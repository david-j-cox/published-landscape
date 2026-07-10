"use client";

import { useActionState, useState } from "react";
import { sendPasswordReset, signIn, type LoginState } from "./actions";

const initialState: LoginState = { status: "idle" };

const inputClass =
  "rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900";

export function LoginForm({ next }: { next: string }) {
  // Email is shared between the sign-in form and the reset form so it only
  // has to be typed once.
  const [email, setEmail] = useState("");
  const [signInState, signInAction, signingIn] = useActionState(signIn, initialState);
  const [resetState, resetAction, resetting] = useActionState(sendPasswordReset, initialState);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-xl font-semibold">Published Landscape</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Sign in with the email your editor invited you with.
        </p>
      </div>

      <form action={signInAction} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <input
          type="email"
          name="email"
          required
          autoComplete="username"
          placeholder="you@university.edu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          placeholder="Password"
          className={inputClass}
        />
        <button
          type="submit"
          disabled={signingIn}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {signingIn ? "Signing in..." : "Sign in"}
        </button>
      </form>

      {signInState.status === "error" && (
        <p className="-mt-3 text-sm text-red-600">{signInState.message}</p>
      )}

      <div className="border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <p className="text-sm text-neutral-500">
          First time signing in, or forgot your password? We&apos;ll email you a link to set one.
        </p>
        <form action={resetAction} className="mt-3">
          <input type="hidden" name="email" value={email} />
          <button
            type="submit"
            disabled={resetting}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {resetting ? "Sending..." : "Email me a password link"}
          </button>
        </form>
        {resetState.status !== "idle" && (
          <p
            className={
              resetState.status === "error"
                ? "mt-3 text-sm text-red-600"
                : "mt-3 text-sm text-green-600"
            }
          >
            {resetState.message}
          </p>
        )}
      </div>
    </main>
  );
}
