// pool.drop (lane l-sessions): the idle CLI sessions that hold one thread are closed, so its next turn opens a new engine session; busy ones, other threads and API sessions are left alone.
import test from "node:test";
import assert from "node:assert/strict";
import { createPool } from "../src/pool/index.ts";
import type { PoolDriver, PoolSpec } from "../src/pool/index.ts";
import type { EngineSession } from "../src/turn-engine/index.ts";

function driver(id: string, kind: "api" | "cli"): PoolDriver & { closed: number } {
  const d = {
    id, kind, closed: 0,
    async open(): Promise<EngineSession> {
      return { warm: true, async *send() { yield { type: "done" as const }; }, sendToolResult() {}, inject() {}, async cancel() {}, async close() { d.closed++; } };
    },
  };
  return d;
}
const spec = (driverId: string, thread: string): PoolSpec => ({
  key: { driver: driverId, accountRef: "#acct", model: "m", sandboxId: null, mcpProfile: "agt_intake|usr_dana" }, threadId: thread, person: "usr_dana",
  session: { threadId: thread, agent: { id: "agt_intake", mode: "lead" }, asker: "usr_dana", turnId: "trn_1", traceId: "a".repeat(32) },
});

test("drop closes the idle CLI sessions of that thread only, and the thread's next acquire opens a new one", async () => {
  const cli = driver("claude_code", "cli");
  const api = driver("anthropic", "api");
  const pool = createPool({ placement: "host", drivers: [cli, api], maxPerPerson: 8 });
  const a = await pool.acquire(spec("claude_code", "thr_a"));
  await pool.release(a);
  const b = await pool.acquire(spec("claude_code", "thr_b"));
  await pool.release(b);
  const busy = await pool.acquire(spec("claude_code", "thr_a"));   // the warm one, now busy
  const second = await pool.acquire(spec("claude_code", "thr_a")); // a second one for the same thread, opened and released idle
  await pool.release(second);
  const x = await pool.acquire(spec("anthropic", "thr_a"));
  await pool.release(x);

  assert.equal(await pool.drop("thr_a"), 1, "only the idle CLI session of thr_a");
  assert.equal(cli.closed, 1);
  assert.equal(api.closed, 0, "an API session holds no thread");
  await pool.release(busy);
  const again = await pool.acquire(spec("claude_code", "thr_a"));
  assert.equal(again.session, busy.session, "the busy one was left and is warm again");
  await pool.release(again);
  assert.equal(await pool.drop("thr_a"), 1);
  const fresh = await pool.acquire(spec("claude_code", "thr_a"));
  assert.equal(fresh.warm, false, "the thread's next acquire opens a new session");
  const other = await pool.acquire(spec("claude_code", "thr_b"));
  assert.equal(other.warm, true, "thr_b kept its own");
  await pool.close();
});
