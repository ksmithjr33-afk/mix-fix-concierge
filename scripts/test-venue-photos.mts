// Bar and venue photos on the Location card: admins and managers upload,
// caption, reorder and delete; everyone else is refused. Assigned staff (not
// declined) see them read only; declined and unassigned staff do not. Photos
// carry over to a later event at the same address (normalized), can be hidden
// for one event without leaving the venue, follow an address change, and a
// bar setup photo can be kept as a venue photo. Before the migration the card
// still loads. Real code against the in-memory database.
// Run: node --no-warnings scripts/test-venue-photos.mts

import { addDays, check, done, event, src } from "./team-harness.mts";

const { db, objects, missingTables } = await import("./fake-supabase.mts");
const rules = await import("../lib/team/venue-photos.ts");
const vdb = await import("../lib/team/venue-photos-db.ts");
const time = await import("../lib/team/time.ts");

const today = time.chicagoToday();
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true };
const manager = { id: "m1", name: "Alex Rivera", phone: "+12145550102", role: "manager" as const, active: true };
const sam = { id: "b1", name: "Sam Lee", phone: "+12145550111", role: "bartender" as const, active: true };
const jo = { id: "b2", name: "Jo Park", phone: "+12145550112", role: "server" as const, active: true }; // declined
const lee = { id: "b3", name: "Lee Wong", phone: "+12145550113", role: "bartender" as const, active: true }; // not on it

const PAST = "123 Main St., Dallas, TX 75201";
const SAME = "123  main st dallas tx 75201"; // spacing, case and punctuation differ
type Ev = ReturnType<typeof event> & { id: string; event_data: Record<string, unknown> };

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  objects.clear();
  missingTables.clear();
  db.sessions = [event("past", addDays(today, -30), PAST), event("next", addDays(today, 10), SAME), event("other", addDays(today, 12), "9 Elm St, Austin, TX")];
  db.staff = [admin, manager, sam, jo, lee].map((s) => ({ ...s }));
  db.event_assignments = [
    { id: "x1", session_id: "next", staff_id: "b1", status: "accepted" },
    { id: "x2", session_id: "next", staff_id: "b2", status: "declined" },
    { id: "x3", session_id: "past", staff_id: "b1", status: "offered" },
  ];
  db.venue_photos = [];
  db.venue_photo_hides = [];
  db.bar_ready_reports = [];
}
const ev = (id: string) => db.sessions.find((s) => s.id === id) as Ev;
const jpeg = (n = 2000) => ({ blob: new Blob([new Uint8Array(n)], { type: "image/jpeg" }), type: "image/jpeg" });
const assignment = (sid: string, staffId: string) => (db.event_assignments.find((a) => a.session_id === sid && a.staff_id === staffId) as { status: string } | undefined) ?? null;
const viewFor = (sid: string, who: typeof admin | typeof sam) => vdb.venuePhotosFor(ev(sid), who, assignment(sid, who.id));
async function refused(p: Promise<unknown>): Promise<number | null> {
  try {
    await p;
    return null;
  } catch (err) {
    return err instanceof vdb.VenuePhotoError ? err.status : -1;
  }
}

// ----- 1. Address normalizing -----
check("Case, spacing and punctuation do not change the venue", rules.venueKey(PAST) === rules.venueKey(SAME) && rules.venueKey(PAST) === "123 main st dallas tx 75201", rules.venueKey(SAME));
check("A different address is a different venue", rules.venueKey("125 Main St, Dallas, TX 75201") !== rules.venueKey(PAST));
check("No address never matches", rules.venueKey("") === "" && rules.venueKey(null) === "" && rules.venueKey(" , ") === "");
check("HEIC with no type from the phone is read from the name", rules.photoTypeOf("", "IMG_0042.HEIC") === "image/heic" && rules.photoTypeOf("", "a.heif") === "image/heif");
check("HEIC is an accepted photo type, same limits as bar setup photos", vdb.photoFileError({ type: "image/heic", size: 5000 }) === null && vdb.photoFileError({ type: "application/pdf", size: 5000 }) !== null && vdb.photoFileError({ type: "image/jpeg", size: 9 * 1024 * 1024 }) !== null);

// ----- 2. Upload, caption, reorder, delete: admins and managers -----
reset();
await vdb.addVenuePhoto({ session: ev("past"), staff: admin, file: jpeg(), caption: "  Main bar,   reception hall " });
await vdb.addVenuePhoto({ session: ev("past"), staff: manager, file: { blob: new Blob([new Uint8Array(3000)], { type: "image/heic" }), type: "image/heic" }, caption: "Load in door" });
await vdb.addVenuePhoto({ session: ev("past"), staff: admin, file: jpeg(), caption: "" });
let rows = db.venue_photos as Record<string, unknown>[];
check("Admins and managers upload, several on one event", rows.length === 3 && rows.every((r) => r.session_id === "past"));
check("Uploads go to the bar photos bucket under venue/", [...objects.keys()].length === 3 && [...objects.keys()].every((k) => k.startsWith("bar-photos/venue/past/")), [...objects.keys()].join());
check("HEIC is stored as .heic", [...objects.keys()].some((k) => k.endsWith(".heic")));
check("Caption is trimmed to one line", rows[0].caption === "Main bar, reception hall", String(rows[0].caption));
check("Venue key comes from the event address", rows.every((r) => r.venue_key === rules.venueKey(PAST)));
check("Positions follow upload order", rows.map((r) => r.position).join() === "0,1,2");

for (const who of [sam, jo, lee]) {
  check(`${who.role} ${who.name} cannot upload`, (await refused(vdb.addVenuePhoto({ session: ev("past"), staff: who, file: jpeg(), caption: "x" }))) === 403);
}
const [p1, p2, p3] = rows.map((r) => r.id as string);
check("Staff cannot edit a caption", (await refused(vdb.setVenueCaption("past", sam, p1, "mine"))) === 403);
check("Staff cannot reorder", (await refused(vdb.reorderVenuePhotos("past", sam, [p3, p2, p1]))) === 403);
check("Staff cannot delete", (await refused(vdb.deleteVenuePhoto("past", sam, p1))) === 403);
check("An inactive admin cannot change anything", (await refused(vdb.deleteVenuePhoto("past", { ...admin, active: false }, p1))) === 403);

await vdb.setVenueCaption("past", manager, p3, "Ice bin behind the bar");
check("Managers edit a caption", (db.venue_photos.find((r) => r.id === p3) as Record<string, unknown>).caption === "Ice bin behind the bar");
await vdb.reorderVenuePhotos("past", admin, [p3, p1, p2]);
let view = (await viewFor("past", admin))!;
check("Reorder sets the order everyone sees", view.own.map((p) => p.id).join() === [p3, p1, p2].join());
await vdb.reorderVenuePhotos("past", admin, [p2, "not-a-photo", p2]);
view = (await viewFor("past", admin))!;
check("Reorder ignores unknown and repeated ids, keeping the rest in order", view.own.map((p) => p.id).join() === [p2, p3, p1].join());
await vdb.deleteVenuePhoto("past", admin, p1);
view = (await viewFor("past", admin))!;
check("Delete takes it off the event", view.own.length === 2 && !view.own.some((p) => p.id === p1));
check("Deleted file stays in the private bucket", objects.size === 3);
check("A photo from another event cannot be edited here", (await refused(vdb.setVenueCaption("next", admin, p2, "x"))) === 404);

// ----- 3. Who sees them -----
const samView = await viewFor("next", sam);
check("Assigned staff see the photos", !!samView && samView.past.length === 2);
check("Assigned staff get them read only", samView!.canManage === false && samView!.hidden.length === 0 && samView!.keptBarReports.length === 0);
check("Offered (not yet accepted) staff count as assigned", !!(await viewFor("past", sam)));
check("Declined staff see nothing", (await viewFor("next", jo)) === null);
check("Unassigned staff see nothing", (await viewFor("next", lee)) === null);
check("Inactive staff see nothing", (await vdb.venuePhotosFor(ev("next"), { ...sam, active: false }, assignment("next", "b1"))) === null);
const pageSrc = src("app/team/e/[id]/page.tsx");
check("The staff page loads them with the viewer's own assignment and forces read only", /venuePhotosFor\(access\.session, staff, a\)/.test(pageSrc) && /canManage: false/.test(pageSrc));
const clientFiles = ["app/s/event-summary.tsx", "app/s/update-mode.tsx", "app/chat/page.tsx"];
check("Client pages never load venue photos", clientFiles.every((f) => !/venue-photos|venue_photos/.test(src(f))));
const routeSrc = src("app/api/team/admin/venue-photos/route.ts");
check("The route is admins and managers only", /isAdminRole\(staff\.role\)/.test(routeSrc) && /Admins only/.test(routeSrc));

// ----- 4. Carried over to a later event at the same address -----
const adminNext = (await viewFor("next", admin))!;
check("A later event at the same address shows them under From past events", adminNext.own.length === 0 && adminNext.past.map((p) => p.id).sort().join() === [p2, p3].sort().join());
check("Each carries the date it was added", adminNext.past.every((p) => !!p.addedAt) && /^Added [A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(rules.addedLabel(adminNext.past[0].addedAt)));
check("Captions carry over too", adminNext.past.some((p) => p.caption === "Ice bin behind the bar"));
check("A different address shows none", (await viewFor("other", admin))!.past.length === 0);
check("Deleted photos never carry over", !adminNext.past.some((p) => p.id === p1));

// ----- 5. Hiding a carried over photo for one event -----
check("Staff cannot hide one", (await refused(vdb.hidePastPhoto(ev("next"), sam, p2, true))) === 403);
await vdb.hidePastPhoto(ev("next"), manager, p2, true);
const hiddenAdmin = (await viewFor("next", admin))!;
check("Hidden one leaves this event's list", hiddenAdmin.past.map((p) => p.id).join() === p3 && hiddenAdmin.hidden.map((p) => p.id).join() === p2);
check("Staff no longer see the hidden one", (await viewFor("next", sam))!.past.map((p) => p.id).join() === p3);
check("It stays on the venue and on its own event", (await viewFor("past", admin))!.own.some((p) => p.id === p2) && !(db.venue_photos.find((r) => r.id === p2) as Record<string, unknown>).removed_at);
db.sessions.push(event("later", addDays(today, 40), PAST));
check("Another event at the address still shows it", (await viewFor("later", admin))!.past.some((p) => p.id === p2));
await vdb.hidePastPhoto(ev("next"), admin, p2, true);
check("Hiding twice keeps one hide", db.venue_photo_hides.length === 1);
check("Its own photos cannot be hidden as carried over", (await refused(vdb.hidePastPhoto(ev("past"), admin, p2, true))) === 404);
await vdb.hidePastPhoto(ev("next"), admin, p2, false);
check("Show again brings it back", (await viewFor("next", admin))!.past.length === 2 && db.venue_photo_hides.length === 0);

// ----- 6. Address change rechecks the match -----
ev("next").event_data.event_address = "9 Elm St, Austin, TX";
await vdb.addVenuePhoto({ session: ev("next"), staff: admin, file: jpeg(), caption: "Side door" });
check("After an address change the old venue's photos stop showing", (await viewFor("next", admin))!.past.length === 0);
ev("next").event_data.event_address = SAME;
const back = (await viewFor("next", admin))!;
check("Changing back finds them again", back.past.length === 2);
check("The event's own photos follow its current address", (db.venue_photos.find((r) => r.caption === "Side door") as Record<string, unknown>).venue_key === rules.venueKey(SAME));
check("And so carry to other events at the new address", (await viewFor("past", admin))!.past.some((p) => p.caption === "Side door"));

// ----- 7. Keeping a bar setup photo as a venue photo -----
db.bar_ready_reports.push(
  { id: "r1", session_id: "next", staff_id: "b1", photo_path: "next/b1/1.jpg", note: "Justin Reyes asked for the bar by the window", created_at: new Date().toISOString(), removed_at: null },
  { id: "r2", session_id: "other", staff_id: "b1", photo_path: "other/b1/2.jpg", note: "", created_at: new Date().toISOString(), removed_at: null },
  { id: "r3", session_id: "next", staff_id: "b1", photo_path: "next/b1/3.jpg", note: "", created_at: new Date().toISOString(), removed_at: new Date().toISOString() }
);
check("Staff cannot keep one", (await refused(vdb.keepBarPhoto(ev("next"), sam, "r1"))) === 403);
await vdb.keepBarPhoto(ev("next"), manager, "r1");
const kept = db.venue_photos.find((r) => r.bar_report_id === "r1") as Record<string, unknown>;
check("One tap keeps it as a venue photo, same file, no copy", !!kept && kept.photo_path === "next/b1/1.jpg" && kept.source === "bar_setup" && kept.session_id === "next");
check("The bartender's note is not carried into the caption", kept.caption === "");
const keptView = (await viewFor("next", admin))!;
check("It shows with the event's photos and is marked kept", keptView.own.some((p) => p.id === kept.id) && keptView.keptBarReports.includes("r1"));
await vdb.keepBarPhoto(ev("next"), admin, "r1");
check("Keeping again does not add a second copy", db.venue_photos.filter((r) => r.bar_report_id === "r1").length === 1);
check("A bar setup photo from another event cannot be kept here", (await refused(vdb.keepBarPhoto(ev("next"), admin, "r2"))) === 404);
check("A removed bar setup photo cannot be kept", (await refused(vdb.keepBarPhoto(ev("next"), admin, "r3"))) === 404);
check("Kept photos carry to later events at the address", (await viewFor("later", admin))!.past.some((p) => p.id === kept.id));

// ----- 8. No client name added, before the migration, wording -----
const allCaptions = (db.venue_photos as Record<string, unknown>[]).map((r) => String(r.caption)).join("|");
check("No caption ever picks up the client's name by itself", !/Justin|Reyes/.test(allCaptions), allCaptions);
check("The upload sheet asks to leave the client's name out", /leave out the client/.test(src("app/team/e/[id]/venue-photos.tsx")));
reset();
missingTables.add("venue_photos");
missingTables.add("venue_photo_hides");
const before = await viewFor("next", admin);
check("Before the migration the card loads empty", !!before && before.ready === false && before.own.length === 0 && before.past.length === 0);
check("Before the migration staff still load the page", (await viewFor("next", sam))?.ready === false);
check("Before the migration adding says the migration is needed", (await refused(vdb.addVenuePhoto({ session: ev("next"), staff: admin, file: jpeg(), caption: "" }))) === 503);
missingTables.clear();

const shown = src("app/team/e/[id]/venue-photos.tsx");
const strings = [...shown.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => m[1]).concat([...shown.matchAll(/"([A-Z][^"]*)"/g)].map((m) => m[1]));
const hy = strings.filter((s) => /[A-Za-z]-[A-Za-z]/.test(s) || / - /.test(s));
check("No hyphens in the card's wording", hy.length === 0, hy.join(" | "));
check("No hyphens in the shared wording", ![rules.VENUE_PHOTOS_TITLE, rules.PAST_TITLE, rules.NOT_READY].some((s) => s.includes("-")));
check("The admin Location card puts the row under Bar details", /r\.field === "bar_details" && locationExtra/.test(src("app/team/admin/e/[id]/editable-details.tsx")));
check("The staff Location card puts the row under Bar details", /Bar details" value=\{v\.barDetails\} \/>\s*\{locationExtra\}/.test(src("app/team/e/[id]/event-details.tsx")));

done("venue photos");
