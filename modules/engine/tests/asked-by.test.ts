// engine.turn.asked_by: who asked for the turn that is making this call, read from the queue and the message mirror. Only a person's own message counts, and only for a server-side nested call.
import test from "node:test";
import assert from "node:assert/strict";
import { extraHandlers } from "../handlers/extra/index.ts";
import { codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import { ensure } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";

const T = "thr_ask",
  A = "agt_dex",
  PERSON = "usr_maya",
  OTHER = "usr_omar";
const H = extraHandlers;
const agentCtx = (h: ReturnType<typeof harness>, over: Partial<EngineCtx> = {}): EngineCtx => ({
  ...h.ctx,
  principal: { kind: "agent", id: A },
  actingFor: PERSON,
  thread: T,
  depth: 1,
  ...over,
});
/** `typed: false` is a person-authored line they did not type: a poke, a helper's restart line, a line a module posted in their name. */
const say = (
  h: ReturnType<typeof harness>,
  id: string,
  seq: number,
  kind: string,
  who: string,
  at = 1000,
  typed = true,
): void => {
  ensure(h.ctx.db);
  if (typed && kind === "person")
    h.ctx.db.run("INSERT OR IGNORE INTO engine_typed_message (message_id, thread_id, at) VALUES (?, ?, ?)", id, T, at);
  h.ctx.db.run(
    "INSERT INTO engine_messages (id, thread_id, thread_seq, author_kind, author_id, mentions, depth, body, at) VALUES (?, ?, ?, ?, ?, '[]', 0, 'x', ?)",
    id,
    T,
    seq,
    kind,
    who,
    at,
  );
};
function run(
  h: ReturnType<typeof harness>,
  row: { kind: "message" | "interrupt" | "wake" | "handoff"; messageId?: string; from: string; routine?: boolean },
): number {
  const { qseq } = H["engine.turn.enqueue"](h.ctx, {
    threadId: T,
    agentId: A,
    kind: row.kind,
    ...(row.messageId ? { messageId: row.messageId } : {}),
    from: row.from,
  });
  if (row.routine) h.ctx.db.run("UPDATE engine_thread_queue SET routine = 1 WHERE qseq = ?", qseq);
  H["engine.turn.start"](h.ctx, { threadId: T, agentId: A, qseq, placement: "host", engine: "anthropic", model: "m" });
  return qseq;
}

test("a turn a person's own message started is asked by that person, with the message", () => {
  const h = harness();
  say(h, "msg_a", 1, "person", PERSON, 5000);
  run(h, { kind: "message", messageId: "msg_a", from: PERSON });
  const out = H["engine.turn.asked_by"](agentCtx(h), {});
  assert.deepEqual(out, {
    kind: "message",
    routine: false,
    askedBy: { person: PERSON, messageIds: ["msg_a"], at: 5000 },
  });
  assert.deepEqual(contractErrors("engine.turn.asked_by", "out", out), []);
});

test("a person's message added while the turn runs counts; another person's does not", () => {
  const h = harness();
  say(h, "msg_a", 1, "person", PERSON, 5000);
  say(h, "msg_b", 2, "person", PERSON, 6000);
  say(h, "msg_c", 3, "person", OTHER, 7000);
  const q = run(h, { kind: "message", messageId: "msg_a", from: PERSON });
  for (const m of ["msg_b", "msg_c"]) {
    const { qseq } = H["engine.turn.enqueue"](h.ctx, {
      threadId: T,
      agentId: A,
      kind: "message",
      messageId: m,
      from: m === "msg_c" ? OTHER : PERSON,
    });
    h.ctx.db.run("UPDATE engine_thread_queue SET steer = 1, state = 'consumed' WHERE qseq = ?", qseq);
    assert.ok(qseq > q);
  }
  assert.deepEqual(H["engine.turn.asked_by"](agentCtx(h), {}).askedBy, {
    person: PERSON,
    messageIds: ["msg_a", "msg_b"],
    at: 6000,
  });
});

test("a wake, a hand-off, a routine and a watcher turn are never asked for by a person", () => {
  for (const row of [
    { kind: "wake" as const, from: PERSON },
    { kind: "handoff" as const, from: PERSON },
    { kind: "message" as const, messageId: "msg_a", from: PERSON, routine: true },
  ]) {
    const h = harness();
    say(h, "msg_a", 1, "person", PERSON);
    run(h, row);
    const out = H["engine.turn.asked_by"](agentCtx(h), {});
    assert.equal(out.askedBy, undefined, JSON.stringify(row));
    assert.equal(out.kind, row.kind);
  }
});

test("a turn an agent's message started is not asked for, even when it speaks for the person", () => {
  const h = harness();
  say(h, "msg_a", 1, "agent", "agt_other");
  run(h, { kind: "message", messageId: "msg_a", from: PERSON });
  assert.equal(H["engine.turn.asked_by"](agentCtx(h), {}).askedBy, undefined);
});

test("no running turn for this agent in this chat: nobody asked", () => {
  const h = harness();
  say(h, "msg_a", 1, "person", PERSON);
  H["engine.turn.enqueue"](h.ctx, { threadId: T, agentId: A, kind: "message", messageId: "msg_a", from: PERSON }); // queued, not running
  assert.deepEqual(H["engine.turn.asked_by"](agentCtx(h), {}), { kind: "none", routine: false });
  run(h, { kind: "message", messageId: "msg_a", from: PERSON });
  assert.deepEqual(
    H["engine.turn.asked_by"](agentCtx(h, { thread: "thr_elsewhere" }), {}),
    { kind: "none", routine: false },
    "another chat",
  );
  assert.deepEqual(
    H["engine.turn.asked_by"](agentCtx(h, { principal: { kind: "agent", id: "agt_else" } }), {}),
    { kind: "none", routine: false },
    "another agent",
  );
  assert.deepEqual(
    H["engine.turn.asked_by"](agentCtx(h, { principal: { kind: "person", id: PERSON } }), {}),
    { kind: "none", routine: false },
    "a person has no turn",
  );
});

test("only the server's own nested call may ask: a call straight from outside, or one forwarded for a caller, is refused", () => {
  const h = harness();
  say(h, "msg_a", 1, "person", PERSON);
  run(h, { kind: "message", messageId: "msg_a", from: PERSON });
  for (const over of [{ depth: 0 }, { depth: undefined }, { forwarded: true }])
    assert.throws(
      () => H["engine.turn.asked_by"](agentCtx(h, over), {}),
      (e) => codeOf(e) === "permission.role_lacks_permission",
    );
});

test("a line a person did not type is never asking: a poke, a helper's restart line, the owner pressing a card, an automation's chat post", () => {
  // all of these are authored by the person and reach the queue as their message, but chat does not mark them typed (chat/handlers/post.ts:150), so the engine keeps no typed row
  for (const what of [
    "a poke",
    "a helper's restart line",
    "the owner pressing Pause on a goal card",
    "a Personal Automation's chat post",
    "a nested chat.post with a person principal",
  ]) {
    const h = harness();
    say(h, "msg_a", 1, "person", PERSON, 1000, false);
    run(h, { kind: "message", messageId: "msg_a", from: PERSON });
    const out = H["engine.turn.asked_by"](agentCtx(h), {});
    assert.equal(out.askedBy, undefined, what);
    assert.equal(out.kind, "message");
  }
});

test("a typed message that starts the turn counts, and a steering line that was not typed does not join it", () => {
  const h = harness();
  say(h, "msg_a", 1, "person", PERSON, 5000);
  say(h, "msg_b", 2, "person", PERSON, 6000, false);
  run(h, { kind: "message", messageId: "msg_a", from: PERSON });
  const { qseq } = H["engine.turn.enqueue"](h.ctx, {
    threadId: T,
    agentId: A,
    kind: "message",
    messageId: "msg_b",
    from: PERSON,
  });
  h.ctx.db.run("UPDATE engine_thread_queue SET steer = 1, state = 'consumed' WHERE qseq = ?", qseq);
  assert.deepEqual(H["engine.turn.asked_by"](agentCtx(h), {}).askedBy, {
    person: PERSON,
    messageIds: ["msg_a"],
    at: 5000,
  });
});

test("a failed watcher turn retried by the owner is still a routine turn, so it is not asked for", async () => {
  const h = harness();
  say(h, "msg_a", 1, "person", PERSON);
  const q = run(h, { kind: "message", messageId: "msg_a", from: PERSON, routine: true });
  const turnId = String(h.rows("SELECT turn_id FROM engine_turns WHERE qseq = ?", q)[0]!["turn_id"]);
  await H["engine.turn.finish"](h.ctx, {
    turnId,
    outcome: "failed",
    error: { code: "provider.unavailable", message: "Down", next: [], traceId: "0123456789abcdef0123456789abcdef" },
  });
  await H["engine.turn.retry"]({ ...h.ctx, principal: { kind: "person", id: PERSON } }, { turnId });
  const retry = h.rows("SELECT qseq, routine FROM engine_thread_queue ORDER BY qseq DESC LIMIT 1")[0]!;
  assert.equal(retry["routine"], 1, "the retry keeps the routine mark");
  h.ctx.db.run("UPDATE engine_thread_queue SET state = 'running' WHERE qseq = ?", retry["qseq"]);
  assert.equal(H["engine.turn.asked_by"](agentCtx(h), {}).askedBy, undefined);
});

// KNOWN GAP, open until the tool seed carries the turn (plan P1: carry turnId or qseq and key on it). The answer is keyed by (thread, agent), so a call still in flight from a wake turn the owner just
// interrupted reads the owner's new interrupt row. This test states today's behaviour; when the seed carries the turn, it is replaced by one that expects "not asked".
test("known gap: a call from a cancelled wake turn reads the owner's interrupt that replaced it as asked", async () => {
  const h = harness();
  say(h, "msg_int", 1, "person", PERSON, 7000);
  const wake = run(h, { kind: "wake", from: PERSON });
  h.ctx.db.run("UPDATE engine_thread_queue SET state = 'stopping' WHERE qseq = ?", wake);
  const { qseq } = H["engine.turn.enqueue"](h.ctx, {
    threadId: T,
    agentId: A,
    kind: "interrupt",
    messageId: "msg_int",
    from: PERSON,
  });
  h.ctx.db.run("UPDATE engine_thread_queue SET state = 'running' WHERE qseq = ?", qseq);
  assert.equal(
    H["engine.turn.asked_by"](agentCtx(h), {}).askedBy?.person,
    PERSON,
    "the gap: the cancelled turn's late call counts as asked",
  );
});

test("a database from rc.26 (every engine table, no typed-message table) is brought up by ensure() without a duplicate-column error", () => {
  const h = harness();
  ensure(h.ctx.db);
  h.ctx.db.run("DROP TABLE engine_typed_message");
  // a second handle onto the same file: ensure() probes again, finds the new table missing and runs the whole list, whose ALTERs (0010, 0014) have already been applied
  const again = { ...h.ctx.db } as typeof h.ctx.db;
  assert.doesNotThrow(() => ensure(again));
  assert.deepEqual(h.rows("SELECT message_id FROM engine_typed_message"), [], "the table is back");
});
