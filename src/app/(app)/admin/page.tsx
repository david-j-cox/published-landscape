import { notFound } from "next/navigation";
import { getJournals } from "@/lib/data";
import { isEmailConfigured } from "@/lib/email";
import { assignableRoles, getLoginEvents, getManagedUsers, getViewer } from "@/lib/users";
import { InviteForm } from "./invite-form";
import { LocalTime } from "./local-time";
import { PeopleHead, PeopleTable } from "./people-table";
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

  // The journal ids come from the shared corpus now, and profiles.journal_id
  // still references the twelve rows seeded into Supabase by migration 0005.
  // They agree because the corpus pipeline assigns ids by list order and only
  // ever appends, so the first twelve are the seed in the seed's order.
  const [journals, users, events] = await Promise.all([
    getJournals(),
    getManagedUsers(viewer),
    getLoginEvents(viewer),
  ]);

  const isAdmin = viewer.role === "admin";
  const assignable = assignableRoles(viewer);
  const ownJournal = journals.find((j) => j.id === viewer.journalId);

  // Deactivated accounts keep their history but clutter the working list, so
  // they live in the Archive block below rather than inline.
  const active = users.filter((u) => u.active);
  const archived = users.filter((u) => !u.active);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="text-lg font-semibold">{isAdmin ? "Admin" : "Editors"}</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {isAdmin ? (
          <>
            {active.length} active {active.length === 1 ? "account" : "accounts"} across all
            journals{archived.length > 0 ? `, ${archived.length} archived` : ""}. Only addresses
            added here can sign in.
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
        The account is created straight away and they&apos;re emailed a temporary password plus a
        link to the sign-in page - nothing in that email expires, and they pick their own password
        the first time they sign in.
        {isAdmin
          ? " An Editor-in-Chief needs a journal - they can add and remove that journal's AEs themselves."
          : ` They'll be added to ${ownJournal?.name ?? "your journal"}.`}
      </p>
      {!isEmailConfigured && (
        <p className="mb-3 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
          RESEND_API_KEY and EMAIL_FROM aren&apos;t set on this deployment, so nothing is emailed.
          Accounts are still created - the temporary password is shown here for you to send on
          yourself.
        </p>
      )}
      <InviteForm
        journals={journals}
        assignable={assignable}
        canPickJournal={isAdmin}
        fixedJournalId={viewer.journalId}
      />

      <h2 className="mt-10 text-sm font-semibold">People</h2>
      <PeopleTable
        users={active}
        journals={journals}
        viewerId={viewer.id}
        assignable={assignable}
        canPickJournal={isAdmin}
        canDelete={isAdmin}
        isAdmin={isAdmin}
        archivedCount={archived.length}
      />

      {archived.length > 0 && (
        <details className="group mt-6 rounded-md border border-neutral-200 dark:border-neutral-800">
          <summary className="cursor-pointer list-none px-3 py-2 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
            <span className="inline-block w-4 transition-transform group-open:rotate-90">&rsaquo;</span>
            Archive
            <span className="ml-2 text-xs text-neutral-400">
              {archived.length} deactivated {archived.length === 1 ? "account" : "accounts"}
            </span>
          </summary>
          <div className="overflow-x-auto border-t border-neutral-200 pb-2 dark:border-neutral-800">
            <table className="w-full text-left text-sm">
              <PeopleHead isAdmin={isAdmin} />
              <tbody>
                {archived.map((user) => (
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
              </tbody>
            </table>
          </div>
        </details>
      )}

      <p className="mt-2 px-3 text-xs text-neutral-400">
        &quot;New password&quot; emails someone a fresh temporary password and invalidates their old
        one - that&apos;s the answer to &quot;I never got the email&quot; or a forgotten password.
        Deactivating blocks sign-in and frees a seat while keeping the person&apos;s history -
        that&apos;s the one to use when a guest AE&apos;s term ends, and it files them under Archive
        above. Last sign-in comes from Supabase and covers all time; the Sign-ins count only covers
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
