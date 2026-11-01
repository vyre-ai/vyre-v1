// Needs you: the screen. One list sorted by urgency on the left, the open request on the right with what, why, source, one primary action and Send back; acting calls
// tasks.act and the request leaves the list; a request addressed to a role is taken first; a handled one shows who handled it. Rendered from the sample Spaces through the
// live screen queries. (Mapped from apps/app/tests/chats-helper.test.tsx, "Needs you approve calls tasks.act": lane L9b owns only apps/app/src/places/chats/.)
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { NeedsYou, NeedsYouLoading } from "./NeedsYou.tsx";
import { act, snooze, take } from "./actions.ts";
import type { NeedsDeps } from "./actions.ts";
import {
  FILTERS, SEND_BACK, agoLabel, arrivedLabel, blockView, doneLine, dueLabel, filterCounts, holder, isSendBack, matchesFilter, needsNote, needsTake, nextSelection, notePrompt, rowNote, snoozeUntil,
  sortItems, splitActions, stepSelection, footerHint,
} from "./model.ts";
import type { Item } from "./model.ts";
import { NO_ACCOUNT_TITLE, isNoAccount, mailFix } from "./account.ts";
import { ME, SAMPLE_NOW, createSample } from "./sample.ts";
import type { Sample, Variant } from "./sample.ts";

const ALL = { start: 0, end: 500 };
const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const html = (s: Sample, selected?: string): string => clean(renderToStaticMarkup(<NeedsYou data={s.data} window={ALL} {...(selected ? { initialSelected: selected } : {})} />));
const at = (s: string, needle: string): number => {
  const i = s.indexOf(needle);
  assert.ok(i >= 0, `expected ${needle}`);
  return i;
};
const has = (s: string, needle: string): boolean => s.includes(needle);
const inOrder = (s: string, needles: string[]): void => {
  const idx = needles.map((n) => at(s, n));
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, `in the order ${needles.join(" > ")}`);
};
const tagOf = (out: string, testid: string): string => {
  const i = at(out, `data-testid="${testid}"`);
  return out.slice(out.lastIndexOf("<", i), out.indexOf(">", i) + 1);
};
const deps = (s: Sample): { d: NeedsDeps; notes: string[] } => {
  const notes: string[] = [];
  return { notes, d: { call: s.data.call, note: (t) => notes.push(t) } };
};
const itemsNow = (s: Sample): Item[] => (s.replica.rows("needs") as unknown as Item[]);
const item = (s: Sample, id: string): Item => {
  const x = itemsNow(s).find((i) => i.task.id === id);
  assert.ok(x, id);
  return x;
};

test("one list in the queue's order as the prototype lists it (ruling 45), withdrawn last; no groups", () => {
  const out = html(createSample());
  inOrder(out, ['data-testid="row-need-n1"', 'data-testid="row-need-n2"', 'data-testid="row-need-n3"', 'data-testid="row-need-n4"', 'data-testid="row-need-n5"', 'data-testid="row-need-n6"', 'data-testid="row-need-n7"']);
  assert.ok(!has(out, 'data-testid="group-'), "no groups");
  assert.ok(has(out, 'data-testid="needs-count"') && has(out, ">7<") && has(out, ">Needs you<"));
  assert.ok(has(out, 'data-testid="needs-filter"'), "the filter is a quiet icon, not a row of chips");
});

test("two columns: the list, then the open request; the first row is open and painted as selected", () => {
  const out = html(createSample());
  inOrder(out, ['data-testid="needs-list"', 'data-testid="needs-detail"']);
  assert.ok(has(tagOf(out, "row-need-n1"), "background-color:var(--sel)"));
  assert.ok(!has(tagOf(out, "row-need-n3"), "background-color:var(--sel)"));
  assert.ok(has(out, "Month-end export is waiting on a sign-in") && has(out, "Needs your approval"));
});

test("a request: what it is, why, who made it, where it came from, with one primary action and Send back", () => {
  const out = html(createSample(), "n1");
  assert.ok(has(out, "Needs your approval") && has(out, ">Send 12 invoices<") && has(out, "$18,420 total · due Friday"));
  assert.ok(has(out, "Awaiting approval · Assigned to Billing · Approver: You"));
  assert.ok(has(out, "The monthly run, same as September. Two clients have new rates since last month; both are marked."));
  assert.ok(has(out, 'data-testid="block-table"') && has(out, "Harlow & Price") && has(out, "$2,400") && has(out, "7 more in the chat"));
  assert.ok(has(out, "From ") && has(out, 'data-testid="needs-source"') && has(out, "October invoices"));
  assert.ok(has(out, 'data-testid="needs-primary"') && has(out, ">Approve<") && has(out, 'data-testid="needs-sendback"') && has(out, ">Send back<"));
  inOrder(out, ['data-testid="needs-primary"', 'data-testid="needs-sendback"']);
  assert.ok(has(out, ">A<") && has(out, ">B<"), "the keys that do the same");
});

test("a review shows the excerpt and the file; a report shows its values; a blocked one offers its own actions and no Send back", () => {
  const review = html(createSample(), "n2");
  assert.ok(has(review, "Needs your review") && has(review, 'data-testid="block-quote"') && has(review, "The consult fee is $250") && has(review, "engagement-letter.docx · open beside") && has(review, ">Looks good<"));
  const report = html(createSample(), "n6");
  assert.ok(has(report, 'data-testid="block-pairs"') && has(report, "form.send 503") && has(report, "MacBook · macOS 26"));
  const blocked = html(createSample(), "n7");
  assert.ok(has(blocked, ">Sign in again<") && has(blocked, ">Use the backup key<") && has(blocked, 'data-testid="needs-computer"') && !has(blocked, 'data-testid="needs-sendback"'));
  assert.ok(has(blocked, 'data-testid="needs-kind"'));
});

test("every row is a ui/Row with a face, a second line and a time; a quick action sits in its trailing slot", () => {
  const out = html(createSample());
  assert.ok(has(out, 'data-testid="row-need-n1-leading"') && has(out, 'data-testid="row-need-n1-trailing"') && has(out, 'data-testid="face-Billing"'));
  assert.ok(has(out, "Billing · $18,420 total · due Friday") && has(out, "Scout · Needs a login for the county site"), "the second line names who and what");
  assert.ok(has(out, 'data-testid="row-need-n1-notelead"') && has(out, "var(--warn)"), "the verb you act with starts the second line in its colour: accent for Approve and Review, warning for Unblock (P-L9b_23)");
  assert.ok(has(out, ">Approve<") && has(out, ">Unblock<"));
  assert.ok(has(out, 'data-testid="quick-n1"') && has(out, 'data-testid="quick-n7"'));
  assert.ok(has(out, ">9:12<"), "the time of the request is the clock time, as the prototype shows it");
});

test("nothing waiting says so, with the Space's name", () => {
  const out = html(createSample("harbor", { empty: true }));
  assert.ok(has(out, 'data-testid="needs-empty"') && has(out, "All caught up. Nothing in Harbor Studio is waiting on you."));
  assert.ok(has(out, 'data-testid="needs-nothing"') && has(out, "Nothing selected"));
});

test("offline: the screen says so and still draws the list from the device", () => {
  const out = html(createSample("northwind", { online: false }));
  assert.ok(has(out, 'data-testid="needs-offline"') && has(out, "Send 12 invoices"));
});

test("before data the screen draws a frame of the right size", () => {
  assert.ok(has(clean(renderToStaticMarkup(<NeedsYouLoading />)), 'data-testid="needs-loading"'));
  assert.ok(has(clean(renderToStaticMarkup(<NeedsYou />)), 'data-testid="needs-loading"'));
  assert.ok(!html(createSample()).includes(String.fromCharCode(0x2014)), "no em dash in any copy");
});

test("a request addressed to a role is taken first; one taken or handled by someone else shows who", () => {
  const s = createSample();
  const n1 = item(s, "n1");
  s.replica.put("needs", [{ id: "n1", ...n1, task: { ...n1.task, assigned: { kind: "role", id: "role_finance" } } }]);
  const role = html(s, "n1");
  assert.ok(has(role, 'data-testid="needs-take"') && !has(role, 'data-testid="needs-primary"'));
  s.replica.put("needs", [{ id: "n1", ...n1, task: { ...n1.task, takenBy: "usr_lena" } }]);
  const taken = html(s, "n1");
  assert.ok(has(taken, 'data-testid="needs-taken"') && has(taken, "Taken by Lena Ortiz") && !has(taken, 'data-testid="needs-actions"'));
  s.replica.put("needs", [{ id: "n1", ...n1, handledBy: "usr_maya" }]);
  const handled = html(s, "n1");
  assert.ok(has(handled, 'data-testid="needs-handled"') && has(handled, "Handled by Maya Chen") && !has(handled, 'data-testid="needs-primary"') && !has(handled, 'data-testid="quick-n1"'));
});

/* ---------- writes ---------- */

test("Approve calls tasks.act with the task and the action, and the request leaves the list", async () => {
  const s = createSample();
  const { d, notes } = deps(s);
  const n1 = item(s, "n1");
  const approve = splitActions(n1.task).primary!;
  assert.equal(await act(d, n1.task, approve, "Billing"), true);
  assert.deepEqual(s.calls, [{ cap: "tasks.act", input: { taskId: "n1", action: "approve" } }]);
  assert.deepEqual(notes, ["Approved. It continues now."]);
  const out = html(s);
  assert.ok(!has(out, 'data-testid="row-need-n1"') && has(out, ">6<"), "six are left");
});

test("Send back needs a note and carries it in; an empty note does nothing", async () => {
  const s = createSample();
  const { d, notes } = deps(s);
  const n2 = item(s, "n2");
  const back = splitActions(n2.task).sendBack!;
  assert.ok(isSendBack(back) && needsNote(back));
  assert.equal(await act(d, n2.task, back, "Docs"), false);
  assert.equal(await act(d, n2.task, back, "Docs", "   "), false);
  assert.equal(s.calls.length, 0, "no call without a note");
  assert.equal(await act(d, n2.task, back, "Docs", "  Fee should be $300  "), true);
  assert.deepEqual(s.calls, [{ cap: "tasks.act", input: { taskId: "n2", action: "send_back", note: "Fee should be $300" } }]);
  assert.deepEqual(notes, ["Sent back to Docs with your note"]);
  assert.equal(notePrompt(back, "Docs"), "Tell Docs what to change…");
});

test("a failed write is one quiet line, not a thrown error, and nothing leaves the list", async () => {
  const s = createSample();
  const { d, notes } = deps(s);
  s.failNext("tasks.act");
  const n3 = item(s, "n3");
  assert.equal(await act(d, n3.task, n3.task.actions[0]!, "Scout"), false);
  assert.deepEqual(notes, ["Could not lend a login. Try again."]);
  assert.ok(has(html(s), 'data-testid="row-need-n3"'));
});

test("Take locks a role request to you; Snooze removes the request until its time", async () => {
  const s = createSample();
  const { d, notes } = deps(s);
  await take(d, item(s, "n4").task);
  assert.equal(item(s, "n4").task.takenBy, ME);
  await snooze(d, item(s, "n5").task, "tomorrow", { now: SAMPLE_NOW, offsetMin: 0 });
  assert.deepEqual(s.calls.map((c) => c.cap), ["tasks.take", "tasks.snooze"]);
  assert.deepEqual(s.calls[1]!.input, { taskId: "n5", until: Date.UTC(2025, 9, 25, 9, 0, 0) });
  assert.ok(!has(html(s), 'data-testid="row-need-n5"'));
  assert.equal(notes[0], "You took “Pruitt intake summary”");
});

test("every nav handler is reachable: the shell is told what to open, never how", () => {
  const s = createSample();
  s.data.nav.openSource("chat", "c3");
  s.data.nav.openFile("doc1");
  s.data.nav.openComputer("agt_scout");
  s.data.nav.openSignIn();
  assert.deepEqual(s.opened, ["source:chat:c3", "file:doc1", "computer:agt_scout", "sign-in"]);
});

test("a turn with no AI account leaves one task whose action is the direct sign-in, not the agent's computer", () => {
  const s = createSample();
  const base = item(s, "n4").task;
  const acct: Item = { reason: "ready", task: { ...base, id: "acct", kind: "unblock", title: NO_ACCOUNT_TITLE, summary: "So your agent can answer.", blocked: false, source: { kind: "chat", id: "c1" } } };
  s.replica.put("needs", [{ id: "acct", ...acct }]);
  const out = html(s, "acct");
  assert.ok(has(out, 'data-testid="needs-signin"') && has(out, "Sign in"), "the sign-in is the action");
  assert.ok(!has(out, 'data-testid="needs-computer"') && !has(out, 'data-testid="needs-primary"'));
  assert.ok(isNoAccount(acct.task) && !isNoAccount({ kind: "unblock", title: "County records search" }));
});

test("a lost mailbox sign-in leaves one task whose action is Sign in again, which opens Connect a mailbox, not the task's own action", () => {
  const s = createSample();
  const base = item(s, "n4").task;
  const fix: Item = {
    reason: "ready",
    task: { ...base, id: "mailfix", kind: "unblock", title: "Sign in to maya@gmail.test again", blocked: false, source: { kind: "manual", id: "gua_1" }, actions: [{ key: "resolved", label: "Sign in again" }], blocks: [{ type: "mail_signin", v: 1, data: { provider: "google", address: "maya@gmail.test", accountId: "gua_1" } }] },
  };
  s.replica.put("needs", [{ id: "mailfix", ...fix }]);
  const out = html(s, "mailfix");
  assert.ok(has(out, 'data-testid="needs-mailfix"') && has(out, "Sign in again"));
  assert.ok(!has(out, 'data-testid="needs-primary"'), "the task's own action is not offered beside it");
  assert.equal(mailFix(fix.task), "google");
  assert.equal(mailFix({ ...fix.task, blocks: [] }), null);
  assert.equal(mailFix({ ...fix.task, kind: "work" }), null);
});

/* ---------- the rules behind it ---------- */

test("sorting keeps the queue's order as the prototype lists it (ruling 45) and puts withdrawn requests last", () => {
  const s = createSample();
  const mk = (id: string, reason: Item["reason"], o: Partial<Item["task"]> = {}): Item => ({ reason, task: { ...item(s, "n4").task, id, blocked: false, ...o } });
  const given = [mk("ready-old", "ready", { updatedAt: 1 }), mk("gone", "ready", { state: "canceled" }), mk("late", "overdue", { due: 3 }), mk("blocked", "ready", { blocked: true, updatedAt: 99 }), mk("today", "due_today", { due: 5 })];
  assert.deepEqual(sortItems(given).map((i) => i.task.id), ["ready-old", "late", "blocked", "today", "gone"]);
});

test("selection moves with the arrows, stops at the ends, and after an act goes to the next row, else the one before", () => {
  const s = createSample();
  const list = sortItems(itemsNow(s));
  const ids = list.map((i) => i.task.id);
  assert.equal(stepSelection(list, null, 1), ids[0]);
  assert.equal(stepSelection(list, null, -1), ids[ids.length - 1]);
  assert.equal(stepSelection(list, ids[0]!, -1), ids[0]);
  assert.equal(stepSelection(list, ids[0]!, 1), ids[1]);
  assert.equal(stepSelection(list, ids[ids.length - 1]!, 1), ids[ids.length - 1]);
  assert.equal(nextSelection(list, ids[0]!), ids[1]);
  assert.equal(nextSelection(list, ids[ids.length - 1]!), ids[ids.length - 2]);
  assert.equal(nextSelection([], "x"), null);
  assert.equal(nextSelection(list, "gone"), ids[0]);
  assert.equal(stepSelection([], null, 1), null);
});

test("the kind filter keeps one kind; the counts are over the whole list", () => {
  const s = createSample();
  const items = itemsNow(s);
  assert.deepEqual(FILTERS.map((f) => f.key), ["all", "approve", "review", "answer", "unblock"]);
  assert.deepEqual(filterCounts(items), { all: 7, approve: 2, review: 3, answer: 0, unblock: 2 });
  assert.equal(items.filter((i) => matchesFilter(i.task, "review")).length, 3);
  assert.equal(items.filter((i) => matchesFilter(i.task, "all")).length, 7);
});

test("actions split into one primary, Send back and the rest", () => {
  const s = createSample();
  const a = splitActions(item(s, "n7").task);
  assert.deepEqual([a.primary?.key, a.sendBack, a.more.map((x) => x.key)], ["signin", null, ["backup"]]);
  const b = splitActions(item(s, "n1").task);
  assert.deepEqual([b.primary?.key, b.sendBack?.key, b.more.length], ["approve", SEND_BACK, 0]);
  assert.equal(needsNote({ key: "x", label: "X", note: "required" }), true);
  assert.equal(needsNote({ key: "x", label: "X", note: "optional" }), false);
  assert.equal(needsNote({ key: "x", label: "X" }), false);
});

test("who holds a request and whether it needs Take", () => {
  const s = createSample();
  const n1 = item(s, "n1");
  assert.deepEqual(holder(n1, ME), { kind: "free" });
  assert.deepEqual(holder({ ...n1, handledBy: "usr_maya" }, ME), { kind: "handled", by: "usr_maya" });
  assert.deepEqual(holder({ ...n1, task: { ...n1.task, takenBy: "usr_lena" } }, ME), { kind: "taken", by: "usr_lena" });
  assert.deepEqual(holder({ ...n1, task: { ...n1.task, takenBy: ME } }, ME), { kind: "free" });
  assert.equal(needsTake({ ...n1.task, assigned: { kind: "group", id: "g" } }, ME), true);
  assert.equal(needsTake({ ...n1.task, assigned: { kind: "group", id: "g" }, takenBy: ME }, ME), false);
  assert.equal(needsTake(n1.task, ME), false);
});

test("words and times", () => {
  const s = createSample();
  const c = { now: SAMPLE_NOW, offsetMin: 0 };
  assert.equal(rowNote(item(s, "n5"), "Research", c), "Approve · Research · Quarterly worksheet, due Nov 12");
  assert.equal(doneLine(item(s, "n2").task, { key: "review", label: "Looks good" }, "Docs"), "Marked reviewed.");
  assert.equal(doneLine(item(s, "n7").task, { key: "signin", label: "Sign in again" }, "Billing"), "Billing carries on");
  assert.equal(agoLabel(SAMPLE_NOW - 3 * 3_600_000, c), "3 h ago");
  assert.equal(arrivedLabel(SAMPLE_NOW - 48 * 60_000, c), "9:12");
  assert.equal(arrivedLabel(SAMPLE_NOW - 26 * 3_600_000, c), "Yesterday");
  assert.equal(agoLabel(SAMPLE_NOW - 26 * 3_600_000, c), "Yesterday");
  assert.equal(dueLabel(SAMPLE_NOW + 7 * 3_600_000, c), "Today 17:00");
  assert.equal(dueLabel(SAMPLE_NOW - 26 * 3_600_000, c), "Yesterday 08:00");
  assert.equal(snoozeUntil("later", c), SAMPLE_NOW + 4 * 3_600_000);
  assert.equal(snoozeUntil("week", c), Date.UTC(2025, 9, 31, 9, 0, 0));
  assert.equal(snoozeUntil("tomorrow", { now: SAMPLE_NOW, offsetMin: 300 }), Date.UTC(2025, 9, 25, 4, 0, 0), "09:00 in a clock 300 minutes ahead");
});

test("content blocks: a table, key/values and an excerpt get their own look; anything else is one quiet line", () => {
  assert.deepEqual(blockView({ type: "table", v: 1, data: { columns: ["A", "B"], rows: [["1", "2"]], more: 3 } }), { type: "table", columns: ["A", "B"], rows: [["1", "2"]], more: 3 });
  assert.deepEqual(blockView({ type: "table", v: 1, data: { columns: ["A"], rows: [] } }), { type: "table", columns: ["A"], rows: [] });
  assert.deepEqual(blockView({ type: "pairs", v: 1, data: { pairs: [["k", "v"]] } }), { type: "pairs", pairs: [["k", "v"]] });
  assert.deepEqual(blockView({ type: "checklist", v: 1, data: { items: [{ label: "Sign", done: true }, { label: "Pay" }] } }), { type: "pairs", pairs: [["Sign", "Done"], ["Pay", "To do"]] });
  assert.deepEqual(blockView({ type: "document", v: 1, data: { lines: ["x"], file: "a.docx" } }), { type: "quote", lines: ["x"], source: "a.docx" });
  assert.deepEqual(blockView({ type: "screenshot", v: 1, data: { caption: "Sign-in page" } }), { type: "line", text: "screenshot: Sign-in page" });
  assert.deepEqual(blockView({ type: "record_card", v: 1, data: null }), { type: "line", text: "record card" });
});

test("Harbor Studio has the prototype's two: Send the Moreno gallery (Proofer) and Saturday call sheet (Scheduler)", () => {
  const out = html(createSample("harbor"));
  assert.ok(has(out, "Send the Moreno gallery") && has(out, "Saturday call sheet"));
  assert.ok(has(out, "Proofer") && has(out, "Scheduler"));
  assert.ok(!has(out, 'data-testid="needs-empty"'));
});

test("variants exist for the screenshots", () => {
  const variants: Variant[] = ["northwind", "harbor"];
  for (const v of variants) assert.ok(createSample(v).data.space.name.length > 0, v);
});

// ---- requests Vyre itself makes (a connection that stopped working) ----
const connectionTask = (over: Record<string, unknown> = {}) => ({
  id: "tsk_k", kind: "unblock", title: "Replace the Composio key", summary: "Stopped accepting the key. Apps through it are paused until it is replaced.", state: "todo", blocked: true, blocks: [],
  actions: [{ key: "resolved", label: "Done, continue" }, { key: "cannot", label: "Can't do this", note: "required" }],
  assigned: { kind: "role", id: "admin" }, fileIds: [], source: { kind: "manual", id: "connection:mcs_1" }, dependsOn: [], followers: [],
  workingNotes: { origin: "Composio", connection: "mcs_1", fix: "replace_key", hub: "composio" }, reviewLoops: 0, createdBy: "svc_host", createdAt: SAMPLE_NOW - 600_000, updatedAt: SAMPLE_NOW - 600_000, ...over,
});
function withConnectionTask(over: Record<string, unknown> = {}): Sample {
  const s = createSample("northwind");
  for (const r of s.replica.rows("needs")) s.replica.remove("needs", [r.id]);
  s.replica.put("needs", [{ id: "tsk_k", reason: "blocking", task: connectionTask(over) }]);
  return s;
}

test("a request Vyre made reads From the app or Vyre, never from a person, and is assigned to a role by its name", () => {
  const out = html(withConnectionTask());
  assert.ok(has(out, "From ") && has(out, "Composio"));
  assert.ok(!has(out, "a person") && !has(out, "Someone") && !has(out, "Unknown"));
  assert.ok(has(out, "Assigned to Admins"));
  const plain = html(withConnectionTask({ workingNotes: {}, createdBy: "svc_host" }));
  assert.ok(has(plain, "From </span>") || has(plain, "Vyre"));
  assert.ok(!has(plain, "Someone"));
});

test("Open its computer shows only for a request an agent made in a run or chat", () => {
  assert.ok(!has(html(withConnectionTask()), "Open its computer"));
  assert.ok(!has(html(withConnectionTask({ workingNotes: {}, source: { kind: "manual", id: "x" }, createdBy: "usr_maya" })), "Open its computer"));
  assert.ok(has(html(createSample("northwind"), "n3"), "Open its computer"), "an agent's blocked run keeps it");
});

test("a connection request's main button is the fix itself; Take is gone and its own actions wait in the menu", () => {
  const out = html(withConnectionTask());
  assert.ok(has(out, 'data-testid="needs-replace-key"') && has(out, "Replace key"));
  assert.ok(!has(out, 'data-testid="needs-take"') && !has(out, ">Take<"));
  assert.ok(!has(out, 'data-testid="needs-primary"') && !has(out, "Done, continue") && !has(out, 'data-testid="needs-action-cannot"'));
});

test("the list row says who and what: Unblock, the app, then what happened", () => {
  const out = html(withConnectionTask());
  assert.ok(has(out, "Composio") && has(out, "Stopped accepting the key"));
  assert.ok(!has(out, "Someone"));
  const s = withConnectionTask();
  assert.equal(rowNote(item(s, "tsk_k"), "Composio", s.data.clock()), "Unblock \u00b7 Composio \u00b7 Stopped accepting the key. Apps through it are paused until it is replaced.");
});

test("the participants button hides when no person is on the request, never reads 0", () => {
  assert.ok(!has(html(withConnectionTask()), 'data-testid="needs-participants"'));
  assert.ok(has(html(createSample("northwind")), 'data-testid="needs-participants"'));
});

test("the footer names only the keys that work for the open request", () => {
  const s = withConnectionTask();
  assert.equal(footerHint(item(s, "tsk_k").task), "\u2191 \u2193 to move \u00b7 Enter to open");
  assert.equal(footerHint(item(createSample("northwind"), "n1").task), "\u2191 \u2193 to move \u00b7 A approve \u00b7 B send back");
  assert.equal(footerHint(undefined), "\u2191 \u2193 to move");
  assert.ok(has(html(s), "Enter to open"));
});

test("a request Vyre made carries the origin's mark, not a person's face", () => {
  const out = html(withConnectionTask());
  assert.ok(has(out, 'data-testid="origin-Composio"') && !has(out, 'data-testid="face-Composio"'));
  const plain = html(withConnectionTask({ workingNotes: {}, createdBy: "svc_host" }));
  assert.ok(has(plain, 'data-testid="origin-Vyre"'));
  assert.ok(has(html(createSample("northwind")), 'data-testid="face-'), "an agent's request keeps its face");
});

// ---- a key request in Needs you: the main button collects the key; a bare Done cannot close it ----
const keyTask = () => ({
  id: "tsk_kr", kind: "unblock", title: "Fathom key needed", summary: "To read your meetings.", state: "todo", blocked: true,
  blocks: [{ type: "vault_request", v: 1, data: { requestId: "vrq_1", name: "Fathom", fields: ["api_key"], reason: "To read your meetings.", state: "waiting" } }],
  actions: [{ key: "cannot", label: "Decline", note: "optional" }], assigned: { kind: "person", id: "usr_irfad" }, fileIds: [], source: { kind: "manual", id: "vrq_1" }, dependsOn: [], followers: [],
  workingNotes: { thread: "thr_1" }, reviewLoops: 0, createdBy: "agt_intake", createdAt: SAMPLE_NOW - 600_000, updatedAt: SAMPLE_NOW - 600_000,
});
test("Provide the key is the main button of a key request; no bare resolve, Decline or approve key is offered", () => {
  const s = createSample("northwind");
  for (const r of s.replica.rows("needs")) s.replica.remove("needs", [r.id]);
  s.replica.put("needs", [{ id: "tsk_kr", reason: "blocking", task: keyTask() }]);
  const out = html(s);
  assert.ok(has(out, 'data-testid="needs-provide-key"') && has(out, "Provide the key"));
  assert.ok(!has(out, 'data-testid="needs-primary"') && !has(out, 'data-testid="needs-sendback"') && !has(out, ">Take<"));
  assert.ok(has(out, "Open the chat") && !has(out, "A approve"));
});

test("an access request's Approve grants (access.requests.approve); it is not a bare resolve", () => {
  const s = createSample("northwind");
  for (const r of s.replica.rows("needs")) s.replica.remove("needs", [r.id]);
  s.replica.put("needs", [{ id: "tsk_ar", reason: "blocking", task: { ...keyTask(), id: "tsk_ar", title: "Maya asks for use access to Fathom", blocks: [{ type: "access_request", v: 1, data: { requestId: "arq_1", level: "use", state: "waiting" } }], workingNotes: {} } }]);
  const out = html(s);
  assert.ok(has(out, 'data-testid="needs-access-approve"') && has(out, 'data-testid="needs-access-decline"'));
  assert.ok(!has(out, 'data-testid="needs-primary"'));
});

test("a connection that stopped working offers Reconnect and Check again; no bare Fix, no Take", () => {
  const s = createSample("northwind");
  for (const r of s.replica.rows("needs")) s.replica.remove("needs", [r.id]);
  s.replica.put("needs", [{ id: "tsk_cf", reason: "blocking", task: { ...keyTask(), id: "tsk_cf", title: "Your Acme key stopped working", blocks: [{ type: "connection_fix", v: 1, data: { connectionId: "con_1", title: "Acme" } }], workingNotes: {}, source: { kind: "manual", id: "con_1" } } }]);
  const out = html(s);
  assert.ok(has(out, 'data-testid="needs-reconnect"') && has(out, 'data-testid="needs-check-again"'));
  assert.ok(!has(out, 'data-testid="needs-primary"') && !has(out, ">Fix<") && !has(out, "connection fix"));
});
