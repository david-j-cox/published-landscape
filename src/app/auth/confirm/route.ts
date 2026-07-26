import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recordLogin } from "@/lib/supabase/login-events";
import type { LoginMethod } from "@/lib/types";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = searchParams.get("next") ?? "/";
  const supabase = await createClient();

  async function logAndRedirect(method: LoginMethod) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) await recordLogin(user, method);
    // redirect throws, so nothing after this runs.
    redirect(next);
  }

  // This project's default email templates use {{ .ConfirmationURL }},
  // which redirects back with a PKCE `code` param (exchanged for a
  // session) rather than the `token_hash`+`type` pair a custom template
  // using {{ .TokenHash }}/{{ .Type }} would send - handle both so this
  // keeps working if the template is ever customized.
  const code = searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    // The code itself doesn't say which email it came from; only the reset
    // flow sends people to /update-password, so use that as the tell.
    if (!error) await logAndRedirect(next.startsWith("/update-password") ? "recovery" : "magic_link");
  }

  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) await logAndRedirect(type === "recovery" ? "recovery" : "magic_link");
  }

  redirect("/auth/error");
}
