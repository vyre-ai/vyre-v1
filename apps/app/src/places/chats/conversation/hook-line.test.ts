// @tsx
// The quiet line a hook leaves in a chat (lane l-hooks): its words, and the side button it offers (Edit for a hook that is still there, Details for one that stopped something).
import test from "node:test";
import assert from "node:assert/strict";
import { hookLineActs, hookLineOf, hookLineText, isCard, hookLead, timeline } from "./model.ts";

const msg = (data: Record<string, unknown>) => ({ blocks: [{ id: "b", type: "hook", v: 1, state: "done", data }] }) as never;

test("a hook block is a quiet line, never a card, and carries its words", () => {
  const l = hookLineOf(msg({ line: "Assistant added a hook in this chat: before any email, check the address is in Contacts", kind: "added", hookId: "hok_1" }))!;
  assert.equal(l.line, "Assistant added a hook in this chat: before any email, check the address is in Contacts");
  assert.equal(isCard({ id: "b", type: "hook", v: 1, state: "done", data: {} } as never), false);
  assert.equal(hookLineOf({ blocks: [] } as never), null);
  assert.equal(hookLineOf(msg({ kind: "added" })), null);
});

test("an added or changed hook offers Edit; a block offers Details, Allow this once and Ask an admin; a failure Details; a removed hook or one with no id nothing", () => {
  const a = (kind: string, hookId?: string) => hookLineActs(hookLineOf(msg({ line: "x", kind, ...(hookId ? { hookId } : {}) }))!);
  assert.deepEqual([a("added", "h"), a("changed", "h"), a("blocked", "h"), a("failed", "h")], [["edit"], ["edit"], ["details", "once", "ask"], ["details"]]);
  assert.deepEqual([a("removed", "h"), a("blocked"), a("allowed", "h")], [[], [], []]);
});

test("a line about a person names them as the reader does, never Someone", () => {
  const l = hookLineOf(msg({ line: "Someone let a hook go by once: x", kind: "allowed", hookId: "h", by: "usr_maya", subject: "before the file tree is read, Space rule" }))!;
  assert.equal(hookLineText(l, (id) => (id === "usr_maya" ? "Maya Chen" : id)), "Maya Chen let a hook go by once: before the file tree is read, Space rule");
  const q = hookLineOf(msg({ line: "Someone asked an admin about a hook: x", kind: "asked", hookId: "h", by: "usr_maya", subject: "rule" }))!;
  assert.equal(hookLineText(q, () => "Maya Chen"), "Maya Chen asked an admin about a hook: rule");
  assert.equal(hookLineText(hookLineOf(msg({ line: "A hook stopped this: no", kind: "blocked" }))!, () => "x"), "A hook stopped this: no");
});

test("the lead words of a hook line are the name before added, or A hook stopped this:", () => {
  assert.deepEqual(hookLead("Intake added a hook in this chat: before any email, check"), ["Intake", " added a hook in this chat: before any email, check"]);
  assert.deepEqual(hookLead("A hook stopped this: no"), ["A hook stopped this:", " no"]);
  assert.deepEqual(hookLead("Maya Chen let a hook go by once: x"), ["Maya Chen", " let a hook go by once: x"]);
  assert.deepEqual(hookLead("nothing to lead"), ["", "nothing to lead"]);
});

test("steps in a block's data are read: at most two, each a short label and sentence", () => {
  const l = hookLineOf(msg({ line: "A hook stopped this: x", kind: "blocked", hookId: "h", agentId: "agt_a", next: [{ label: "A", ask: "Do a" }, { label: "B", ask: "Do b" }, { label: "C", ask: "Do c" }, { label: 5, ask: "x" }] }))!;
  assert.equal(l.agentId, "agt_a");
  assert.deepEqual(l.next, [{ label: "A", ask: "Do a" }, { label: "B", ask: "Do b" }]);
  assert.equal(hookLineOf(msg({ line: "x", kind: "blocked", hookId: "h", next: "nope" }))!.next, undefined);
});

test("the steps of a stop ride on the agent's reply right below it, and the line leaves them out; with no reply from that agent they stay on the line", () => {
  const ctx = { meId: "usr_me", nameOf: (id: string) => id, kindOf: (id: string) => (id.startsWith("agt_") ? "agent" as const : "person" as const), clock: { now: 1_760_000_000_000, offsetMin: 0 } } as never;
  const stop = { messageId: "m_stop", threadId: "t", threadSeq: 2, author: { kind: "agent", id: "agt_a" }, kind: "quiet", body: "A hook stopped this: no", createdAt: 1_760_000_000_000, depth: 0, attachments: [], reactions: [], pinned: false,
    blocks: [{ type: "hook", v: 1, id: "b", state: "done", data: { line: "A hook stopped this: no", kind: "blocked", hookId: "h", agentId: "agt_a", next: [{ label: "Add them", ask: "Please add them" }] } }] };
  const reply = { messageId: "m_reply", threadId: "t", threadSeq: 3, author: { kind: "agent", id: "agt_a" }, kind: "agent", body: "I did not send it.", createdAt: 1_760_000_001_000, depth: 0, attachments: [], reactions: [], pinned: false, blocks: [] };
  const items = timeline([stop, reply] as never, ctx);
  assert.equal(items.find((i) => i.kind === "event")!.stepsBelow, true);
  const other = items.find((i) => i.kind === "other")!;
  assert.deepEqual(other.kind === "other" && other.hookSteps?.next, [{ label: "Add them", ask: "Please add them" }]);
  const alone = timeline([stop] as never, ctx);
  assert.equal(alone.find((i) => i.kind === "event")!.stepsBelow, undefined, "no reply yet: the steps stay on the line");
  const other2 = timeline([stop, { ...reply, author: { kind: "agent", id: "agt_b" } }] as never, ctx);
  assert.equal(other2.find((i) => i.kind === "event")!.stepsBelow, undefined, "a reply from another agent does not carry them");
});
