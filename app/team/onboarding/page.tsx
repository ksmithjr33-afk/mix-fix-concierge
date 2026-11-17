import { redirect } from "next/navigation";
import { TRAINING_PATH } from "@/lib/team/training";

// Getting started moved to the Training page. Old links and texts land there.
export default function OnboardingPage() {
  redirect(`${TRAINING_PATH}#getting-started`);
}
