"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { status: "idle" | "sent" | "error"; message?: string };

// Only allow same-origin relative paths as the post-login destination, so a
// crafted ?next=https://evil.example can't turn login into an open redirect.
function safeNext(next: FormDataEntryValue | null): string {
  const value = String(next ?? "");
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  if (!email || !password) {
    return { status: "error", message: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const invalid = error.code === "invalid_credentials" || /invalid login credentials/i.test(error.message);
    return {
      status: "error",
      message: invalid
        ? "Incorrect email or password. If this is your first time here, set a password below."
        : error.message,
    };
  }

  // redirect throws, so it must live outside any try/catch.
  redirect(safeNext(formData.get("next")));
}

export async function sendPasswordReset(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") || "").trim();
  if (!email) return { status: "error", message: "Enter your email address first." };

  const supabase = await createClient();
  // resetPasswordForEmail never creates a user and (to avoid account
  // enumeration) doesn't error on unknown addresses - so invite-only is
  // preserved and the message stays deliberately vague.
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/update-password`,
  });

  if (error) return { status: "error", message: error.message };
  return {
    status: "sent",
    message: `If ${email} is on the reviewer/editor list, a link to set your password is on its way.`,
  };
}
