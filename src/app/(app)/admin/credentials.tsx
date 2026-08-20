"use client";

import { useState } from "react";

/**
 * Shows a freshly minted temporary password once, with a one-click copy of
 * the whole message an editor would paste into their own email.
 *
 * This is the belt to the email's braces. Mail to university addresses is
 * unreliable enough - junk folders, quarantines, scanners - that the person
 * who pressed the button needs to be able to see what was sent and forward
 * it themselves. The password is only in this response, so it's gone on the
 * next page load.
 */
export function Credentials({ email, password }: { email: string; password: string }) {
  const [copied, setCopied] = useState(false);
  const loginUrl = `${(process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "")}/login`;

  const blurb = [
    `Sign in at: ${loginUrl}`,
    `Email: ${email}`,
    `Password: ${password}`,
    "",
    "That password is temporary - the site asks you to choose your own the first time you sign in. It does not expire.",
  ].join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(blurb);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the text is on screen to select.
      setCopied(false);
    }
  }

  return (
    <div className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
        <dt className="text-neutral-400">Email</dt>
        <dd className="break-all">{email}</dd>
        <dt className="text-neutral-400">Password</dt>
        <dd className="font-semibold break-all select-all">{password}</dd>
      </dl>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={copy}
          className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {copied ? "Copied" : "Copy message"}
        </button>
        <span className="text-xs text-neutral-400">Not shown again once you leave this page.</span>
      </div>
    </div>
  );
}
