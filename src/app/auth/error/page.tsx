export default function AuthErrorPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold">Link expired or invalid</h1>
      <p className="text-sm text-neutral-500">
        Password reset links can only be used once and time out within the hour - and some email
        systems open links to scan them, which uses the link up before you get to it.
      </p>
      <p className="text-sm text-neutral-500">
        Request a fresh one from the{" "}
        <a href="/login" className="underline">
          sign-in page
        </a>
        , or ask your editor to email you a new password - that one has nothing in it that can
        expire.
      </p>
    </main>
  );
}
