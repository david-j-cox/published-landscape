"use client";

import { useActionState } from "react";
import { inviteUser, type AdminState } from "./actions";
import { ROLES } from "@/lib/types";

const initialState: AdminState = { status: "idle" };

export function InviteForm() {
  const [state, formAction, pending] = useActionState(inviteUser, initialState);

  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-center gap-2 text-sm">
        <input
          type="email"
          name="email"
          required
          placeholder="name@university.edu"
          className="min-w-56 flex-1 rounded-md border border-neutral-300 px-3 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <select
          name="role"
          defaultValue="reviewer"
          className="rounded-md border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {pending ? "Sending..." : "Send invite"}
        </button>
      </form>
      {state.message && (
        <p
          className={`mt-2 text-sm ${state.status === "error" ? "text-red-600" : "text-neutral-500"}`}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
