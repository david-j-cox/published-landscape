import { notFound } from "next/navigation";
import { getLoginEvents, getManagedUsers, getViewer } from "@/lib/users";
import { InviteForm } from "./invite-form";
import { LocalTime } from "./local-time";
import { UserRow } from "./user-row";

const METHOD_LABELS: Record<string, string> = {
  password: "password",
  magic_link: "email link",
  recovery: "password reset",
};

export default async function AdminPage() {
  const viewer = await getViewer();
  // 404 rather than a 403: there's no reason to confirm this route exists to a
  // reviewer who wandered in.
  if (!viewer || viewer.role !== "admin") notFound();

  const [users, events] = await Promise.all([getManagedUsers(), getLoginEvents()]);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-lg font-semibold">Admin</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {users.length} {users.length === 1 ? "account" : "accounts"}. Only invited addresses can
        sign in.
      </p>

      <h2 className="mt-8 text-sm font-semibold">Invite someone</h2>
      <p className="mb-3 mt-1 text-sm text-neutral-500">
        They get an email link to set a password. Editors and admins can do everything a reviewer
        can; admins also see this page.
      </p>
      <InviteForm />

      <h2 className="mt-10 text-sm font-semibold">People</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-neutral-400">
            <tr>
              <th className="px-3 pb-2 font-medium">Email</th>
              <th className="px-3 pb-2 font-medium">Role</th>
              <th className="px-3 pb-2 font-medium">Last sign-in</th>
              <th className="px-3 pb-2 font-medium">Sign-ins</th>
              <th className="px-3 pb-2 font-medium">Added</th>
              <th className="px-3 pb-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <UserRow key={user.id} user={user} isSelf={user.id === viewer.id} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 px-3 text-xs text-neutral-400">
        Last sign-in comes from Supabase and covers all time. The Sign-ins count only covers
        activity since login logging was added.
      </p>

      <h2 className="mt-10 text-sm font-semibold">Recent sign-ins</h2>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">
          Nothing recorded yet - this fills in as people sign in from now on.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="px-3 pb-2 font-medium">When</th>
                <th className="px-3 pb-2 font-medium">Who</th>
                <th className="px-3 pb-2 font-medium">Method</th>
                <th className="px-3 pb-2 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="whitespace-nowrap px-3 py-2 text-neutral-500">
                    <LocalTime value={event.createdAt} withTime />
                  </td>
                  <td className="px-3 py-2">{event.email}</td>
                  <td className="px-3 py-2 text-neutral-500">
                    {METHOD_LABELS[event.method] ?? event.method}
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{event.ip ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
