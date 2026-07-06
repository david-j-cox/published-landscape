"use client";

import { useActionState } from "react";
import { requestMagicLink, type LoginState } from "./actions";

const initialState: LoginState = { status: "idle" };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(requestMagicLink, initialState);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-xl font-semibold">Published Landscape</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Sign in with the email your editor invited you with.
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        <input
          type="email"
          name="email"
          required
          placeholder="you@university.edu"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {pending ? "Sending..." : "Send sign-in link"}
        </button>
      </form>

      {state.status !== "idle" && (
        <p
          className={
            state.status === "error"
              ? "text-sm text-red-600"
              : "text-sm text-green-600"
          }
        >
          {state.message}
        </p>
      )}
    </main>
  );
}
