// Client agreements: upload a PDF or image on the manager view (more than one,
// each with an optional label), who uploaded it and when, replace, remove,
// and the list on the client's Clients page. Admins and managers only, since
// agreements carry pricing: bartenders, bar backs, servers, helpers and an
// admin in Bartender view never see one.
// Run: node --no-warnings scripts/test-agreements.mts

import { check, done, src } from "./team-harness.mts";

const { db, putObject, objects, signed } = await import("./fake-supabase.mts");
const ag = await import("../lib/team/agreements.ts");
const agDb = await import("../lib/team/agreements-db.ts");
const view = await import("../lib/team/view-mode.ts");

const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true };
const alex = { id: "m1", name: "Alex Rivera", phone: "+12145550101", role: "manager" as const, active: true };
const field = [
  { id: "b1", name: "Taylor Brooks", phone: "+12145550111", role: "bartender" as const, active: true },
  { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bar_back" as const, active: true },
  { id: "b3", name: "Pat Lee", phone: "+12145550113", role: "server" as const, active: true },
  { id: "b4", name: "Jo Kim", phone: "+12145550114", role: "event_helper" as const, active: true },
];
const asBartender = view.applyViewMode(admin, "bartender");

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  objects.clear();
  signed.length = 0;
  db.staff = [admin, alex, ...field];
  db.sessions = [
    { id: "s1", status: "submitted", version: 1, event_date: "2026-12-05", event_data: { client_name: "Justin Reyes", event_type: "Birthday", event_date: "2026-12-05", email: "justin@example.com" } },
    { id: "s2", status: "submitted", version: 1, event_date: "2027-03-01", event_data: { client_name: "Justin Reyes", event_type: "Anniversary", event_date: "2027-03-01", email: "justin@example.com" } },
  ];
  db.event_agreements = [];
}

/** The browser's part: start, put the file, finish. */
async function upload(who: typeof admin | typeof alex, sessionId: string, file: { type: string; size: number; name: string }, opts: { label?: string; replaces?: string } = {}) {
  const start = await agDb.startAgreementUpload(who, sessionId, file, opts);
  if (!start.ok) return start;
  const row = (db.event_agreements as Record<string, unknown>[]).find((r) => r.id === start.id)!;
  putObject(ag.AGREEMENT_BUCKET, String(row.file_path), file.size, file.type);
  return agDb.finishAgreementUpload(who, start.id);
}
const pdf = { type: "application/pdf", size: 400_000, name: "Reyes agreement.pdf" };

// ----- Upload, more than one, labels -----
reset();
const first = await upload(admin, "s1", pdf, { label: "Original agreement" });
check("An admin uploads the agreement as a PDF", first.ok && first.agreements.length === 1 && first.agreements[0].label === "Original agreement" && first.agreements[0].typeLabel === "PDF");
check("It shows who uploaded it and when", first.ok && first.agreements[0].uploadedBy === "Kenneth" && /\w{3} \d+, \d+:\d{2} (AM|PM)/.test(first.agreements[0].uploadedAt), first.ok ? first.agreements[0].uploadedAt : "");
const second = await upload(alex, "s1", { type: "image/jpeg", size: 200_000, name: "change order.jpg" }, { label: "Change order 1" });
check("A manager adds a change order as an image: both are listed", second.ok && second.agreements.length === 2 && second.agreements[1].label === "Change order 1" && second.agreements[1].typeLabel === "JPG" && second.agreements[1].uploadedBy === "Alex");
const noLabel = await upload(admin, "s1", { type: "image/png", size: 100_000, name: "scan.png" });
check("The label is optional", noLabel.ok && noLabel.agreements.length === 3 && noLabel.agreements[2].label === "");
check("Only PDF, PNG and JPG up to 15 MB", !(await agDb.startAgreementUpload(admin, "s1", { type: "application/msword", size: 1000 })).ok && !(await agDb.startAgreementUpload(admin, "s1", { type: "application/pdf", size: 16 * 1024 * 1024 })).ok);
const fake = await agDb.startAgreementUpload(admin, "s1", pdf);
if (fake.ok) {
  const row = (db.event_agreements as Record<string, unknown>[]).find((r) => r.id === fake.id)!;
  putObject(ag.AGREEMENT_BUCKET, String(row.file_path), 500, "text/html");
}
check("A stored file that is not really a PDF or image is refused and deleted", fake.ok && !(await agDb.finishAgreementUpload(admin, fake.id)).ok && (db.event_agreements as Record<string, unknown>[]).every((r) => r.id !== fake.id));
const labelled = noLabel.ok ? await agDb.labelAgreement(admin, noLabel.agreements[2].id, "  Signed  page  ") : null;
check("A label can be added later", !!labelled && labelled.ok && labelled.agreements[2].label === "Signed page");

// ----- Replace and remove -----
const origId = first.ok ? first.agreements[0].id : "";
const replaced = await upload(admin, "s1", { type: "application/pdf", size: 410_000, name: "Reyes agreement v2.pdf" }, { replaces: origId });
check("Replace swaps the file and keeps its label", replaced.ok && replaced.agreements.length === 3 && replaced.agreements.some((a) => a.label === "Original agreement" && a.fileName === "Reyes agreement v2.pdf") && !replaced.agreements.some((a) => a.id === origId));
check("The replaced file is kept as replaced, not shown", (db.event_agreements as Record<string, unknown>[]).find((r) => r.id === origId)?.status === "replaced");
check("A file already replaced cannot be replaced again", !(await agDb.startAgreementUpload(admin, "s1", pdf, { replaces: origId })).ok);
const coId = second.ok ? second.agreements[1].id : "";
const coPath = String((db.event_agreements as Record<string, unknown>[]).find((r) => r.id === coId)?.file_path);
const removedR = await agDb.removeAgreement(alex, coId);
check("Remove takes it off the list, records who, and deletes the stored file", removedR.ok && removedR.agreements.length === 2 && (db.event_agreements as Record<string, unknown>[]).find((r) => r.id === coId)?.removed_by_name === "Alex" && !objects.has(`${ag.AGREEMENT_BUCKET}/${coPath}`));

// ----- Who can see it -----
const keepId = replaced.ok ? replaced.agreements.find((a) => a.label === "Original agreement")!.id : "";
check("Admins and managers see the card", (await agDb.agreementsFor("s1", admin))?.length === 2 && (await agDb.agreementsFor("s1", alex))?.length === 2);
for (const s of field) {
  check(`A ${s.role.replace("_", " ")} never sees an agreement`, (await agDb.agreementsFor("s1", s)) === null && (await agDb.agreementLink(s, keepId, false)) === null && (await agDb.clientAgreements(["s1"], s)) === null);
  check(`A ${s.role.replace("_", " ")} cannot upload, label or remove`, !(await agDb.startAgreementUpload(s as never, "s1", pdf)).ok && !(await agDb.removeAgreement(s as never, keepId)).ok && !(await agDb.labelAgreement(s as never, keepId, "x")).ok);
}
check("An admin in Bartender view sees nothing either", (await agDb.agreementsFor("s1", asBartender)) === null && (await agDb.agreementLink(asBartender, keepId, false)) === null);
signed.length = 0;
const link = await agDb.agreementLink(alex, keepId, true);
check("Files open through a 10 minute signed link from the private bucket", !!link && signed.length === 1 && signed[0].bucket === "event-agreements" && signed[0].seconds === 600 && !!signed[0].download);
check("A removed file has no link", (await agDb.agreementLink(admin, coId, false)) === null);
check("The upload route is admins and managers only on the server", src("app/api/team/admin/agreements/route.ts").includes("if (!isAdminRole(staff.role)) return NextResponse.json({ error: \"Admins only.\" }, { status: 403 });"));
check("The file route answers 404 for anyone else", src("app/api/team/admin/agreement-file/route.ts").includes("agreementLink(staff, id") && src("app/api/team/admin/agreement-file/route.ts").includes("status: 404"));
check("Nothing on the bartender event page loads agreements", !src("app/team/e/[id]/page.tsx").includes("agreement") && !src("app/team/e/[id]/event-tabs.tsx").includes("agreement"));

// ----- The manager view and the Clients page -----
const mgr = src("app/team/admin/e/[id]/page.tsx");
check("The Agreement card is on the manager Details tab", mgr.includes("{agreements && <AgreementCard sessionId={id} initial={agreements} />}") && mgr.includes('on("details") ? agreementsFor(id, me'));
const card = src("app/team/admin/e/[id]/agreement-card.tsx");
check("The card has upload with a label, replace and remove", card.includes("Replace") && card.includes("Yes, remove") && card.includes('placeholder="Label (optional)"'));
await upload(admin, "s2", pdf, { label: "Anniversary agreement" });
const all = await agDb.clientAgreements(["s1", "s2"], admin);
check("A client's Clients page lists agreements across all their events", !!all && all.length === 3 && all.some((a) => a.eventTitle === "Justin Reyes · Anniversary" && a.label === "Anniversary agreement") && all.some((a) => a.eventTitle === "Justin Reyes · Birthday"));
check("Each entry links to its event", !!all && all.every((a) => a.eventHref === `/team/admin/e/${a.sessionId}`));
check("The Clients page shows them", src("app/team/admin/clients/[key]/page.tsx").includes("clientAgreements(page.rows.map((r) => r.id), admin)") && src("app/team/admin/clients/[key]/page.tsx").includes(">Agreements</h2>"));

// ----- The migration -----
const sql = src("supabase/migrations/20261208_agreements.sql");
check("The migration adds the table and a private bucket, safe to run twice", sql.includes("create table if not exists public.event_agreements") && sql.includes("'event-agreements', 'event-agreements', false") && sql.includes("revoke all on public.event_agreements from anon, authenticated"));

done("agreement");
