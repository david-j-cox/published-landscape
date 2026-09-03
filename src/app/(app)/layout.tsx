import { redirect } from "next/navigation";
import { NavBar } from "@/components/nav-bar";
import { getViewer } from "@/lib/users";

// Everything under here reads a database that changes weekly and sits behind
// sign-in, so there is nothing to gain from prerendering at build time and a
// build environment has no database to prerender from.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Deactivating bans the account at the Supabase auth level, but an access
  // token already in a browser stays valid until it expires. Checking the
  // flag here drops a deactivated user on their very next page view instead.
  // getViewer is cache()d, so this shares the NavBar's lookup.
  const viewer = await getViewer();
  if (viewer && !viewer.active) redirect("/login?deactivated=1");
  // Someone who signed in with the temporary password we emailed has exactly
  // one destination until they replace it. /update-password lives outside
  // this layout, so this can't loop.
  if (viewer?.mustSetPassword) redirect("/update-password");

  return (
    <div className="flex min-h-screen flex-col">
      <NavBar />
      <main className="flex-1">{children}</main>
    </div>
  );
}
