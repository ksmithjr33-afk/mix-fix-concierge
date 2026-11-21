// A balance is only ever quoted from recorded payments: the booked total on
// file minus what our team recorded (lib/balance.ts). With no total or nothing
// recorded, no number: "Our team will confirm your remaining balance with
// you." and a team note so someone follows up. Never the deposit as a guess.
// Covers both concierges (intake payment step, update mode), the TOOL RESULT
// after a saved price change, the team notes, and the import's recording.
// Run: node --no-warnings scripts/test-balance.mts

import { registerHooks } from "node:module";
import { check, done, src } from "./team-harness.mts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
process.env.TIMING_LOG = "0";
const bal = await import("../lib/balance.ts");
const sp = await import("../lib/system-prompt.ts");
const up = await import("../lib/update-prompt.ts");

const NOTHING = bal.recordedFrom(null, []);

const SOME = bal.recordedFrom({ deposit_paid_cents: 15000 }, [{ cents: 50000 }]);
const PAYMENT_ONLY = bal.recordedFrom(null, [{ cents: 50000 }]);

// ----- The rule -----
check("Nothing recorded is nothing: the assumed $150 deposit is never counted", !NOTHING.any && NOTHING.cents === 0);
check("Recorded: an entered deposit, a legacy balance, and payments", SOME.cents === 65000 && bal.recordedFrom({ balance_paid_cents: 1000 }, [{ cents: 500 }]).cents === 1500);
check("Balance: total on file minus recorded", bal.knownBalance(2400, SOME) === 1750 && bal.knownBalance(2400, PAYMENT_ONLY) === 1900);
check("No balance without a total on file", bal.knownBalance(null, SOME) === null && bal.totalOnFile(null) === null && bal.totalOnFile({ total: null }) === null);
check("No balance with nothing recorded, even with a total and a booked deposit", bal.knownBalance(2400, NOTHING) === null);
check("A deposit an admin entered is recorded", bal.knownBalance(2400, bal.recordedFrom({ deposit_paid_cents: 15000 }, [])) === 2250);
check("No total while a new price is being confirmed", bal.totalOnFile({ total: 2400 }, true) === null);
check("Paid in full settles it", bal.knownBalance(2400, bal.recordedFrom(null, [{ cents: 100, note: "Paid in full" }])) === 0);
check("Why no balance, for the team note", bal.balanceGap(null, NOTHING) === "no booked total on file and no payments recorded" && bal.balanceGap(2400, NOTHING) === "no payments recorded" && bal.balanceGap(null, SOME) === "no booked total on file" && bal.balanceGap(2400, SOME) === null);

// ----- Intake payment step -----
const noBooking = sp.paymentStep(null);
check("Intake, nothing known: no balance number, our team will confirm", !/\$\d/.test(noBooking) && noBooking.includes(bal.TEAM_WILL_CONFIRM) && noBooking.includes("NEVER state a balance amount"));
const totalOnly = sp.paymentStep({ balance: null, gap: "no payments recorded" });
check("Intake, a total but nothing recorded: still no number, never total minus the deposit", !/\$\d/.test(totalOnly) && totalOnly.includes("no payments recorded") && !/minus the \$?\d* ?deposit/.test(totalOnly));
const known = sp.paymentStep({ balance: 1750, gap: null });
check("Intake, recorded payments: quotes the balance from them", known.includes('"Your remaining balance is $1,750, due two weeks before your event.') && known.includes("ONLY balance amount you may ever state"));
check("Intake: never subtracts a deposit", [noBooking, totalOnly, known].every((t) => t.includes("never subtract a deposit")) && !src("lib/system-prompt.ts").includes("total - deposit"));
const full = sp.buildIntakePrompt({ balance: null, gap: "no payments recorded" });
check("Intake prompt carries the payment step", full.includes("PAYMENT STEP") && full.includes(bal.TEAM_WILL_CONFIRM));
const route = src("app/api/chat/route.ts");
check("Intake: the route builds the balance from recorded payments, never the deposit", route.includes("await recordedPayments(session.id)") && route.includes("buildIntakePrompt(approvalOnly ? null : intakeBalance") && !route.includes("DEFAULT_DEPOSIT"));
check("Intake: a submission with no balance quoted gets the follow up team note", route.includes("withBalanceFollowUp(input, intakeBalance.gap, input.payment_preference)"));
const submitted = bal.withBalanceFollowUp({ team_notes: "Earlier note." }, "no payments recorded", "Payment link");
check("...the note says why and what they chose, added to the notes on file", submitted.team_notes === "Earlier note.\nBalance not quoted (no payments recorded). Confirm the remaining balance with the client. They chose: Payment link.");

// ----- Update mode -----
const dl = { today: "2026-11-21", eventDay: "2026-12-12", daysUntil: 21, lastDrinkChangeDay: "2026-12-06", withinSixDays: false, eventPassed: false };
const ED = { client_name: "Sam", package: "Full Bar", event_date: "December 12, 2026", guest_count: 60 };
const BOOKED = { total: 2400, deposit_paid: 150 } as never;
const noPays = up.buildUpdatePrompt(ED, 2, dl, { booked: BOOKED, recorded: NOTHING });
check("Update, a total but no payments recorded: never $2,250 (total minus deposit), no balance number", !noPays.includes("2,250") && noPays.includes("we cannot state this client's remaining balance (no payments recorded)") && noPays.includes(bal.TEAM_WILL_CONFIRM));
check("...and if the balance comes up, a team note so someone follows up", noPays.includes('team_note: "Balance not quoted (no payments recorded). Confirm the remaining balance with the client."'));
const withPays = up.buildUpdatePrompt(ED, 2, dl, { booked: BOOKED, recorded: SOME });
check("Update, recorded payments: the balance from them is the only one it may state", withPays.includes("remaining balance is $1,750") && withPays.includes("ONLY balance amount you may ever state") && !withPays.includes("2,250"));
const noTotal = up.buildUpdatePrompt(ED, 2, dl, { booked: null, recorded: SOME });
check("Update, no total on file: no number", noTotal.includes("(no booked total on file)") && !noTotal.includes("1,750"));
const pending = up.buildUpdatePrompt(ED, 2, dl, { booked: BOOKED, recorded: SOME, pricePending: { items: [], old_package: null, new_package: null, old_total: 2400, client_quoted: null, reason: "x" } });
check("Update, a price being confirmed: no number", pending.includes("a new total is being confirmed") && !pending.includes("1,750"));
check("Update: the payment question after a price change takes the balance from the TOOL RESULT", noPays.includes("use remaining_balance from the TOOL RESULT") && noPays.includes(bal.PAYMENT_QUESTION_WITH_BALANCE));
check("Update prompt code: no deposit subtraction left", !/bookedTotal - deposit|total - deposit/.test(src("lib/update-prompt.ts")));

check("TOOL RESULT after a saved price change: new total minus recorded", bal.remainingBalanceLine(2600, SOME).startsWith("remaining_balance: 1950 ($1,950)"));
check("TOOL RESULT with nothing recorded: not known, no number, our team will confirm", bal.remainingBalanceLine(2600, NOTHING) === `remaining_balance: not known (no payments recorded). Do not state a balance amount. Say "${bal.TEAM_WILL_CONFIRM}"`);
check("TOOL RESULT with no new total: not known", bal.remainingBalanceLine(null, SOME).includes("not known (no booked total on file)"));
check("The route puts it in the TOOL RESULT and reads recorded payments once per turn", route.includes("remainingBalanceLine(result.priceChange.new_total, recorded)") && route.includes("const recorded = approvalOnly ? null : await recordedPayments(session.id);") && route.includes("updateToolResult(result, recorded)"));

const S0 = { booked_price: { total: 2400 }, price_pending: false };
const chose = bal.paymentFollowUp({ ...ED }, { payment_preference: "Payment link" }, S0, NOTHING);
check("Update: a payment choice saved with no balance quoted carries the follow up team note", chose.team_notes === "Balance not quoted (no payments recorded). Confirm the remaining balance with the client. They chose: Payment link.");
check("...not when the balance was known and quoted", !("team_notes" in bal.paymentFollowUp({ ...ED }, { payment_preference: "Payment link" }, S0, SOME)));
check("...not when the payment choice did not change", !("team_notes" in bal.paymentFollowUp({ ...ED, payment_preference: "Payment link" }, { payment_preference: "Payment link" }, S0, NOTHING)));
check("...added to a team note sent in the same call, nothing lost", bal.paymentFollowUp({ ...ED, team_notes: "Old." }, { payment_preference: "Payment link", team_notes: "Old.\nNew." }, S0, NOTHING).team_notes === "Old.\nNew.\nBalance not quoted (no payments recorded). Confirm the remaining balance with the client. They chose: Payment link.");
check("The route adds it before saving", route.includes("partial = paymentFollowUp(eventData, partial, session, recorded);"));

// ----- Pages and the import use the same rule -----
check("The client and planner pages use the same recorded payments", src("lib/event-home-db.ts").includes("recordedFrom(finance, pays)") && src("lib/event-home.ts").includes("knownBalance("));
check("Business records Paid in full with the note the balance rule reads", src("lib/team/business-db.ts").includes("insertPayment(admin, sessionId, remaining, date, PAID_IN_FULL_NOTE)"));
const imp = src("scripts/import-booked-totals.mts");
check("Import: compares against everything recorded, and records the deposit part plus the rest, so collected equals the file", imp.includes("recordedFrom(f,") && imp.includes('from("event_finance").upsert') && imp.includes("restCents > 0"));

done("balance");
