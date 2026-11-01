// The link card: the shape it reads, the one line it says, and that a press on the name opens the target and a button runs its action once.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { installDom, mount, press, find, textOf, flush } from "../../testing/dom.ts";
import { LinkCard } from "./LinkCard.tsx";
import { isFullCard, linkCardBlock, linkCardLine, linkCardOf } from "./model.ts";

const base = { icon: "task", lead: "Task created", title: "Send the letter", who: "usr_maya", target: { type: "task", id: "tsk_1" } };
const names = (id: string): string => ({ usr_maya: "Maya" } as Record<string, string>)[id] ?? id;

test("linkCardOf reads a good card, drops a broken one, and caps what it keeps", () => {
  assert.deepEqual(linkCardOf({ type: "link_card", data: base }), base);
  assert.equal(linkCardOf({ type: "terminal", data: base }), null, "another block type");
  assert.equal(linkCardOf({ type: "link_card", data: { icon: "task", title: "x" } }), null, "no verb");
  assert.equal(linkCardOf({ type: "link_card", data: null }), null);
  const d = linkCardOf({ type: "link_card", data: { lead: "Summary", title: "T", body: "b".repeat(5000), actions: [1, 2, 3, 4, 5, 6].map((i) => ({ key: `k${i}`, label: `L${i}` })).concat([{ key: "", label: "x" }]), target: { type: "task" } } })!;
  assert.equal(d.body!.length, 2000);
  assert.equal(d.actions!.length, 4);
  assert.equal(d.target, undefined, "a target with no id is no target");
  assert.equal(d.icon, "thread");
  assert.equal(linkCardBlock("blk_1", "t".repeat(32), base).type, "link_card");
});

test("the line names who it went to; a card with a body or buttons is a full card", () => {
  assert.equal(linkCardLine(base, names), "Task created, assigned to Maya");
  assert.equal(linkCardLine({ icon: "fact", lead: "Remembered", title: "Tuesday launch" }, names), "Remembered");
  assert.equal(isFullCard(base), false);
  assert.equal(isFullCard({ ...base, body: "words" }), true);
  assert.equal(isFullCard({ ...base, actions: [{ key: "a", label: "A" }] }), true);
});

test("a press on the name opens the target; a button runs its action and reads as done", async () => {
  installDom();
  const opened: string[] = [], ran: string[] = [];
  const root = await mount(createRoot, <LinkCard id="b1" data={{ ...base, body: "Three leads, one reply.", actions: [{ key: "task", label: "Make task" }, { key: "remember", label: "Remember" }] }} nameOf={names} onOpen={(t) => opened.push(`${t.type}:${t.id}`)} onAction={(k) => ran.push(k)} done={new Set(["remember"])} />);
  assert.match(textOf(find(root, "link-card-b1")), /Task created, assigned to Maya/);
  await press(find(root, "link-card-b1-open"));
  assert.deepEqual(opened, ["task:tsk_1"]);
  await press(find(root, "link-card-b1-task"));
  await flush();
  assert.deepEqual(ran, ["task"]);
  assert.match(textOf(find(root, "link-card-b1-remember")), /Remember ✓/);
  const was = find(root, "link-card-b1-remember")!;
  assert.equal(was.props.disabled === true || was.props["aria-disabled"] === true, true, "a done button is disabled");
});

test("a button may carry a capability and its input; anything else about it is dropped", () => {
  const d = linkCardOf({ type: "link_card", data: { lead: "Flow", title: "Weekly report", actions: [{ key: "on", label: "Turn on", cap: "automations.enable", input: { automationId: "aut_1" } }, { key: "x", label: "Skip", input: { a: 1 } }, { key: "y", label: "Bad", cap: "c", input: [1] }] } })!;
  assert.deepEqual(d.actions, [{ key: "on", label: "Turn on", cap: "automations.enable", input: { automationId: "aut_1" } }, { key: "x", label: "Skip" }, { key: "y", label: "Bad", cap: "c" }]);
});

test("a shared card reads \"Shared by Maya\" where it landed and \"Shared to #ops\" where it came from", () => {
  const name = (id: string): string => ({ usr_maya: "Maya" })[id] ?? id;
  const there = linkCardOf({ type: "link_card", data: { icon: "thread", lead: "Shared", by: "usr_maya", title: "We ship Friday", target: { type: "thread", id: "thr_a" } } })!;
  assert.equal(linkCardLine(there, name), "Shared by Maya");
  const here = linkCardOf({ type: "link_card", data: { icon: "thread", lead: "Shared", to: "#ops", title: "We ship Friday", target: { type: "thread", id: "thr_b" } } })!;
  assert.equal(linkCardLine(here, name), "Shared to #ops");
});
