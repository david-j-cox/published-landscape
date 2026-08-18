"use client";

import { useActionState } from "react";
import { removeUser, setActive, setRole, type AdminState } from "./actions";
import { LocalTime } from "./local-time";
import { ROLE_LABELS, type Journal, type ManagedUser, type Role } from "@/lib/types";

const idle: AdminState = { status: "idle" };

const cellClass = "px-3 py-2 align-middle";
const selectClass =
  "rounded-md border border-neutral-300 px-2 py-1 text-sm disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900";

export function UserRow({
  user,
  isSelf,
  journals,
  assignable,
  canPickJournal,
  canDelete,
}: {
  user: ManagedUser;
  isSelf: boolean;
  journals: Journal[];
  assignable: Role[];
  canPickJournal: boolean;
  canDelete: boolean;
}) {
  const [roleState, saveRole, savingRole] = useActionState(setRole, idle);
  const [activeState, toggleActive, togglingActive] = useActionState(setActive, idle);
  const [removeState, remove, removing] = useActionState(removeUser, idle);

  const message = roleState.message ?? activeState.message ?? removeState.message;
  const failed =
    roleState.status === "error" || activeState.status === "error" || removeState.status === "error";

  // Someone whose role the viewer can't assign (an EiC seen by another EiC,
  // say) is shown read-only rather than hidden - context without control.
  const editable = !isSelf && assignable.includes(user.role);

  return (
    <>
      <tr className="border-t border-neutral-200 dark:border-neutral-800">
        <td className={cellClass}>
          <span className={`font-medium ${user.active ? "" : "text-neutral-400 line-through"}`}>
            {user.email}
          </span>
          {isSelf && <span className="ml-2 text-xs text-neutral-400">you</span>}
          {!user.active && (
            <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              deactivated
            </span>
          )}
          {user.active && !user.activated && (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              invite pending
            </span>
          )}
        </td>
        <td className={cellClass}>
          {editable ? (
            <form action={saveRole} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="userId" value={user.id} />
              <select name="role" defaultValue={user.role} className={selectClass}>
                {assignable.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
              {canPickJournal ? (
                <select
                  name="journalId"
                  defaultValue={user.journalId ?? ""}
                  className={`${selectClass} max-w-[15rem] truncate`}
                >
                  <option value="">No journal</option>
                  {journals.map((journal) => (
                    <option key={journal.id} value={journal.id}>
                      {journal.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input type="hidden" name="journalId" value={user.journalId ?? ""} />
              )}
              <button
                type="submit"
                disabled={savingRole}
                className="text-xs text-neutral-500 underline disabled:opacity-50 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                {savingRole ? "Saving..." : "Save"}
              </button>
            </form>
          ) : (
            <span className="text-neutral-500">
              {ROLE_LABELS[user.role]}
              {!canPickJournal && user.journalId !== null && (
                <span className="ml-2 text-xs text-neutral-400">
                  {journals.find((j) => j.id === user.journalId)?.name}
                </span>
              )}
            </span>
          )}
        </td>
        <td className={`${cellClass} whitespace-nowrap text-neutral-500`}>
          <LocalTime value={user.lastSignInAt} empty="never" withTime />
        </td>
        <td className={`${cellClass} text-neutral-500`}>{user.loginCount || "-"}</td>
        <td className={`${cellClass} whitespace-nowrap text-right`}>
          {!isSelf && (
            <div className="flex items-center justify-end gap-3">
              <form action={toggleActive}>
                <input type="hidden" name="userId" value={user.id} />
                <input type="hidden" name="active" value={user.active ? "false" : "true"} />
                <button
                  type="submit"
                  disabled={togglingActive}
                  className="text-xs text-neutral-500 underline disabled:opacity-50 hover:text-neutral-900 dark:hover:text-neutral-100"
                >
                  {togglingActive ? "..." : user.active ? "Deactivate" : "Reactivate"}
                </button>
              </form>
              {canDelete && (
                <form
                  action={remove}
                  onSubmit={(event) => {
                    // Deletion can't be undone - they'd need a fresh invite
                    // and would lose their password. Deactivating is usually
                    // what's wanted, so make the difference explicit.
                    if (
                      !window.confirm(
                        `Permanently delete ${user.email}?\n\nThis cannot be undone. To free up their seat while keeping the account, use Deactivate instead.`,
                      )
                    ) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="userId" value={user.id} />
                  <button
                    type="submit"
                    disabled={removing}
                    className="text-xs text-red-600 underline disabled:opacity-50"
                  >
                    {removing ? "Deleting..." : "Delete"}
                  </button>
                </form>
              )}
            </div>
          )}
        </td>
      </tr>
      {message && (
        <tr>
          <td
            colSpan={5}
            className={`px-3 pb-2 text-xs ${failed ? "text-red-600" : "text-neutral-500"}`}
          >
            {message}
          </td>
        </tr>
      )}
    </>
  );
}
