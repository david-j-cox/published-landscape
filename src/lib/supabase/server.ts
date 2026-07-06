import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server Components can't write cookies (no response to attach them to), so
// `setAll` there is a no-op wrapped in try/catch. Session refresh happens in
// proxy.ts, which can write cookies on every request.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // called from a Server Component; proxy.ts refreshes the session instead
          }
        },
      },
    },
  );
}
