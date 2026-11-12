// The admin manager view: admins land on it from any event link, bartenders
// (and admins in Bartender view) stay on the bartender view, the tabs and
// their links, the order sheet link opening its tab, and admin only checks on
// the server for the page and every route behind the tabs (the real auth,
// with cookies stubbed).
// Run: node --no-warnings scripts/test-manager.mts

import { registerHooks } from "node:module";
import { readdirSync, existsSync } from "node:fs";
import { check, done, src } from "./team-harness.mts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers" || specifier === "next/navigation") return nextResolve(new URL("./stub-next.mts", import.meta.url).href, context);
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { db } = await import("./fake-supabase.mts");
const stub = await import("./stub-next.mts");
const auth = await import("../lib/team/auth.ts");
const codes = await import("../lib/team/codes.ts");
const tabs = await import("../lib/team/manager-tabs.ts");
const cldb = await import("../lib/client-list-db.ts");

const admin = { id: "admin-1", name: "Isabel Jones", phone: "+12145550100", role: "admin", active: true };
const bartender = { id: "bart-1", name: "Sam Lee", phone: "+12145550101", role: "bartender", active: true };

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.staff = [admin, bartender];
  db.staff_sessions = [];
}
const signIn = (staffId: string, token: string) => {
  db.staff_sessions.push({ token_hash: codes.hashToken(token), staff_id: staffId, expires_at: new Date(Date.now() + 86_400_000).toISOString() });
  stub.stubCookies.clear();
  stub.stubCookies.set(codes.SESSION_COOKIE, token);
};
const redirectOf = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof stub.RedirectError ? e.to : String(e);
  }
};

// ----- Landing -----
reset();
signIn("admin-1", "admin-token");
const asAdmin = await auth.getCurrentStaff();
check("An admin opening an event lands on the manager view", tabs.eventLanding(asAdmin!, "s1", {}) === "/team/admin/e/s1");
check("An admin opening a chat link lands on the manager view's Chat tab", tabs.eventLanding(asAdmin!, "s1", { tab: "chat" }) === "/team/admin/e/s1?tab=chat");
check("An admin opening a tab link lands on that tab", tabs.eventLanding(asAdmin!, "s1", { tab: "dayof" }) === "/team/admin/e/s1?tab=dayof");
check("An unknown tab lands on Details", tabs.eventLanding(asAdmin!, "s1", { tab: "nope" }) === "/team/admin/e/s1");
check("Bartender view of this event: the admin sees the bartender view", tabs.eventLanding(asAdmin!, "s1", { as: "bartender" }) === null);
stub.stubCookies.set("mf_team_view", "bartender");
const inBartenderView = await auth.getCurrentStaff();
check("An admin in Bartender view still sees the bartender view", inBartenderView!.role === "bartender" && tabs.eventLanding(inBartenderView!, "s1", {}) === null);
signIn("bart-1", "bart-token");
const asBartender = await auth.getCurrentStaff();
check("A bartender lands on the bartender view exactly as before", tabs.eventLanding(asBartender!, "s1", {}) === null && tabs.eventLanding(asBartender!, "s1", { tab: "chat" }) === null);

const eventPage = src("app/team/e/[id]/page.tsx");
check("The event page sends admins on before loading any event data", eventPage.indexOf("redirect(landing)") > 0 && eventPage.indexOf("redirect(landing)") < eventPage.indexOf("openEvent("));
check("The bartender view offers admins Back to manager view", src("app/team/e/[id]/event-tabs.tsx").includes("Back to manager view") && eventPage.includes('managerHref={staff.role === "admin"'));
check("Manage staff for this event is gone", !src("app/team/e/[id]/event-tabs.tsx").includes("Manage staff for this event"));
check("Admin event lists open the manager view", src("lib/team/my-events.ts").includes("href: `/team/admin/e/${r.id}`") && src("app/team/admin/events/page.tsx").includes("href: `/team/admin/e/${s.id}`"));

// ----- Tabs and their links -----
check("Six tabs in order", tabs.MANAGER_TABS.map(([, l]) => l).join(" | ") === "Details | Team | Shopping list | Client list | Day of | Chat");
check("Tab links", tabs.managerHref("s1") === "/team/admin/e/s1" && tabs.managerHref("s1", "order") === "/team/admin/e/s1?tab=order" && tabs.managerHref("a b", "team") === "/team/admin/e/a%20b?tab=team");
const page = src("app/team/admin/e/[id]/page.tsx");
const bar = src("app/team/admin/e/[id]/manager-tabs.tsx");
check("The page opens the tab in the address", page.includes("isManagerTab(asked) ? asked : \"details\"") && page.includes("initialTab={tab}"));
check("Switching tabs puts the tab in the address", bar.includes('url.searchParams.set("tab", t)') && bar.includes("window.history.replaceState"));
check("The tab bar has the bartender view's look and scrolls sideways on a phone", bar.includes("bg-[#DDD5CC] p-1 rounded-xl") && bar.includes("overflow-x-auto") && bar.includes("whitespace-nowrap") && bar.includes('bg-[#F5F0EB] text-[#2C2420] shadow-sm'));
check("Tabs show a count when something needs attention", bar.includes("counts[key]") && page.includes("client: pendingHolds.length") && page.includes("counts.stillNeeded + handoffs.length") && page.includes("dayof: dayofCount") && page.includes("missingReports: missing.length"));
const has = (tab: string, ...parts: string[]) => {
  const at = page.indexOf(`    ${tab}: `);
  const next = page.slice(at + 1).search(/\n    (details|team|order|client|dayof|chat): /);
  const body = page.slice(at, next < 0 ? undefined : at + 1 + next);
  return at > 0 && parts.every((p) => body.includes(p));
};
check("Details: the event details and the admin edit form", has("details", "<Details v={v} />", "<EditEvent", "<HideAction"));
check("Team: bartenders, assign someone, open shifts, requests, handoffs, market", has("team", "<AssignPanel", "<ShiftPanel"));
check("Shopping list: the full order sheet inside the tab", has("order", "<OrderSheet initial={sheet}"));
check("Client list: list, auto send, held changes, Review and send, the log", has("client", "<ClientListPanel", "holds=", "log=", "autoSend=", "listText="));
check("Day of: bar setup photos, each bartender's lists, missing reports, wrap ups, time punches", has("dayof", "<BarReadyCard", "<BartenderLists", "<MissingReports", "<Closeouts", "<TimePunches"));
check("Chat: the event team chat with Message team", has("chat", "<ManagerChat") && src("app/team/admin/e/[id]/manager-chat.tsx").includes("Message team"));
check("The header: name, date and times, market, guests, package, and Bartender view of this event", page.includes("eventTitle(ed)") && page.includes("v.serviceStart") && page.includes("v.market") && page.includes("v.guestCount") && page.includes("v.package") && page.includes("?as=bartender`} ") && page.includes("Bartender view of this event"));
check("No staffing page wording on the event page", !/Staffing/.test(page) && !/staffing page/i.test(page));
check("Assign panel features stay: progress moves to Day of, not removed", src("app/team/admin/e/[id]/assign-panel.tsx").includes("showProgress") && src("app/team/admin/e/[id]/day-of.tsx").includes("<Bar label={title}"));

// ----- The order sheet link and order_sheet_url -----
const orderPage = src("app/team/admin/e/[id]/order/page.tsx");
check("The old order sheet link opens the Shopping list tab", orderPage.includes('redirect(managerHref(id, "order"))'));
check("order_sheet_url still points at that link", cldb && src("lib/client-list.ts").includes("/team/admin/e/${encodeURIComponent(sessionId)}/order"));

// ----- Admin only, on the server -----
reset();
stub.stubCookies.clear();
check("Signed out: the manager view sends you to sign in", (await redirectOf(() => auth.requireAdmin("/team/admin/e/s1?tab=team"))) === `/team?next=${encodeURIComponent("/team/admin/e/s1?tab=team")}`);
signIn("bart-1", "bart-token");
check("Bartender: the manager view sends them to their own events", (await redirectOf(() => auth.requireAdmin("/team/admin/e/s1"))) === "/team/events");
signIn("admin-1", "admin-token");
stub.stubCookies.set("mf_team_view", "bartender");
check("Admin in Bartender view: the manager view sends them away", (await redirectOf(() => auth.requireAdmin("/team/admin/e/s1"))) === "/team/events");
stub.stubCookies.delete("mf_team_view");
check("Admin: the manager view opens", (await redirectOf(() => auth.requireAdmin("/team/admin/e/s1"))) === null);
check("The manager view checks admin before reading anything", page.indexOf("await requireAdmin(") > 0 && page.indexOf("await requireAdmin(") < page.indexOf("getSubmittedSession(id)"));

// Every admin route behind the tabs refuses bartenders on the server.
const routes: string[] = [];
const walk = (dir: string) => {
  for (const e of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
    if (e.isDirectory()) walk(`${dir}/${e.name}`);
    else if (e.name === "route.ts") routes.push(`${dir}/${e.name}`);
  }
};
walk("app/api/team/admin");
check("Every admin route checks for an admin on the server", routes.length >= 15 && routes.every((r) => /role !== "admin"/.test(src(r))), routes.filter((r) => !/role !== "admin"/.test(src(r))).join(", "));
const tabRoutes = ["assign", "shifts", "handoff", "market", "hide", "event-edit", "client-list", "order-sheet", "stores"];
check("The routes behind the tabs are all admin routes", tabRoutes.every((r) => existsSync(new URL(`../app/api/team/admin/${r}/route.ts`, import.meta.url))));
check("Admin pages are all behind requireAdmin", ["app/team/admin/e/[id]/page.tsx", "app/team/admin/e/[id]/order/page.tsx", "app/team/admin/stores/page.tsx"].every((p) => src(p).includes("await requireAdmin(")));
const importsAdmin = (p: string) => [...src(p).matchAll(/from "([^"]+)"/g)].some((m) => m[1].includes("/admin/"));
check("Manager components never reach bartenders: the bartender view imports nothing from the admin pages", !importsAdmin("app/team/e/[id]/page.tsx") && !importsAdmin("app/team/e/[id]/event-tabs.tsx"));

// ----- Admins see "Shopping list", never "order sheet" -----
const os = await import("../lib/order-sheet.ts");
check("The tab is named Shopping list, next to Client list", tabs.MANAGER_TABS.some(([k, l]) => k === "order" && l === "Shopping list") && tabs.MANAGER_TABS.some(([k, l]) => k === "client" && l === "Client list"));
check("The events list status says shopping list", os.STATUS_LABEL.not_started === "shopping list not started" && os.STATUS_LABEL.in_progress === "shopping list in progress" && os.STATUS_LABEL.all_ordered === "shopping list all ordered");
const visible = (p: string) =>
  src(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/console\.(error|log|warn)\([^)]*\)/g, "");
const uiFiles = [
  "app/team/admin/e/[id]/order/order-sheet.tsx",
  "app/team/admin/e/[id]/page.tsx",
  "app/team/admin/e/[id]/manager-tabs.tsx",
  "app/team/admin/e/[id]/client-list-panel.tsx",
  "app/team/admin/e/[id]/day-of.tsx",
  "app/team/admin/events/page.tsx",
  "app/team/admin/stores/page.tsx",
  "app/team/admin/stores/store-manager.tsx",
  "app/team/admin/staff/page.tsx",
  "app/api/team/admin/order-sheet/route.ts",
  "app/api/team/admin/stores/route.ts",
  "lib/order-sheet-db.ts",
  "lib/order-sheet-stores.ts",
  "lib/team/manager-tabs.ts",
];
check("No admin facing text says order sheet", uiFiles.every((p) => !/order sheets?\b/i.test(visible(p))), uiFiles.filter((p) => /order sheets?\b/i.test(visible(p))).join(", "));
check("Near the team's list, the client's list is the Client's list", src("app/team/admin/e/[id]/order/order-sheet.tsx").includes("the Client&apos;s list") && src("app/team/admin/e/[id]/order/order-sheet.tsx").includes('"On the Client\'s list"'));
check("Routes, tables and the payload field keep their names", src("lib/client-list.ts").includes("/order`") && existsSync(new URL("../app/api/team/admin/order-sheet/route.ts", import.meta.url)) && src("lib/order-sheet-db.ts").includes('from("order_sheet_lines")'));

done("manager view");
