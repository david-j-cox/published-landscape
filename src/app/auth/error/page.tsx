export default function AuthErrorPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold">Sign-in link expired or invalid</h1>
      <p className="text-sm text-neutral-500">
        Request a new link from the{" "}
        <a href="/login" className="underline">
          sign-in page
        </a>
        .
      </p>
    </main>
  );
}
