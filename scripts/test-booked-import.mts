// The booked totals import's file reading and matching (lib/booked-import.ts).
// Run: node --no-warnings scripts/test-booked-import.mts

import { registerHooks } from "node:module";
import { check, done, src } from "./team-harness.mts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
const imp = await import("../lib/booked-import.ts");

check("CSV: quoted fields, commas and doubled quotes", JSON.stringify(imp.parseCsv('a,"b, c","d ""e"""\r\n1,2,3\n')) === JSON.stringify([["a", "b, c", 'd "e"'], ["1", "2", "3"]]));
check("Missing columns are named", imp.readImport("email,event_date\nx@y.com,2026-12-12").error?.includes("package_total") === true);
check("Email or contact id is required", imp.readImport("event_date,package_total,amount_paid\n2026-12-12,1,0").error?.includes("email or ghl_contact_id") === true);
const { rows } = imp.readImport('Email,Contact Id,Event Date,Package Total,Amount Paid,Last Paid On\nSam@Example.com,,12/12/2026,"$2,400.00",$650,11/1/2026\n,c9,December 13 2026,1500,,\n,,,x,abc,\n');
check("GHL style headers, case and money formats read", rows[0].email === "sam@example.com" && rows[0].eventDay === "2026-12-12" && rows[0].total === 2400 && rows[0].paid === 650 && rows[0].paidOn === "2026-11-01", JSON.stringify(rows[0]));
check("Contact id and a written date", rows[1].contactId === "c9" && rows[1].eventDay === "2026-12-13" && rows[1].paid === null);
check("An unreadable row says why", rows[2].problems.length >= 3);

const C = (o: Partial<import("../lib/booked-import.ts").Candidate>) => ({ id: "s", status: "submitted", emails: [], contactId: "", eventDay: "2026-12-12", total: null, paidCents: 0, payments: 0, ...o });
const m1 = imp.matchRow(rows[0], [C({ id: "a", emails: ["sam@example.com"] })]);
check("Match: email and date, sets the total and records the paid amount", m1.kind === "matched" && m1.setTotal && m1.addPaid === 650);
const m2 = imp.matchRow(rows[0], [C({ id: "a", emails: ["sam@example.com"], total: 2300, payments: 1, paidCents: 15000 })]);
check("A different total or recorded payments on file are reported and left alone", m2.kind === "matched" && !m2.setTotal && m2.addPaid === null && m2.notes.length === 2);
check("Same contact, another date: not matched, with their dates", (() => { const o = imp.matchRow(rows[0], [C({ emails: ["sam@example.com"], eventDay: "2027-01-01" })]); return o.kind === "unmatched" && o.reason.includes("2027-01-01"); })());
check("No such contact: not matched", imp.matchRow(rows[0], [C({ emails: ["other@x.com"] })]).kind === "unmatched");
check("Two submitted events the same day: ambiguous, nothing set", imp.matchRow(rows[0], [C({ id: "a", emails: ["sam@example.com"] }), C({ id: "b", emails: ["sam@example.com"] })]).kind === "ambiguous");
check("A submitted event wins over an unfinished one", (() => { const o = imp.matchRow(rows[0], [C({ id: "a", emails: ["sam@example.com"], status: "active" }), C({ id: "b", emails: ["sam@example.com"] })]); return o.kind === "matched" && o.c.id === "b"; })());
check("Contact id matches", imp.matchRow(rows[1], [C({ id: "z", contactId: "c9", eventDay: "2026-12-13" })]).kind === "matched");
const script = src("scripts/import-booked-totals.mts");
check("The script is a dry run unless --confirm, and never uses the price engine", script.includes('process.argv.includes("--confirm")') && script.includes("if (!confirm) continue;") && !/priceEvent|computeBaseline|basisFromEvent/.test(script));
check("The script never texts or touches GHL", !/sendSms|ghl-payload|deliverEventUpdates|webhook/i.test(script.replace(/^\s*\/\/.*$/gm, "")));

done("booked totals import");
