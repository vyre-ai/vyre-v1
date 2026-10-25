// Automations sidebar (spec 3.7): tabs, search, Failed runs, and the sections Needs you, Personal, Shared with me, Space and Running with their Groups, from the Northwind sample.
// The model is checked on its own, then the rendered sidebar; Groups open and close, search narrows, and the writes (create, move, group edits, delete) change what the next render shows.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AutomationsSidebar } from "./AutomationsSidebar.tsx";
import type { SidebarProps } from "./AutomationsSidebar.tsx";
import { AutomationsDataProvider } from "../canvas/data.tsx";
import { allGroupKeys, failedTotal, journeyNote, matches, needsYou, nextId, noteOf, sectionsOf, visibleOrder } from "./model.ts";
import type { AutoRow, GroupRow } from "./model.ts";
import { createSampleAutomations, harbor, northwind } from "./sample.ts";
import type { SampleAutomations } from "./sample.ts";

const html = (s: SampleAutomations, props: SidebarProps = {}): string =>
  renderToStaticMarkup(<AutomationsDataProvider value={s.data}><AutomationsSidebar shared={s.shared} reasons={s.space.reasons} {...props} /></AutomationsDataProvider>).replaceAll("<!-- -->", "");
const has = (s: string, needle: string): boolean => s.includes(needle);
const at = (s: string, needle: string): number => { const i = s.indexOf(needle); assert.ok(i >= 0, `expected ${needle}`); return i; };
const lists = (s: SampleAutomations): { autos: AutoRow[]; groups: GroupRow[] } => ({
  autos: (s.data.screens.query("automations.sidebar", "automations", {}).getSnapshot() as { data: { automations: AutoRow[] } }).data.automations,
  groups: (s.data.screens.query("automations.sidebar", "groups", {}).getSnapshot() as { data: { groups: GroupRow[] } }).data.groups,
});
const sections = (s: SampleAutomations, q = "") => { const l = lists(s); return sectionsOf(l.autos, l.groups, { me: s.space.me.id, q, shared: s.shared, reasons: s.space.reasons }); };

test("sections come in the order Needs you, Personal, Shared with me, Space, Running, with the prototype's counts", () => {
  const sec = sections(createSampleAutomations(northwind));
  assert.deepEqual(sec.map((x) => x.key), ["needs", "personal", "shared", "space", "running"]);
  assert.deepEqual(sec.map((x) => x.count), [3, 2, 1, 12, 1]);
  assert.deepEqual(sec.find((x) => x.key === "personal")!.groups.map((g) => g.name), ["Daily", "Money"]);
  assert.deepEqual(sec.find((x) => x.key === "space")!.groups.map((g) => [g.name, g.rows.length]), [["Sales", 5], ["Billing", 1], ["Intake", 5]]);
  assert.deepEqual(sec.find((x) => x.key === "space")!.loose.map((a) => a.name), ["Weekly backup check"], "an Automation with no group is listed directly");
  assert.deepEqual(sec.find((x) => x.key === "needs")!.loose.map((a) => a.name), ["Flag invoices over $5k to me", "New lead follow-up", "Invoice reminders"]);
  assert.deepEqual(sec.find((x) => x.key === "running")!.loose.map((a) => a.name), ["Meeting transcript to tasks"]);
});

test("what needs you: paused, a failed run, or a last run that failed; and the short reason beside it", () => {
  const { autos } = lists(createSampleAutomations(northwind));
  const by = (id: string): AutoRow => autos.find((a) => a.id === id)!;
  assert.ok(needsYou(by("aut_lead")) && needsYou(by("aut_flag")) && needsYou(by("aut_invoice")));
  assert.ok(!needsYou(by("aut_score")));
  assert.equal(noteOf(by("aut_lead"), { aut_lead: "Needs the Twilio key" }), "Needs the Twilio key");
  assert.equal(noteOf(by("aut_flag")), "Personal, 1 run failed");
  assert.equal(noteOf(by("aut_nurture")), "Off");
  assert.equal(noteOf(by("aut_score")), "A record changes");
  assert.equal(failedTotal(autos), 3);
});

test("search keeps the Automations whose name matches, drops empty Groups and opens the rest", () => {
  const s = createSampleAutomations(northwind);
  const sec = sections(s, "invoice");
  assert.deepEqual(sec.map((x) => x.key), ["needs", "personal", "space"], "Shared with me goes when nothing in it matches");
  assert.deepEqual(sec.find((x) => x.key === "space")!.groups.map((g) => g.name), ["Billing"]);
  assert.ok(matches(lists(s).autos[0]!, "  MORNING "));
  assert.equal(sections(s, "zzz").every((x) => x.count === 0), true);
  assert.deepEqual([...allGroupKeys(sec)].sort(), ["personal:agr_money", "space:agr_billing"]);
});

test("the arrow keys walk the rows on screen; a closed Group hides its rows and a closed section hides all", () => {
  const sec = sections(createSampleAutomations(northwind));
  const closed = visibleOrder(sec, new Set(), new Set());
  assert.ok(closed.includes("group:space:agr_sales") && !closed.includes("space:aut_score"));
  const open = visibleOrder(sec, new Set(["space:agr_sales"]), new Set());
  assert.ok(open.includes("space:aut_score"));
  assert.ok(open.indexOf("group:space:agr_sales") < open.indexOf("space:aut_score"));
  assert.ok(!visibleOrder(sec, new Set(), new Set(["space"])).some((id) => id.startsWith("space:") || id.startsWith("group:space:")));
  assert.equal(nextId(["a", "b", "c"], null, 1), "a");
  assert.equal(nextId(["a", "b", "c"], null, -1), "c");
  assert.equal(nextId(["a", "b", "c"], "b", 1), "c");
  assert.equal(nextId(["a", "b", "c"], "c", 1), "c", "stops at the end");
  assert.equal(nextId([], "a", 1), null);
});

test("the sidebar draws the tabs, search, Failed runs and each section with its rows", () => {
  const out = html(createSampleAutomations(northwind), { selectedId: "aut_lead" });
  assert.ok(has(out, 'data-testid="automations-sidebar"'));
  assert.ok(has(out, "Automations") && has(out, "Journeys") && has(out, ">15<"), "tab names and the total");
  assert.ok(has(out, 'aria-label="Search Automations"') && has(out, 'placeholder="Search"'));
  assert.ok(has(out, "Failed runs") && has(out, 'data-testid="failed-count"'));
  const order = ["Needs you", "Personal", "Shared with me", "Space", "Running"].map((t) => at(out, `aria-label="${t}"`));
  assert.deepEqual([...order].sort((x, y) => x - y), order, "sections in order");
  for (const t of ["New lead follow-up", "Needs the Twilio key", "Invoice reminders", "Waiting for Maya to approve", "Flag invoices over $5k to me", "Daily", "Money", "Maya&#x27;s reports", "Sales", "Billing", "Intake", "Meeting transcript to tasks"]) assert.ok(has(out, t), t);
  assert.ok(has(out, 'data-testid="row-auto-needs:aut_lead"'));
});

test("the selected Automation's row is marked and Groups start closed", () => {
  const out = html(createSampleAutomations(northwind), { selectedId: "aut_lead" });
  assert.match(out.match(/<[^>]*data-testid="row-auto-needs:aut_lead"[^>]*>/)![0], /var\(--sel\)/, "the shared Row paints the selection token");
  assert.ok(!has(out, 'data-testid="row-auto-space:aut_score"'), "Lead scoring is inside the closed Sales Group");
  const open = html(createSampleAutomations(northwind), { initialOpen: ["space:agr_sales"] });
  assert.ok(has(open, 'data-testid="row-auto-space:aut_score"') && has(open, "Hot lead alert"));
  assert.ok(has(open, 'data-testid="row-auto-space:aut_lead"'), "the Automation shows under its Group as well as in Needs you");
});

test("a failed run counts beside its Group, and the Group's count is its rows", () => {
  const space = sections(createSampleAutomations(northwind)).find((x) => x.key === "space")!;
  const by = (n: string) => space.groups.find((g) => g.name === n)!;
  assert.deepEqual([by("Sales").failed, by("Billing").failed, by("Intake").failed], [1, 1, 0]);
  assert.deepEqual([by("Sales").rows.length, by("Billing").rows.length, by("Intake").rows.length], [5, 1, 5]);
  assert.equal(sections(createSampleAutomations(northwind)).find((x) => x.key === "personal")!.groups.find((g) => g.name === "Money")!.failed, 1);
});

test("the Journeys tab lists Journeys with their stages and what is in flight", () => {
  const out = html(createSampleAutomations(northwind), { initialTab: "journeys" });
  assert.ok(has(out, "Client onboarding") && has(out, "5 stages, 4 in flight"));
  assert.ok(has(out, "Matter intake") && has(out, "4 stages, 7 in flight"));
  assert.ok(!has(out, "New lead follow-up"), "the Automations list is not shown");
  assert.equal(journeyNote({ id: "j", name: "n", subjectType: "x", recordType: "y", version: 1, stages: 1, inFlight: 0, updatedAt: 0 }), "1 stage");
  assert.match(out.match(/<[^>]*data-testid="subtab-journeys"[^>]*>/)![0], /aria-selected="true"/);
});

test("Harbor Studio draws its own Space: one Group open, a Personal Automation, no Needs you and no Running", () => {
  const h = createSampleAutomations(harbor);
  const sec = sections(h);
  assert.deepEqual(sec.map((x) => x.key), ["personal", "shared", "space"]);
  assert.deepEqual(sec.map((x) => x.count), [1, 0, 2]);
  const out = html(h, { initialOpen: ["space:agr_studio"] });
  assert.ok(has(out, "Brief to project") && has(out, "Friday wrap-up") && has(out, "My reading list"));
  assert.ok(!has(out, 'aria-label="Needs you"') && !has(out, 'aria-label="Running"'));
  assert.ok(!has(out, "data-testid=\"failed-count\""), "no failed runs, no badge");
});

test("creating, moving and deleting change what the next render shows", async () => {
  const s = createSampleAutomations(northwind);
  const made = (await s.data.call("automations.create", { name: "New automation", groupId: "agr_daily" })) as { automation: { id: string } };
  assert.equal(sections(s).find((x) => x.key === "personal")!.groups.find((g) => g.id === "agr_daily")!.rows.length, 2);
  await s.data.call("automations.move", { automationId: made.automation.id, groupId: "agr_money" });
  assert.equal(sections(s).find((x) => x.key === "personal")!.groups.find((g) => g.id === "agr_money")!.rows.length, 2);
  await s.data.call("automations.move", { automationId: made.automation.id });
  assert.equal(sections(s).find((x) => x.key === "personal")!.loose.length, 1, "no group puts it back in the list");
  await s.data.call("automations.delete", { automationId: made.automation.id });
  assert.equal(lists(s).autos.length, 15);
});

test("Group edits: a new Group is empty and shows under Space; rename and delete keep the Automations", async () => {
  const s = createSampleAutomations(northwind);
  await s.data.call("automations.groups.create", { name: "Legal" });
  const space = () => sections(s).find((x) => x.key === "space")!;
  assert.ok(space().groups.some((g) => g.name === "Legal" && g.rows.length === 0), "empty Groups sit under Space");
  assert.ok(!sections(s).find((x) => x.key === "personal")!.groups.some((g) => g.name === "Legal"));
  await s.data.call("automations.groups.rename", { groupId: "agr_sales", name: "Revenue" });
  assert.ok(space().groups.some((g) => g.name === "Revenue" && g.rows.length === 5));
  await s.data.call("automations.groups.delete", { groupId: "agr_sales" });
  assert.equal(lists(s).autos.length, 15, "the Automations stay");
  assert.ok(space().loose.some((a) => a.name === "New lead follow-up"), "and are listed directly");
});

test("a failed write says so in a sentence and leaves the list as it was", async () => {
  const s = createSampleAutomations(northwind);
  s.failNext("automations.move");
  await assert.rejects(() => s.data.call("automations.move", { automationId: "aut_score" }), /automations.move failed/);
  assert.equal(lists(s).autos.find((a) => a.id === "aut_score")!.groupId, "agr_sales");
});
