// Receipts: staff upload and see only their own; edit and delete only while
// Submitted; managers view and upload but cannot approve; approving a staff
// receipt creates the linked reimbursement on Payroll; approving a Company
// receipt is a cost with no reimbursement; Not approved needs a reason;
// reopening is blocked once the reimbursement is paid; the duplicate warning;
// the Business rule (every approved receipt dollar counts exactly once); the
// admin page filters and CSV; and every page loading before the migration.
// Real code against the in-memory database.
// Run: node --no-warnings scripts/test-receipts.mts

import { addDays, check, done, event, src } from "./team-harness.mts";

const { db, objects, missingTables, signed } = await import("./fake-supabase.mts");
const rules = await import("../lib/team/receipts.ts");
const rdb = await import("../lib/team/receipts-db.ts");
const reimb = await import("../lib/team/reimbursements-db.ts");
const biz = await import("../lib/team/business.ts");
const bset = await import("../lib/team/business-settings.ts");
const payroll = await import("../lib/team/payroll.ts");
const time = await import("../lib/team/time.ts");
const { staffingFor } = await import("../lib/pricing.ts");

const today = time.chicagoToday();
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true };
const manager = { id: "m1", name: "Alex Rivera", phone: "+12145550102", role: "manager" as const, active: true };
const sam = { id: "b1", name: "Sam Lee", phone: "+12145550111", role: "bartender" as const, active: true };
const kim = { id: "b2", name: "Kim Diaz", phone: "+12145550112", role: "bartender" as const, active: true }; // also on the event
const jo = { id: "b3", name: "Jo Park", phone: "+12145550113", role: "server" as const, active: true }; // declined
const lee = { id: "b4", name: "Lee Wong", phone: "+12145550114", role: "bartender" as const, active: true }; // not on it

type Ev = { id: string; event_data: Record<string, unknown> };
function reset() {
  for (const k of Object.keys(db)) delete db[k];
  objects.clear();
  missingTables.clear();
  db.sessions = [
    event("next", addDays(today, 5), "123 Main St, Dallas, TX"),
    event("old", addDays(today, -15), "9 Elm St, Austin, TX"), // 15 days ago: closed to staff
    event("edge", addDays(today, -14), "9 Elm St, Austin, TX"), // 14 days ago: still open today
  ];
  db.staff = [admin, manager, sam, kim, jo, lee].map((s) => ({ ...s }));
  db.event_assignments = [
    { id: "x1", session_id: "next", staff_id: "b1", status: "accepted" },
    { id: "x2", session_id: "next", staff_id: "b2", status: "accepted" },
    { id: "x3", session_id: "next", staff_id: "b3", status: "declined" },
    { id: "x4", session_id: "old", staff_id: "b1", status: "accepted" },
    { id: "x5", session_id: "edge", staff_id: "b1", status: "accepted" },
  ];
  db.event_receipts = [];
  db.payroll_reimbursements = [];
  db.payroll_paid = [];
}
reset();
const ev = (id: string) => db.sessions.find((s) => s.id === id) as unknown as Ev;
const asg = (sid: string, staffId: string) => {
  const a = db.event_assignments.find((x) => x.session_id === sid && x.staff_id === staffId) as { id: string; status: string } | undefined;
  return a ? { id: a.id, status: a.status } : null;
};
const jpeg = () => ({ blob: new Blob([new Uint8Array(3000)], { type: "image/jpeg" }), type: "image/jpeg" });
type Who = typeof admin | typeof manager | typeof sam;
async function photo(sid: string, who: Who): Promise<string> {
  const r = await rdb.uploadReceiptPhoto(ev(sid), who, asg(sid, who.id), jpeg());
  if (!r.ok) throw new Error(`upload failed: ${r.error}`);
  return r.path;
}
async function add(sid: string, who: Who, body: Record<string, unknown>) {
  const photos = body.photos ?? [await photo(sid, who)];
  return rdb.saveReceipt(ev(sid), who, asg(sid, who.id), { ...body, photos });
}
const row = (id: string) => db.event_receipts.find((r) => r.id === id) as Record<string, unknown>;
const ok = <T,>(r: { ok: boolean } & T) => r.ok;
const idOf = (r: Awaited<ReturnType<typeof add>>) => (r.ok ? r.id : "");

// ----- 1. Staff upload, and see only their own -----
const s1 = await add("next", sam, { kind: "ice", amount: "24.50", note: "  Kroger,   10 bags " });
check("Staff on the event add a receipt", s1.ok, JSON.stringify(s1));
const r1 = idOf(s1);
check("It is Submitted, paid by that person, on their assignment", row(r1).status === "submitted" && row(r1).paid_by === "staff" && row(r1).staff_id === "b1" && row(r1).assignment_id === "x1");
check("Amount in cents, note on one line", row(r1).amount_cents === 2450 && row(r1).note === "Kroger, 10 bags");
check("The photo is in the private bar photos bucket under receipts/<event>/<uploader>/", [...objects.keys()].some((k) => k.startsWith("bar-photos/receipts/next/b1/")));
const forged = await rdb.saveReceipt(ev("next"), sam, asg("next", "b1"), { kind: "ice", amount: "5", photos: ["receipts/next/b2/123.jpg"], payer: "company" });
check("A staff member cannot use another person's photo", !forged.ok && forged.status === 400);
const s2 = await add("next", sam, { kind: "other", amount: "12", payer: "company" });
check("Staff cannot pick Company or anyone else as the payer: it is always them", s2.ok && row(idOf(s2)).paid_by === "staff" && row(idOf(s2)).staff_id === "b1");
const k1 = await add("next", kim, { kind: "supplies", amount: "60" });
check("A teammate adds their own", k1.ok);

const samView = (await rdb.staffReceiptsView(ev("next"), sam, asg("next", "b1")))!;
check("Staff see only their own receipts", samView.ready && samView.receipts.length === 2 && samView.receipts.every((r) => r.staffId === "b1"), JSON.stringify(samView.receipts.map((r) => r.staffId)));
check("Each with its status", samView.receipts.every((r) => r.status === "submitted"));
check("Newest first", samView.receipts[0].id === idOf(s2));
check("Open until 14 days after the event", samView.openUntil === addDays(addDays(today, 5), 14));
const kimView = (await rdb.staffReceiptsView(ev("next"), kim, asg("next", "b2")))!;
check("The teammate sees only theirs", kimView.receipts.length === 1 && kimView.receipts[0].staffId === "b2");
check("Declined staff get no Receipts tab", (await rdb.staffReceiptsView(ev("next"), jo, asg("next", "b3"))) === null);
check("Staff not on the event get no Receipts tab", (await rdb.staffReceiptsView(ev("next"), lee, null)) === null);
const joTry = await rdb.uploadReceiptPhoto(ev("next"), jo, asg("next", "b3"), jpeg());
check("Declined staff cannot upload", !joTry.ok && joTry.status === 403);
const leeTry = await rdb.saveReceipt(ev("next"), lee, null, { kind: "ice", amount: "5", photos: ["receipts/next/b4/1.jpg"] });
check("Unassigned staff cannot save one", !leeTry.ok && leeTry.status === 403);
check("14 days after the event it is still open", !!(await rdb.staffReceiptsView(ev("edge"), sam, asg("edge", "b1"))) && ok(await add("edge", sam, { kind: "ice", amount: "8" })));
check("15 days after, the tab is gone", (await rdb.staffReceiptsView(ev("old"), sam, asg("old", "b1"))) === null);
const late = await rdb.uploadReceiptPhoto(ev("old"), sam, asg("old", "b1"), jpeg());
check("...and uploading is refused", !late.ok && late.status === 403);
const noPhoto = await rdb.saveReceipt(ev("next"), sam, asg("next", "b1"), { kind: "ice", amount: "5", photos: [] });
const noAmount = await add("next", sam, { kind: "ice", amount: "" });
const noKind = await add("next", sam, { kind: "", amount: "5" });
check("Photo is required", !noPhoto.ok && /photo/i.test(noPhoto.error));
check("Amount is required", !noAmount.ok && /amount/i.test(noAmount.error));
check("Type is required", !noKind.ok);
check("A PDF is not a photo", !(await rdb.uploadReceiptPhoto(ev("next"), sam, asg("next", "b1"), { blob: new Blob([new Uint8Array(10)]), type: "application/pdf" })).ok);
check("Too many photos is refused", !(await rdb.saveReceipt(ev("next"), sam, asg("next", "b1"), { kind: "ice", amount: "5", photos: Array.from({ length: 7 }, (_, i) => `receipts/next/b1/${i}.jpg`) })).ok);
const staffAmountMax = await add("next", sam, { kind: "supplies", amount: "1500" });
check("A staff receipt tops out at the reimbursement limit", !staffAmountMax.ok);

// Photo access.
const samPhoto = await rdb.receiptPhotoUrl(sam, r1, 0);
check("The payer opens their own photo through a fresh signed link", !!samPhoto && signed.some((s) => s.path.startsWith("receipts/next/b1/")));
check("A teammate cannot open it", (await rdb.receiptPhotoUrl(kim, r1, 0)) === null);
check("Staff not on it cannot open it", (await rdb.receiptPhotoUrl(lee, r1, 0)) === null);
check("Managers can", !!(await rdb.receiptPhotoUrl(manager, r1, 0)));
check("A photo number that is not there is nothing", (await rdb.receiptPhotoUrl(admin, r1, 3)) === null);

// ----- 2. Edit and delete only while Submitted -----
const keep = row(r1).photo_paths as string[];
const e1 = await rdb.saveReceipt(ev("next"), sam, asg("next", "b1"), { id: r1, kind: "ice", amount: "26", note: "Kroger", photos: keep });
check("Staff edit their own while Submitted", e1.ok && row(r1).amount_cents === 2600);
const kEdit = await rdb.saveReceipt(ev("next"), sam, asg("next", "b1"), { id: idOf(k1), kind: "supplies", amount: "1", photos: row(idOf(k1)).photo_paths });
check("Staff cannot edit a teammate's", !kEdit.ok && kEdit.status === 403);
const kDel = await rdb.deleteReceipt(ev("next"), sam, asg("next", "b1"), idOf(k1));
check("Staff cannot delete a teammate's", !kDel.ok && kDel.status === 403);
const d2 = await rdb.deleteReceipt(ev("next"), sam, asg("next", "b1"), idOf(s2));
check("Staff delete their own while Submitted", d2.ok && !!row(idOf(s2)).deleted_at);
check("A deleted receipt stops showing", !(await rdb.staffReceiptsView(ev("next"), sam, asg("next", "b1")))!.receipts.some((r) => r.id === idOf(s2)));
check("...and its photo no longer opens", (await rdb.receiptPhotoUrl(admin, idOf(s2), 0)) === null);

// ----- 3. Managers view and upload, never approve -----
const mView = (await rdb.adminReceiptsView(ev("next"), manager, [{ staffId: "b1", name: "Sam Lee", status: "accepted" }, { staffId: "b3", name: "Jo Park", status: "declined" }]))!;
check("Managers see every receipt on the event", mView.receipts.length === 2 && mView.receipts.some((r) => r.staffId === "b2"));
check("...with who paid", mView.receipts.some((r) => r.personName === "Kim Diaz"));
check("Managers cannot approve", mView.canApprove === false);
check("The payer choices leave out declined people", mView.people.length === 1 && mView.people[0].id === "b1");
check("Staff get no admin view", (await rdb.adminReceiptsView(ev("next"), sam, [])) === null);
const mUp = await add("next", manager, { kind: "ice", amount: "30", payer: "b2" });
check("Managers upload a receipt for a staff member", mUp.ok && row(idOf(mUp)).staff_id === "b2" && row(idOf(mUp)).uploaded_by === "m1");
const mCo = await add("next", manager, { kind: "other", amount: "45", payer: "company", note: "Cups" });
check("...or for Company", mCo.ok && row(idOf(mCo)).paid_by === "company" && row(idOf(mCo)).staff_id === null);
const mNo = await add("next", manager, { kind: "ice", amount: "30" });
check("Admins and managers must pick who paid", !mNo.ok && /who paid/i.test(mNo.error));
const mDeclined = await add("next", manager, { kind: "ice", amount: "31", payer: "b3" });
check("...and cannot pick someone who declined", !mDeclined.ok);
const mApprove = await rdb.reviewReceipt(manager, { id: r1, action: "approve" });
check("A manager approving is refused", !mApprove.ok && mApprove.status === 403 && row(r1).status === "submitted");
const mNot = await rdb.reviewReceipt(manager, { id: r1, action: "not_approve", reason: "blurry" });
check("A manager marking Not approved is refused", !mNot.ok && mNot.status === 403);
check("Staff cannot review", !(await rdb.reviewReceipt(sam, { id: r1, action: "approve" })).ok);
const reviewRoute = src("app/api/team/admin/receipts/route.ts");
check("The review route is admins only on the server", /isFullAdmin\(staff\.role\)/.test(reviewRoute));
check("Kim sees the receipt a manager added for her", (await rdb.staffReceiptsView(ev("next"), kim, asg("next", "b2")))!.receipts.length === 2);

// ----- 4. Approving a staff receipt creates the linked reimbursement -----
const a1 = await rdb.reviewReceipt(admin, { id: r1, action: "approve" });
check("An admin approves", a1.ok && row(r1).status === "approved" && row(r1).reviewed_by_name === "Kenneth Smith");
const linked = db.payroll_reimbursements.filter((r) => r.receipt_id === r1);
check("One reimbursement, linked to the receipt", linked.length === 1);
check("...for that person on that event, same type and amount", linked[0].assignment_id === "x1" && linked[0].staff_id === "b1" && linked[0].session_id === "next" && linked[0].kind === "ice" && linked[0].amount_cents === 2600);
const onPayroll = (await reimb.reimbursementsFor(["next"])).byAssignment.get("x1") ?? [];
check("It shows on the payroll row like any other, with its receipt", onPayroll.length === 1 && onPayroll[0].receiptId === r1);
check("Approving twice does not add a second", !(await rdb.reviewReceipt(admin, { id: r1, action: "approve" })).ok && db.payroll_reimbursements.length === 1);
const editLinked = await reimb.editReimbursement(admin, { id: linked[0].id, kind: "ice", amount: "99" });
const removeLinked = await reimb.removeReimbursement(admin, { id: linked[0].id });
check("Payroll cannot change or remove a reimbursement that came from a receipt", !editLinked.ok && !removeLinked.ok && db.payroll_reimbursements.length === 1);
const afterEdit = await rdb.saveReceipt(ev("next"), sam, asg("next", "b1"), { id: r1, kind: "ice", amount: "1", photos: keep });
const afterDel = await rdb.deleteReceipt(ev("next"), sam, asg("next", "b1"), r1);
check("Staff cannot edit an approved receipt", !afterEdit.ok && afterEdit.status === 409 && row(r1).amount_cents === 2600);
check("Staff cannot delete an approved receipt", !afterDel.ok && afterDel.status === 409 && !row(r1).deleted_at);
const kSupply = await rdb.reviewReceipt(admin, { id: idOf(k1), action: "approve" });
check("A staff Supplies receipt is reimbursed too, as Supplies", kSupply.ok && db.payroll_reimbursements.some((r) => r.receipt_id === idOf(k1) && r.kind === "supplies" && r.amount_cents === 6000));

// ----- 5. Approving a Company receipt: a cost, no reimbursement -----
const before = db.payroll_reimbursements.length;
const c1 = await rdb.reviewReceipt(admin, { id: idOf(mCo), action: "approve" });
check("A Company receipt is approved with no reimbursement", c1.ok && row(idOf(mCo)).status === "approved" && db.payroll_reimbursements.length === before);
const approved = await rdb.approvedReceiptsFor("next");
check("It counts as a cost on the event", approved.some((r) => r.paidBy === "company" && r.cents === 4500));

// ----- 6. Not approved needs a reason -----
const noReason = await rdb.reviewReceipt(admin, { id: idOf(mUp), action: "not_approve", reason: "   " });
check("Not approved with no reason is refused", !noReason.ok && noReason.status === 400 && row(idOf(mUp)).status === "submitted");
const withReason = await rdb.reviewReceipt(admin, { id: idOf(mUp), action: "not_approve", reason: "The total is cut off" });
check("With a reason it is saved", withReason.ok && row(idOf(mUp)).status === "not_approved" && row(idOf(mUp)).reason === "The total is cut off");
const kimSees = (await rdb.staffReceiptsView(ev("next"), kim, asg("next", "b2")))!.receipts.find((r) => r.id === idOf(mUp))!;
check("The staff member sees Not approved and the reason", kimSees.status === "not_approved" && kimSees.reason === "The total is cut off");
check("No reimbursement for a Not approved receipt", !db.payroll_reimbursements.some((r) => r.receipt_id === idOf(mUp)));

// ----- 7. Reopen, and blocked once paid -----
db.payroll_paid.push({ id: "p1", assignment_id: "x1", session_id: "next", staff_id: "b1", paid_on: today, undone_at: null });
const blocked = await rdb.reviewReceipt(admin, { id: r1, action: "reopen" });
check("Reopen is blocked once the reimbursement is marked paid", !blocked.ok && blocked.status === 409 && row(r1).status === "approved" && db.payroll_reimbursements.some((r) => r.receipt_id === r1));
check("The admin view says it is locked", (await rdb.adminReceiptsView(ev("next"), admin, []))!.receipts.find((r) => r.id === r1)!.paidLocked === true);
(db.payroll_paid[0] as Record<string, unknown>).undone_at = new Date().toISOString();
const reopened = await rdb.reviewReceipt(admin, { id: r1, action: "reopen" });
check("After Undo paid, reopening works", reopened.ok && row(r1).status === "submitted" && row(r1).reviewed_by === null);
check("Reopening removes the linked reimbursement", !db.payroll_reimbursements.some((r) => r.receipt_id === r1));
check("Managers cannot reopen", !(await rdb.reviewReceipt(manager, { id: idOf(mCo), action: "reopen" })).ok);
check("A Not approved receipt can be reopened too", ok(await rdb.reviewReceipt(admin, { id: idOf(mUp), action: "reopen" })) && row(idOf(mUp)).status === "submitted" && row(idOf(mUp)).reason === "");
check("Once reopened, the staff member can edit it again", ok(await rdb.saveReceipt(ev("next"), sam, asg("next", "b1"), { id: r1, kind: "ice", amount: "27", photos: keep })));
check("Approving again makes a fresh reimbursement", ok(await rdb.reviewReceipt(admin, { id: r1, action: "approve" })) && db.payroll_reimbursements.filter((r) => r.receipt_id === r1 && r.amount_cents === 2700).length === 1);

// ----- 8. The duplicate warning -----
reset();
const first = await add("next", sam, { kind: "ice", amount: "24" });
const dup = await add("next", sam, { kind: "ice", amount: "24.00" });
check("Same person, event, type and amount warns before saving", !dup.ok && dup.status === 409 && dup.duplicate === true && /already/.test(dup.error), JSON.stringify(dup));
check("...and saves nothing", db.event_receipts.length === 1);
const confirmed = await add("next", sam, { kind: "ice", amount: "24", confirmDuplicate: true });
check("Confirming saves it", confirmed.ok && db.event_receipts.length === 2);
check("A different amount does not warn", ok(await add("next", sam, { kind: "ice", amount: "25" })));
check("A different type does not warn", ok(await add("next", sam, { kind: "other", amount: "24" })));
check("A different person does not warn", ok(await add("next", kim, { kind: "ice", amount: "24" })));
check("Company with the same amount does not warn against a staff receipt", ok(await add("next", admin, { kind: "ice", amount: "24", payer: "company" })));
const coDup = await add("next", manager, { kind: "ice", amount: "24", payer: "company" });
check("Two Company receipts with the same type and amount warn", !coDup.ok && coDup.duplicate === true);
const adminForSam = await add("next", admin, { kind: "ice", amount: "24", payer: "b1" });
check("An admin uploading for Sam the same thing warns", !adminForSam.ok && adminForSam.duplicate === true);
const editInto = await rdb.saveReceipt(ev("next"), sam, asg("next", "b1"), { id: (db.event_receipts.find((r) => r.amount_cents === 2500) as { id: string }).id, kind: "ice", amount: "24", photos: (db.event_receipts.find((r) => r.amount_cents === 2500) as { photo_paths: string[] }).photo_paths });
check("Editing one into a match warns too", !editInto.ok && editInto.duplicate === true);
check("Editing a receipt without changing it does not warn against itself", ok(await rdb.saveReceipt(ev("next"), sam, asg("next", "b1"), { id: idOf(first), kind: "other", amount: "99", photos: row(idOf(first)).photo_paths })));
await rdb.deleteReceipt(ev("next"), kim, asg("next", "b2"), (db.event_receipts.find((r) => r.staff_id === "b2") as { id: string }).id);
check("A deleted receipt never counts as a duplicate", ok(await add("next", kim, { kind: "ice", amount: "24" })));
check("Pure rule: matches on person, event, type, amount only", rules.findDuplicate({ sessionId: "e", paidBy: "staff", staffId: "s", kind: "ice", cents: 100 }, [{ id: "1", sessionId: "e", paidBy: "staff", staffId: "s", kind: "ice", cents: 100 }]) !== null && rules.findDuplicate({ sessionId: "e2", paidBy: "staff", staffId: "s", kind: "ice", cents: 100 }, [{ id: "1", sessionId: "e", paidBy: "staff", staffId: "s", kind: "ice", cents: 100 }]) === null);
check("The form asks before saving a duplicate", src("app/team/e/[id]/receipts.tsx").includes("window.confirm(err.message)") && src("app/team/e/[id]/receipts.tsx").includes("confirmDuplicate: true"));

// ----- 9. Business: every approved receipt dollar counts exactly once -----
const S = bset.COST_DEFAULTS;
const base = {
  today: "2026-11-17",
  eventDay: "2026-12-30",
  done: false,
  totalCents: 200000,
  gratuityCents: 0,
  pricePending: false,
  defaultDepositCents: 15000,
  finance: null as null | { session_id: string; deposit_paid_cents: null; deposit_paid_on: null; balance_paid_cents: null; balance_paid_on: null; supplies_cents: number | null },
  payments: [],
  crew: [],
  bookedBartenders: 1,
  guests: 50,
  scheduledMinutes: 420,
  bookedMinutes: 420,
  defaultRateCents: 3000,
  staffingFor,
  supplyLines: { catalogCents: 12345, costed: 3, lines: 3 },
  perGuestCents: 300,
  packageLabel: "Full Bar",
  other: [] as { id: string; label: string; cents: number }[],
  settings: S,
};
const cost = (b: ReturnType<typeof biz.eventBusiness>, k: string) => b.costs.find((c) => c.key === k)!;
type R = { kind: "ice" | "menu_printing" | "supplies" | "other"; cents: number; paidBy: "staff" | "company" };
// Approving a staff receipt creates a reimbursement of the same kind and amount; that is what Payroll hands Business.
const reimbursementsOf = (list: R[]) => list.filter((r) => r.paidBy === "staff").map((r) => ({ kind: r.kind, cents: r.cents }));
const run = (list: R[], extra: Record<string, unknown> = {}) => biz.eventBusiness({ ...base, receipts: list, reimbursements: reimbursementsOf(list), ...extra });
const withoutReceipts = biz.eventBusiness(base);
const receiptKeys = ["supplies", "reimbursed", "company"];
const receiptPart = (b: ReturnType<typeof biz.eventBusiness>) => receiptKeys.reduce((n, k) => n + (cost(b, k).cents ?? 0), 0);

const s14 = run([{ kind: "supplies", cents: 8000, paidBy: "staff" }, { kind: "supplies", cents: 2000, paidBy: "company" }]);
check("14a. Approved Supplies receipts, whoever paid, are the supplies cost", cost(s14, "supplies").cents === 10000 && s14.supplies === "receipts");
check("14a. ...labeled from receipts", /from receipts/.test(cost(s14, "supplies").note));
check("14a. ...replacing the estimate", cost(withoutReceipts, "supplies").cents === 12345 && cost(s14, "supplies").cents !== 12345);
check("14d. The staff Supplies receipt is not also under Reimbursed to staff", cost(s14, "reimbursed").cents === 0);
const manualWins = run([{ kind: "supplies", cents: 8000, paidBy: "staff" }], { finance: { session_id: "e", deposit_paid_cents: null, deposit_paid_on: null, balance_paid_cents: null, balance_paid_on: null, supplies_cents: 15000 } });
check("14a. A hand entered supplies amount still wins", cost(manualWins, "supplies").cents === 15000 && manualWins.supplies === "manual");
check("14a/d. ...and the Supplies receipt is not added on top anywhere", receiptPart(manualWins) === 15000 && cost(manualWins, "reimbursed").cents === 0 && /not added again/.test(cost(manualWins, "supplies").note));
const o14 = run([{ kind: "ice", cents: 2400, paidBy: "staff" }, { kind: "menu_printing", cents: 1500, paidBy: "staff" }, { kind: "other", cents: 900, paidBy: "staff" }]);
check("14b. Other approved receipts paid by staff stay under Reimbursed to staff", cost(o14, "reimbursed").cents === 4800 && cost(o14, "company").cents === 0);
check("14b. ...and the supplies estimate is untouched", cost(o14, "supplies").cents === 12345);
const c14 = run([{ kind: "ice", cents: 3000, paidBy: "company" }, { kind: "other", cents: 4500, paidBy: "company" }]);
check("14c. Other approved receipts paid by Company are their own line", cost(c14, "company").cents === 7500 && cost(c14, "company").label === "Paid by company, from receipts" && cost(c14, "reimbursed").cents === 0);
check("14c. The line is in the costs total", c14.costCents - withoutReceipts.costCents === 7500);

// No receipt is ever counted twice: every mix of types and payers, with and without a hand entered supplies amount.
const pool: R[] = [
  { kind: "ice", cents: 2400, paidBy: "staff" },
  { kind: "ice", cents: 1100, paidBy: "company" },
  { kind: "menu_printing", cents: 1500, paidBy: "staff" },
  { kind: "menu_printing", cents: 700, paidBy: "company" },
  { kind: "supplies", cents: 8000, paidBy: "staff" },
  { kind: "supplies", cents: 3300, paidBy: "company" },
  { kind: "other", cents: 900, paidBy: "staff" },
  { kind: "other", cents: 4500, paidBy: "company" },
];
let mixes = 0;
const twice: string[] = [];
for (let mask = 0; mask < 1 << pool.length; mask++) {
  const list = pool.filter((_, i) => mask & (1 << i));
  for (const manual of [null, 15000]) {
    mixes++;
    const b = run(list, manual === null ? {} : { finance: { session_id: "e", deposit_paid_cents: null, deposit_paid_on: null, balance_paid_cents: null, balance_paid_on: null, supplies_cents: manual } });
    const supplies = list.filter((r) => r.kind === "supplies").reduce((n, r) => n + r.cents, 0);
    const rest = list.filter((r) => r.kind !== "supplies").reduce((n, r) => n + r.cents, 0);
    // Supplies receipts are the supplies cost (or covered by the hand entered amount); every other receipt dollar is counted once more.
    const suppliesExpected = manual ?? (supplies > 0 ? supplies : 12345);
    const expected = suppliesExpected + rest;
    const nonReceipt = b.costCents - receiptPart(b);
    if (receiptPart(b) !== expected || nonReceipt !== withoutReceipts.costCents - (cost(withoutReceipts, "supplies").cents ?? 0) - (cost(withoutReceipts, "reimbursed").cents ?? 0) - (cost(withoutReceipts, "company").cents ?? 0)) {
      twice.push(`${mask}/${manual}: got ${receiptPart(b)}, expected ${expected}`);
    }
  }
}
check(`14. No receipt is ever counted twice (${mixes} mixes of type, payer and hand entered supplies)`, twice.length === 0, twice.slice(0, 3).join("; "));
const handOther = run([{ kind: "ice", cents: 2400, paidBy: "staff" }], { other: [{ id: "o1", label: "Ice", cents: 2400 }] });
check("14. An other cost already typed in for the same ice is not counted on top of the receipt", cost(handOther, "other").cents === 0 && cost(handOther, "reimbursed").cents === 2400);
const supplyOther = run([{ kind: "supplies", cents: 2400, paidBy: "staff" }], { other: [{ id: "o1", label: "reimbursement", cents: 2400 }] });
check("14d. A Supplies reimbursement never knocks out an other cost: it is not under Reimbursed to staff", cost(supplyOther, "other").cents === 2400 && cost(supplyOther, "reimbursed").cents === 0);

// The same rule end to end: approved receipts and their reimbursements read back from the database.
reset();
const e2e = [
  await add("next", sam, { kind: "supplies", amount: "80" }),
  await add("next", sam, { kind: "ice", amount: "24" }),
  await add("next", admin, { kind: "supplies", amount: "33", payer: "company" }),
  await add("next", admin, { kind: "other", amount: "45", payer: "company" }),
  await add("next", kim, { kind: "other", amount: "9" }), // left Submitted: not counted
];
for (const r of e2e.slice(0, 4)) await rdb.reviewReceipt(admin, { id: idOf(r), action: "approve" });
const fromDb = await rdb.approvedReceiptsFor("next");
const fromPayroll = [...(await reimb.reimbursementsFor(["next"])).byAssignment.values()].flat().map((r) => ({ kind: r.kind, cents: r.cents }));
const live = biz.eventBusiness({ ...base, receipts: fromDb, reimbursements: fromPayroll });
check("End to end: supplies $113, reimbursed $24, company $45", cost(live, "supplies").cents === 11300 && cost(live, "reimbursed").cents === 2400 && cost(live, "company").cents === 4500, JSON.stringify(live.costs.filter((c) => receiptKeys.includes(c.key))));
check("End to end: the receipt dollars add up to exactly what was approved", receiptPart(live) === 8000 + 2400 + 3300 + 4500);
check("The Business tab reads approved receipts", src("lib/team/business-db.ts").includes("approvedReceiptsFor(session.id)") && src("lib/team/business-db.ts").includes("receipts,"));

// ----- 10. Payroll: the receipt link and the pickup prompt -----
const submitted = await rdb.submittedReceiptsFor(["next"]);
check("Submitted staff receipts are found for the pickup prompt", submitted.get("next")?.get("b2")?.other === idOf(e2e[4]));
const prow = { assignmentId: "x2", staffId: "b2", name: "Kim Diaz", role: "bartender", tipsCents: 0, fromEstimate: true, actualMinutes: null, estMinutes: 420, rateCents: 3000, rateSource: "package", ratePkg: null, totalCents: 21000, mileageCents: 0, mileageMiles: 0, reimbursements: [], reimbursementsCents: 0 } as never;
const line = payroll.lineFrom(prow, null, { sessionId: "next", day: today, title: "Event", timeZone: "America/Chicago" }, null, { ice: true, menu: true }, { ice: "rc1" });
check("A pickup with a submitted receipt of that type links to the receipt", line.prompts.includes("ice") && line.promptReceipts.ice === "rc1");
check("...and one without still asks for a manual entry", line.prompts.includes("menu_printing") && !line.promptReceipts.menu_printing);
const board = src("app/team/admin/payroll/payroll-board.tsx");
check("Payroll shows a small receipt link that opens the photo", board.includes("receiptPhotoHref(r.receiptId)") && board.includes(">\n      receipt\n    </a>"));
check("The pickup prompt links to the event's Receipts tab when a receipt is in", board.includes('managerHref(l.sessionId, "receipts")') && board.includes("l.promptReceipts[k]"));

// ----- 11. The admin page: filters, totals and CSV -----
reset();
db.sessions.push(event("dec", "2026-12-20", "1 Oak St, Dallas, TX"));
db.event_assignments.push({ id: "x9", session_id: "dec", staff_id: "b2", status: "accepted" });
await add("next", sam, { kind: "ice", amount: "24", note: "Kroger, 10 bags" });
await add("next", admin, { kind: "supplies", amount: "100", payer: "company", note: 'Costco "bulk"' });
const forKim = await add("dec", kim, { kind: "menu_printing", amount: "15.50" });
await rdb.reviewReceipt(admin, { id: idOf(forKim), action: "approve" });
const notOk = await add("dec", admin, { kind: "other", amount: "8", payer: "b2" });
await rdb.reviewReceipt(admin, { id: idOf(notOk), action: "not_approve", reason: "Personal" });
check("Managers do not get the admin wide list", (await rdb.allReceipts(manager)) === null);
check("Staff do not either", (await rdb.allReceipts(sam)) === null);
const all = (await rdb.allReceipts(admin))!;
check("Admins get every receipt across events", all.ready && all.items.length === 4);
check("The person filter lists the people on receipts", all.people.map((p) => p.name).join() === "Kim Diaz,Sam Lee");
const f = (q: Record<string, string>) => rules.filterReceipts(all.items, rules.parseFilters(q));
check("No filters: everything, newest event first", f({}).length === 4 && f({})[0].sessionId === "dec");
check("Filter by event date range", f({ from: "2026-12-01", to: "2026-12-31" }).every((r) => r.sessionId === "dec") && f({ from: "2026-12-01", to: "2026-12-31" }).length === 2);
check("Filter by status", f({ status: "approved" }).length === 1 && f({ status: "not_approved" })[0].reason === "Personal" && f({ status: "submitted" }).length === 2);
check("Filter by type", f({ kind: "supplies" }).length === 1 && f({ kind: "supplies" })[0].paidBy === "company");
check("Filter by payer", f({ payer: "company" }).length === 1 && f({ payer: "staff" }).length === 3);
check("Filter by person", f({ person: "b2" }).length === 2 && f({ person: "b1" }).length === 1);
check("Search the note, person and amount", f({ q: "kroger" }).length === 1 && f({ q: "kim" }).length === 2 && f({ q: "15.50" }).length === 1);
check("Filters combine", f({ person: "b2", status: "approved" }).length === 1);
check("Unknown filter values are ignored", f({ status: "lost", kind: "boats", payer: "x" }).length === 4);
const t = rules.receiptTotals(f({ person: "b2" }));
check("Totals for the filtered set", t.count === 2 && t.cents === 2350 && t.byStatus.approved.cents === 1550 && t.byStatus.not_approved.count === 1);
const csv = rules.receiptsCsv(f({}), "https://plan.test").trim().split("\r\n");
check("CSV columns", csv[0] === "Event date,Event,Person,Payer,Type,Amount,Note,Status,Approved by,Approved on,Photos", csv[0]);
const kimLine = csv.find((l) => l.includes("Menu printing"))!;
check("CSV row: event date, person, payer, type, amount, status, approved by and on", kimLine.startsWith("2026-12-20,") && kimLine.includes(",Kim Diaz,Staff,Menu printing,15.50,,Approved,Kenneth Smith,") && new RegExp(`,${today},`).test(kimLine), kimLine);
check("CSV row: a link to each photo, through the access check", /https:\/\/plan\.test\/api\/team\/receipts\/photo\?id=[\w-]+&n=0$/.test(kimLine), kimLine);
check("CSV: Company receipts say Company, and notes are quoted", csv.some((l) => l.includes(',,Company,Supplies,100.00,"Costco ""bulk""",Submitted,,,')) && csv.some((l) => l.includes('"Kroger, 10 bags"')));
check("CSV: Not approved rows carry no approver", csv.some((l) => l.includes(",Not approved,,,")));
check("The CSV follows the page's filters", rules.receiptsCsv(f({ kind: "ice" }), "x").trim().split("\r\n").length === 2);
const page = src("app/team/admin/receipts/page.tsx");
const exportRoute = src("app/api/team/admin/receipts/export/route.ts");
check("The page is admins only", page.includes("await requireFullAdmin("));
check("The export is admins only on the server", /isFullAdmin\(staff\.role\)/.test(exportRoute) && exportRoute.includes("filterReceipts(all.items, filters)"));
check("The page is linked from the Business area", src("app/team/admin/business/page.tsx").includes('href="/team/admin/receipts"') && src("lib/team/header-nav.ts").includes('"/team/admin/receipts"'));

// ----- 12. Staff never see anyone else's receipts, totals, or the admin page -----
const mine = await rdb.myReceipts(kim);
check("My receipts: only their own, across events, newest first", mine.ready && mine.receipts.length === 2 && mine.receipts.every((r) => r.staffId === "b2") && mine.receipts[0].createdAt >= mine.receipts[1].createdAt);
check("...with status and the reason", mine.receipts.some((r) => r.status === "not_approved" && r.reason === "Personal") && mine.receipts.some((r) => r.status === "approved"));
check("...and a staff title, never the client's full name", mine.receipts.every((r) => !/Reyes/.test(r.eventTitle)));
check("Sam's list has none of Kim's", (await rdb.myReceipts(sam)).receipts.every((r) => r.staffId === "b1"));
check("The Me page shows My receipts", src("app/team/me/page.tsx").includes("My receipts") && src("app/team/me/page.tsx").includes("myReceipts(staff)"));
const card = src("app/team/e/[id]/receipts.tsx");
const code = card.replace(/^\s*\/\/.*$/gm, "");
check("The staff card shows no totals: no sums anywhere in it", !/totals|receiptTotals|reduce\(/.test(code));
const staffRoute = src("app/api/team/receipts/route.ts");
check("The staff route answers staff with only their own view", staffRoute.includes("canManageReceipts(staff) ? (await adminReceiptsView") && staffRoute.includes("staffReceiptsView(session, staff, assignment)"));

// ----- 13. Tabs and badge -----
const tabs = await import("../lib/team/manager-tabs.ts");
check("Admin Receipts tab sits between Day of and Chat", tabs.MANAGER_TABS.map(([k]) => k).join() === "details,team,pickups,order,client,dayof,receipts,chat,agreement");
check("Managers get it too", tabs.managerTabsFor("manager").some(([k]) => k === "receipts"));
check("Badge: receipts waiting on review", (await rdb.pendingReceiptCount("next")) === 2 && (await rdb.pendingReceiptCount("dec")) === 0 && src("app/team/admin/e/[id]/page.tsx").includes("receipts: receiptsWaiting"));
check("The staff event page has a Receipts tab", src("app/team/e/[id]/event-tabs.tsx").includes('["receipts", RECEIPTS_TAB]') && src("app/team/e/[id]/page.tsx").includes("staffReceiptsView(access.session, staff, a)"));

// ----- 14. Before the migration -----
reset();
missingTables.add("event_receipts");
check("Staff tab loads, not ready", (await rdb.staffReceiptsView(ev("next"), sam, asg("next", "b1")))?.ready === false);
check("Admin tab loads, not ready", (await rdb.adminReceiptsView(ev("next"), admin, []))?.ready === false);
check("Badge is 0", (await rdb.pendingReceiptCount("next")) === 0);
check("Business sees no receipts", (await rdb.approvedReceiptsFor("next")).length === 0);
check("Payroll prompts see none", (await rdb.submittedReceiptsFor(["next"])).size === 0);
check("Me page loads empty", (await rdb.myReceipts(sam)).ready === false);
check("Admin page loads empty", (await rdb.allReceipts(admin))!.ready === false);
const pre = await rdb.uploadReceiptPhoto(ev("next"), sam, asg("next", "b1"), jpeg());
check("Uploading says the migration is needed, and nothing is stored", !pre.ok && pre.status === 503 && pre.error === rules.RECEIPTS_NOT_READY && objects.size === 0);
check("Reviewing says so too", !(await rdb.reviewReceipt(admin, { id: "x", action: "approve" })).ok);
check("Reimbursements still read without the receipt column", (await reimb.reimbursementsFor(["next"])).ready);

// ----- 15. The migration and wording -----
const sql = src("supabase/migrations/20261223_receipts.sql");
check("One migration: the receipts table and the reimbursement link", sql.includes("create table if not exists public.event_receipts") && sql.includes("add column if not exists receipt_id") && sql.includes("'supplies'"));
check("Not approved needs a reason in the database too", sql.includes("status <> 'not_approved' or length(trim(reason)) > 0"));
const shown = [
  ...Object.values(rules.RECEIPT_KIND_LABEL),
  ...Object.values(rules.RECEIPT_STATUS_LABEL),
  rules.RECEIPTS_NOT_READY,
  rules.COMPANY_COST_LABEL,
  rules.MANAGERS_CANNOT_APPROVE,
  rules.ONLY_SUBMITTED,
  rules.duplicateMessage({ kind: "ice", cents: 100, status: "submitted" }),
];
check("No hyphens in the wording", shown.every((s) => !s.includes("-")), shown.filter((s) => s.includes("-")).join(" | "));
const jsxText = (s: string) => [...s.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => m[1]).concat([...s.matchAll(/"([A-Z][a-z][^"]*)"/g)].map((m) => m[1]));
const files = ["app/team/e/[id]/receipts.tsx", "app/team/admin/receipts/page.tsx"].map(src);
const hyphenated = files.flatMap(jsxText).filter((t) => /[A-Za-z]-[A-Za-z]|\s-\s/.test(t) && !/^[a-z-]+$/.test(t) && t !== "Content-Type");
check("No hyphens in the receipts screens", hyphenated.length === 0, hyphenated.join(" | "));

done("receipts");
