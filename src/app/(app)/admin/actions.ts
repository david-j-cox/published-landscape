"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/users";
import { isRole } from "@/lib/types";

export type AdminState = { status: "idle" | "ok" | "error"; message?: string };

// Server Actions are reachable by direct POST, not only through the page that
// renders them - so each one re-checks the role rather than trusting that the
// caller got past /admin's own check.
async function adminClientForCurrentUser() {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== "admin") return { error: "Not authorized." as const };

  const admin = createAdminClient();
  if (!admin) return { error: "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment." as const };

  return { viewer, admin };
}

export async function setRole(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const gate = await adminClientForCurrentUser();
  if ("error" in gate) return { status: "error", message: gate.error };

  const userId = String(formData.get("userId") || "");
  const role = String(formData.get("role") || "");
  if (!userId || !isRole(role)) return { status: "error", message: "Pick a valid role." };

  // No self-demotion: it's the one role change that can lock the last admin
  // out of this page, and recovering needs SQL access. Change your own role
  // from the Supabase SQL editor if you really mean to.
  if (userId === gate.viewer.id) {
    return { status: "error", message: "You can't change your own role here." };
  }

  const { error } = await gate.admin.from("profiles").update({ role }).eq("id", userId);
  if (error) return { status: "error", message: error.message };

  revalidatePath("/admin");
  return { status: "ok", message: `Role set to ${role}.` };
}

export async function removeUser(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const gate = await adminClientForCurrentUser();
  if ("error" in gate) return { status: "error", message: gate.error };

  const userId = String(formData.get("userId") || "");
  if (!userId) return { status: "error", message: "Missing user." };
  if (userId === gate.viewer.id) {
    return { status: "error", message: "You can't remove your own account." };
  }

  // Deletes the auth.users row; profiles cascades, and login_events keeps its
  // rows with user_id nulled so the sign-in history survives.
  const { error } = await gate.admin.auth.admin.deleteUser(userId);
  if (error) return { status: "error", message: error.message };

  revalidatePath("/admin");
  return { status: "ok", message: "Account removed." };
}

export async function inviteUser(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const gate = await adminClientForCurrentUser();
  if ("error" in gate) return { status: "error", message: gate.error };

  const email = String(formData.get("email") || "").trim();
  const role = String(formData.get("role") || "reviewer");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: "error", message: "Enter a valid email address." };
  }
  if (!isRole(role)) return { status: "error", message: "Pick a valid role." };

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    return { status: "error", message: "NEXT_PUBLIC_SITE_URL is not set, so the invite link would be broken." };
  }

  const { data, error } = await gate.admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl}/auth/confirm?next=/update-password`,
  });

  if (error) {
    const exists = /already been registered|already exists/i.test(error.message);
    return {
      status: "error",
      message: exists ? `${email} already has an account.` : error.message,
    };
  }

  // The on_auth_user_created trigger inserts the profile as 'reviewer', so an
  // elevated invite needs a follow-up update.
  if (role !== "reviewer" && data.user) {
    const { error: roleError } = await gate.admin
      .from("profiles")
      .update({ role })
      .eq("id", data.user.id);
    if (roleError) {
      revalidatePath("/admin");
      return {
        status: "error",
        message: `Invited ${email}, but setting the role failed: ${roleError.message}`,
      };
    }
  }

  revalidatePath("/admin");
  return { status: "ok", message: `Invite sent to ${email}.` };
}
