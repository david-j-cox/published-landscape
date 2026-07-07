import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = searchParams.get("next") ?? "/";
  const supabase = await createClient();

  // This project's default email templates use {{ .ConfirmationURL }},
  // which redirects back with a PKCE `code` param (exchanged for a
  // session) rather than the `token_hash`+`type` pair a custom template
  // using {{ .TokenHash }}/{{ .Type }} would send - handle both so this
  // keeps working if the template is ever customized.
  const code = searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) redirect(next);
  }

  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) redirect(next);
  }

  redirect("/auth/error");
}
