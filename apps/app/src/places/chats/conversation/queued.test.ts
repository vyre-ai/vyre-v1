// @tsx
import test from "node:test";
import assert from "node:assert/strict";
import { ghostMessages, queuedCount, queuedIds, timeline } from "./model.ts";
import type { Message } from "./model.ts";

const me = "usr_me";
const m = (id: string, seq: number, at: number, kind: "person" | "agent" = "person"): Message => ({ messageId: id, threadId: "thr", threadSeq: seq, author: { kind, id: kind === "person" ? me : "agt_x" }, kind: kind === "person" ? "text" : "agent", body: id, blocks: [], depth: 0, attachments: [], reactions: [], pinned: false, createdAt: at } as unknown as Message);

test("a reply being written sits after the message that started it and before the ones queued behind it, which count as queued", () => {
  const rows = [m("first", 1, 1_000), m("second", 2, 9_000)];
  const ghosts = ghostMessages([{ turnId: "trn_1", agentId: "agt_x", startedAt: 1_300, triggerId: "first" }], rows, "thr");
  const all = [...rows, ...ghosts].sort((a, b) => a.threadSeq - b.threadSeq);
  assert.deepEqual(all.map((x) => x.messageId), ["first", "turn:trn_1", "second"]);
  assert.equal(queuedCount(all, me, true), 1, "the second waits behind the reply");
  assert.deepEqual(queuedIds(all, me, true), ["second"]);
  assert.equal(queuedCount(all, me, false), 0, "nothing is queued when nothing is working");
});

test("with nothing sent while it writes, the reply is last and nothing is queued", () => {
  const rows = [m("first", 1, 1_000)];
  const ghosts = ghostMessages([{ turnId: "trn_1", agentId: "agt_x", startedAt: 1_300 }], rows, "thr");
  assert.deepEqual([...rows, ...ghosts].map((x) => x.messageId), ["first", "turn:trn_1"]);
  assert.equal(queuedCount([...rows, ...ghosts], me, true), 0);
  void timeline;
});
