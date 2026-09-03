import { getJournals, getYears } from "@/lib/data";
import { SubmitForm } from "./submit-form";

export default async function SubmitPage() {
  const [journals, years] = await Promise.all([getJournals(), getYears()]);
  return <SubmitForm journals={journals} years={years} />;
}
