import { timed } from "@/lib/timing";
import { requireAdmin } from "@/lib/team/auth";
import { listStaff } from "@/lib/team/assignments-db";
import TeamHeader from "../../team-header";
import StaffManager from "./staff-manager";
import { upcomingUnavailableByStaff } from "@/lib/team/availability-db";
import { compactLines } from "@/lib/team/reliability-db";
import { certsEnforced, trainingProgressFor } from "@/lib/team/certs-db";
import { progressLine } from "@/lib/team/training";
import EnforceToggle from "./enforce-toggle";
import SettingToggle from "./setting-toggle";
import SettingText from "./setting-text";
import { AUTO_SEND_KEY, ICE_RULE_KEY, POPULAR_COCKTAILS_KEY, POPULAR_MOCKTAILS_KEY, SUGGEST_STORES_KEY, teamSetting, teamText } from "@/lib/client-list-db";
import { currentPopularDrinks } from "@/lib/popular-drinks-db";
import { popularStatusLine } from "@/lib/popular-drinks";
import { ratesFor } from "@/lib/team/pay-db";
import { rateText } from "@/lib/team/pay";
import { rangeLabel } from "@/lib/team/availability";
import { chicagoToday } from "@/lib/team/time";
import { staffOverview } from "@/lib/team/profile-db";

export const dynamic = "force-dynamic";

async function AdminStaffPage() {
  const me = await requireAdmin("/team/admin/staff");
  // The staff list first; everything about each person is then read together, with the settings alongside.
  const staffP = listStaff();
  const ids = staffP.then((staff) => staff.map((s) => s.id));
  const [staff, away, records, onboard, enforced, autoSend, suggestStores, rates, overview, iceRule, popularCocktails, popularMocktails, popular] = await Promise.all([
    staffP,
    upcomingUnavailableByStaff(chicagoToday()),
    ids.then(compactLines),
    ids.then(trainingProgressFor),
    certsEnforced(),
    teamSetting(AUTO_SEND_KEY),
    teamSetting(SUGGEST_STORES_KEY),
    ids.then((list) => ratesFor(me, list)),
    staffP.then((list) => staffOverview(me, list)),
    teamText(ICE_RULE_KEY),
    teamText(POPULAR_COCKTAILS_KEY),
    teamText(POPULAR_MOCKTAILS_KEY),
    currentPopularDrinks(),
  ]);
  // One line per person per topic, shown under their name.
  const notes: Record<string, string[]> = {};
  const add = (id: string, line: string) => (notes[id] = [...(notes[id] ?? []), line]);
  for (const s of staff) {
    add(s.id, `Record: ${records[s.id]}`);
    add(s.id, `Training: ${progressLine(onboard.get(s.id) ?? [])}`);
    add(s.id, `Rate: ${rates.get(s.id) ? `${rateText(rates.get(s.id)!)} (own rate)` : "package rate"}`);
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
        <SettingText
          settingKey={ICE_RULE_KEY}
          initial={iceRule}
          title="Ice rule"
          help="Shown under Recommended location on every ice card and in the ice pickup text. Leave it empty to put back: No gas stations. No grocery stores."
        />
        <SettingText
          settingKey={POPULAR_COCKTAILS_KEY}
          initial={popularCocktails}
          title="Most popular cocktails (fallback)"
          help={`What the concierge calls most popular until ${popular.minEvents} events have menu picks. Drink names from the menu, separated by commas, top five used. A name not on the current menu is skipped. ${popularStatusLine(popular, "cocktails")}`}
        />
        <SettingText
          settingKey={POPULAR_MOCKTAILS_KEY}
          initial={popularMocktails}
          title="Most popular mocktails (fallback)"
          help={`There is no mocktail menu to count from, so the concierge always uses this list for mocktails. Names separated by commas, top five used. Empty means the concierge says it has no most popular mocktails yet. ${popularStatusLine(popular, "mocktails")}`}
        />
        <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-heading text-base font-bold text-[#2C2420]">Syrup recipes</h2>
            <p className="text-sm text-[#6B5D52]">House made syrups for the Shopping list and the bartenders&apos; Supplies tab.</p>
          </div>
          <a href="/team/admin/syrups" className="inline-flex min-h-[44px] items-center rounded-lg border border-[#2C2420] px-4 text-sm font-medium text-[#2C2420]">
            Manage
          </a>
        </section>
        <div className="px-1">
          <a href="/api/team/admin/staff/export" className="inline-block rounded-lg border border-[#2C2420] text-[#2C2420] px-4 py-2 text-sm font-medium">
            Download CSV
          </a>
        </div>
        <StaffManager initial={staff} meId={me.id} viewerRole={me.role} notes={notes} overview={overview} />
      </main>
    </>
  );
}

export default async function Page() {
  return timed("staff", () => AdminStaffPage());
}
