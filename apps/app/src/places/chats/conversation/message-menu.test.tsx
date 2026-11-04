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
  assert.equal(shape(msg(), false), "Copy,|,Reply in Thread,Make a Task,Share to...,Fork From Here,|,Pin Message,Add Reaction");
});

test("your own message adds Edit beside Copy and Delete last, alone, in the danger colour", () => {
  assert.equal(shape(msg({ author: { kind: "person", id: "me" } }), true), "Copy,Edit,|,Reply in Thread,Make a Task,Share to...,Fork From Here,|,Pin Message,Add Reaction,|,Delete");
  const items = menuFor(msg(), true, acts, () => undefined);
  const last = items.at(-1) as { label: string; danger?: boolean };
  assert.deepEqual([last.label, last.danger], ["Delete", true]);
  assert.equal(items.filter((e) => "danger" in e && e.danger).length, 1);
});

test("the words follow the state and every item calls what it says", () => {
  assert.ok(shape(msg({ pinned: true }), false).includes("Unpin Message"));
  calls.length = 0;
  for (const e of menuFor(msg(), true, acts, () => calls.push("edit"))) if ("onSelect" in e) e.onSelect?.();
  assert.deepEqual(calls, ["copy", "edit", "thread", "task", "share", "fork", "pin:true", "remove"].filter((x) => x !== "react"));
});

test("a system line has no Make a Task, Share or Fork", () => {
  assert.equal(shape(msg({ kind: "system" }), false), "Copy,|,Reply in Thread,|,Pin Message,Add Reaction");
});

test("Edit and Delete are only on your own message; an agent's reply has Regenerate instead of Edit, and Regenerate runs its turn again", async () => {
  const withRegen = { ...(acts as object), regenerate: (id: string) => calls.push(`regen:${id}`) } as unknown as MessageActions;
  const agentMsg = msg({ author: { kind: "agent", id: "agt_mira" }, kind: "agent" });
  const agentLabels = menuFor(agentMsg, false, withRegen, () => undefined).flatMap((e) => ("label" in e ? [e.label] : []));
  assert.ok(agentLabels.includes("Regenerate") && !agentLabels.includes("Edit") && !agentLabels.includes("Delete"), agentLabels.join("|"));
  const theirs = menuFor(msg(), false, withRegen, () => undefined).flatMap((e) => ("label" in e ? [e.label] : []));
  assert.ok(!theirs.includes("Edit") && !theirs.includes("Delete") && !theirs.includes("Regenerate"), "a person's message has none of the three");
  const mine = menuFor(msg({ author: { kind: "person", id: "me" } }), true, withRegen, () => undefined).flatMap((e) => ("label" in e ? [e.label] : []));
  assert.ok(mine.includes("Edit") && mine.includes("Delete") && !mine.includes("Regenerate"));
  calls.length = 0;
  (menuFor(agentMsg, false, withRegen, () => undefined).find((e) => "label" in e && e.label === "Regenerate") as { onSelect(): void }).onSelect();
  assert.deepEqual(calls, ["regen:m1"]);
  assert.ok(!menuFor(agentMsg, false, acts, () => undefined).some((e) => "label" in e && e.label === "Regenerate"), "left out where the chat cannot");
  const { regenerate } = await import("./actions.ts");
  const sent: { cap: string; input: unknown }[] = [];
  await regenerate({ threadId: "thr_1", call: async (cap: string, input: unknown) => { sent.push({ cap, input }); return cap === "engine.turn.of_message" ? { turn: { turnId: "trn_9" } } : {}; } } as never, "m1");
  assert.deepEqual(sent, [{ cap: "engine.turn.of_message", input: { threadId: "thr_1", messageId: "m1" } }, { cap: "engine.turn.retry", input: { turnId: "trn_9" } }]);
  await assert.rejects(regenerate({ threadId: "thr_1", call: async () => ({}) } as never, "m1"));
});

test("Copy Link copies the plain link to the message, only where the chat has an address; it sits with Copy", () => {
  const withLink = { ...(acts as object), copyLink: (id: string) => calls.push(`link:${id}`) } as unknown as MessageActions;
  const labels = menuFor(msg(), false, withLink, () => undefined).map((e) => ("separator" in e ? "|" : "head" in e ? "#" : e.label));
  assert.deepEqual(labels.slice(0, 3), ["Copy", "Copy Link", "|"]);
  calls.length = 0;
  (menuFor(msg(), false, withLink, () => undefined).find((e) => "label" in e && e.label === "Copy Link") as { onSelect(): void }).onSelect();
  assert.deepEqual(calls, ["link:m1"]);
  assert.ok(!menuFor(msg(), false, acts, () => undefined).some((e) => "label" in e && e.label === "Copy Link"));
});
