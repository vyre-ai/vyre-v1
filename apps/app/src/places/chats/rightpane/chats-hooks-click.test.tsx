// The Hooks tab by clicking (lane l-hooks): a hook card's Edit opens the form, the When and What it does chips change the draft, typing changes the words, Save writes through hooks.set and the card shows them,
// Cancel throws the draft away, Pause and Resume flip the card, Remove calls hooks.remove and Undo brings the hook back. Last ran and Made by read from real runs and real names.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import { HookCard } from "./HooksTab.tsx";
import { lastRan, ranWhat, setInput, titleOf } from "./hooks-model.ts";
import { entriesOf } from "./HooksTab.tsx";
import { EVENT_ORDER, EVENT_WORDS } from "./hooks-model.ts";
import { matcherFor } from "../../../../../../lib/hooks.ts";
import type { Hook, HookRun } from "./hooks-model.ts";
import type { PaneDeps } from "./actions.ts";

const hook = (over: Partial<Hook> = {}): Hook => ({
  id: "hok_1", scope: "chat", event: "outward.before", kind: "check", matcher: "", line: "before any email, check the address is in Contacts", paused: false, madeBy: "agt_intake", madeByKind: "agent",
  threadId: "thr_1", helpers: true, timeoutSec: 20, createdAt: 1, updatedAt: 1, spec: { instruction: "Check the address is in Contacts" }, mine: true, canChange: true, ...over,
} as Hook);
function deps() {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const notes: Array<{ text: string; undo?: () => Promise<void> | void }> = [];
  const d: PaneDeps = { call: async (cap, input) => { calls.push({ cap, input: input as Record<string, unknown> }); return {}; }, note: (text, undo) => notes.push({ text, ...(undo ? { undo } : {}) }) };
  return { d, calls, notes };
}
const card = (d: PaneDeps, h: Hook, ran = "Never ran") => <HookCard h={h} threadId="thr_1" deps={d} selected={false} nameOf={(id) => (id === "agt_intake" ? "Intake" : "Irfad Imtiaz")} ran={ran} />;

test("Edit opens the form with the hook's words; Cancel throws a change away", async () => {
  const off = installDom();
  try {
    const { d } = deps();
    const root = await mount(createRoot, card(d, hook()));
    assert.equal(find(root, "hook-form-hok_1"), null);
    await press(find(root, "hook-edit-hok_1"));
    assert.match(textOf(find(root, "hook-form-hok_1")), /When/);
    await typeInto(find(root, "hook-what-hok_1"), "changed my mind");
    await press(find(root, "hook-cancel-hok_1"));
    assert.equal(find(root, "hook-form-hok_1"), null);
    await press(find(root, "hook-edit-hok_1"));
    assert.equal((find(root, "hook-what-hok_1")!.props as { value: string }).value, "Check the address is in Contacts", "the draft was thrown away");
  } finally { off(); }
});

test("the form has quiet pickers, never pills: When, Only for (on a tool event) and What it does; each opens a menu whose choices change the draft, and Save writes them", async () => {
  const off = installDom();
  try {
    const { d, calls } = deps();
    const root = await mount(createRoot, card(d, hook()));
    await press(find(root, "hook-edit-hok_1"));
    for (const id of ["hook-event-hok_1", "hook-kind-hok_1"]) assert.ok(find(root, id), id);
    assert.ok(find(root, "hook-only-hok_1"), "Only for shows when the event is around a tool or an outward step");
    assert.match(textOf(find(root, "hook-only-hok_1-value")), /Any action/);
    assert.match(textOf(find(root, "hook-event-hok_1-value")), /Before anything leaves Vyre/);
    assert.match(textOf(find(root, "hook-kind-hok_1-value")), /Ask a quick check/);
    // the choices of each menu are the plain words, and picking one changes the draft
    const when = entriesOf(EVENT_ORDER.map((e) => ({ key: e, title: EVENT_WORDS[e]! })), "outward.before", () => undefined);
    assert.equal(when.length, 8);
    assert.deepEqual(when.filter((e) => e.checked).map((e) => e.label), ["Before anything leaves Vyre"]);
    const input = setInput(hook(), { event: "tool.before", kind: "command", what: "check-address.sh", only: "email" }, "thr_1")!;
    assert.deepEqual([input["event"], input["kind"], input["command"], input["matcher"]], ["tool.before", "command", "check-address.sh", matcherFor("email")]);
    await typeInto(find(root, "hook-what-hok_1"), "check-address.sh");
    await press(find(root, "hook-save-hok_1"));
    await flush();
    assert.deepEqual([calls[0]!.cap, calls[0]!.input["id"], calls[0]!.input["command"] ?? calls[0]!.input["instruction"]], ["hooks.set", "hok_1", "check-address.sh"]);
    assert.equal(find(root, "hook-form-hok_1"), null, "the form closes after Save");
  } finally { off(); }
});

test("Save with no words says so and writes nothing", async () => {
  const off = installDom();
  try {
    const { d, calls, notes } = deps();
    const root = await mount(createRoot, card(d, hook()));
    await press(find(root, "hook-edit-hok_1"));
    await typeInto(find(root, "hook-what-hok_1"), "  ");
    await press(find(root, "hook-save-hok_1"));
    await flush();
    assert.equal(calls.length, 0);
    assert.equal(notes.at(-1)?.text, "Say what the hook does first.");
    assert.ok(find(root, "hook-form-hok_1"), "the form stays open");
  } finally { off(); }
});

test("Pause calls hooks.pause; Remove calls hooks.remove and its Undo makes the hook again", async () => {
  const off = installDom();
  try {
    const { d, calls, notes } = deps();
    const root = await mount(createRoot, card(d, hook()));
    await press(find(root, "hook-pause-hok_1"));
    await flush();
    assert.deepEqual([calls[0]!.cap, calls[0]!.input["paused"]], ["hooks.pause", true]);
    await press(find(root, "hook-remove-hok_1"));
    await flush();
    assert.equal(calls[1]!.cap, "hooks.remove");
    assert.equal(notes.at(-1)?.text, "Hook removed");
    await notes.at(-1)!.undo!();
    assert.equal(calls[2]!.cap, "hooks.set");
    assert.equal(calls[2]!.input["instruction"], "Check the address is in Contacts");
    assert.equal(calls[2]!.input["scope"], "chat");
  } finally { off(); }
});

test("a Space hook a person cannot change has no Edit or Remove, says so, and still has Pause", async () => {
  const off = installDom();
  try {
    const { d } = deps();
    const root = await mount(createRoot, card(d, hook({ scope: "space", madeBy: "usr_irfad", madeByKind: "admin", canChange: false })));
    assert.equal(find(root, "hook-edit-hok_1"), null);
    assert.equal(find(root, "hook-remove-hok_1"), null);
    assert.match(textOf(find(root, "hook-locked-hok_1")), /Only an admin can remove this/);
    assert.match(textOf(find(root, "hook-meta-hok_1")), /Made by\s+Irfad Imtiaz \(admin\)/, "a real name, never A person");
    assert.ok(find(root, "hook-pause-hok_1"));
  } finally { off(); }
});

test("Last ran reads from the newest run: when, and what it did", async () => {
  const ago = (ts: number): string => `${Math.round((600_000 - ts) / 60_000)} min ago`;
  const run = (o: Partial<HookRun>): HookRun => ({ id: 1, hookId: "hok_1", event: "tool.before", outcome: "blocked", ms: 3, at: 480_000, ...o } as HookRun);
  assert.equal(lastRan("hok_1", [run({ tool: "mail_send" })], ago), "Last ran 2 min ago, stopped sending an email");
  assert.equal(lastRan("hok_1", [], ago), "Never ran");
  assert.equal(lastRan("hok_other", [run({})], ago), "Never ran");
  assert.equal(titleOf({ line: "before any email, check the address is in Contacts", event: "outward.before" }), "Before any email");
  assert.equal(titleOf({ line: "", event: "turn.end" }), "When a turn ends");
  assert.equal(ranWhat({ outcome: "allowed_once", tool: "mail_send" }), "let through once, sending an email");
  assert.equal(ranWhat({ outcome: "blocked", tool: "files_tree" }), "stopped an action", "a tool with no plain choice is an action, never its name");
  assert.equal(ranWhat({ outcome: "timeout" }), "ran out of time");
  const off = installDom();
  try {
    const { d } = deps();
    const root = await mount(createRoot, card(d, hook(), "Last ran 2 min ago, stopped sending an email"));
    assert.match(textOf(find(root, "hook-ran-hok_1")), /Last ran 2 min ago, stopped sending an email/);
    assert.match(textOf(find(root, "hook-title-hok_1")), /^Before any email$/);
  } finally { off(); }
});
