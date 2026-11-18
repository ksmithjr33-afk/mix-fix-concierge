// Announcement drafts: saving without a title, drafts never texting or
// showing to staff, edit then send following quiet hours and Send now,
// autosave restoring after leaving the page, the newer edit warning, the test
// send reaching only the person asking, sending someone else's draft, delete,
// and everything still loading before the migration runs.
// Real code against the in-memory database.
// Run: node --no-warnings scripts/test-drafts.mts

import { check, done, src, texts, textsTo } from "./team-harness.mts";

const { db, missingTables, objects, putObject } = await import("./fake-supabase.mts");
const rules = await import("../lib/team/announcement-drafts.ts");
const ddb = await import("../lib/team/announcement-drafts-db.ts");
const ann = await import("../lib/team/announcements.ts");
const annDb = await import("../lib/team/announcements-db.ts");
const media = await import("../lib/team/media-db.ts");
const time = await import("../lib/team/time.ts");

const today = time.todayIn("America/Chicago");
const at = (mins: number, ymd = today) => time.zonedInstant(ymd, mins, "America/Chicago");
const NOON = at(12 * 60);
const TEN_PM = at(22 * 60);
const later = (d: Date, mins: number) => new Date(d.getTime() + mins * 60_000);
const tomorrow = time.todayIn("America/Chicago", later(TEN_PM, 6 * 60));

const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, markets: ["dallas"] };
const manager = { id: "m1", name: "Alex Rivera", phone: "+12145550102", role: "manager" as const, active: true, markets: ["dallas"] };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true, markets: ["dallas"] };
const b2 = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bartender" as const, active: true, markets: ["austin"] };
const staff = [admin, manager, b1, b2];

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  missingTables.clear();
  objects.clear();
  db.staff = staff.map((s) => ({ ...s }));
  for (const t of ["announcements", "announcement_recipients", "announcement_drafts", "team_attachments"]) db[t] = [];
  texts.length = 0;
}
const id = () => crypto.randomUUID();
const save = (who: typeof admin | typeof manager | typeof b1, raw: Record<string, unknown>, now: Date) => ddb.saveDraft(who as never, raw, now);
const draftRow = (i: string) => db.announcement_drafts.find((d) => d.id === i) as Record<string, unknown> | undefined;
const nothingReachedStaff = () => texts.length === 0 && db.announcement_recipients.length === 0 && db.announcements.length === 0;

// ----- 1. Rules -----
check("A draft needs no title", rules.validateDraft({ title: "", body: "" }).ok);
check("Lengths and markets are still checked", !rules.validateDraft({ title: "x".repeat(121) }).ok && !rules.validateDraft({ body: "x".repeat(2001) }).ok && !rules.validateDraft({ markets: ["miami"] }).ok);
check("Untitled and the first line of the message", rules.draftTitle("  ") === "Untitled" && rules.draftTitle("Hi") === "Hi" && rules.firstLine("\n  Line one \nLine two") === "Line one");
check("An empty form is not worth saving", rules.draftIsEmpty({ title: " ", body: "\n", attachmentId: null }) && !rules.draftIsEmpty({ title: "", body: "", attachmentId: "x" }));
const t1 = NOON.toISOString();
const t2 = later(NOON, 1).toISOString();
check("Newer edit: someone else saved after I loaded", rules.isNewerEditByOther({ updated_by: "m1", updated_at: t2 }, "a1", t1));
check("Newer edit: my own later save is not a conflict", !rules.isNewerEditByOther({ updated_by: "a1", updated_at: t2 }, "a1", t1));
check("Newer edit: the version I loaded is not a conflict", !rules.isNewerEditByOther({ updated_by: "m1", updated_at: t1 }, "a1", t1));
check("Newer edit: someone else's draft I never loaded is a conflict", rules.isNewerEditByOther({ updated_by: "m1", updated_at: t1 }, "a1", null));
check("Some markets with none picked cannot be sent", "error" in rules.draftToAnnouncement({ title: "x", body: "y", audience: "markets", markets: [], bartenders_only: false, send_now: false }));

// ----- 2. Saving a draft without a title -----
reset();
const d1 = id();
const s1 = await save(admin, { id: d1, title: "", body: "Holiday hours are\nchanging next week." }, NOON);
check("Saving a draft without a title works", s1.ok && draftRow(d1)?.title === "" && draftRow(d1)?.status === "draft", JSON.stringify(s1));
const list1 = await ddb.draftsFor(admin as never);
check("The Drafts list shows it as Untitled with the first line, the author and when it was saved", list1.length === 1 && rules.draftTitle(list1[0].title) === "Untitled" && rules.firstLine(list1[0].body) === "Holiday hours are" && list1[0].authorName === "Kenneth Smith" && list1[0].updatedAt === NOON.toISOString());
check("A blank new draft is refused", !(await save(admin, { id: id(), title: " ", body: "" }, NOON)).ok);
const noTitle = await ddb.sendDraft(admin as never, { id: d1 }, NOON);
check("The title is still required to send", !noTitle.ok && noTitle.error === "Add a title." && draftRow(d1)?.status === "draft");
check("Saving the same draft again does not make a second one", (await save(admin, { id: d1, title: "", body: "Holiday hours are changing.", baseUpdatedAt: NOON.toISOString() }, later(NOON, 1))).ok && db.announcement_drafts.length === 1);

// ----- 3. Drafts never text or show to staff -----
reset();
db.team_attachments.push({ id: "pic1", scope: "announcement", status: "pending", uploaded_by: "a1", file_path: "announcements/a1/x.gif", file_type: "image/gif", size_bytes: 1000, kind: "gif", source: "upload", session_id: null, announcement_id: null, message_id: null });
putObject("team-media", "announcements/a1/x.gif", 1000, "image/gif");
const d2 = id();
await save(admin, { id: d2, title: "Holiday schedule", body: "Office closed Thursday.", attachmentId: "pic1", sendNow: true }, NOON);
await save(admin, { id: d2, title: "Holiday schedule", body: "Office closed Thursday and Friday.", attachmentId: "pic1", sendNow: true, baseUpdatedAt: NOON.toISOString() }, later(NOON, 1));
check("Saving a draft (even with Send now ticked) texts nobody and makes no announcement", nothingReachedStaff());
check("The cron finds nothing to send for a draft", (await annDb.deliverAnnouncements(later(NOON, 5))) === 0 && texts.length === 0);
check("Staff see no announcement and no unread badge", (await annDb.announcementsFor(b1 as never)).length === 0 && (await annDb.unreadAnnouncements("b1")) === 0);
check("A draft is not in the sent list, even for admins", (await annDb.announcementsFor(admin as never)).length === 0);
check("Staff get no Drafts list and cannot open a draft", (await ddb.draftsFor(b1 as never)).length === 0 && (await ddb.draftFor(b1 as never, d2)) === null);
check("Staff cannot save, send, test or delete a draft", ![await save(b1, { id: d2, title: "x" }, NOON), await ddb.sendDraft(b1 as never, { id: d2, confirmOthers: true }, NOON), await ddb.testDraft(b1 as never, d2), await ddb.deleteDraft(b1 as never, d2)].some((r) => r.ok));
const pic = db.team_attachments[0] as never;
check("A draft's picture is visible to admins and managers, never staff", (await media.canViewAttachment(manager as never, pic)) && !(await media.canViewAttachment(b1 as never, pic)));
check("The drafts route is admins and managers only", src("app/api/team/admin/announcements/drafts/route.ts").includes("if (!isAdminRole(staff.role))") && src("app/api/team/admin/announcements/drafts/route.ts").includes("getCurrentStaff()"));
check("The test view page is admins and managers only", src("app/team/announcements/drafts/[id]/page.tsx").includes("admin ? await draftFor(staff, id) : null"));

// ----- 4. Edit then send, following quiet hours -----
reset();
const d3 = id();
const first = await save(admin, { id: d3, title: "Late note", body: "See you tomorrow." }, at(21 * 60 + 30));
const edited = await save(admin, { id: d3, title: "Late note", body: "See you tomorrow at 9.", baseUpdatedAt: first.ok ? first.updatedAt : "" }, TEN_PM);
const sent = await ddb.sendDraft(admin as never, { id: d3, baseUpdatedAt: edited.ok ? edited.updatedAt : "" }, later(TEN_PM, 1));
check("Sent at 10 PM without Send now: every text is held for the morning", sent.ok && sent.recipients === 3 && sent.texted === 0 && sent.held === 3 && texts.length === 0, JSON.stringify(sent));
check("The edited version is what was sent", db.announcements.length === 1 && db.announcements[0].body === "See you tomorrow at 9.");
check("Held texts wait for 8:00 AM their time", db.announcement_recipients.every((r) => r.send_after === at(8 * 60, tomorrow).toISOString()));
check("The draft moves from Drafts to the sent list", draftRow(d3)?.status === "sent" && draftRow(d3)?.announcement_id === db.announcements[0].id && (await ddb.draftsFor(admin as never)).length === 0 && (await annDb.announcementsFor(admin as never)).map((a) => a.title).join() === "Late note");
await annDb.deliverAnnouncements(at(8 * 60, tomorrow));
check("At 8:00 AM the held texts go out, once each", texts.length === 3 && textsTo(b1).length === 1 && textsTo(admin).length === 0);
reset();
const d4 = id();
const s4 = await save(manager, { id: d4, title: "Storm tonight", body: "Check your event page.", sendNow: true, audience: "markets", markets: ["dallas"], bartendersOnly: true }, TEN_PM);
const urgent = await ddb.sendDraft(manager as never, { id: d4, baseUpdatedAt: s4.ok ? s4.updatedAt : "" }, later(TEN_PM, 1));
check("Send now on a draft texts right away, even in quiet hours, to the chosen audience only", urgent.ok && urgent.texted === 1 && textsTo(b1).length === 1 && textsTo(b2).length === 0, JSON.stringify(urgent));
check("A draft cannot be sent twice", !(await ddb.sendDraft(manager as never, { id: d4 }, later(TEN_PM, 2))).ok && db.announcements.length === 1);
reset();
const d5 = id();
await save(admin, { id: d5, title: "Pick a market", body: "x", audience: "markets", markets: [] }, NOON);
check("Some markets with none picked is refused when sending", !(await ddb.sendDraft(admin as never, { id: d5 }, NOON)).ok && nothingReachedStaff());
reset();
const d6 = id();
const [x, y] = await Promise.all([save(admin, { id: d6, title: "Twice", body: "y", sendNow: true }, NOON)]).then(async () => Promise.all([ddb.sendDraft(admin as never, { id: d6 }, NOON), ddb.sendDraft(admin as never, { id: d6 }, NOON)]));
check("Two sends at once: one goes, the other is refused", [x, y].filter((r) => r.ok).length === 1 && db.announcements.length === 1 && textsTo(b1).length === 1);

// ----- 5. Autosave restoring after leaving the page -----
reset();
db.team_attachments.push({ id: "pic2", scope: "announcement", status: "pending", uploaded_by: "a1", file_path: "announcements/a1/y.png", file_type: "image/png", size_bytes: 2000, kind: "photo", source: "upload", session_id: null, announcement_id: null, message_id: null });
const d7 = id(); // the browser picks the id when the form opens
const auto1 = await save(admin, { id: d7, title: "Team party", body: "Friday at 7." }, NOON);
// Leaving the page sends whatever was typed since (the same save, by beacon).
await save(admin, { id: d7, title: "Team party", body: "Friday at 7. Bring a friend.", audience: "markets", markets: ["austin", "dallas"], bartendersOnly: true, sendNow: true, attachmentId: "pic2", baseUpdatedAt: auto1.ok ? auto1.updatedAt : "" }, later(NOON, 1));
const back = await ddb.draftsFor(admin as never);
const resumed = rules.draftToResume(d7, back);
check("Coming back, the draft that was open is found", !!resumed && back.length === 1);
check(
  "Every field is restored: title, message, picture, Send to and Send now",
  !!resumed && resumed.title === "Team party" && resumed.body === "Friday at 7. Bring a friend." && resumed.audience === "markets" && resumed.markets.join() === "dallas,austin" && resumed.bartendersOnly && resumed.sendNow && resumed.attachment?.id === "pic2" && resumed.attachment.kind === "photo",
  JSON.stringify(resumed)
);
check("Saved shows the time of the last save", resumed?.updatedAt === later(NOON, 1).toISOString());
check("A draft that was sent or deleted is not reopened", rules.draftToResume("gone", back) === null && rules.draftToResume(null, back) === null);
const composeSrc = src("app/team/announcements/compose.tsx");
check("The form autosaves a few seconds after typing stops and shows Saved with the time", composeSrc.includes("setTimeout(() => void save({ auto: true }), AUTOSAVE_MS)") && composeSrc.includes("`Saved ${clock(savedAt)}`") && rules.AUTOSAVE_MS >= 1000 && rules.AUTOSAVE_MS <= 5000);
check("The form saves on leaving the page and reopens the open draft on return", composeSrc.includes('addEventListener("pagehide", flush)') && composeSrc.includes("draftToResume(id, drafts)"));

// ----- 6. The newer edit warning -----
reset();
const d8 = id();
const mine = await save(admin, { id: d8, title: "Schedule", body: "Version one." }, NOON);
const mineAt = mine.ok ? mine.updatedAt : "";
const theirs = await save(manager, { id: d8, title: "Schedule", body: "Alex's version.", baseUpdatedAt: mineAt }, later(NOON, 2));
check("A manager can edit an admin's draft", theirs.ok && draftRow(d8)?.body === "Alex's version." && draftRow(d8)?.updated_by === "m1");
const stale = await save(admin, { id: d8, title: "Schedule", body: "Version two.", baseUpdatedAt: mineAt }, later(NOON, 3));
check("Autosave never writes over someone else's newer edit", !stale.ok && stale.status === 409 && draftRow(d8)?.body === "Alex's version.");
check("The warning says who saved it, when, and carries their version", !stale.ok && stale.conflict?.by === "Alex Rivera" && stale.conflict.at === later(NOON, 2).toISOString() && stale.conflict.draft.body === "Alex's version.");
check("The form pauses autosave and offers their version or keeping mine", composeSrc.includes("Autosave is paused so their changes are not lost.") && composeSrc.includes("Load their version") && composeSrc.includes("if (!open || !draftId || conflict || draftsOff) return;"));
const sendStale = await ddb.sendDraft(admin as never, { id: d8, baseUpdatedAt: mineAt }, later(NOON, 3));
check("Sending a version someone else has since changed is refused", !sendStale.ok && sendStale.status === 409 && nothingReachedStaff());
const kept = await save(admin, { id: d8, title: "Schedule", body: "Version two.", baseUpdatedAt: mineAt, force: true }, later(NOON, 4));
check("Keep mine, chosen after the warning, saves", kept.ok && draftRow(d8)?.body === "Version two.");
const otherTab = await save(admin, { id: d8, title: "Schedule", body: "From my other tab.", baseUpdatedAt: mineAt }, later(NOON, 5));
check("My own newer save from another tab is not a conflict", otherTab.ok);
const neverLoaded = await save(manager, { id: d8, title: "Schedule", body: "Blind write." }, later(NOON, 6));
check("Saving over a draft someone else saved, without having loaded it, is refused", !neverLoaded.ok && neverLoaded.status === 409);

// ----- 7. Send a test to me -----
reset();
db.team_attachments.push({ id: "pic3", scope: "announcement", status: "pending", uploaded_by: "a1", file_path: "announcements/a1/z.gif", file_type: "image/gif", size_bytes: 1000, kind: "gif", source: "upload", session_id: null, announcement_id: null, message_id: null });
putObject("team-media", "announcements/a1/z.gif", 1000, "image/gif");
const d9 = id();
const s9 = await save(admin, { id: d9, title: "Uniform update", body: "Black shirts from Monday.", attachmentId: "pic3", sendNow: true }, NOON);
const before = JSON.stringify(draftRow(d9));
const test1 = await ddb.testDraft(manager as never, d9);
check("The test goes to the person asking, and only them", test1.ok && texts.length === 1 && textsTo(manager).length === 1, JSON.stringify(test1));
check(
  "It is exactly the text staff would get, linking to the draft as staff will see it",
  textsTo(manager)[0]?.message === ann.announcementText({ title: "Uniform update", link: `https://plan.test/team/announcements/drafts/${d9}`, attachment: "gif" }),
  textsTo(manager)[0]?.message
);
check("Nobody else is texted and nothing is sent to staff", textsTo(admin).length === 0 && textsTo(b1).length === 0 && db.announcements.length === 0 && db.announcement_recipients.length === 0);
check("The draft's status and content are unchanged", JSON.stringify(draftRow(d9)) === before && draftRow(d9)?.status === "draft");
check("The test view shows the draft the way staff see it", (await ddb.draftFor(admin as never, d9))?.body === "Black shirts from Monday." && src("app/team/announcements/drafts/[id]/page.tsx").includes("Test view. This is how staff will see it."));
check("A test needs a title and a message", !(await ddb.testDraft(admin as never, (await save(admin, { id: (() => { const n = id(); return n; })(), title: "", body: "x" }, NOON), db.announcement_drafts.at(-1)!.id as string))).ok);
// Sending it for real after the test still works, and carries the picture another admin uploaded.
const real = await ddb.sendDraft(manager as never, { id: d9, baseUpdatedAt: s9.ok ? s9.updatedAt : "", confirmOthers: true }, NOON);
check("After a test, the draft still sends normally, with the picture another admin uploaded", real.ok && (db.team_attachments.find((a) => a.id === "pic3") as Record<string, unknown>).status === "attached" && db.announcements[0].attachment_id === "pic3", JSON.stringify(real));

// ----- 8. Someone else's draft -----
reset();
const d10 = id();
await save(admin, { id: d10, title: "Payday", body: "Friday.", sendNow: true }, NOON);
const unconfirmed = await ddb.sendDraft(manager as never, { id: d10 }, NOON);
check("Sending a draft someone else wrote needs a confirm", !unconfirmed.ok && unconfirmed.needsConfirm === true && unconfirmed.error.includes("Kenneth Smith") && nothingReachedStaff());
const confirmed = await ddb.sendDraft(manager as never, { id: d10, confirmOthers: true }, NOON);
check("Confirmed, any manager can send any draft", confirmed.ok && db.announcements.length === 1);
check("The form and the list confirm before sending someone else's draft and show the author", composeSrc.includes("wrote this draft. Send it to staff now?") && composeSrc.includes("Written by") && composeSrc.includes("By {d.createdBy === me ?"));

// ----- 9. Delete -----
reset();
const d11 = id();
const s11 = await save(admin, { id: d11, title: "Old idea", body: "Never mind." }, NOON);
check("Staff cannot delete a draft", !(await ddb.deleteDraft(b1 as never, d11)).ok && draftRow(d11)?.status === "draft");
const del = await ddb.deleteDraft(manager as never, d11, later(NOON, 1));
check("Delete removes it from Drafts", del.ok && (await ddb.draftsFor(admin as never)).length === 0);
const late = await save(admin, { id: d11, title: "Old idea", body: "Never mind!", baseUpdatedAt: s11.ok ? s11.updatedAt : "" }, later(NOON, 2));
check("A late autosave cannot bring a deleted draft back", !late.ok && late.status === 410 && (await ddb.draftsFor(admin as never)).length === 0);
check("A deleted draft cannot be sent", !(await ddb.sendDraft(admin as never, { id: d11 }, NOON)).ok && nothingReachedStaff());
check("Deleting twice says it is already gone", !(await ddb.deleteDraft(admin as never, d11)).ok);
check("Delete asks to confirm", composeSrc.includes("window.confirm(`Delete the draft"));

// ----- 10. Before the migration -----
reset();
missingTables.add("announcement_drafts");
check("Before the migration the Drafts list is empty, so the page loads", (await ddb.draftsFor(admin as never)).length === 0 && (await ddb.draftFor(admin as never, id())) === null);
const early = await save(admin, { id: id(), title: "x", body: "y" }, NOON);
check("Before the migration saving says drafts are not set up yet", !early.ok && early.status === 503);
check("Before the migration announcements still send the old way", (await annDb.createAnnouncement(admin as never, { title: "Still works", body: "y", sendNow: true }, NOON)).ok && composeSrc.includes('if (saved !== "off") return;'));

// ----- 11. Wording -----
const shown = [...composeSrc.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => m[1]).concat(src("app/team/announcements/drafts/[id]/page.tsx").match(/>([^<>{}]*[A-Za-z][^<>{}]*)</g) ?? []);
const messages = [...src("lib/team/announcement-drafts-db.ts").matchAll(/error: [`"]([^`"]+)[`"]/g)].map((m) => m[1]);
check("No hyphens in wording shown on screen", shown.concat(messages).every((t) => !/\w-\w|\s-\s/.test(t)), shown.concat(messages).filter((t) => /\w-\w|\s-\s/.test(t)).join(" | "));
check("The form has Save draft beside Send announcement, and Send a test to me", composeSrc.includes(">\n              Save draft") && composeSrc.includes("Send announcement") && composeSrc.includes("Send a test to me"));
check("Drafts sit above the sent announcements", src("app/team/announcements/page.tsx").indexOf("<Compose") < src("app/team/announcements/page.tsx").indexOf("items.map"));

done("announcement draft");
