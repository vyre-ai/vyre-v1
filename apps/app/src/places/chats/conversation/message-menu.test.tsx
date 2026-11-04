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
