"use client";

import { useActionState } from "react";
import { removeUser, setRole, type AdminState } from "./actions";
import { LocalTime } from "./local-time";
import { ROLES, type ManagedUser } from "@/lib/types";

const idle: AdminState = { status: "idle" };

const cellClass = "px-3 py-2 align-middle";

export function UserRow({ user, isSelf }: { user: ManagedUser; isSelf: boolean }) {
  const [roleState, saveRole, savingRole] = useActionState(setRole, idle);
  const [removeState, remove, removing] = useActionState(removeUser, idle);
  const message = roleState.message ?? removeState.message;
  const failed = roleState.status === "error" || removeState.status === "error";

  return (
    <>
      <tr className="border-t border-neutral-200 dark:border-neutral-800">
        <td className={cellClass}>
          <span className="font-medium">{user.email}</span>
          {isSelf && <span className="ml-2 text-xs text-neutral-400">you</span>}
          {!user.activated && (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              invite pending
            </span>
          )}
        </td>
        <td className={cellClass}>
          <form action={saveRole} className="flex items-center gap-2">
            <input type="hidden" name="userId" value={user.id} />
            <select
              name="role"
              defaultValue={user.role}
              disabled={isSelf}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            {!isSelf && (
              <button
                type="submit"
                disabled={savingRole}
                className="text-xs text-neutral-500 underline disabled:opacity-50 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                {savingRole ? "Saving..." : "Save"}
              </button>
            )}
          </form>
        </td>
        <td className={`${cellClass} whitespace-nowrap text-neutral-500`}>
          <LocalTime value={user.lastSignInAt} empty="never" withTime />
        </td>
        <td className={`${cellClass} text-neutral-500`}>{user.loginCount || "-"}</td>
        <td className={`${cellClass} whitespace-nowrap text-neutral-500`}>
          <LocalTime value={user.createdAt} />
        </td>
        <td className={`${cellClass} text-right`}>
          {!isSelf && (
            <form
              action={remove}
              onSubmit={(event) => {
                // Deleting an auth user can't be undone - they'd need a fresh
                // invite and would lose their password.
                if (!window.confirm(`Remove ${user.email}? They will lose access immediately.`)) {
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
                {removing ? "Removing..." : "Remove"}
              </button>
            </form>
          )}
        </td>
      </tr>
      {message && (
        <tr>
          <td
            colSpan={6}
            className={`px-3 pb-2 text-xs ${failed ? "text-red-600" : "text-neutral-500"}`}
          >
            {message}
          </td>
        </tr>
      )}
    </>
  );
}
