import "server-only";

// Outbound mail goes through Resend rather than Supabase's built-in sender.
// Supabase's shared sending domain has no reputation tied to this project, so
// its mail reliably lands in university junk folders - which is what started
// this whole problem. A verified sending domain of our own is the fix, and
// the REST API is a single POST, so there's no SDK to add.
const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * False when RESEND_API_KEY or EMAIL_FROM is missing. Everything that sends
 * mail degrades rather than fails in that case: the account is still created
 * and /admin shows the credentials for an editor to pass along by hand.
 */
export const isEmailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export type SendResult = { ok: true } | { ok: false; error: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function send(message: {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}): Promise<SendResult> {
  if (!isEmailConfigured) return { ok: false, error: "Email sending is not configured." };

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        // Replies land with the editor who added them, not in a void. It also
        // gives the message a human address to answer, which spam filters
        // weigh more kindly than a no-reply.
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      let detail = body.slice(0, 200);
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed?.message === "string") detail = parsed.message;
      } catch {
        // Non-JSON error body; the raw text above is the best we have.
      }
      return { ok: false, error: `Resend returned ${response.status}: ${detail}` };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not reach Resend." };
  }
}

/**
 * The one email a new account gets. Deliberately contains no token: just a
 * plain link to the sign-in page and a temporary password. A link with
 * nothing to consume can be prefetched by a mail scanner, sit in a junk
 * folder for a week, and still work when it's finally opened.
 */
export function sendWelcomeEmail(options: {
  to: string;
  tempPassword: string;
  siteUrl: string;
  invitedBy?: string;
  /** True when an editor is reissuing a password for an existing account. */
  reissued?: boolean;
}): Promise<SendResult> {
  const { to, tempPassword, siteUrl, invitedBy, reissued } = options;
  const loginUrl = `${siteUrl.replace(/\/$/, "")}/login`;

  const opening = reissued
    ? "Here is a new password for your Published Landscape account. It replaces any password you had before."
    : "You have been added to Published Landscape, the topic map and reviewer finder for the ABAI journals.";

  const text = [
    opening,
    "",
    `Sign in at: ${loginUrl}`,
    "",
    `  Email:    ${to}`,
    `  Password: ${tempPassword}`,
    "",
    "That password is temporary - the site asks you to choose your own the first time you sign in. It does not expire, so there is no rush.",
    "",
    "If this message arrived in your junk folder, marking it as safe will help the next one through.",
    invitedBy ? `\nQuestions? Reply to this email and it reaches ${invitedBy}.` : "",
  ].join("\n");

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55;color:#171717;max-width:34rem">
  <p>${escapeHtml(opening)}</p>
  <p><a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#171717;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Sign in</a></p>
  <table style="border-collapse:collapse;margin:20px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px">
    <tr><td style="padding:2px 14px 2px 0;color:#737373">Email</td><td>${escapeHtml(to)}</td></tr>
    <tr><td style="padding:2px 14px 2px 0;color:#737373">Password</td><td><strong>${escapeHtml(tempPassword)}</strong></td></tr>
  </table>
  <p>That password is temporary - the site asks you to choose your own the first time you sign in. It does not expire, so there is no rush.</p>
  <p style="color:#737373;font-size:13px">If this message arrived in your junk folder, marking it as safe will help the next one through.${
    invitedBy ? ` Questions? Reply to this email and it reaches ${escapeHtml(invitedBy)}.` : ""
  }</p>
  <p style="color:#737373;font-size:13px">Or paste this into your browser: ${escapeHtml(loginUrl)}</p>
</div>`;

  return send({
    to,
    subject: reissued ? "Your new Published Landscape password" : "Your Published Landscape sign-in",
    text,
    html,
    replyTo: invitedBy,
  });
}
