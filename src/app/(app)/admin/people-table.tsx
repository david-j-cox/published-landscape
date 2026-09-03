"use client";

import { useMemo, useState } from "react";
import { ROLE_LABELS, type Journal, type ManagedUser, type Role } from "@/lib/types";
import { UserRow } from "./user-row";

const selectClass =
  "rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900";

type Group = { key: string; name: string; users: ManagedUser[] };

/** True for someone with no journal, or one that isn't in the corpus list. */
function isUnassigned(user: ManagedUser, journalIds: Set<number>): boolean {
  return user.journalId === null || !journalIds.has(user.journalId);
}

/** Journals in corpus order, each with its people; unassigned last. */
function groupByJournal(users: ManagedUser[], journals: Journal[]): Group[] {
  const groups: Group[] = [];
  for (const journal of journals) {
    const members = users.filter((u) => u.journalId === journal.id);
    if (members.length > 0) {
      groups.push({ key: String(journal.id), name: journal.name, users: members });
    }
  }
  const known = new Set(journals.map((j) => j.id));
  const unassigned = users.filter((u) => isUnassigned(u, known));
  if (unassigned.length > 0) groups.push({ key: "none", name: "No journal", users: unassigned });
  return groups;
}

export function PeopleHead({ isAdmin }: { isAdmin: boolean }) {
  return (
    <thead className="text-xs uppercase tracking-wide text-neutral-400">
      <tr>
        <th className="px-3 pb-2 font-medium">Email</th>
        <th className="px-3 pb-2 font-medium">{isAdmin ? "Role and journal" : "Role"}</th>
        <th className="whitespace-nowrap px-3 pb-2 font-medium">Last sign-in</th>
        <th className="whitespace-nowrap px-3 pb-2 font-medium">Sign-ins</th>
        <th className="px-3 pb-2" />
      </tr>
    </thead>
  );
}

/**
 * The active roster, with role and journal filters.
 *
 * Filtering happens here rather than through the URL because the whole roster
 * is already on the page: a search param would mean a server round trip, and
 * another listUsers call against Supabase, for what is a dropdown.
 */
export function PeopleTable({
  users,
  journals,
  viewerId,
  assignable,
  canPickJournal,
  canDelete,
  isAdmin,
  archivedCount,
}: {
  users: ManagedUser[];
  journals: Journal[];
  viewerId: string;
  assignable: Role[];
  canPickJournal: boolean;
  canDelete: boolean;
  isAdmin: boolean;
  archivedCount: number;
}) {
  // "" is no filter; journal also takes "none" for the unassigned.
  const [role, setRole] = useState<Role | "">("");
  const [journal, setJournal] = useState<string>("");

  const journalIds = useMemo(() => new Set(journals.map((j) => j.id)), [journals]);

  // Only offer options that can actually match, so the filters never lead to
  // an empty table by way of a role nobody on this page holds.
  const rolesPresent = useMemo(() => {
    const present = new Set(users.map((u) => u.role));
    return (Object.keys(ROLE_LABELS) as Role[]).filter((r) => present.has(r));
  }, [users]);

  const journalsPresent = useMemo(
    () => journals.filter((j) => users.some((u) => u.journalId === j.id)),
    [journals, users],
  );

  const hasUnassigned = useMemo(
    () => users.some((u) => isUnassigned(u, journalIds)),
    [users, journalIds],
  );

  const filtered = useMemo(
    () =>
      users.filter((user) => {
        if (role !== "" && user.role !== role) return false;
        if (journal === "none") return isUnassigned(user, journalIds);
        if (journal !== "") return user.journalId === Number(journal);
        return true;
      }),
    [users, role, journal, journalIds],
  );

  const filtering = role !== "" || journal !== "";

  // An EiC only ever sees their own journal's people, so per-journal headings
  // would be a single heading over the whole table - that's an admin view.
  const groups = isAdmin
    ? groupByJournal(filtered, journals)
    : [{ key: "all", name: "", users: filtered }];

  return (
    <>
      {users.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role | "")}
            className={selectClass}
            aria-label="Filter people by role"
          >
            <option value="">All roles</option>
            {rolesPresent.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>

          {canPickJournal && (
            <select
              value={journal}
              onChange={(e) => setJournal(e.target.value)}
              className={`${selectClass} max-w-[15rem] truncate`}
              aria-label="Filter people by journal"
            >
              <option value="">All journals</option>
              {journalsPresent.map((j) => (
                <option key={j.id} value={String(j.id)}>
                  {j.name}
                </option>
              ))}
              {hasUnassigned && <option value="none">No journal</option>}
            </select>
          )}

          {filtering && (
            <>
              <span className="text-neutral-400">
                {filtered.length} of {users.length}
              </span>
              <button
                type="button"
                onClick={() => {
                  setRole("");
                  setJournal("");
                }}
                className="text-blue-600 underline dark:text-blue-400"
              >
                Clear filters
              </button>
            </>
          )}
        </div>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <PeopleHead isAdmin={isAdmin} />
          {groups.map((group) => (
            <tbody key={group.key}>
              {group.name && (
                <tr>
                  <th
                    colSpan={5}
                    className="border-t border-neutral-200 px-3 pb-1 pt-4 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:border-neutral-800"
                  >
                    {group.name}
                    <span className="ml-2 font-normal normal-case tracking-normal text-neutral-400">
                      {group.users.length} active
                    </span>
                  </th>
                </tr>
              )}
              {group.users.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  isSelf={user.id === viewerId}
                  journals={journals}
                  assignable={assignable}
                  canPickJournal={canPickJournal}
                  canDelete={canDelete}
                />
              ))}
            </tbody>
          ))}
          {filtered.length === 0 && (
            <tbody>
              <tr className="border-t border-neutral-200 dark:border-neutral-800">
                <td colSpan={5} className="px-3 py-6 text-sm text-neutral-400">
                  {filtering
                    ? "Nobody active matches those filters."
                    : archivedCount > 0
                      ? "Nobody active - everyone is in the archive below."
                      : "Nobody yet. Invite your first Associate Editor above."}
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>
    </>
  );
}
