import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; deactivated?: string }>;
}) {
  const { next, deactivated } = await searchParams;
  return <LoginForm next={next ?? "/"} deactivated={deactivated === "1"} />;
}
