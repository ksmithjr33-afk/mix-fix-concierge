// The approved menu: the admin upload (type and size limits, the real stored
// file checked again, replace with history, the client approval date), who
// can open it (admins, staff on the event, the pickup person, the client on
// their own page, and nobody else), the pickup person's "Download print file",
// the bartender's read only menu section, and the 72 hour missing count.
// Run: node --no-warnings scripts/test-approved-menu.mts

import { check, done, src } from "./team-harness.mts";

const { db, putObject, objects, signed } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const am = await import("../lib/team/approved-menu.ts");
const amDb = await import("../lib/team/approved-menu-db.ts");
const mpDb = await import("../lib/team/menu-pickup-db.ts");

const DAY = "2026-12-05"; // service 6:00 PM, arrive 4:00 PM Central
const at = (day: string, hh: number, mm = 0) => time.zonedInstant(day, hh * 60 + mm, "America/Chicago");
const ev = (id: string, day: string, extra: Record<string, unknown> = {}) => ({
  id,
  status: "submitted",
  version: 1,
  event_date: day,
  team_market: "dallas",
  event_data: { client_name: "Justin Reyes", client_email: "justin@example.com", event_name: "Justin's 30th", event_date: day, bar_service_start: "6:00pm", bar_service_end: "10:00pm", event_address: "1 Main St, Dallas, TX", bartenders: 2, ...extra },
});
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true };
const taylor = { id: "b1", name: "Taylor Brooks", phone: "+12145550111", role: "bartender" as const, active: true }; // on s1, accepted
const sam = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bartender" as const, active: true }; // not on s1
const robin = { id: "b3", name: "Robin Lee", phone: "+12145550113", role: "bartender" as const, active: true }; // declined s1
const casey = { id: "b4", name: "Casey Park", phone: "+12145550114", role: "bartender" as const, active: true }; // offered s1
const gone = { id: "b9", name: "Gone Person", phone: "+12145550119", role: "bartender" as const, active: false }; // on s1 but inactive
const adminAsBartender = { ...admin, role: "bartender" as const }; // Bartender view

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [ev("s1", DAY), ev("s2", "2026-12-20"), { ...ev("s3", DAY), status: "draft" }];
  db.staff = [admin, taylor, sam, robin, casey, gone].map((s) => ({ ...s }));
  db.event_assignments = [
    { id: "as1", session_id: "s1", staff_id: "b1", status: "accepted" },
    { id: "as2", session_id: "s1", staff_id: "b3", status: "declined" },
    { id: "as3", session_id: "s1", staff_id: "b4", status: "offered" },
    { id: "as4", session_id: "s1", staff_id: "b9", status: "accepted" },
  ];
  for (const t of ["event_menu_files", "event_menu_pickups", "event_menu_pickup_log", "team_notices", "team_hidden_events"]) db[t] = [];
  objects.clear();
  signed.length = 0;
}
const noon = at("2026-12-01", 12);

/** An admin uploads a menu the way the browser does: start, the file lands in storage, finish. */
async function upload(sessionId: string, file: { type: string; size: number; name?: string }, approvedOn = "2026-11-30", stored?: { type: string; size: number }, now = noon) {
  const start = await amDb.startMenuUpload(admin, sessionId, file, now);
  if (!start.ok) return { start, finish: null };
  const row = db.event_menu_files.find((r) => r.id === start.id)!;
  putObject("event-menus", String(row.file_path), (stored ?? file).size, (stored ?? file).type);
  return { start, finish: await amDb.finishMenuUpload(admin, start.id, approvedOn, now) };
}

// ----- 1. Upload rules -----
reset();
check("PDF, PNG and JPG up to 15 MB are allowed", am.menuFileError({ type: "application/pdf", size: 15 * 1024 * 1024 }) === null && am.menuFileError({ type: "image/png", size: 10 }) === null && am.menuFileError({ type: "image/jpeg", size: 10 }) === null);
check("Over 15 MB is refused", am.menuFileError({ type: "application/pdf", size: 15 * 1024 * 1024 + 1 }) !== null);
check("Other file types are refused", am.menuFileError({ type: "image/gif", size: 10 }) !== null && am.menuFileError({ type: "application/zip", size: 10 }) !== null);
const big = await amDb.startMenuUpload(admin, "s1", { type: "application/pdf", size: 16 * 1024 * 1024 }, noon);
check("Starting an upload over 15 MB is refused before anything is stored", !big.ok && db.event_menu_files.length === 0);
check("A bartender cannot upload the menu", !(await amDb.startMenuUpload(taylor, "s1", { type: "application/pdf", size: 1000 }, noon)).ok);
check("An admin in Bartender view cannot upload the menu", !(await amDb.startMenuUpload(adminAsBartender, "s1", { type: "application/pdf", size: 1000 }, noon)).ok);
check("Only submitted events take a menu", !(await amDb.startMenuUpload(admin, "s3", { type: "application/pdf", size: 1000 }, noon)).ok);

const liar = await upload("s1", { type: "application/pdf", size: 1000 }, "2026-11-30", { type: "application/pdf", size: 20 * 1024 * 1024 });
check("A stored file bigger than it said is refused and deleted", liar.finish !== null && !liar.finish.ok && objects.size === 0 && db.event_menu_files.length === 0);
const wrongType = await upload("s1", { type: "image/png", size: 1000 }, "2026-11-30", { type: "text/html", size: 1000 });
check("A stored file of another type is refused and deleted", wrongType.finish !== null && !wrongType.finish.ok && objects.size === 0);
const future = await upload("s1", { type: "image/png", size: 1000 }, "2026-12-25");
check("The client approval date cannot be in the future", future.finish !== null && !future.finish.ok);
check("The client approval date is required", !(await upload("s1", { type: "image/png", size: 1000 }, "")).finish?.ok);

reset();
const first = await upload("s1", { type: "image/png", size: 250_000, name: "justin-menu.png" }, "2026-11-28");
check("An admin uploads the approved menu", !!first.finish?.ok && db.event_menu_files.filter((r) => r.status === "current").length === 1);
const cur = db.event_menu_files.find((r) => r.status === "current")!;
check("Who uploaded it and when are recorded", cur.uploaded_by === "a1" && cur.uploaded_by_name === "Kenneth" && cur.created_at === noon.toISOString());
check("The client approved on date is recorded", cur.client_approved_on === "2026-11-28");
check("The admin view shows it", first.finish?.ok === true && first.finish.view.current?.typeLabel === "PNG" && first.finish.view.current.approvedOn === "2026-11-28" && first.finish.view.current.uploadedBy === "Kenneth");
check("It is stored in the private event-menus bucket under the event", String(cur.file_path).startsWith("menus/s1/"));
const second = await upload("s1", { type: "application/pdf", size: 900_000, name: "final.pdf" }, "2026-11-30", undefined, at("2026-12-01", 13));
check("A new upload replaces the current one", second.finish?.ok === true && second.finish.view.current?.typeLabel === "PDF" && db.event_menu_files.filter((r) => r.status === "current").length === 1);
check("The old one is kept in the history admins can open", second.finish?.ok === true && second.finish.view.history.length === 1 && second.finish.view.history[0].fileName === "justin-menu.png");
const oldId = second.finish?.ok ? second.finish.view.history[0].id : "";
check("An admin can open an old one from the history", (await amDb.staffMenuLink(admin, "s1", { fileId: oldId }))?.includes("menus/s1/") === true);
check("A bartender on the event only ever gets the current one", (await amDb.staffMenuLink(taylor, "s1", { fileId: oldId })) === (await amDb.staffMenuLink(taylor, "s1")) && (await amDb.staffMenuLink(taylor, "s1"))!.endsWith(".pdf"));
check("The approval date can be changed later by an admin", (await amDb.setApprovedOn(admin, "s1", "2026-11-29", noon)).ok && db.event_menu_files.find((r) => r.status === "current")!.client_approved_on === "2026-11-29");
check("A bartender cannot change the approval date", !(await amDb.setApprovedOn(taylor, "s1", "2026-11-27", noon)).ok);

// ----- 2. Who sees it -----
check("An admin sees it", (await amDb.staffMenuLink(admin, "s1")) !== null);
check("A bartender assigned to the event sees it", (await amDb.staffMenuLink(taylor, "s1")) !== null);
check("A bartender offered the event sees it", (await amDb.staffMenuLink(casey, "s1")) !== null);
check("A bartender not on the event is refused", (await amDb.staffMenuLink(sam, "s1")) === null);
check("A bartender who declined is refused", (await amDb.staffMenuLink(robin, "s1")) === null);
check("An inactive person is refused", (await amDb.staffMenuLink(gone, "s1")) === null);
check("An admin in Bartender view is treated as a bartender (not on the event: refused)", (await amDb.staffMenuLink(adminAsBartender, "s1")) === null);
check("The client sees it on their own event page", (await amDb.clientMenuLink("s1")) !== null && (await amDb.clientMenu("s1"))?.viewHref === "/api/menu?id=s1");
check("Another event's link shows nothing (no menu there)", (await amDb.clientMenuLink("s2")) === null && (await amDb.clientMenu("s2")) === null);
check("An unknown or unfinished event shows nothing", (await amDb.clientMenuLink("nope")) === null && (await amDb.clientMenuLink("s3")) === null);
signed.length = 0;
await amDb.staffMenuLink(taylor, "s1");
check("Links are short lived (10 minutes)", signed.length === 1 && signed[0].seconds === 600 && signed[0].bucket === "event-menus");
signed.length = 0;
await amDb.clientMenuLink("s1", true);
check("The client's download gets a file name", signed[0]?.download === "menu-justin-s-30th.pdf");
check("The staff route checks who is asking before linking", src("app/api/team/menu-file/route.ts").includes("staffMenuLink(staff, sessionId"));
check("The client page shows Your menu with view and download", src("app/s/update-mode.tsx").includes("Your menu") && src("app/s/update-mode.tsx").includes("Download") && src("app/s/page.tsx").includes("clientMenu(sessionId)"));

// ----- 3. The pickup person's download -----
await mpDb.savePickup("s1", admin, { store: "walgreens", assignee_id: "b2" }, noon); // Sam picks it up but is not working the event
const samPickups = await mpDb.myPickups(sam, noon);
check("The pickup person's card has Download print file", samPickups.length === 1 && samPickups[0].printFileHref === "/api/team/menu-file?sessionId=s1&download=1");
check("The pickup person can download it even when not working the event", (await amDb.staffMenuLink(sam, "s1", { download: true })) !== null);
check("The card shows the button", src("app/team/menu-pickup-card.tsx").includes("Download print file"));
await mpDb.savePickup("s1", admin, { store: "walgreens", assignee_id: "b1" }, noon); // reassigned to Taylor
check("Once someone else is picking it up, Sam loses access", (await amDb.staffMenuLink(sam, "s1")) === null);
await mpDb.savePickup("s2", admin, { store: "walmart", assignee_id: "b2" }, noon);
check("No print file button before the menu is uploaded", (await mpDb.myPickups(sam, noon)).find((p) => p.sessionId === "s2")?.printFileHref === null);

// ----- 4. The bartender's read only menu section -----
const s1 = db.sessions[0] as never;
const mineT = await amDb.staffMenuSection(s1, taylor);
check("A bartender on the event gets the menu section", !!mineT && !!mineT.file && mineT.file.type === "application/pdf");
check("It shows where it is printed and who is picking it up", mineT?.store === "Walgreens" && mineT.pickupPerson === "Taylor");
check("The assigned person keeps the I picked it up button", mineT?.isPickupPerson === true && src("app/team/e/[id]/menu-section.tsx").includes("I picked it up"));
const mineC = await amDb.staffMenuSection(s1, casey);
check("Another bartender on the event sees it read only", !!mineC && mineC.isPickupPerson === false && mineC.pickupPerson === "Taylor");
check("A bartender not on the event gets nothing", (await amDb.staffMenuSection(s1, sam)) === null);
check("A bartender who declined gets nothing", (await amDb.staffMenuSection(s1, robin)) === null);
check("A read only bartender cannot mark it picked up", !(await mpDb.markPickedUp("s1", casey, noon)).ok);
const marked = await mpDb.markPickedUp("s1", taylor, at("2026-12-04", 15, 40));
const after = await amDb.staffMenuSection(s1, casey);
check("Picked up and when show to everyone on the event", marked.ok && after?.state === "picked_up" && /Picked up by Taylor, Dec 4, 3:40/.test(after.pickedUpLine));
check("The section sits on the Details tab", src("app/team/e/[id]/event-tabs.tsx").includes("{menuSection && <MenuSection menu={menuSection} />}"));

// ----- 5. The 72 hour count and the events list marker -----
reset();
const s1b = db.sessions[0] as never;
check("No count more than 72 hours out", !(await amDb.adminMenuView(s1b, at("2026-12-01", 15))).missing);
const in70 = at("2026-12-02", 18);
check("Inside 72 hours with no approved menu: counted", (await amDb.adminMenuView(s1b, in70)).missing);
check("The events list marks it", (await amDb.menuMissingIds(db.sessions as never, in70)).has("s1") && !(await amDb.menuMissingIds(db.sessions as never, in70)).has("s2"));
await upload("s1", { type: "image/jpeg", size: 1000 }, "2026-12-01", undefined, in70);
check("Uploading it clears the count and the marker", !(await amDb.adminMenuView(s1b, in70)).missing && !(await amDb.menuMissingIds(db.sessions as never, in70)).has("s1"));
reset();
await mpDb.savePickup("s1", admin, { not_needed: true }, noon);
check("No printed menu for this event: not counted", !(await amDb.adminMenuView(s1b, in70)).missing);
check("No count after the event starts", !(await amDb.adminMenuView(s1b, at(DAY, 17))).missing);
const mgr = src("app/team/admin/e/[id]/page.tsx");
check("The Details tab count includes it", mgr.includes("(menuFile.missing ? 1 : 0)"));
check("The events list and calendar show the marker", src("app/team/admin/events/page.tsx").includes("noMenu.has(s.id)") && src("app/team/calendar-view.tsx").includes("No approved menu") && src("app/team/events/event-list.tsx").includes("No approved menu"));

// ----- 6. Routes refuse bartenders -----
const route = src("app/api/team/admin/approved-menu/route.ts");
check("The upload route is admins only", route.includes('staff.role !== "admin"') && route.includes("status: 403"));

done("approved menu");
