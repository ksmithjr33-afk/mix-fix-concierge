// Pictures and GIFs in event chat and announcements: upload limits, the stored
// file checked again, who can view (only people who can see that chat or
// announcement), texts that say "sent a GIF" or "sent a photo" and never carry
// the file, client details still stripped, admins removing any attachment,
// and the GIPHY button hidden without GIPHY_API_KEY.
// Run: node --no-warnings scripts/test-chat-media.mts

import { check, done, event, noClientData, src, texts, textsTo } from "./team-harness.mts";

const { db, putObject, objects, removed, signed } = await import("./fake-supabase.mts");
const media = await import("../lib/team/media.ts");
const mediaDb = await import("../lib/team/media-db.ts");
const chatDb = await import("../lib/team/chat-db.ts");
const annDb = await import("../lib/team/announcements-db.ts");
const chat = await import("../lib/team/chat.ts");

// GIPHY stand-in: one rated G GIF, one rated R GIF, and the GIF file itself.
const harnessFetch = globalThis.fetch;
const giphyCalls: string[] = [];
const GIF = (id: string, rating: string) => ({
  id,
  rating,
  title: `gif ${id}`,
  images: {
    fixed_width_small: { url: `https://media.giphy.com/media/${id}/100w.gif`, width: "100", height: "80" },
    downsized: { url: `https://media.giphy.com/media/${id}/giphy-downsized.gif`, size: "900000" },
  },
});
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("https://api.giphy.com/")) {
    giphyCalls.push(url);
    if (url.includes("/search")) return new Response(JSON.stringify({ data: [GIF("cheersG1", "g"), GIF("spicyR22", "r"), GIF("pgPG333", "pg")] }), { status: 200 });
    const id = url.match(/gifs\/([A-Za-z0-9]+)/)?.[1] ?? "";
    return new Response(JSON.stringify({ data: GIF(id, id.startsWith("spicy") ? "r" : "g") }), { status: 200 });
  }
  if (url.startsWith("https://media.giphy.com/")) return new Response(new Uint8Array(900_000), { status: 200, headers: { "content-type": "image/gif" } });
  return harnessFetch(input as string, init);
}) as typeof fetch;

const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true };
const taylor = { id: "b1", name: "Taylor Brooks", phone: "+12145550111", role: "bartender" as const, active: true };
const jordan = { id: "b2", name: "Jordan Lee", phone: "+12145550112", role: "bartender" as const, active: true };
const sam = { id: "b3", name: "Sam Diaz", phone: "+12145550113", role: "bartender" as const, active: true }; // not on the event
const robin = { id: "b4", name: "Robin Park", phone: "+12145550114", role: "bartender" as const, active: true }; // declined
const austinOnly = { id: "b5", name: "Avery Cole", phone: "+12145550115", role: "bartender" as const, active: true };
const adminAsBartender = { ...admin, role: "bartender" as const };
const MB = 1024 * 1024;
const now = new Date("2026-12-01T18:00:00Z");

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [event("s1", "2026-12-05", "1 Elm St, Dallas, TX", {}, { team_market: "dallas" }), event("s2", "2026-12-06", "1 Elm St, Dallas, TX", {}, { team_market: "dallas" })];
  db.staff = [
    { ...admin, markets: ["dallas"] },
    { ...taylor, markets: ["dallas"] },
    { ...jordan, markets: ["dallas"] },
    { ...sam, markets: ["dallas"] },
    { ...robin, markets: ["dallas"] },
    { ...austinOnly, markets: ["austin"] },
  ];
  db.event_assignments = [
    { id: "x1", session_id: "s1", staff_id: "b1", status: "accepted" },
    { id: "x2", session_id: "s1", staff_id: "b2", status: "offered" },
    { id: "x4", session_id: "s1", staff_id: "b4", status: "declined" },
    { id: "x5", session_id: "s2", staff_id: "b3", status: "accepted" },
  ];
  for (const t of ["team_attachments", "event_messages", "event_message_reads", "event_chat_notices", "event_chat_mutes", "announcements", "announcement_recipients", "team_notices"]) db[t] = [];
  objects.clear();
  removed.length = 0;
  signed.length = 0;
  texts.length = 0;
  delete process.env.GIPHY_API_KEY;
}

/** A picture picked on the phone: start, the browser puts the file in storage. Returns the attachment id. */
async function pick(staff: typeof taylor | typeof admin, scope: "chat" | "announcement", type: string, size: number, sessionId: string | undefined = "s1", stored?: { type: string; size: number }) {
  const r = await mediaDb.startMediaUpload(staff, { scope, sessionId, type, size }, now);
  if (!r.ok) return { r, id: "" };
  const row = db.team_attachments.find((a) => a.id === r.id)!;
  putObject("team-media", String(row.file_path), (stored ?? { size }).size, (stored ?? { type }).type);
  return { r, id: r.id };
}

// ----- 1. Upload limits -----
reset();
check("GIF, PNG, JPG and WEBP up to 8 MB are allowed", ["image/gif", "image/png", "image/jpeg", "image/webp"].every((t) => media.mediaError({ type: t, size: 8 * MB }) === null));
check("Over 8 MB is refused", media.mediaError({ type: "image/gif", size: 8 * MB + 1 }) !== null);
check("Other types are refused", media.mediaError({ type: "application/pdf", size: 10 }) !== null && media.mediaError({ type: "image/heic", size: 10 }) !== null && media.mediaError({ type: "video/mp4", size: 10 }) !== null);
check("Starting a 9 MB upload is refused before anything is stored", !(await mediaDb.startMediaUpload(taylor, { scope: "chat", sessionId: "s1", type: "image/gif", size: 9 * MB }, now)).ok && db.team_attachments.length === 0);
check("Starting a PDF upload is refused", !(await mediaDb.startMediaUpload(taylor, { scope: "chat", sessionId: "s1", type: "application/pdf", size: 1000 }, now)).ok);
const ok = await pick(taylor, "chat", "image/gif", 2 * MB);
check("A bartender on the event can attach a GIF", ok.r.ok && ok.r.ok && ok.r.kind === "gif" && String(db.team_attachments[0].file_path).startsWith("chat/s1/b1-"));
check("A bartender not on the event cannot upload to its chat", !(await mediaDb.startMediaUpload(sam, { scope: "chat", sessionId: "s1", type: "image/png", size: 1000 }, now)).ok);
check("A bartender who declined cannot upload to its chat", !(await mediaDb.startMediaUpload(robin, { scope: "chat", sessionId: "s1", type: "image/png", size: 1000 }, now)).ok);
check("A bartender cannot attach to an announcement", !(await mediaDb.startMediaUpload(taylor, { scope: "announcement", type: "image/png", size: 1000 }, now)).ok);
check("An admin in Bartender view cannot attach to an announcement", !(await mediaDb.startMediaUpload(adminAsBartender, { scope: "announcement", type: "image/png", size: 1000 }, now)).ok);
const liar = await pick(taylor, "chat", "image/png", 1000, "s1", { type: "image/png", size: 12 * MB });
const liarPost = await chatDb.postMessage("s1", taylor, "look", now, liar.id);
check("A stored file bigger than it said is refused when sent, and deleted", !liarPost.ok && !objects.has(`team-media/${db.team_attachments.find((a) => a.id === liar.id)?.file_path}`) && !db.team_attachments.some((a) => a.id === liar.id));
const fake = await pick(taylor, "chat", "image/png", 1000, "s1", { type: "text/html", size: 1000 });
check("A stored file of another type is refused when sent", !(await chatDb.postMessage("s1", taylor, "x", now, fake.id)).ok);

// ----- 2. Sending, texts, and client details -----
reset();
const gif = await pick(taylor, "chat", "image/gif", 3 * MB);
check("Someone else cannot send another person's upload", !(await chatDb.postMessage("s1", jordan, "", now, gif.id)).ok);
check("An upload for one chat cannot be sent in another", !(await chatDb.postMessage("s2", admin, "", now, gif.id)).ok);
check("A message with no words and no picture is refused", !(await chatDb.postMessage("s1", taylor, "  ", now)).ok);
const sent = await chatDb.postMessage("s1", taylor, "", now, gif.id);
check("A GIF alone can be sent", sent.ok && sent.message.attachment?.kind === "gif" && sent.message.body === "");
check("It is attached to the message", db.team_attachments.find((a) => a.id === gif.id)!.status === "attached" && db.team_attachments.find((a) => a.id === gif.id)!.message_id === (sent.ok ? sent.message.id : ""));
check("Only one picture per message: the same upload cannot be sent twice", !(await chatDb.postMessage("s1", taylor, "again", now, gif.id)).ok);
const toJordan = textsTo(jordan);
check("The text says sent a GIF and links to the app", toJordan.length === 1 && toJordan[0].message === "Taylor on Justin's 30th: sent a GIF https://plan.test/team/e/s1?tab=chat");
check("The file is never in the text", !texts.some((t) => /signed\.test|team-media|upload\.test|\.gif\b/.test(t.message)));
const photo = await pick(taylor, "chat", "image/jpeg", 1 * MB);
const later = new Date(now.getTime() + 10 * 60_000);
const sentPhoto = await chatDb.postMessage("s1", taylor, "Bar is set. Call Justin at 972-555-0199 or justin@example.com", later, photo.id);
check("Client contact details are still stripped from a message with a picture", sentPhoto.ok && noClientData(sentPhoto.message.body) && sentPhoto.message.body.includes("[client contact removed]"));
check("A photo's text says sent a photo, with the words", textsTo(jordan).length === 2 && textsTo(jordan)[1].message.startsWith("Taylor on Justin's 30th: sent a photo: Bar is set.") && noClientData(textsTo(jordan)[1].message));
// A held text (sent within 5 minutes of the last) says the same when it goes out.
const gif2 = await pick(taylor, "chat", "image/gif", 1000);
await chatDb.postMessage("s1", taylor, "", new Date(later.getTime() + 60_000), gif2.id);
check("Inside 5 minutes the text is held", textsTo(jordan).length === 2);
await chatDb.deliverChatNotices(new Date(later.getTime() + 6 * 60_000));
check("The held text says sent a GIF", textsTo(jordan).length === 3 && textsTo(jordan)[2].message.startsWith("Taylor on Justin's 30th: sent a GIF") && !/signed\.test|team-media/.test(textsTo(jordan)[2].message));
check("The chat list snippet for a picture alone reads sent a GIF", chat.inboxSnippet("", "gif") === "sent a GIF" && chat.inboxSnippet("", "photo") === "sent a photo");

// ----- 3. Who can view -----
const gifId = gif.id;
check("An admin can view a chat picture", (await mediaDb.attachmentLink(admin, gifId)) !== null);
check("A bartender on the event can view it", (await mediaDb.attachmentLink(taylor, gifId)) !== null && (await mediaDb.attachmentLink(jordan, gifId)) !== null);
check("A bartender not on the event cannot", (await mediaDb.attachmentLink(sam, gifId)) === null);
check("A bartender who declined cannot", (await mediaDb.attachmentLink(robin, gifId)) === null);
check("An admin in Bartender view who is not on the event cannot", (await mediaDb.attachmentLink(adminAsBartender, gifId)) === null);
const pendingPic = await pick(jordan, "chat", "image/png", 1000);
check("A picture not sent yet is only visible to who uploaded it", (await mediaDb.attachmentLink(jordan, pendingPic.id)) !== null && (await mediaDb.attachmentLink(taylor, pendingPic.id)) === null && (await mediaDb.attachmentLink(admin, pendingPic.id)) === null);
signed.length = 0;
await mediaDb.attachmentLink(taylor, gifId);
check("Links are short lived (10 minutes) from the private team-media bucket", signed[0]?.seconds === 600 && signed[0]?.bucket === "team-media");
const thread = await chatDb.threadMessages("s1", taylor);
check("The thread links pictures through the checking route", thread.some((m) => m.attachment?.url === `/api/team/media/file?id=${gifId}`));
check("The file route checks who is asking", src("app/api/team/media/file/route.ts").includes("attachmentLink(staff, id)"));

// Announcements
const annPic = await pick(admin, "announcement", "image/png", 2 * MB, undefined);
const ann = await annDb.createAnnouncement(admin, { title: "Holiday party", body: "Saturday at 7.", markets: ["dallas"], bartendersOnly: false, sendNow: true, attachmentId: annPic.id }, now);
check("An admin sends an announcement with a photo", ann.ok && db.team_attachments.find((a) => a.id === annPic.id)!.status === "attached" && db.team_attachments.find((a) => a.id === annPic.id)!.announcement_id === (ann.ok ? ann.id : ""));
check("Its text says sent a photo and links to the app", textsTo(taylor).some((t) => t.message.startsWith("Mix Fix sent a photo with an announcement: Holiday party. Read it: https://plan.test/team/announcements/")));
check("The announcement text never carries the file", !texts.some((t) => /signed\.test|team-media/.test(t.message)));
check("A recipient can view it", (await mediaDb.attachmentLink(taylor, annPic.id)) !== null);
check("Someone it was not sent to cannot", (await mediaDb.attachmentLink(austinOnly, annPic.id)) === null);
check("Admins can view it", (await mediaDb.attachmentLink(admin, annPic.id)) !== null);
const detail = ann.ok ? await annDb.openAnnouncement(ann.id, taylor, now) : null;
check("The announcement page shows it to a recipient", detail?.item.attachment?.kind === "photo");
check("Someone it was not sent to cannot open the announcement at all", ann.ok && (await annDb.openAnnouncement(ann.id, austinOnly, now)) === null);
const annGifPic = await pick(admin, "announcement", "image/gif", 1000, undefined);
texts.length = 0;
await annDb.createAnnouncement(admin, { title: "Cheers", body: "Great week.", sendNow: true, attachmentId: annGifPic.id }, now);
check("A GIF announcement says sent a GIF", texts.length > 0 && texts.every((t) => t.message.startsWith("Mix Fix sent a GIF with an announcement: Cheers.")));

// ----- 4. Admins remove any attachment -----
check("A bartender cannot remove a picture, even their own", !(await mediaDb.removeAttachment(taylor, gifId, now)).ok && db.team_attachments.find((a) => a.id === gifId)!.status === "attached");
const filePath = String(db.team_attachments.find((a) => a.id === gifId)!.file_path);
check("An admin removes any picture", (await mediaDb.removeAttachment(admin, gifId, now)).ok && db.team_attachments.find((a) => a.id === gifId)!.status === "removed");
check("The file is deleted from storage", removed.includes(`team-media/${filePath}`));
check("Nobody can view a removed picture", (await mediaDb.attachmentLink(admin, gifId)) === null && (await mediaDb.attachmentLink(taylor, gifId)) === null);
check("The message stays and shows it was removed", (await chatDb.threadMessages("s1", taylor)).find((m) => m.attachment?.id === gifId)?.attachment?.removed === true);
check("An admin removes an announcement picture too", (await mediaDb.removeAttachment(admin, annPic.id, now)).ok && (await mediaDb.attachmentLink(taylor, annPic.id)) === null);

// ----- 5. GIPHY: hidden without the key -----
reset();
check("No key: the GIF button is off", media.giphyEnabled({}) === false && media.giphyEnabled({ GIPHY_API_KEY: "  " }) === false && media.giphyEnabled() === false);
const offSearch = await mediaDb.searchGiphy(taylor, "cheers");
check("No key: search is refused and GIPHY is never called", !offSearch.ok && offSearch.status === 404 && giphyCalls.length === 0);
check("No key: picking a GIPHY GIF is refused", !(await mediaDb.importGiphy(taylor, { scope: "chat", sessionId: "s1", giphyId: "cheersG1" }, now)).ok);
const picker = src("app/team/attach-picker.tsx");
check("The GIF button only renders when GIF search is on", /\{gifSearch && \(\s*<button[\s\S]{0,200}?>\s*GIF\s*<\/button>/.test(picker));
check("Pages turn GIF search on only from the key", src("app/team/e/[id]/page.tsx").includes("gifSearch: giphyEnabled()") && src("app/team/admin/e/[id]/page.tsx").includes("gifSearch={giphyEnabled()}") && src("app/team/announcements/page.tsx").includes("gifSearch={giphyEnabled()}"));
check("Without the key, photo library, camera and paste still work", picker.includes('capture="environment"') && picker.includes("onPaste") && (await pick(taylor, "chat", "image/png", 1000)).r.ok);

process.env.GIPHY_API_KEY = "test-key";
check("With the key: the GIF button is on", media.giphyEnabled() === true);
const found = await mediaDb.searchGiphy(taylor, "cheers");
check("Search returns rated G results only", found.ok && found.results.length === 1 && found.results[0].id === "cheersG1");
check("Search asks GIPHY for rated G", giphyCalls.some((u) => u.includes("rating=g")));
check("A bartender not on the event cannot pull a GIF into its chat", !(await mediaDb.importGiphy(sam, { scope: "chat", sessionId: "s1", giphyId: "cheersG1" }, now)).ok);
check("A GIF that is not rated G is refused", !(await mediaDb.importGiphy(taylor, { scope: "chat", sessionId: "s1", giphyId: "spicyR22" }, now)).ok);
const imported = await mediaDb.importGiphy(taylor, { scope: "chat", sessionId: "s1", giphyId: "cheersG1" }, now);
const impRow = imported.ok ? db.team_attachments.find((a) => a.id === imported.id) : undefined;
check("A chosen GIF is copied into the private bucket", imported.ok && impRow?.source === "giphy" && objects.has(`team-media/${impRow?.file_path}`));
const impSent = imported.ok ? await chatDb.postMessage("s1", taylor, "", now, imported.id) : null;
check("And sent like any other GIF", !!impSent?.ok && textsTo(jordan).some((t) => t.message.includes("sent a GIF")));
check("Odd GIPHY ids are refused", !(await mediaDb.importGiphy(taylor, { scope: "chat", sessionId: "s1", giphyId: "../../etc" }, now)).ok);
delete process.env.GIPHY_API_KEY;

// ----- 6. Routes -----
const route = src("app/api/team/media/route.ts");
check("The media route signs people in and the remove action is admin checked in the code it calls", route.includes("getCurrentStaff()") && src("lib/team/media-db.ts").includes('admin.role !== "admin"'));

done("chat picture and GIF");
