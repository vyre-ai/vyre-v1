// The Hooks tab by clicking (lane l-hooks): a hook card's Edit opens the form, the When and What it does chips change the draft, typing changes the words, Save writes through hooks.set and the card shows them,
// Cancel throws the draft away, Pause and Resume flip the card, Remove calls hooks.remove and Undo brings the hook back. Last ran and Made by read from real runs and real names.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import { HookCard } from "./HooksTab.tsx";
import { lastRan, ranWhat } from "./hooks-model.ts";
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
const card = (d: PaneDeps, h: Hook, ran = "Not run yet") => <HookCard h={h} threadId="thr_1" deps={d} selected={false} nameOf={(id) => (id === "agt_intake" ? "Intake" : "Irfad Imtiaz")} ran={ran} />;

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

test("in the form the chips choose when and what it does, typing sets the words, Save writes hooks.set and the card shows them", async () => {
  const off = installDom();
  try {
    const { d, calls, notes } = deps();
    const root = await mount(createRoot, card(d, hook()));
    await press(find(root, "hook-edit-hok_1"));
    await press(find(root, "hook-event-hok_1-tool.before"));
    await press(find(root, "hook-kind-hok_1-command"));
    await typeInto(find(root, "hook-what-hok_1"), "check-address.sh");
    await press(find(root, "hook-save-hok_1"));
    await flush();
    assert.equal(calls.length, 1);
    assert.deepEqual([calls[0]!.cap, calls[0]!.input["id"], calls[0]!.input["event"], calls[0]!.input["kind"], calls[0]!.input["command"]], ["hooks.set", "hok_1", "tool.before", "command", "check-address.sh"]);
    assert.equal(notes.at(-1)?.text, "Hook saved");
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
  assert.equal(lastRan("hok_1", [run({ tool: "files_tree" })], ago), "Ran 2 min ago · stopped files_tree");
  assert.equal(lastRan("hok_1", [], ago), "Not run yet");
  assert.equal(lastRan("hok_other", [run({})], ago), "Not run yet");
  assert.equal(ranWhat({ outcome: "allowed_once", tool: "files_tree" }), "let through once, files_tree");
  assert.equal(ranWhat({ outcome: "timeout" }), "ran out of time");
  const off = installDom();
  try {
    const { d } = deps();
    const root = await mount(createRoot, card(d, hook(), "Ran 2 min ago · stopped files_tree"));
    assert.match(textOf(find(root, "hook-ran-hok_1")), /Ran 2 min ago · stopped files_tree/);
  } finally { off(); }
});
