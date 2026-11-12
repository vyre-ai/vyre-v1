// Every engine consumer keeps an event that reaches it while the server is stopping its engine (the daemon's engine closer has taken the host half back): it throws the host's kept error before it
// does anything, so the hook runner keeps its cursor on the event (not counted as a try) and the next start delivers it. Before, most of them answered "no engine" (return [] or skipped): the host
// moved past the event and the work was lost: a goal's wake-up (engine.goal_wake), a baton, a routine run, an approved hold, a reviewed file, an unblock, a key or access answer.
// A host that never had an engine (no seam, a unit test) answers as before, and so does a second daemon in the process whose databases the stopping engine did not serve.
// @reads /modules/engine/migrations/0001_init.sql
// @reads /modules/engine/migrations/0003_unblock.sql
import test from "node:test";
import assert from "node:assert/strict";
import { consumers, hostSeams } from "../impl.ts";
import { bindEngine, setEngineStopping } from "../projections.ts";
import { harness } from "../fixtures/harness.ts";
import { isKeptForRestart } from "../../../host/src/routes/errors.ts";
import type { EngineCtx } from "../projections.ts";
import type { EngineHostSeam } from "../runtime.ts";

type Run = (ctx: EngineCtx, event: { name: string; payload: Record<string, unknown> }) => Promise<unknown>;
const ALL = Object.entries(consumers as unknown as Record<string, { on: string[]; run: Run }>);
// a payload with every id the consumers read, so a consumer that did not keep the event would go on to its work
const payload = { threadId: "thr_kept", messageId: "msg_kept", agentId: "agt_kept", taskId: "tsk_kept", holdId: "hld_kept", goalId: "gol_kept", wakeId: "gwk_kept", attempt: 1, personId: "usr_kept",
  requestId: "req_kept", fileId: "fil_kept", name: "brief.md", by: "usr_kept", actingFor: "usr_kept", asker: "usr_kept", starter: "usr_kept", kind: "chat", runId: "run_kept", blockId: "blk_kept",
  author: { kind: "person", id: "usr_kept" }, mentions: [{ kind: "agent", id: "agt_kept" }], depth: 0, providerId: "prv_kept", providerKey: "claude-code", fields: ["agents"] };

function stoppingHost(calls: string[], ours?: (db: unknown) => boolean): EngineHostSeam {
  return {
    holder: "host:spc_kept", now: () => 1_760_000_000_000, openSession: async () => { throw new Error("no session in this test"); },
    async call(cap) { calls.push(cap); return {}; },
    postAs: async () => { calls.push("postAs"); },
    ...(ours ? { ours } : {}),
  };
}

test("while the server stops its engine, every engine consumer keeps its event for the next start: the kept error, no side effect", async () => {
  assert.ok(ALL.length >= 20, `the engine exports its consumers (${ALL.length})`);
  for (const [name, c] of ALL) {
    bindEngine(null);
    const h = harness();
    const calls: string[] = [];
    hostSeams.setEngineHost(stoppingHost(calls));
    hostSeams.setEngineHost(null);   // the daemon's engine closer: the host half goes first, the hooks' last passes come after
    const err = await c.run(h.ctx, { name: c.on[0]!, payload }).then(() => null, (e: unknown) => e);
    assert.ok(err !== null && isKeptForRestart(err), `${name} kept ${c.on[0]} for the next start (got ${err === null ? "an answer" : String((err as Error).message)})`);
    assert.deepEqual(calls, [], `${name} did nothing before it kept the event`);
    assert.deepEqual(h.emitted.map((e) => e.name), [], `${name} emitted nothing`);
  }
});

test("the next start takes the kept event: once a host half is bound again, the consumer is not told to keep it", async () => {
  bindEngine(null);
  const h = harness();
  const calls: string[] = [];
  hostSeams.setEngineHost(stoppingHost(calls));
  hostSeams.setEngineHost(null);
  const run = (consumers as unknown as Record<string, { run: Run }>)["engine.goal_wake"]!.run;
  await assert.rejects(() => run(h.ctx, { name: "goal.woken", payload }), (e: unknown) => isKeptForRestart(e));
  hostSeams.setEngineHost(stoppingHost(calls));
  try {
    const err = await run(h.ctx, { name: "goal.woken", payload }).then(() => null, (e: unknown) => e);
    assert.ok(err === null || !isKeptForRestart(err), "not kept once the engine host is back");
  } finally { hostSeams.setEngineHost(null); setEngineStopping(false); }
});

test("a host that never had an engine, and a second daemon whose databases the stopping engine did not serve, answer as before: nothing is kept for them", async () => {
  for (const [name, c] of ALL.filter(([n]) => n === "engine.goal_wake" || n === "engine.task_baton" || n === "engine.bridge")) {
    // never had an engine (a unit test, a daemon without the seam)
    bindEngine(null); setEngineStopping(false);
    const h = harness();
    const err = await c.run(h.ctx, { name: c.on[0]!, payload }).then(() => null, (e: unknown) => e);
    assert.ok(err === null || !isKeptForRestart(err), `${name}: a host with no engine is not told to keep`);
    // two daemons in one process: the one that stops served another database
    const calls: string[] = [];
    const theirs = harness();
    hostSeams.setEngineHost(stoppingHost(calls, (db) => db === theirs.ctx.db));
    hostSeams.setEngineHost(null);
    const other = await c.run(h.ctx, { name: c.on[0]!, payload }).then(() => null, (e: unknown) => e);
    assert.ok(other === null || !isKeptForRestart(other), `${name}: the daemon that keeps running is not held up by the other's stop`);
    const mine = await c.run(theirs.ctx, { name: c.on[0]!, payload }).then(() => null, (e: unknown) => e);
    assert.ok(mine !== null && isKeptForRestart(mine), `${name}: the stopping daemon's own events are kept`);
    setEngineStopping(false);
  }
});
