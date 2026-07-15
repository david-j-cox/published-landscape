import { getJournals, getYears } from "@/lib/data";
import { SubmitForm } from "./submit-form";

export default function SubmitPage() {
  return <SubmitForm journals={getJournals()} years={getYears()} />;
}
