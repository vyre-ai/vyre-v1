// Two people edit one task: the second save is refused (stale_version), and the page keeps what they wrote beside what the task holds now, field by field. They keep theirs or take the current
// one per field, one Save writes only what they kept on the version they just saw, and what was left out is said once. Nothing is written while they choose.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import type { LiveQuery, ScreenHooks } from "../../../../../../client/src/index.ts";
import { CapError } from "../../../../../../client/src/gateway/index.ts";
import { createSample } from "../conversation/sample.ts";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { TaskDetail } from "./TaskDetail.tsx";
import { clashFrom, keptPatch, leftOut, mergeClash, mergeList, setAll, setPick, shortDiff, wordsOf } from "./conflict.ts";

const NOW = Date.UTC(2026, 10, 3, 9);
const DAY = 86_400_000;
const stale = (current: Record<string, unknown>, by = "usr_sara"): CapError => new CapError({ code: "validation.precondition_failed", message: "This task changed while you were editing it.", traceId: "t", status: 409, details: { reason: "stale_version", version: 5, updatedAt: NOW, current, by } });

test("a refused save becomes one row per field that really differs; a field the other person left alone, or set to the same, is not a conflict", () => {
  const c = clashFrom(stale({ title: "Their title", due: NOW + 2 * DAY, effort: 30 }), { title: "My title", due: NOW + DAY, effort: 30, expectedVersion: 4 });
  assert.ok(c);
  assert.deepEqual(c.rows.map((r) => [r.key, r.label, r.pick]), [["title", "Title", "mine"], ["due", "Due", "mine"]]);
  assert.equal(c.version, 5);
  assert.equal(c.by, "usr_sara");
  assert.equal(clashFrom(new Error("no"), { title: "x" }), null);
  assert.equal(clashFrom(new CapError({ code: "validation.precondition_failed", message: "m", traceId: "t", status: 409, details: { reason: "closed" } }), { title: "x" }), null);
});

test("picks are per field; Save carries only what is kept as theirs; what is left out is said", () => {
  let c = clashFrom(stale({ title: "Their title", priority: "high", effort: 90 }), { title: "My title", priority: "urgent", effort: 60 })!;
  c = setPick(c, "priority", "current");
  assert.deepEqual(keptPatch(c), { title: "My title", effort: 60 });
  assert.equal(leftOut(c, NOW, 0), "Not kept from you: priority Urgent.");
  assert.deepEqual(keptPatch(setAll(c, "current")), {});
  assert.equal(leftOut(setAll(c, "mine"), NOW, 0), "");
  assert.match(leftOut(setAll(c, "current"), NOW, 0), /title "My title", priority Urgent, estimate 1 h/);
});

test("a second refused save adds its rows to the open card and keeps the picks already made; another version replaces the card", () => {
  const a = setPick(clashFrom(stale({ title: "Theirs" }), { title: "Mine" })!, "title", "current");
  const b = clashFrom(stale({ priority: "high" }), { priority: "urgent" })!;
  const m = mergeClash(a, b);
  assert.deepEqual(m.rows.map((r) => [r.key, r.pick]), [["title", "current"], ["priority", "mine"]]);
  const again = mergeClash(m, clashFrom(stale({ title: "Theirs" }), { title: "Mine again" })!);
  assert.deepEqual(again.rows.map((r) => [r.key, r.mine, r.pick]), [["title", "Mine again", "current"], ["priority", "urgent", "mine"]]);
  const newer = clashFrom(new CapError({ code: "validation.precondition_failed", message: "m", traceId: "t", status: 409, details: { reason: "stale_version", version: 9, current: { due: NOW } } }), { due: NOW + DAY })!;
  assert.deepEqual(mergeClash(m, newer).rows.map((r) => r.key), ["due"]);
});

test("a long text is cut to the part that differs, with context; short ones and non-text are not cut", () => {
  const body = "The renewal term runs twelve months from signing and covers the retainer, the filing fees and the two court dates listed below. ".repeat(3);
  const d = shortDiff(`${body}Pricing stays out.`, `${body}Pricing is in.`)!;
  assert.ok(d[0].length < 90 && d[1].length < 90, "both sides short");
  assert.match(d[0], /Pricing stays out\./);
  assert.match(d[1], /Pricing is in\./);
  assert.equal(shortDiff("short", "also short"), null);
  assert.equal(shortDiff(5, 6), null);
});

test("values read the way the page shows them", () => {
  assert.equal(wordsOf("priority", "high", NOW, 0), "High");
  assert.equal(wordsOf("due", NOW + DAY, NOW, 0), "Tomorrow");
  assert.equal(wordsOf("effort", 45, NOW, 0), "45 min");
  assert.equal(wordsOf("labels", ["a", "b"], NOW, 0), "#a, #b");
  assert.equal(wordsOf("summary", undefined, NOW, 0), "Empty");
});

type Call = { cap: string; input: Record<string, unknown> };
const TASK = {
  id: "tsk_1", key: "VY-1", kind: "work", title: "Review the lease", state: "todo", blocked: false, assigned: { kind: "person", id: "usr_irfad" }, createdBy: "usr_irfad", version: 4,
  blocks: [], actions: [], fileIds: [], dependsOn: [], followers: [], workingNotes: { brief: "Check the renewal terms." }, labels: [], fields: {}, reviewLoops: 0, createdAt: NOW, updatedAt: NOW,
};
const fixed = (snap: unknown): LiveQuery<unknown> => ({ subscribe: () => () => undefined, getSnapshot: () => snap as never });
const PEOPLE = { status: "ready", data: [{ id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" }, { id: "usr_sara", name: "Sara Lund", kind: "person" }] } as const;

function runtime(): { rt: ShellRuntime; calls: Call[] } {
  const conv = createSample("idle");
  const calls: Call[] = [];
  const screens: ScreenHooks = { query: (_id, name) => fixed(name === "task" ? { status: "ready", data: { task: TASK } } : { status: "ready", data: { entries: [] } }) as never };
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "tasks.index") return { rev: "1", unchanged: false, rows: [], doneThisWeek: 0, total: 0 };
    if (cap === "tasks.working_notes.set") {
      const i = input as Record<string, unknown>;
      const now = NOTES[String(i["key"])] ?? "";
      if (i["expectedFrom"] !== undefined && i["expectedFrom"] !== now) throw stale({ [String(i["key"])]: now });
      NOTES[String(i["key"])] = String(i["value"]);
      return { task: { ...TASK, workingNotes: { ...TASK.workingNotes, ...NOTES }, version: 6, updatedAt: NOW + 1 } };
    }
    if (cap === "tasks.update") {
      const i = input as Record<string, unknown>;
      if (i["expectedVersion"] === 4) throw stale({ title: "Review the renewal lease" });
      return { task: { ...TASK, ...i, version: 6, updatedAt: NOW + 1 } };
    }
    return {};
  };
  const rt = {
    screens, call, connection: conv.data.connection, principals: { subscribe: () => () => undefined, getSnapshot: () => PEOPLE }, recordTitle: () => undefined,
    me: { id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" }, clock: conv.data.clock, space: { id: "northwind", kind: "team", name: "Northwind" }, assistant: { id: "agt_assistant", name: "Assistant" },
    aiConnected: true, deferredModules: new Set<string>(), isDeferred: () => false, calendarConnected: false, open: () => undefined, openUrl: () => undefined,
  } as unknown as ShellRuntime;
  return { rt, calls };
}
const NOTES: Record<string, string> = {};
const wait = async (until: () => boolean): Promise<void> => { for (let i = 0; i < 20 && !until(); i++) await flush(); };
const page = (rt: ShellRuntime) => <TaskDetail rt={rt} taskId="tsk_1" rail={false} conversationFor={() => { throw new Error("no thread in this test"); }} openTask={() => undefined} openAgent={() => undefined} openChat={() => undefined} />;
const fire = async (n: Node | null, name: string): Promise<void> => {
  if (!n) throw new Error("node not found");
  await act(async () => { (n.props[name] as (e: unknown) => void)({ target: { value: "Review the lease today" }, nativeEvent: {}, currentTarget: {} }); });
  await flush();
};
const edit = async (root: Node): Promise<void> => { const title = find(root, "task-title"); await fire(title, "onFocus"); await typeInto(title, "Review the lease today"); await fire(title, "onBlur"); };

test("the page shows both sides, names who changed it, and saves what is kept on the version just seen", async () => {
  const off = installDom();
  try {
    const { rt, calls } = runtime();
    const root = await mount(createRoot, page(rt));
    await edit(root);
    await wait(() => find(root, "task-conflict") !== null);
    const card = textOf(find(root, "task-conflict"));
    assert.match(card, /Sara Lund changed this task while you were editing/);
    assert.match(card, /Review the lease today/);
    assert.match(card, /Review the renewal lease/);
    assert.match(textOf(find(root, "task-conflict-count")), /1 yours, 0 Sara Lund's/);
    // choosing writes nothing
    const before = calls.filter((c) => c.cap === "tasks.update").length;
    await press(find(root, "task-conflict-current-title"));
    assert.match(textOf(find(root, "task-conflict-count")), /0 yours, 1 Sara Lund's/);
    await press(find(root, "task-conflict-mine-title"));
    assert.equal(calls.filter((c) => c.cap === "tasks.update").length, before);
    await press(find(root, "task-conflict-save"));
    await wait(() => find(root, "task-conflict") === null);
    const saved = calls.filter((c) => c.cap === "tasks.update").at(-1)!;
    assert.deepEqual(saved.input, { taskId: "tsk_1", title: "Review the lease today", expectedVersion: 5 });
    assert.equal(find(root, "task-conflict"), null);
  } finally { off(); }
});

test("taking the current value for every field saves nothing and says what was not kept", async () => {
  const off = installDom();
  try {
    const { rt, calls } = runtime();
    const root = await mount(createRoot, page(rt));
    await edit(root);
    await wait(() => find(root, "task-conflict") !== null);
    const writes = calls.filter((c) => c.cap === "tasks.update").length;
    await press(find(root, "task-conflict-all-current"));
    await press(find(root, "task-conflict-save"));
    await wait(() => find(root, "task-conflict") === null);
    assert.equal(calls.filter((c) => c.cap === "tasks.update").length, writes);
    assert.match(textOf(find(root, "task-conflict-left")), /Not kept from you: title "Review the lease today"/);
  } finally { off(); }
});

test("the description is saved against the note it started from: two saves race, the second gets the card, and Save writes on what the note holds now", async () => {
  const off = installDom();
  try {
    const { rt, calls } = runtime();
    NOTES["brief"] = "Alice's brief";   // Sara saved first; this page still shows "Check the renewal terms."
    const root = await mount(createRoot, page(rt));
    await press(find(root, "task-brief"));
    // the description is the shared Markdown editor: its Markdown view is the field a test can type into, and Done saves what was typed
    await press(find(root, "md-view-raw"));
    await typeInto(find(root, "markdown-editor-raw-text"), "Irfad's brief");
    await press(find(root, "task-brief-done"));
    await wait(() => find(root, "task-conflict") !== null);
    assert.match(textOf(find(root, "task-conflict")), /Description/);
    assert.match(textOf(find(root, "task-conflict")), /Irfad's brief/);
    assert.match(textOf(find(root, "task-conflict")), /Alice's brief/);
    assert.equal(NOTES["brief"], "Alice's brief", "nothing was overwritten");
    const first = calls.filter((c) => c.cap === "tasks.working_notes.set")[0]!;
    assert.equal(first.input["expectedFrom"], "Check the renewal terms.", "it names the note it started from");
    await press(find(root, "task-conflict-save"));
    await wait(() => find(root, "task-conflict") === null);
    assert.equal(NOTES["brief"], "Irfad's brief");
    assert.equal(calls.filter((c) => c.cap === "tasks.working_notes.set").at(-1)!.input["expectedFrom"], "Alice's brief");
    delete NOTES["brief"];
  } finally { off(); }
});

test("list notes (Done means, the ticks) are merged, not refused: both people's changes stay", () => {
  assert.equal(mergeList('["a"]', '["a","mine"]', '["a","theirs"]'), '["a","theirs","mine"]');
  assert.equal(mergeList("[0]", "[0,1]", "[0,2]"), "[0,2,1]", "both ticked");
  assert.equal(mergeList("[0,1]", "[0]", "[0,1,2]"), "[0,2]", "I unticked 1, they ticked 2");
  assert.equal(mergeList(undefined, '["x"]', undefined), '["x"]');
});

test("adding to Done means while someone else added too keeps both, with no card", async () => {
  const off = installDom();
  try {
    const { rt, calls } = runtime();
    NOTES["done_means"] = '["theirs"]';
    const root = await mount(createRoot, page(rt));
    await typeInto(find(root, "task-add-means"), "mine");
    await act(async () => { (find(root, "task-add-means")!.props["onKeyDown"] as (e: unknown) => void)({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: false }, target: { value: "mine", blur() {} }, stopPropagation() {}, preventDefault() {}, isDefaultPrevented: () => false }); });
    await wait(() => calls.filter((c) => c.cap === "tasks.working_notes.set").length >= 2);
    assert.equal(find(root, "task-conflict"), null);
    assert.equal(NOTES["done_means"], '["theirs","mine"]');
    delete NOTES["done_means"];
  } finally { off(); }
});
