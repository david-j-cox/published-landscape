import "server-only";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role client. Two things need it that a session-scoped client can't
// do: read auth.users (the auth schema isn't exposed to anon/authenticated at
// all, so last_sign_in_at is only reachable here) and invite/delete users.
//
// The key is a full-database credential that bypasses RLS - "server-only"
// above makes importing this from a Client Component a build error.
export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createSupabaseClient(url, key, {
    // No cookies to read and no session to keep: every call is a one-shot
    // request authenticated by the key itself.
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
