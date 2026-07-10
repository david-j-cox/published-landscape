"use client";

import { useActionState } from "react";
import { updatePassword, type UpdatePasswordState } from "./actions";

const initialState: UpdatePasswordState = { status: "idle" };

const inputClass =
  "rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900";

export default function UpdatePasswordPage() {
  const [state, formAction, pending] = useActionState(updatePassword, initialState);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-xl font-semibold">Set your password</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Choose a password to sign in with from now on.
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        <input
          type="password"
          name="password"
          required
          autoComplete="new-password"
          placeholder="New password"
          className={inputClass}
        />
        <input
          type="password"
          name="confirm"
          required
          autoComplete="new-password"
          placeholder="Confirm password"
          className={inputClass}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {pending ? "Saving..." : "Save password"}
        </button>
      </form>

      {state.status === "error" && <p className="-mt-3 text-sm text-red-600">{state.message}</p>}
    </main>
  );
}
