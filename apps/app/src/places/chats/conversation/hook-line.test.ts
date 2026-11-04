// @tsx
// The quiet line a hook leaves in a chat (lane l-hooks): its words, and the side button it offers (Edit for a hook that is still there, Details for one that stopped something).
import test from "node:test";
import assert from "node:assert/strict";
import { hookLineAction, hookLineOf, isCard } from "./model.ts";

const msg = (data: Record<string, unknown>) => ({ blocks: [{ id: "b", type: "hook", v: 1, state: "done", data }] }) as never;

test("a hook block is a quiet line, never a card, and carries its words", () => {
  const l = hookLineOf(msg({ line: "Assistant added a hook in this chat: before any email, check the address is in Contacts", kind: "added", hookId: "hok_1" }))!;
  assert.equal(l.line, "Assistant added a hook in this chat: before any email, check the address is in Contacts");
  assert.equal(isCard({ id: "b", type: "hook", v: 1, state: "done", data: {} } as never), false);
  assert.equal(hookLineOf({ blocks: [] } as never), null);
  assert.equal(hookLineOf(msg({ kind: "added" })), null);
});

test("Edit for an added or changed hook, Details for a block or a failure, nothing for a removed hook or one with no id", () => {
  const a = (kind: string, hookId?: string) => hookLineAction(hookLineOf(msg({ line: "x", kind, ...(hookId ? { hookId } : {}) }))!);
  assert.deepEqual([a("added", "h")?.label, a("changed", "h")?.label, a("blocked", "h")?.label, a("failed", "h")?.label], ["Edit", "Edit", "Details", "Details"]);
  assert.equal(a("removed", "h"), null);
  assert.equal(a("blocked"), null);
});
