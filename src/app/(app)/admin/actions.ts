"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEmailConfigured, sendWelcomeEmail } from "@/lib/email";
import { generateTempPassword } from "@/lib/temp-password";
import { assignableRoles, canManage, getViewer } from "@/lib/users";
import { isRole, type Role, type Viewer } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AdminState = {
  status: "idle" | "ok" | "error";
  message?: string;
  /**
   * Set when an action mints a temporary password. /admin shows it once so
   * an editor can pass it on by hand - which is the only recourse when the
   * mail send fails, and a useful backup when it succeeds but the message is
   * still crawling through a university spam filter.
   */
  credentials?: { email: string; password: string };
};

// Long enough to be indefinite; Supabase has no "forever", and 'none' lifts
// it. Deactivation is reversible by design - guest AEs rotate back.
const BAN_FOREVER = "876000h";

// Server Actions are reachable by direct POST, not only through the page that
// renders them - so each one re-checks the caller's role rather than trusting
// that they got past /admin's own check.
async function gate(): Promise<{ error: string } | { viewer: Viewer; admin: SupabaseClient }> {
  const viewer = await getViewer();
  if (!viewer || (viewer.role !== "admin" && viewer.role !== "eic")) {
    return { error: "Not authorized." };
  }
  if (!viewer.active) return { error: "Your account is deactivated." };

  const admin = createAdminClient();
  if (!admin) return { error: "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment." };

  return { viewer, admin };
}

/**
 * Re-reads the target's current role and journal from the database rather
 * than trusting anything the form submitted, then checks the viewer may act
 * on them. A form field claiming role=ae is not evidence that they are one.
 */
async function loadManageableTarget(
  admin: SupabaseClient,
  viewer: Viewer,
  userId: string,
): Promise<{ error: string } | { target: { id: string; role: Role; journalId: number | null } }> {
  if (!userId) return { error: "Missing user." };

  const { data, error } = await admin
    .from("profiles")
    .select("id, role, journal_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "That account no longer exists." };

  const target = {
    id: data.id as string,
    role: (isRole(data.role) ? data.role : "ae") as Role,
    journalId: (data.journal_id as number | null) ?? null,
  };
  if (!canManage(viewer, target)) return { error: "Not authorized to manage that account." };

  return { target };
}

export async function setRole(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const g = await gate();
  if ("error" in g) return { status: "error", message: g.error };

  const userId = String(formData.get("userId") || "");
  const role = String(formData.get("role") || "");
  const journalRaw = String(formData.get("journalId") || "");

  if (!isRole(role)) return { status: "error", message: "Pick a valid role." };
  if (!assignableRoles(g.viewer).includes(role)) {
    return { status: "error", message: `You can't assign the ${role} role.` };
  }

  // No self-demotion: it's the one change that can lock the last admin out of
  // this page, and recovering needs SQL access.
  if (userId === g.viewer.id) {
    return { status: "error", message: "You can't change your own role here." };
  }

  const found = await loadManageableTarget(g.admin, g.viewer, userId);
  if ("error" in found) return { status: "error", message: found.error };

  // An EiC can't move anyone between journals - their scope is fixed to their
  // own - so the submitted journal is only honoured for admins.
  const journalId =
    g.viewer.role === "admin"
      ? journalRaw === ""
        ? null
        : Number(journalRaw)
      : g.viewer.journalId;

  if (journalId !== null && !Number.isInteger(journalId)) {
    return { status: "error", message: "Pick a valid journal." };
  }
  // Mirrors the profiles_eic_needs_journal constraint, so the user gets a
  // sentence instead of a raw Postgres error.
  if (role === "eic" && journalId === null) {
    return { status: "error", message: "An Editor-in-Chief needs a journal." };
  }

  const { error } = await g.admin.from("profiles").update({ role, journal_id: journalId }).eq("id", userId);
  if (error) return { status: "error", message: error.message };

  revalidatePath("/admin");
  return { status: "ok", message: "Saved." };
}

export async function setActive(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const g = await gate();
  if ("error" in g) return { status: "error", message: g.error };

  const userId = String(formData.get("userId") || "");
  const active = String(formData.get("active") || "") === "true";

  if (userId === g.viewer.id) {
    return { status: "error", message: "You can't deactivate your own account." };
  }

  const found = await loadManageableTarget(g.admin, g.viewer, userId);
  if ("error" in found) return { status: "error", message: found.error };

  // Banning at the auth level stops new tokens from being issued; the flag is
  // what the app checks on each request, which is what makes an already
  // signed-in user drop out immediately rather than at token expiry.
  const { error: banError } = await g.admin.auth.admin.updateUserById(userId, {
    ban_duration: active ? "none" : BAN_FOREVER,
  });
  if (banError) return { status: "error", message: banError.message };

  const { error } = await g.admin.from("profiles").update({ active }).eq("id", userId);
  if (error) return { status: "error", message: error.message };

  revalidatePath("/admin");
  return { status: "ok", message: active ? "Reactivated." : "Deactivated." };
}

export async function removeUser(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const g = await gate();
  if ("error" in g) return { status: "error", message: g.error };

  // Deletion is irreversible and deactivation covers the rotating-guest case,
  // so it stays with admins rather than EiCs.
  if (g.viewer.role !== "admin") {
    return { status: "error", message: "Only an admin can delete an account. Deactivate instead." };
  }

  const userId = String(formData.get("userId") || "");
  if (!userId) return { status: "error", message: "Missing user." };
  if (userId === g.viewer.id) {
    return { status: "error", message: "You can't remove your own account." };
  }

  // Deletes the auth.users row; profiles cascades, and login_events keeps its
  // rows with user_id nulled so the sign-in history survives.
  const { error } = await g.admin.auth.admin.deleteUser(userId);
  if (error) return { status: "error", message: error.message };

  revalidatePath("/admin");
  return { status: "ok", message: "Account deleted." };
}

/**
 * Mails someone their temporary password and turns the outcome into a
 * sentence for /admin.
 *
 * A failed send is deliberately not a failed action: the account exists and
 * the password works either way, so the useful thing to do is hand the
 * credentials to the editor rather than roll everything back and leave them
 * with nothing.
 */
async function deliverPassword(options: {
  email: string;
  tempPassword: string;
  invitedBy: string;
  reissued: boolean;
}): Promise<string> {
  const { email, tempPassword, invitedBy, reissued } = options;

  if (!isEmailConfigured) {
    return "Email sending isn't configured on this deployment, so send them these details yourself:";
  }

  const sent = await sendWelcomeEmail({
    to: email,
    tempPassword,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL!,
    invitedBy,
    reissued,
  });

  if (!sent.ok) {
    console.error("[admin] welcome email failed", sent.error);
    return `The email didn't go out (${sent.error}), so send them these details yourself:`;
  }

  return `Emailed to ${email}. If it doesn't arrive, these are the details to pass on by hand:`;
}

/**
 * Creates the account outright, with a temporary password, and emails it.
 *
 * Supabase's own inviteUserByEmail is deliberately not used: it sends a
 * one-time, time-limited token link, which expires while the message sits in
 * a junk folder and gets spent outright by mail scanners that follow links
 * before the human does. Nothing in this flow can expire or be consumed in
 * transit - profiles.must_set_password is what makes the password temporary
 * instead of the clock.
 */
export async function inviteUser(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const g = await gate();
  if ("error" in g) return { status: "error", message: g.error };

  const email = String(formData.get("email") || "").trim();
  const role = String(formData.get("role") || "ae");
  const journalRaw = String(formData.get("journalId") || "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: "error", message: "Enter a valid email address." };
  }
  if (!isRole(role) || !assignableRoles(g.viewer).includes(role)) {
    return { status: "error", message: "You can't invite someone with that role." };
  }

  // An EiC only ever adds AEs to their own journal, whatever the form says.
  const journalId =
    g.viewer.role === "admin" ? (journalRaw === "" ? null : Number(journalRaw)) : g.viewer.journalId;

  if (journalId !== null && !Number.isInteger(journalId)) {
    return { status: "error", message: "Pick a valid journal." };
  }
  if (role === "eic" && journalId === null) {
    return { status: "error", message: "An Editor-in-Chief needs a journal." };
  }

  if (!process.env.NEXT_PUBLIC_SITE_URL) {
    return { status: "error", message: "NEXT_PUBLIC_SITE_URL is not set, so the sign-in link would be broken." };
  }

  const tempPassword = generateTempPassword();
  // email_confirm marks the address verified without a round trip. There is
  // no confirmation link to click, and knowing the password is itself the
  // proof of receipt that a confirmation link would have been.
  const { data, error } = await g.admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });

  if (error) {
    const exists = /already been registered|already exists/i.test(error.message);
    return {
      status: "error",
      message: exists
        ? `${email} already has an account. Use "New password" on their row to send them a fresh one.`
        : error.message,
    };
  }

  // The on_auth_user_created trigger inserts the profile with the column
  // defaults ('ae', no journal, must_set_password false), so the real values
  // are set afterwards.
  if (data.user) {
    const { error: profileError } = await g.admin
      .from("profiles")
      .update({ role, journal_id: journalId, must_set_password: true })
      .eq("id", data.user.id);
    if (profileError) {
      revalidatePath("/admin");
      return {
        status: "error",
        message: `Created ${email}, but saving their role failed: ${profileError.message}`,
      };
    }
  }

  const message = await deliverPassword({
    email,
    tempPassword,
    invitedBy: g.viewer.email,
    reissued: false,
  });

  revalidatePath("/admin");
  return { status: "ok", message, credentials: { email, password: tempPassword } };
}

/**
 * Issues a fresh temporary password for an existing account and emails it.
 *
 * This is the recovery path for anyone holding an unusable invite link from
 * the old flow, and the everyday answer to "I never got it" - unlike the
 * self-service reset on the sign-in page, it doesn't depend on the person
 * being able to receive and click a link within the hour.
 */
export async function resetTempPassword(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const g = await gate();
  if ("error" in g) return { status: "error", message: g.error };

  const userId = String(formData.get("userId") || "");
  if (userId === g.viewer.id) {
    return { status: "error", message: "Change your own password from the sign-in page instead." };
  }

  const found = await loadManageableTarget(g.admin, g.viewer, userId);
  if ("error" in found) return { status: "error", message: found.error };

  if (!process.env.NEXT_PUBLIC_SITE_URL) {
    return { status: "error", message: "NEXT_PUBLIC_SITE_URL is not set, so the sign-in link would be broken." };
  }

  const { data: authUser, error: lookupError } = await g.admin.auth.admin.getUserById(userId);
  if (lookupError) return { status: "error", message: lookupError.message };
  const email = authUser.user?.email;
  if (!email) return { status: "error", message: "That account has no email address." };

  const tempPassword = generateTempPassword();
  // email_confirm here is what rescues accounts left unconfirmed by the old
  // invite flow: without it they can hold a valid password and still be
  // refused at sign-in.
  const { error } = await g.admin.auth.admin.updateUserById(userId, {
    password: tempPassword,
    email_confirm: true,
  });
  if (error) return { status: "error", message: error.message };

  const { error: profileError } = await g.admin
    .from("profiles")
    .update({ must_set_password: true })
    .eq("id", userId);
  if (profileError) return { status: "error", message: profileError.message };

  const message = await deliverPassword({
    email,
    tempPassword,
    invitedBy: g.viewer.email,
    reissued: true,
  });

  revalidatePath("/admin");
  return { status: "ok", message, credentials: { email, password: tempPassword } };
}
