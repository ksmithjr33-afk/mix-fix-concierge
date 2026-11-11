import { requireAdmin } from "@/lib/team/auth";
import { listStaff } from "@/lib/team/assignments-db";
import TeamHeader from "../../team-header";
import StaffManager from "./staff-manager";
import { upcomingUnavailableByStaff } from "@/lib/team/availability-db";
import { compactLines } from "@/lib/team/reliability-db";
import { certLinesByStaff, certsEnforced, onboardingProgress } from "@/lib/team/certs-db";
import { ONBOARDING } from "@/lib/team/cert-config";
import EnforceToggle from "./enforce-toggle";
import SettingToggle from "./setting-toggle";
import { AUTO_SEND_KEY, SUGGEST_STORES_KEY, teamSetting } from "@/lib/client-list-db";
import { ratesFor } from "@/lib/team/pay-db";
import { rateText } from "@/lib/team/pay";
import { rangeLabel } from "@/lib/team/availability";
import { chicagoToday } from "@/lib/team/time";

export const dynamic = "force-dynamic";

export default async function AdminStaffPage() {
  const me = await requireAdmin("/team/admin/staff");
  const [staff, away] = await Promise.all([listStaff(), upcomingUnavailableByStaff(chicagoToday())]);
  const [records, certLines, onboard, enforced, autoSend, suggestStores] = await Promise.all([
    compactLines(staff.map((s) => s.id)),
    certLinesByStaff(staff),
    onboardingProgress(staff.map((s) => s.id)),
    certsEnforced(),
    teamSetting(AUTO_SEND_KEY),
    teamSetting(SUGGEST_STORES_KEY),
  ]);
  const rates = await ratesFor(me, staff.map((s) => s.id));
  // One line per person per topic, shown under their name.
  const notes: Record<string, string[]> = {};
  const add = (id: string, line: string) => (notes[id] = [...(notes[id] ?? []), line]);
  for (const s of staff) {
    add(s.id, `Record: ${records[s.id]}`);
    if (certLines[s.id]) add(s.id, `Certification: ${certLines[s.id]}`);
    if (s.role !== "admin") add(s.id, `Onboarding: ${onboard.get(s.id) ?? 0} of ${ONBOARDING.length}`);
    add(s.id, `Rate: ${rates.get(s.id) ? rateText(rates.get(s.id)!) : "not set"}`);
  }
  for (const [id, rows] of away) {
    const shown = rows.slice(0, 3).map(rangeLabel).join("; ");
    add(id, `Unavailable: ${shown}${rows.length > 3 ? ` and ${rows.length - 3} more` : ""}`);
  }
  return (
    <>
      <TeamHeader signedIn admin />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Staff</h1>
          <p className="text-[15px] text-[#6B5D52]">Add, edit, or deactivate. Admins with alerts on get texts about declines, missing items, and bar check ins.</p>
        </div>
        <EnforceToggle initial={enforced} />
        <SettingToggle
          settingKey={AUTO_SEND_KEY}
          initial={autoSend}
          title="Auto send client shopping list"
          onText="On: the client gets their first list on completion and an updated list when an update changes it more than 6 days out. Inside 6 days list changes wait for admin approval."
          offText="Off: every send and hold is worked out and shown on the admin event page as a dry run, but nothing goes to the client and client updates apply as they always have."
        />
        <SettingToggle
          settingKey={SUGGEST_STORES_KEY}
          initial={suggestStores}
          title="Suggest stores on shopping lists"
          onText="On: a line with no store shows the store that item was last given on another event, marked as a suggestion. It is never set by itself."
          offText="Off: lines with no store show no suggestion."
        />
        <StaffManager initial={staff} meId={me.id} notes={notes} />
      </main>
    </>
  );
}
