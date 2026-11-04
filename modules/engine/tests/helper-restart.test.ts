// A helper's result when the server restarted in the middle of its turn (crew-watch.ts): the recovered turn has no start event here, so who it ran for comes from the turn's record, and the chat that
// started the helper hears that it was stopped, never a result ("found") it did not give.
import test from "node:test";
import assert from "node:assert/strict";
import { createCrewWatcher } from "../crew-watch.ts";
import { ensureExtra } from "../handlers/extra/schema.ts";
import { harness } from "../fixtures/harness.ts";
import type { StreamEvent } from "../handlers/bridge.ts";

function scene() {
  const h = harness();
  ensureExtra(h.db);
  const posts: Array<{ agentId: string; post: Record<string, unknown> }> = [];
  const host = {
    call: async (cap: string, _input: unknown, as?: string) => {
      if (cap === "threads.get") return { thread: { kind: "helper", title: "Read the lease", parentThreadId: "thr_parent" }, as };
      if (cap === "chat.message.get") return { message: { body: "I read pages 1 to 3 of the lease" } };
      throw new Error(`unexpected ${cap}`);
    },
    postAs: async (agentId: string, post: Record<string, unknown>) => { posts.push({ agentId, post }); return {}; },
    log: () => undefined,
  };
  const watch = createCrewWatcher({ db: h.db, host: host as never, now: () => 1_760_000_000_000 });
  const turn = (turnId: string): void => {
    h.db.run(
      `INSERT INTO engine_turns (turn_id, thread_id, agent_id, asker, account_ref, engine, model, placement, state, trace_id, run_id, qseq, started_at, ended_at, tokens_in, tokens_out, cost_micros, error, retry_of)
       VALUES (?, 'thr_helper', 'agt_lead', 'usr_dana', NULL, 'chat', '', 'host', 'running', 'tr', NULL, 1, 1, NULL, 0, 0, 0, NULL, NULL)`, turnId);
  };
  const send = async (e: StreamEvent): Promise<void> => { watch(e); await new Promise<void>((r) => setTimeout(r, 30)); };
  return { posts, watch, turn, send };
}

test("a helper whose turn the server lost mid-way tells the chat that started it, for the person it ran for", async () => {
  const s = scene();
  s.turn("trn_helper1");
  // after the restart no start event comes: the recovered turn ends host_lost, then the card is posted
  await s.send({ kind: "end", threadId: "thr_helper", turnId: "trn_helper1", agentId: "agt_lead", state: "failed", code: "host_lost" });
  await s.send({ kind: "final", threadId: "thr_helper", turnId: "trn_helper1", agentId: "agt_lead", messageId: null });
  assert.equal(s.posts.length, 1, "the parent chat hears it");
  const p = s.posts[0]!.post as { actingFor: string; threadId: string; body: string; blocks: Array<{ type: string; data: { status: string; threadId: string } }> };
  assert.deepEqual([p.actingFor, p.threadId], ["usr_dana", "thr_parent"]);
  assert.match(p.body, /^Helper "Read the lease" was stopped when the server restarted/);
  assert.doesNotMatch(p.body, /found/);
  assert.deepEqual([p.blocks[0]!.type, p.blocks[0]!.data.status, p.blocks[0]!.data.threadId], ["helper", "failed", "thr_helper"]);
});

test("a helper that finished normally still reports what it found, and a turn nobody knew the asker of says nothing", async () => {
  const s = scene();
  s.turn("trn_helper2");
  await s.send({ kind: "start", threadId: "thr_helper", turnId: "trn_helper2", agentId: "agt_lead", asker: "usr_dana" });
  await s.send({ kind: "end", threadId: "thr_helper", turnId: "trn_helper2", agentId: "agt_lead", state: "done" });
  await s.send({ kind: "final", threadId: "thr_helper", turnId: "trn_helper2", agentId: "agt_lead", messageId: "msg_1" });
  assert.match((s.posts[0]!.post as { body: string }).body, /^Helper "Read the lease" found:\n\nI read pages 1 to 3/);
  await s.send({ kind: "end", threadId: "thr_helper", turnId: "trn_unknown", agentId: "agt_lead", state: "failed", code: "host_lost" });
  await s.send({ kind: "final", threadId: "thr_helper", turnId: "trn_unknown", agentId: "agt_lead", messageId: null });
  assert.equal(s.posts.length, 1, "no record of who it ran for: nothing is posted for nobody");
});
