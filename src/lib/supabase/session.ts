import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";

const PUBLIC_PATHS = ["/login", "/auth/confirm", "/auth/error"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

let warnedUnconfigured = false;

// Refreshes the Supabase session cookie on every request and redirects
// unauthenticated visitors to /login. This is the whole-site gate: every
// route is private by default except PUBLIC_PATHS.
export async function updateSession(request: NextRequest) {
  if (!isSupabaseConfigured) {
    if (!warnedUnconfigured) {
      console.warn(
        "[auth] NEXT_PUBLIC_SUPABASE_URL/ANON_KEY not set - the login gate is DISABLED. " +
          "Copy .env.local.example to .env.local and fill in a Supabase project to enable it.",
      );
      warnedUnconfigured = true;
    }
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return response;
}
