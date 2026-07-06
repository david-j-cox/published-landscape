"use server";

import { createClient } from "@/lib/supabase/server";

export type LoginState = { status: "idle" | "sent" | "error"; message?: string };

export async function requestMagicLink(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") || "").trim();
  if (!email) return { status: "error", message: "Enter your email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // Invite-only: do not let signInWithOtp create new accounts. Add
      // reviewers/AEs from the Supabase dashboard (Authentication > Users).
      shouldCreateUser: false,
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/confirm`,
    },
  });

  if (error) {
    return {
      status: "error",
      message:
        error.code === "otp_disabled" || /signups not allowed|user not found/i.test(error.message)
          ? "That email isn't on the reviewer/editor list yet. Contact the site admin to be invited."
          : error.message,
    };
  }
  return { status: "sent", message: `Check ${email} for a sign-in link.` };
}
