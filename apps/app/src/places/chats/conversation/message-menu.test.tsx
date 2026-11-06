// A message's menu is in groups (write it, turn it into something, keep it, how it was made, remove it); only your own message has Edit and Delete, and Delete is last and alone.
import test from "node:test";
import assert from "node:assert/strict";
import { menuFor } from "./MessageView.tsx";
import type { MessageActions } from "./MessageView.tsx";
import type { Message } from "./model.ts";

const msg = (o: Record<string, unknown> = {}): Message => ({ messageId: "m1", threadId: "t1", threadSeq: 1, author: { kind: "person", id: "usr_maya" }, kind: "text", body: "Did it come back?", blocks: [], depth: 0, attachments: [], reactions: [], pinned: false, createdAt: 1, ...o }) as unknown as Message;
const calls: string[] = [];
const acts = { copy: () => calls.push("copy"), edit() {}, setPinned: (_id: string, on: boolean) => calls.push(`pin:${on}`), react() {}, openThread: () => calls.push("thread"), remove: () => calls.push("remove"), showMenu() {}, makeTask: () => calls.push("task"), share: () => calls.push("share"), fork: () => calls.push("fork") } as unknown as MessageActions;
const shape = (m: Message, mine: boolean): string => menuFor(m, mine, acts, () => calls.push("edit")).map((e) => ("separator" in e ? "|" : "head" in e ? "#" : e.label)).join(",");

test("someone else's message: copy, then thread, task, share and fork, then pin and react; no Edit, no Delete", () => {
  assert.equal(shape(msg(), false), "Copy,|,Reply in thread,Make a Task,Share to...,Fork From Here,|,Pin,Add Reaction");
});

test("your own message adds Edit beside Copy and Delete last, alone, in the danger colour", () => {
  assert.equal(shape(msg({ author: { kind: "person", id: "me" } }), true), "Copy,Edit,|,Reply in thread,Make a Task,Share to...,Fork From Here,|,Pin,Add Reaction,|,Delete");
  const items = menuFor(msg(), true, acts, () => undefined);
  const last = items.at(-1) as { label: string; danger?: boolean };
  assert.deepEqual([last.label, last.danger], ["Delete", true]);
  assert.equal(items.filter((e) => "danger" in e && e.danger).length, 1);
});

test("the words follow the state and every item calls what it says", () => {
  assert.ok(shape(msg({ pinned: true }), false).includes("Unpin"));
  calls.length = 0;
  for (const e of menuFor(msg(), true, acts, () => calls.push("edit"))) if ("onSelect" in e) e.onSelect?.();
  assert.deepEqual(calls, ["copy", "edit", "thread", "task", "share", "fork", "pin:true", "remove"].filter((x) => x !== "react"));
});

test("a system line has no Make a Task, Share or Fork", () => {
  assert.equal(shape(msg({ kind: "system" }), false), "Copy,|,Reply in thread,|,Pin,Add Reaction");
});

test("Edit and Delete are only on your own message; an agent's reply has Retry instead of Edit, and Retry runs its turn again", async () => {
  const withRegen = { ...(acts as object), regenerate: (id: string) => calls.push(`regen:${id}`) } as unknown as MessageActions;
  const agentMsg = msg({ author: { kind: "agent", id: "agt_mira" }, kind: "agent" });
  const agentLabels = menuFor(agentMsg, false, withRegen, () => undefined).flatMap((e) => ("label" in e ? [e.label] : []));
  assert.ok(agentLabels.includes("Retry") && !agentLabels.includes("Edit") && !agentLabels.includes("Delete"), agentLabels.join("|"));
  const theirs = menuFor(msg(), false, withRegen, () => undefined).flatMap((e) => ("label" in e ? [e.label] : []));
  assert.ok(!theirs.includes("Edit") && !theirs.includes("Delete") && !theirs.includes("Retry"), "a person's message has none of the three");
  const mine = menuFor(msg({ author: { kind: "person", id: "me" } }), true, withRegen, () => undefined).flatMap((e) => ("label" in e ? [e.label] : []));
  assert.ok(mine.includes("Edit") && mine.includes("Delete") && !mine.includes("Retry"));
  calls.length = 0;
  (menuFor(agentMsg, false, withRegen, () => undefined).find((e) => "label" in e && e.label === "Retry") as { onSelect(): void }).onSelect();
  assert.deepEqual(calls, ["regen:m1"]);
  assert.ok(!menuFor(agentMsg, false, acts, () => undefined).some((e) => "label" in e && e.label === "Retry"), "left out where the chat cannot");
  const { regenerate } = await import("./actions.ts");
  const sent: { cap: string; input: unknown }[] = [];
  await regenerate({ threadId: "thr_1", call: async (cap: string, input: unknown) => { sent.push({ cap, input }); return cap === "engine.turn.of_message" ? { turn: { turnId: "trn_9" } } : {}; } } as never, "m1");
  assert.deepEqual(sent, [{ cap: "engine.turn.of_message", input: { threadId: "thr_1", messageId: "m1" } }, { cap: "engine.turn.retry", input: { turnId: "trn_9" } }]);
  await assert.rejects(regenerate({ threadId: "thr_1", call: async () => ({}) } as never, "m1"));
});

test("Copy link copies the plain link to the message, only where the chat has an address; it sits with Copy", () => {
  const withLink = { ...(acts as object), copyLink: (id: string) => calls.push(`link:${id}`) } as unknown as MessageActions;
  const labels = menuFor(msg(), false, withLink, () => undefined).map((e) => ("separator" in e ? "|" : "head" in e ? "#" : e.label));
  assert.deepEqual(labels.slice(0, 3), ["Copy", "Copy link", "|"]);
  calls.length = 0;
  (menuFor(msg(), false, withLink, () => undefined).find((e) => "label" in e && e.label === "Copy link") as { onSelect(): void }).onSelect();
  assert.deepEqual(calls, ["link:m1"]);
  assert.ok(!menuFor(msg(), false, acts, () => undefined).some((e) => "label" in e && e.label === "Copy link"));
});

test("Mark Unread From Here is in the keep group where the chat can do it, and runs threads.mark_unread_from with that message's sequence number", async () => {
  const withIt = { ...(acts as object), markUnreadFrom: (seq: number) => calls.push(`unread:${seq}`) } as unknown as MessageActions;
  const m = msg({ threadSeq: 7 });
  const item = menuFor(m, false, withIt, () => undefined).find((e) => "label" in e && e.label === "Mark Unread From Here") as { onSelect(): void } | undefined;
  assert.ok(item, "offered");
  calls.length = 0;
  item.onSelect();
  assert.deepEqual(calls, ["unread:7"]);
  assert.ok(!menuFor(m, false, acts, () => undefined).some((e) => "label" in e && e.label === "Mark Unread From Here"), "left out where the chat cannot");
  assert.ok(!menuFor(msg({ messageId: "pending:k1" }), false, withIt, () => undefined).some((e) => "label" in e && e.label === "Mark Unread From Here"), "not for a message still sending");
  const { markUnreadFrom } = await import("./actions.ts");
  const sent: { cap: string; input: unknown }[] = [];
  await markUnreadFrom({ threadId: "thr_1", call: async (cap: string, input: unknown) => { sent.push({ cap, input }); return { unread: 2 }; } } as never, 7);
  assert.deepEqual(sent, [{ cap: "threads.mark_unread_from", input: { threadId: "thr_1", seq: 7 } }]);
});

test("message times in a shared place read in the Space zone, hover names both zones, and a private chat keeps the device clock", async () => {
  const { timeLabel, dayLabel, timeTitle, timeline } = await import("./model.ts");
  const zones = { space: "America/Los_Angeles", viewer: "Asia/Karachi" };
  const at = Date.parse("2026-11-05T17:05:00Z");          // 9:05 AM Pacific, 10:05 PM Karachi
  const shared = { now: Date.parse("2026-11-05T20:00:00Z"), offsetMin: 300, zones };
  assert.equal(timeLabel(at, shared), "09:05");
  assert.equal(dayLabel(at, shared), "Today");
  assert.match(timeTitle(at, shared) ?? "", /^Thu 5 Nov 2026, 9:05 AM Pacific Time\. Your time: Thu 5 Nov, 10:05 PM Pakistan/);
  const priv = { now: shared.now, offsetMin: 300 };
  assert.equal(timeLabel(at, priv), "22:05");
  assert.equal(timeTitle(at, priv), undefined, "no hover where there is no second zone");
  const items = timeline([msg({ createdAt: at, messageId: "m_t" })], { meId: "me", nameOf: (id: string) => id, kindOf: () => "person" as never, clock: shared, shared: true } as never);
  const other = items.find((i) => i.kind === "other") as { time: string; timeTitle?: string };
  assert.equal(other.time, "09:05");
  assert.match(other.timeTitle ?? "", /Pacific Time/);
});

test("the message menu uses the settled names: Pin, Reply in thread, Copy link and Retry", () => {
  const withAll = { ...(acts as object), copyLink: () => undefined, regenerate: () => undefined } as unknown as MessageActions;
  const agentMsg = msg({ author: { kind: "agent", id: "agt_mira" }, kind: "agent" });
  const labels = menuFor(agentMsg, false, withAll, () => undefined).flatMap((e) => ("label" in e ? [e.label] : []));
  for (const word of ["Copy link", "Reply in thread", "Retry", "Pin"]) assert.ok(labels.includes(word), word);
  for (const gone of ["Copy Link", "Reply in Thread", "Regenerate", "Pin Message"]) assert.ok(!labels.includes(gone), `${gone} is retired`);
});
