"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
  // Requires the session established by the recovery link (handled in
  // /auth/confirm). The middleware gate guarantees a session is present.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      status: "error",
      message: "Your reset link has expired. Request a new one from the sign-in page.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { status: "error", message: error.message };

  // redirect throws, so it must live outside any try/catch.
  redirect("/");
}
