import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import type { LoginMethod } from "@/lib/types";

// Appends to login_events after a session is established. Called from the
// sign-in action and the /auth/confirm callback - the two places a session can
// come into existence - because Supabase gives us no hook to do it in the
// database.
export async function recordLogin(
  user: { id: string; email?: string | null },
  method: LoginMethod,
) {
  const admin = createAdminClient();
  if (!admin) return;

  try {
    const requestHeaders = await headers();
    // x-forwarded-for is a client-controlled list on the way in; the first
    // entry is the only one Vercel's proxy guarantees, so treat it as a hint
    // rather than evidence.
    const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

    const { error } = await admin.from("login_events").insert({
      user_id: user.id,
      email: user.email ?? "",
      method,
      ip,
      user_agent: requestHeaders.get("user-agent"),
    });
    if (error) throw error;
  } catch (error) {
    // An audit write must never cost someone their sign-in.
    console.error("[auth] could not record login event", error);
  }
}
