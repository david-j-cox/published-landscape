import { getViewer } from "@/lib/users";
import { UpdatePasswordForm } from "./update-password-form";

export default async function UpdatePasswordPage() {
  // Two routes lead here and they need different wording: a first sign-in on
  // a mailed temporary password (which the app forces here), and a
  // self-service reset from the sign-in page.
  const viewer = await getViewer();
  return <UpdatePasswordForm firstTime={Boolean(viewer?.mustSetPassword)} />;
}
