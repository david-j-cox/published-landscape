import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getViewer } from "@/lib/users";
import { signOut } from "@/app/logout/actions";

export async function NavBar() {
  const viewer = await getViewer();

  return (
    <div>
      {!isSupabaseConfigured && (
        <div className="bg-amber-100 px-6 py-1.5 text-center text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
          Supabase not configured - the login gate is disabled. See .env.local.example.
        </div>
      )}
      <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-3 text-sm dark:border-neutral-800">
        <nav className="flex items-center gap-5">
          <Link href="/" className="font-semibold">
            Published Landscape
          </Link>
          <Link href="/map" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
            Topic map
          </Link>
          <Link href="/articles" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
            Articles
          </Link>
          <Link href="/submit" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
            See where a new article lands
          </Link>
          {(viewer?.role === "admin" || viewer?.role === "eic") && (
            <Link href="/admin" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
              {viewer.role === "admin" ? "Admin" : "Editors"}
            </Link>
          )}
          <Link href="/nerds" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
            For Nerds
          </Link>
        </nav>
        {viewer && (
          <form action={signOut} className="flex items-center gap-3">
            <span className="text-neutral-500">{viewer.email}</span>
            <button type="submit" className="text-neutral-500 underline hover:text-neutral-900 dark:hover:text-neutral-100">
              Sign out
            </button>
          </form>
        )}
      </header>
    </div>
  );
}
