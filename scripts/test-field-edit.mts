// Editing one field at a time on the manager view's Details cards. Each save
// goes through the same server path as "Edit everything" (saveAdminEdit), so
// this runs the real path against the in-memory database with fetch stubbed:
// validation, the version check, the event_updates row, the GHL payload with
// updated_by admin, the staff notices, priced fields with the price choice,
// the price pending rule, and calendar only events sending nothing to GHL.
// Run: node --no-warnings scripts/test-field-edit.mts

import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/supabase") return nextResolve(new URL("./fake-supabase.mts", import.meta.url).href, context);
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});

process.env.GHL_API_TOKEN = "test";
process.env.GHL_LOCATION_ID = "test";
process.env.GHL_UPDATE_WEBHOOK_URL = "https://hooks.test/update";
process.env.GHL_STAFF_SMS_WEBHOOK = "https://hooks.test/staff-sms";
process.env.TEAM_BASE_URL = "https://plan.test";

const calls: { url: string; body: Record<string, unknown> }[] = [];
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  let body: Record<string, unknown> = {};
  try {
    body = init?.body ? JSON.parse(String(init.body)) : {};
  } catch {
    body = {};
  }
  calls.push({ url, body });
  const json = url.includes("/contacts") && !url.includes("/notes") ? { contacts: [{ id: "contact-1" }], contact: { id: "contact-1" } } : { ok: true };
  return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const quiet = console.log;
console.log = () => {};
console.warn = () => {};
console.error = () => {};

const { db } = await import("./fake-supabase.mts");
const editDb = await import("../lib/team/admin-edit-db.ts");
const edit = await import("../lib/team/admin-edit.ts");
const cards = await import("../lib/team/edit-cards.ts");
const diff = await import("../lib/event-diff.ts");
const view = await import("../lib/team/event-view.ts");
const time = await import("../lib/team/time.ts");

let failed = 0;
let total = 0;
function check(label: string, ok: boolean, detail = "") {
  total++;
  if (!ok) failed++;
  quiet(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
}
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const [ty, tm, td] = time.chicagoToday().split("-").map(Number);
const later = new Date(Date.UTC(ty, tm - 1, td + 20));
const DATE = `${MONTHS[later.getUTCMonth()]} ${later.getUTCDate()}, ${later.getUTCFullYear()}`;
const DATE_FORM = later.toISOString().slice(0, 10);

const admin = { id: "admin-1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true };
const admin2 = { id: "admin-2", name: "Isabel Jones", phone: "+12145550102", role: "manager" as const, active: true };
const bartender = { id: "bart-1", name: "Jordan Lee", phone: "+12145550101", role: "bartender" as const, active: true };

function baseEvent(extra: Record<string, unknown> = {}) {
  return {
    client_name: "Alex Butler",
    email: "alex@example.com",
    phone: "+12145550199",
    event_type: "Birthday",
    event_name: "Alex's 40th",
    event_date: DATE,
    venue_type: "venue",
    bar_service_start: "6:00pm",
    bar_service_end: "10:00pm",
    hours_booked: 4,
    guest_count: 100,
    package: "Full Bar",
    bartenders: 2,
    event_address: "123 Elm St, Dallas, TX 75201",
    indoor_outdoor: "indoor",
    bar_on_site: "Yes",
    bar_floor_access: "downstairs",
    bar_details: "Long wood bar",
    parking_info: "Driveway",
    day_of_contact_name: "Sam",
    day_of_contact_phone: "469-555-0123",
    theme: "Gatsby",
    event_colors: "black and gold",
    menu_colors: "gold",
    allergies: ["nuts"],
    beer: true,
    wine: false,
    client_providing_beer_wine: true,
    beer_and_wine_details: "Two cases of Modelo",
    drinking_pace: "Moderate",
    dual_bar_setup: false,
    extra_bottles: "Bring an extra tequila",
    special_requests: "",
    signature_drinks: [{ name: "Mule", base_spirit: "vodka", ingredients: ["2 oz vodka", "0.5 oz lime juice", "Top with ginger beer"], garnish: "lime wheel" }],
    ...extra,
  };
}

function reset(top: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [
    {
      id: "s1",
      name: "Alex Butler",
      email: "alex@example.com",
      event_date: DATE,
      package_type: "Full Bar",
      guest_count: "100",
      hours_booked: "4",
      status: "submitted",
      event_data: baseEvent(extra),
      version: 1,
      submitted_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
      booked_price: null,
      ...top,
    },
  ];
  db.event_updates = [];
  db.staff = [admin, admin2, bartender];
  db.event_assignments = [{ id: "as-1", session_id: "s1", staff_id: bartender.id, status: "accepted" }];
  calls.length = 0;
}
const session = () => db.sessions[0] as Record<string, unknown> & { event_data: Record<string, unknown>; version: number; booked_price: Record<string, unknown> | null; price_pending?: boolean };
const origin = "https://plan.test";
const one = (field: string, value: string, o: { version?: number; price?: Record<string, unknown>; who?: typeof admin | typeof admin2 } = {}) =>
  editDb.saveAdminEdit({ sessionId: "s1", admin: o.who ?? admin, changes: { [field]: value }, price: o.price ?? { mode: "keep" }, expectedVersion: o.version ?? session().version, origin });
const staffTexts = () => calls.filter((c) => c.url === "https://hooks.test/staff-sms" && c.body.phone === bartender.phone);

// ----- Every field on the cards -----
const specFields = edit.FIELD_SPECS.map((f) => f.field);
check("Every field with an Edit saves through the client update path (in UPDATABLE_FIELDS)", specFields.every((f) => (diff.UPDATABLE_FIELDS as readonly string[]).includes(f)), specFields.filter((f) => !(diff.UPDATABLE_FIELDS as readonly string[]).includes(f)).join());
check("Every field with an Edit is an admin edit field", specFields.every((f) => edit.isAdminEditField(f)));
check(
  "Style and notes has theme, colors, allergies, beer and wine, and special requests",
  ["theme", "event_colors", "allergies", "beer", "wine", "beer_and_wine_details", "special_requests"].every((f) => edit.FIELD_SPECS.find((s) => s.field === f)?.card === "style")
);
check("The priced fields confirm with the price, and so does the date", edit.FIELD_SPECS.filter((f) => f.priced).map((f) => f.field).sort().join() === ["bar_service_end", "bar_service_start", "bartenders", "guest_count", "package"].join() && edit.fieldSpec("event_date").confirm && !edit.fieldSpec("theme").confirm);
check(
  "The right input for each",
  edit.fieldSpec("event_date").kind === "date" && edit.fieldSpec("bar_service_start").kind === "time" && edit.fieldSpec("guest_count").kind === "number" && edit.fieldSpec("package").kind === "package" && edit.fieldSpec("beer").kind === "yesno" && edit.fieldSpec("special_requests").kind === "longtext" && edit.fieldSpec("theme").kind === "text"
);

reset();
const ed = session().event_data;
const roundTrip = edit.FIELD_SPECS.filter((f) => {
  const c = edit.cleanAdminEdit({ [f.field]: edit.formValue(f.field, ed, session() as never, 2) }, ed.package);
  return !c.ok || !diff.sameValue(c.partial[f.field], f.field === "event_date" ? DATE : ed[f.field]);
});
check("Each input starts from the stored value, and saving it unchanged stores the same value", roundTrip.length === 0, roundTrip.map((f) => f.field).join());

const v = view.buildStaffEventView(session() as never, {});
const built = cards.editCards(v, ed, session() as never);
check("The cards are Event, Location, Day of contact, Style and notes", built.map((c) => c.title).join() === "Event,Location,Day of contact,Style and notes");
check("Every spec field has an Edit row on its card", edit.FIELD_SPECS.every((f) => built.find((c) => c.id === f.card)!.rows.some((r) => r.field === f.field)));
check("Read only rows have no Edit", built[0].rows.filter((r) => !r.field).map((r) => r.label).join() === "Event type,Client,Arrive by");
const styleRows = built[3].rows;
check("Rows show the stored values", styleRows.find((r) => r.field === "theme")?.display === "Gatsby" && styleRows.find((r) => r.field === "beer")?.display === "Yes" && styleRows.find((r) => r.field === "wine")?.display === "No" && styleRows.find((r) => r.field === "allergies")?.display === "nuts");

// ----- One field saves through the same path -----
reset();
const theme = await one("theme", "Roaring 20s");
const row = db.event_updates.at(-1) as Record<string, unknown> & { changes: { field: string; old: unknown; new: unknown }[] };
check("One field saves", theme.ok && session().event_data.theme === "Roaring 20s" && session().version === 2, JSON.stringify(theme));
check("Only that field changes", row.changes.length === 1 && row.changes[0].field === "theme" && row.changes[0].old === "Gatsby" && session().event_data.event_colors === "black and gold");
check("The update row is marked with the admin", row.updated_by === "admin" && row.updated_by_name === "Kenneth" && row.updated_by_staff_id === admin.id && row.version === 2);
const hook = calls.find((c) => c.url === "https://hooks.test/update");
check("The GHL payload says updated_by admin", hook?.body.updated_by === "admin" && hook?.body.updated_by_name === "Kenneth");
check("The GHL note names the admin", calls.some((c) => c.url.includes("/notes") && String(c.body.body ?? "").includes("Updated by admin: Kenneth")));
check("Assigned staff get the same notice", staffTexts().length === 1 && String(staffTexts()[0].body.message).includes("was updated"));

reset();
check("Yes or no fields save as yes or no", (await one("beer", "no")).ok && session().event_data.beer === false && (await one("dual_bar_setup", "yes")).ok && session().event_data.dual_bar_setup === true);
check("A yes or no field refuses anything else", !(await one("wine", "maybe")).ok);
check("Allergies save as a list", (await one("allergies", "nuts, shellfish")).ok && JSON.stringify(session().event_data.allergies) === '["nuts","shellfish"]');
check("Venue type is Venue or Private residence", (await one("venue_type", "private_residence")).ok && session().event_data.venue_type === "private_residence" && !(await one("venue_type", "castle")).ok);
check("The same validation: a bad guest count is refused", !(await one("guest_count", "lots")).ok);
check("The same validation: a bad date is refused", !(await one("event_date", "2026-02-30")).ok);

// ----- Two admins cannot overwrite each other -----
reset();
const opened = session().version;
const first = await one("theme", "Disco", { version: opened, who: admin });
const second = await one("event_colors", "silver", { version: opened, who: admin2 });
check("The second admin's save with the old version is refused", first.ok && !second.ok && second.status === 409 && session().event_data.event_colors === "black and gold");
check("After a reload (new version) it saves", (await one("event_colors", "silver", { version: session().version, who: admin2 })).ok && session().event_data.event_colors === "silver");

// ----- Priced fields: the price difference and new total, then a confirm -----
reset();
const pv = await editDb.previewAdminEdit("s1", { guest_count: "150" });
check("A priced field shows the difference and new total before saving", pv.ok && pv.preview.priced && pv.preview.engineAmount! > 0 && pv.preview.engineNewTotal !== null && session().version === 1);
const eng = await one("guest_count", "150", { price: { mode: "engine" } });
check("Confirmed with the engine's difference: saved and the total moves", eng.ok && session().booked_price?.total === (pv.ok ? pv.preview.engineNewTotal : -1));
reset();
check("A priced field with no price choice is refused", !(await one("package", "Premium Bar", { price: {} })).ok && session().version === 1);
const dv = await editDb.previewAdminEdit("s1", { event_date: DATE_FORM });
check("The date confirm shows the booked total (the engine does not price the date)", dv.ok && !dv.preview.priced && dv.preview.bookedTotal === null);
reset({ booked_price: { total: 1900, package_price: 1700, gratuity: 200, bartenders: 2, promo_code: null, custom_price: null, discount_amount: null, tip_jar: true, deposit_paid: 150, source: "create-session" } });
const dv2 = await editDb.previewAdminEdit("s1", { event_date: DATE_FORM });
check("With a booked total on file, the date confirm shows it", dv2.ok && dv2.preview.bookedTotal === 1900);

// ----- Price pending: the engine cannot price it -----
const legacy = { package_type: "Essentials Bar", booked_price: { total: 1200, package_price: 1050, gratuity: 150, bartenders: 2, promo_code: null, custom_price: null, discount_amount: null, tip_jar: true, deposit_paid: 150, source: "create-session" } };
reset(legacy, { package: "Essentials Bar" });
const lp = await editDb.previewAdminEdit("s1", { guest_count: "140" });
check("A retired package: the engine cannot price the change", lp.ok && lp.preview.priced && lp.preview.engineNewTotal === null);
const pend = await one("guest_count", "140", { price: { mode: "pending" } });
check("Leave the price pending: saved, and the event is price pending", pend.ok && pend.pricePending && session().event_data.guest_count === 140 && session().price_pending === true && session().booked_price?.total === 1200);
const adminTexts = calls.filter((c) => c.url === "https://hooks.test/staff-sms" && String(c.body.message).startsWith("Price needed"));
check("The admins get the one Price needed text", adminTexts.length === 2 && adminTexts.every((t) => t.body.phone !== bartender.phone), JSON.stringify(adminTexts.map((t) => t.body.phone)));
const pendHook = calls.find((c) => c.url === "https://hooks.test/update");
check("GHL gets price_pending with no money", pendHook?.body.price_pending === "Yes" && pendHook?.body.pending_change_new_total === null && pendHook?.body.updated_by === "admin");
reset();
check("Pending is refused when the engine can price it", !(await one("guest_count", "150", { price: { mode: "pending" } })).ok && session().version === 1);

// ----- Calendar only -----
reset({ calendar_only: true });
const cal = await one("theme", "Luau");
check("A calendar only event saves the same way", cal.ok && session().event_data.theme === "Luau" && (db.event_updates.at(-1) as Record<string, unknown>).updated_by === "admin");
check("And sends nothing to GHL", !calls.some((c) => c.url === "https://hooks.test/update" || c.url.includes("/notes") || c.url.includes("/contacts")), calls.map((c) => c.url).join());
check("Staff still get their notice", staffTexts().length === 1);

// ----- The page -----
const page = src("app/team/admin/e/[id]/page.tsx");
const ui = src("app/team/admin/e/[id]/editable-details.tsx");
const bulk = src("app/team/admin/e/[id]/edit-event.tsx");
check("Admins and managers only: the page checks admin first, the route checks again", page.indexOf("await requireAdmin(") > 0 && page.indexOf("await requireAdmin(") < page.indexOf("<EditableDetails") && src("app/api/team/admin/event-edit/route.ts").includes("isAdminRole("));
check("Hidden events are not edited in place", page.includes("{hidden ? (") && page.indexOf("<Details v={v} />") < page.indexOf("<EditableDetails"));
check("Each save posts one field to the same route as Edit everything", ui.includes('fetch("/api/team/admin/event-edit"') && ui.includes("changes: { [field]: value }") && ui.includes("version: ver") && bulk.includes('fetch("/api/team/admin/event-edit"'));
check("Only one field is open at a time", ui.includes("useState<AdminEditField | null>(null)") && ui.includes("if (dirty && open !== row.field && !window.confirm(LEAVE_MESSAGE)) return;"));
check("Leaving the page with an unsaved field asks first", ui.includes('addEventListener("beforeunload"') && ui.includes('closest?.("a[href]")') && ui.includes("window.confirm(LEAVE_MESSAGE)"));
check("Priced fields and the date confirm with the price before saving", ui.includes("openRow.confirm || p.priced") && ui.includes("<PriceFieldset") && ui.includes("Confirm and save"));
check("Tap targets are at least 44px", ui.includes("min-h-[44px] min-w-[44px]") && bulk.includes("min-h-[44px]"));
check("Edit everything stays as a small text link at the bottom", bulk.includes(">\n            Edit everything\n") && page.indexOf("<EditableDetails") < page.indexOf("<EditEvent"));
check("The pending choice only shows when the engine cannot price it", src("app/team/admin/e/[id]/edit-price.tsx").includes("{engineCannotPrice(preview) && ("));

console.log = quiet;
if (failed > 0) {
  console.error(`\n${failed} of ${total} field edit checks failed.`);
  process.exit(1);
}
quiet(`\nAll ${total} field edit checks pass.`);
