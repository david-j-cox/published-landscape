import { notFound } from "next/navigation";
import { getJournals } from "@/lib/data";
import { assignableRoles, getLoginEvents, getManagedUsers, getViewer } from "@/lib/users";
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
  // 404 rather than a 403: there's no reason to confirm this route exists to
  // an AE who wandered in.
  if (!viewer || (viewer.role !== "admin" && viewer.role !== "eic")) notFound();

  const journals = getJournals();
  const [users, events] = await Promise.all([getManagedUsers(viewer), getLoginEvents(viewer)]);

  const isAdmin = viewer.role === "admin";
  const assignable = assignableRoles(viewer);
  const ownJournal = journals.find((j) => j.id === viewer.journalId);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-lg font-semibold">{isAdmin ? "Admin" : "Editors"}</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {isAdmin ? (
          <>
            {users.length} {users.length === 1 ? "account" : "accounts"} across all journals. Only
            invited addresses can sign in.
          </>
        ) : (
          <>
            Associate Editors for {ownJournal?.name ?? "your journal"}. Everyone you add browses all{" "}
            {journals.length} journals; the journal only decides who you administer.
          </>
        )}
      </p>

      <h2 className="mt-8 text-sm font-semibold">
        {isAdmin ? "Invite someone" : "Add an Associate Editor"}
      </h2>
      <p className="mb-3 mt-1 text-sm text-neutral-500">
        They get an email link to set a password.
        {isAdmin
          ? " An Editor-in-Chief needs a journal - they can add and remove that journal's AEs themselves."
          : ` They'll be added to ${ownJournal?.name ?? "your journal"}.`}
      </p>
      <InviteForm
        journals={journals}
        assignable={assignable}
        canPickJournal={isAdmin}
        fixedJournalId={viewer.journalId}
      />

      <h2 className="mt-10 text-sm font-semibold">People</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-neutral-400">
            <tr>
              <th className="px-3 pb-2 font-medium">Email</th>
              <th className="px-3 pb-2 font-medium">{isAdmin ? "Role and journal" : "Role"}</th>
              <th className="px-3 pb-2 font-medium">Last sign-in</th>
              <th className="px-3 pb-2 font-medium">Sign-ins</th>
              <th className="px-3 pb-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                isSelf={user.id === viewer.id}
                journals={journals}
                assignable={assignable}
                canPickJournal={isAdmin}
                canDelete={isAdmin}
              />
            ))}
            {users.length === 0 && (
              <tr className="border-t border-neutral-200 dark:border-neutral-800">
                <td colSpan={5} className="px-3 py-6 text-sm text-neutral-400">
                  Nobody yet. Invite your first Associate Editor above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 px-3 text-xs text-neutral-400">
        Deactivating blocks sign-in and frees a seat while keeping the person&apos;s history -
        that&apos;s the one to use when a guest AE&apos;s term ends. Last sign-in comes from Supabase
        and covers all time; the Sign-ins count only covers activity since login logging was added.
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
