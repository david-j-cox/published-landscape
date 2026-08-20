"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type UpdatePasswordState = { status: "idle" | "error"; message?: string };

export async function updatePassword(
  _prev: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");

  if (password.length < 8) {
    return { status: "error", message: "Password must be at least 8 characters." };
  }
  if (password !== confirm) {
    return { status: "error", message: "The two passwords don't match." };
  }

  const supabase = await createClient();
  // Reached either by signing in with a temporary password or by following a
  // reset link (handled in /auth/confirm). Both leave a session behind, and
  // the proxy gate guarantees one is present.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      status: "error",
      message: "Your session has ended. Sign in again from the sign-in page.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { status: "error", message: error.message };

  // The password is now theirs rather than one we mailed them, so the flag
  // that pins them to this page comes down. Clearing it needs the service
  // role: profiles isn't self-writable.
  const admin = createAdminClient();
  if (admin) {
    const { error: flagError } = await admin
      .from("profiles")
      .update({ must_set_password: false })
      .eq("id", user.id);
    // Failing here would leave them looping back to this page forever, so
    // it's worth saying out loud rather than redirecting into the trap.
    if (flagError) {
      return {
        status: "error",
        message: `Your password was saved, but the account didn't finish updating: ${flagError.message}. Try signing in again.`,
      };
    }
  }

  // redirect throws, so it must live outside any try/catch.
  redirect("/");
}
