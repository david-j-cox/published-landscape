"use client";

import { useActionState } from "react";
import { inviteUser, type AdminState } from "./actions";
import { Credentials } from "./credentials";
import { ROLE_LABELS, type Journal, type Role } from "@/lib/types";

const initialState: AdminState = { status: "idle" };

const fieldClass =
  "rounded-md border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900";

export function InviteForm({
  journals,
  assignable,
  canPickJournal,
  fixedJournalId,
}: {
  journals: Journal[];
  assignable: Role[];
  canPickJournal: boolean;
  fixedJournalId: number | null;
}) {
  const [state, formAction, pending] = useActionState(inviteUser, initialState);

  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-center gap-2 text-sm">
        <input
          type="email"
          name="email"
          required
          placeholder="name@university.edu"
          className={`min-w-56 flex-1 ${fieldClass} px-3`}
        />
        {assignable.length > 1 ? (
          <select name="role" defaultValue="ae" className={fieldClass}>
            {assignable.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        ) : (
          <input type="hidden" name="role" value={assignable[0]} />
        )}
        {canPickJournal ? (
          <select name="journalId" defaultValue="" className={fieldClass}>
            <option value="">No journal</option>
            {journals.map((journal) => (
              <option key={journal.id} value={journal.id}>
                {journal.name}
              </option>
            ))}
          </select>
        ) : (
          <input type="hidden" name="journalId" value={fixedJournalId ?? ""} />
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {pending ? "Creating..." : "Add and email"}
        </button>
      </form>
      {state.message && (
        <p
          className={`mt-2 text-sm ${state.status === "error" ? "text-red-600" : "text-neutral-500"}`}
        >
          {state.message}
        </p>
      )}
      {state.credentials && (
        <Credentials email={state.credentials.email} password={state.credentials.password} />
      )}
    </div>
  );
}
