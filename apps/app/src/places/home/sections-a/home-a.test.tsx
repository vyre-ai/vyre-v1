// Home sections A: the screen. The five sections render from the Northwind sample Space (the prototype's Home data) through the live screen queries; Needs you shows the top
// three in the capability's order; every write the sections make changes what the next render shows; the page opens offline and draws a frame of the right size before data.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import Home, { HomeLoading } from "../index.tsx";
import { act, assign, complete, createTask, markDigestSeen, undoDigestItem } from "./actions.ts";
import type { ActionDeps } from "./actions.ts";
import { createSampleHome, harbor, northwind } from "./sample.ts";
import type { SampleHome } from "./sample.ts";
import type { NeedsItem, Task } from "./model.ts";

const html = (h: SampleHome): string => renderToStaticMarkup(<Home data={h.data} />).replaceAll("<!-- -->", "");
const at = (s: string, needle: string): number => {
  const i = s.indexOf(needle);
  assert.ok(i >= 0, `expected ${needle}`);
  return i;
};
const has = (s: string, needle: string): boolean => s.includes(needle);

function deps(h: SampleHome): { d: ActionDeps; notes: { text: string; undo: () => Promise<void> | void }[] } {
  const notes: { text: string; undo: () => Promise<void> | void }[] = [];
  const names = new Map(northwind.principals.map((p) => [p.id, p.name]));
  return { notes, d: { call: h.data.call, note: (text, undo) => notes.push({ text, undo }), me: northwind.me.id, nameOf: (id) => names.get(id) ?? id } };
}
const queryOf = <T,>(h: SampleHome, screen: string, name: string, state: Record<string, unknown> = {}): T => {
  const snap = h.data.screens.query(screen, name, state).getSnapshot();
  assert.equal(snap.status, "ready");
  return (snap as { data: T }).data;
};
const needsNow = (h: SampleHome): NeedsItem[] => queryOf<{ items: NeedsItem[] }>(h, "home.needs-you-top3", "items", { limit: 3 }).items;
const openNow = (h: SampleHome): Task[] => queryOf<{ tasks: Task[] }>(h, "tasks.my-work", "list", { section: "open" }).tasks;

test("the five sections render from the Northwind sample, in the spec's order", () => {
  const out = html(createSampleHome());
  const ids = ["s-needs", "s-work", "s-risk", "s-away", "s-routines"].map((id) => at(out, `data-testid="${id}"`));
  assert.deepEqual([...ids].sort((a, b) => a - b), ids, "sections run Needs you, My work, Projects at risk, While you were away, Routines");
  for (const title of ["Needs you", "My work", "Projects at risk", "While you were away", "Routines and automations today"]) assert.ok(has(out, title), title);
  assert.ok(!out.includes(String.fromCharCode(0x2014)), "no em dash in any copy");
  assert.ok(!has(out, "home-loading"));
});

test("greeting: time of day, name, date and the day in a line", () => {
  const out = html(createSampleHome());
  assert.ok(has(out, "Good morning, Irfad"));
  assert.ok(has(out, "Friday, October 24 · 7 things need you, 3 tasks due today, 2 tasks overdue"));
});

test("Needs you shows the top 3 in the capability's order and a link to all of them", () => {
  const out = html(createSampleHome());
  const a = at(out, "Send 12 invoices"), b = at(out, "Rivera engagement letter"), c = at(out, "County records search");
  assert.ok(a < b && b < c, "overdue and due today first, then blocking, in the order the capability returned");
  assert.ok(!has(out, "Pruitt intake summary"), "the fourth is not on Home");
  assert.ok(has(out, "All 7 in Needs you"));
  assert.ok(has(out, "$18,420 total · due Friday"));
  assert.ok(has(out, 'data-testid="need-action-tsk_n1"') && has(out, 'data-testid="need-action-tsk_n2"') && has(out, 'data-testid="need-action-tsk_n3"'));
  const labels = ["Approve", "Review", "Unblock"].map((l) => has(out, `aria-label="${l}"`));
  assert.deepEqual(labels, [true, true, true], "one action per row, named for what it does");
});

test("My work groups by due date, shows six, counts every open task and lists Assigned by you", () => {
  const out = html(createSampleHome());
  const g = ["Overdue", "Today", "This week"].map((n) => at(out, `data-testid="group-${n}"`));
  assert.deepEqual([...g].sort((a, b) => a - b), g);
  assert.ok(!has(out, 'data-testid="group-Later"'), "nothing of the six shown falls in Later");
  assert.ok(has(out, "13 · 5 due"), "13 open, 5 due today or earlier");
  assert.ok(has(out, "All 13 in My work"));
  assert.ok(has(out, "Send the retainer reminder to Marcus Pruitt") && has(out, "Approve the consult agenda"));
  assert.ok(!has(out, "Interview round one"), "the seventh task is behind All 13");
  assert.ok(has(out, 'data-testid="group-given"') && has(out, "Prepare the Pruitt consult folder") && has(out, "In Omar&#x27;s My work now"));
  assert.ok(has(out, "Working"), "an agent's task shows its state");
  assert.ok(has(out, "Review the Harlow") && has(out, "  Review"), "a task waiting on me as reviewer carries the seat");
  assert.ok(has(out, 'data-testid="assign-tsk_t1"'), "every row has a face to assign from");
  assert.ok(has(out, "Yesterday") || has(out, "Wed Oct 22"), "a late task shows when it was due");
  assert.ok(has(out, "Today") && has(out, "Mon"), "today and the weekday inside the week");
});

test("Projects at risk lists overdue, blocked and slipped with the reason in words, and a menu for the rule", () => {
  const out = html(createSampleHome());
  assert.ok(has(out, "Pruitt engagement") && has(out, "2 tasks overdue"));
  assert.ok(has(out, "Q4 billing") && has(out, "1 blocked task"));
  assert.ok(has(out, "1 blocked task, Plan slipped"));
  assert.ok(has(out, 'data-testid="risk-dot-block"') && has(out, 'data-testid="risk-dot-risk"'));
  assert.ok(has(out, "Projects at risk: how this is counted"), "the section menu button is there and named");
  assert.ok(has(out, "Nov 14") && has(out, "Dec 23"));
});

test("While you were away: three lines on top, at most seven items, decisions with Undo, See all and Mark seen", () => {
  const out = html(createSampleHome());
  assert.ok(has(out, 'data-testid="away-line-0"') && has(out, 'data-testid="away-line-2"') && !has(out, 'data-testid="away-line-3"'));
  assert.ok(has(out, "Booked Sam Ortega") && has(out, "Reconciled October and drafted 12 invoices"));
  assert.ok(has(out, 'data-testid="away-undo-0"'), "the decision has Undo");
  assert.ok(!has(out, 'data-testid="away-undo-1"'), "work that was only finished does not");
  assert.ok(has(out, 'data-testid="away-all"') && has(out, 'data-testid="away-seen"'));
  assert.ok(has(out, "8:12 am") && has(out, "Yesterday 4:10 pm"));
});

test("Routines today run in time order with their state", () => {
  const page = html(createSampleHome());
  const out = page.slice(at(page, 'data-testid="s-routines"'));
  const order = ["Watch for invoice questions", "Morning briefing", "Weekly lead report", "Weekly status drafts"].map((t) => at(out, t));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(has(out, "Running since 6:00 am · 2 handled today") && has(out, "Ran 7:45 am · three lines in the chat") && has(out, "Today 4:00 pm"));
});

test("offline: the page says so once and every section still shows the kept copy, the digest included", () => {
  const h = createSampleHome(northwind, { online: false });
  const out = html(h);
  assert.ok(has(out, "Offline, showing your saved copy"));
  assert.equal(out.split("Offline, showing your saved copy").length - 1, 1, "said once, not per section");
  assert.ok(has(out, "Booked Sam Ortega") && has(out, "Send 12 invoices") && has(out, "Pruitt engagement"));
  assert.ok(!has(html(createSampleHome()), "home-offline"), "online shows no offline line");
});

test("before the data arrives the place draws a frame the size of the page, not a spinner", () => {
  const out = renderToStaticMarkup(<HomeLoading />).replaceAll("<!-- -->", "");
  assert.ok(has(out, 'data-testid="home-loading"') && has(out, 'data-testid="needs-loading"') && has(out, 'data-testid="work-loading"'));
  assert.ok(has(out, "min-height:132px"), "three rows of 44 are reserved for Needs you");
  assert.equal(renderToStaticMarkup(<Home />).includes("home-loading"), true, "without a provider the place shows the frame");
});

test("Harbor Studio: its own people, two Needs you items, one project at risk, no Northwind name", () => {
  const out = html(createSampleHome(harbor));
  assert.ok(has(out, "Confirm 3 studio visits") && has(out, "All 2 in Needs you") && has(out, "Abel &amp; Daughters site"));
  assert.ok(!has(out, "Rivera") && !has(out, "Pruitt") && !has(out, "Northwind"));
  assert.ok(has(out, "Hold visit slots"));
});

test("an empty Space shows the one-line empties, and calm days hide Projects at risk", () => {
  const empty = createSampleHome({ ...northwind, tasks: [], needs: [], risk: [], routines: [], digest: { ...northwind.digest, seenAt: 1 } });
  const out = html(empty);
  for (const line of ["Nothing needs you", "No tasks yet", "Nothing happened while you were away", "No routines today"]) assert.ok(has(out, line), line);
  assert.ok(!has(out, "s-risk"), "nothing at risk is no heading");
  assert.ok(has(out, "Nothing is waiting on you"));
});

// ---------------------------------------------------------------- the writes

test("approving removes the row and the next one moves up; Undo puts it back", async () => {
  const h = createSampleHome();
  const { d, notes } = deps(h);
  const first = needsNow(h)[0]!;
  assert.equal(first.task.id, "tsk_n1");
  assert.equal(await act(d, first, "approve", "Approve"), true);
  assert.deepEqual(h.calls[0], { cap: "tasks.act", input: { taskId: "tsk_n1", action: "approve" } });
  assert.deepEqual(needsNow(h).map((i) => i.task.id), ["tsk_n2", "tsk_n3", "tsk_n4"]);
  assert.equal(notes.at(-1)!.text, "Approve: Send 12 invoices");
  const out = html(h);
  assert.ok(!has(out, "Send 12 invoices") && has(out, "Pruitt intake summary") && has(out, "All 6 in Needs you"));
  await notes.at(-1)!.undo();
  assert.deepEqual(h.calls.at(-1), { cap: "tasks.transition", input: { taskId: "tsk_n1", to: "awaiting_approval" } });
  assert.deepEqual(needsNow(h).map((i) => i.task.id), ["tsk_n1", "tsk_n2", "tsk_n3"]);
});

test("the circle completes a task and Undo moves it back", async () => {
  const h = createSampleHome();
  const { d, notes } = deps(h);
  const t = openNow(h).find((x) => x.id === "tsk_t1")!;
  assert.equal(await complete(d, t), true);
  assert.deepEqual(h.calls[0], { cap: "tasks.transition", input: { taskId: "tsk_t1", to: "done" } });
  assert.equal(openNow(h).some((x) => x.id === "tsk_t1"), false);
  assert.equal(notes.at(-1)!.text, "Done: Send the retainer reminder to Marcus Pruitt");
  assert.ok(!has(html(h), "Send the retainer reminder"));
  await notes.at(-1)!.undo();
  assert.equal(openNow(h).find((x) => x.id === "tsk_t1")!.state, "doing");
});

test("assigning from a face moves the task to their My work, lists it under Assigned by you, and Undo hands it back", async () => {
  const h = createSampleHome();
  const { d, notes } = deps(h);
  const t = openNow(h).find((x) => x.id === "tsk_t4")!;
  assert.equal(await assign(d, t, { kind: "person", id: "usr_maya" }), true);
  assert.deepEqual(h.calls[0], { cap: "tasks.assign", input: { taskId: "tsk_t4", slot: "assigned", to: { kind: "person", id: "usr_maya" } } });
  assert.equal(openNow(h).some((x) => x.id === "tsk_t4"), false, "no longer in my open list");
  assert.equal(notes.at(-1)!.text, "Assigned to Maya Chen: Call Elena about the fee waiver");
  const out = html(h);
  assert.ok(has(out, "Call Elena about the fee waiver") && has(out, "In Maya&#x27;s My work now"));
  await notes.at(-1)!.undo();
  assert.equal(openNow(h).find((x) => x.id === "tsk_t4")!.assigned.id, "usr_irfad");
  assert.equal(await assign(d, openNow(h).find((x) => x.id === "tsk_t4")!, null), true);
  assert.equal(notes.at(-1)!.text, "Unassigned: Call Elena about the fee waiver");
});

test("a task made from + New task lands in My work", async () => {
  const h = createSampleHome();
  const { d } = deps(h);
  assert.equal(await createTask(d, "Call the county clerk"), true);
  assert.deepEqual(h.calls[0], { cap: "tasks.create", input: { kind: "work", title: "Call the county clerk", assigned: { kind: "person", id: "usr_irfad" } } });
  assert.ok(openNow(h).some((x) => x.title === "Call the county clerk"));
  assert.ok(has(html(h), "All 14 in My work"));
});

test("Mark seen resets the digest; Undo on a decision takes it out of the list", async () => {
  const h = createSampleHome();
  const { d } = deps(h);
  const digest = queryOf<{ digest: { id: string; items: { undo?: { cap: string; input: unknown } }[] } }>(h, "home.away-digest", "digest").digest;
  assert.equal(await undoDigestItem(d, digest.items[0]!), true);
  assert.deepEqual(h.calls[0], { cap: "runs.undo", input: { runId: "run_sweep" } });
  assert.ok(!has(html(h), "Booked Sam Ortega"));
  assert.equal(await undoDigestItem(d, { }), false, "an item without Undo does nothing");
  assert.equal(await markDigestSeen(d, digest.id), true);
  assert.deepEqual(h.calls.at(-1), { cap: "home.mark_digest_seen", input: { digestId: "dgs_1" } });
  const out = html(h);
  assert.ok(has(out, "Nothing happened while you were away") && !has(out, 'data-testid="away-seen"'));
});

test("a failed write says so in the quiet line and changes nothing", async () => {
  const h = createSampleHome();
  const { d, notes } = deps(h);
  h.failNext("tasks.act");
  assert.equal(await act(d, needsNow(h)[0]!, "approve", "Approve"), false);
  assert.equal(notes.at(-1)!.text, "Could not approve. Try again.");
  assert.equal(needsNow(h)[0]!.task.id, "tsk_n1");
  h.failNext("tasks.transition");
  assert.equal(await complete(d, openNow(h)[0]!), false);
  assert.equal(notes.at(-1)!.text, "Could not complete that task. Try again.");
});
