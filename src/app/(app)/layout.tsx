import { redirect } from "next/navigation";
import { NavBar } from "@/components/nav-bar";
import { getViewer } from "@/lib/users";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Deactivating bans the account at the Supabase auth level, but an access
  // token already in a browser stays valid until it expires. Checking the
  // flag here drops a deactivated user on their very next page view instead.
  // getViewer is cache()d, so this shares the NavBar's lookup.
  const viewer = await getViewer();
  if (viewer && !viewer.active) redirect("/login?deactivated=1");

  return (
    <div className="flex min-h-screen flex-col">
      <NavBar />
      <main className="flex-1">{children}</main>
    </div>
  );
}
