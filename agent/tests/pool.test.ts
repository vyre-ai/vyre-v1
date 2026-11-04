// The warm engine pool (ARCH 6.6): keys, hits and misses, hints, caps and least-recently-used eviction, idle time, CLI sessions bound to a thread, and the pool behind the turn engine.
import test from "node:test";
import assert from "node:assert/strict";
import { createPool, keyString, poolOpenSession, warmHint } from "../src/pool/index.ts";
import type { PoolDriver, PoolKey, PoolSpec } from "../src/pool/index.ts";
import { createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";
import type { EngineSession, SessionSpec } from "../src/turn-engine/index.ts";
import type { ScriptedProvider } from "../src/turn-engine/index.ts";
import { manualClock } from "../src/turn-engine/harness.ts";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Fake extends PoolDriver { opens: number; provider: ScriptedProvider; fail: number }

/** A driver whose sessions are scripted sessions: `provider.sessions` shows which were opened, cancelled and closed. */
function driver(id: string, kind: "api" | "cli" = "api", o: { openMs?: number; fail?: number } = {}): Fake {
  const provider = scriptedProvider({ script: [{ type: "text", text: "ok" }, { type: "done" }] });
  const d: Fake = {
    id, kind, opens: 0, provider, fail: o.fail ?? 0,
    async open(spec: SessionSpec): Promise<EngineSession> {
      d.opens++;
      if (o.openMs) await sleep(o.openMs);
      if (d.fail > 0) { d.fail--; throw new Error("the provider is down"); }
      return provider.openSession(spec);
    },
  };
  return d;
}

const key = (over: Partial<PoolKey> = {}): PoolKey => ({ driver: "anthropic", accountRef: "#Team_Anthropic_Key", model: "claude-sonnet-5-5", sandboxId: null, mcpProfile: "default", ...over });
const spec = (over: Partial<PoolKey> = {}, o: { thread?: string; person?: string } = {}): PoolSpec => {
  const thread = o.thread ?? "thr_a";
  const person = o.person ?? "usr_dana";
  return { key: key(over), threadId: thread, person, session: { threadId: thread, agent: { id: "agt_intake", mode: "lead" }, asker: person } };
};

test("the same engine is a hit, and the session handed out is the same warm one", async () => {
  const d = driver("anthropic");
  const pool = createPool({ placement: "device", drivers: [d] });
  const first = await pool.acquire(spec());
  assert.deepEqual([first.warm, first.waited], [false, false]);
  await pool.release(first);
  const second = await pool.acquire(spec());
  assert.equal(second.warm, true);
  assert.equal(second.session, first.session);
  assert.equal(d.opens, 1);
  const status = pool.status().sessions.find((s) => s.driver === "anthropic");
  assert.deepEqual([status?.hits, status?.misses, status?.busy, status?.warm], [1, 1, 1, 0]);
  await pool.release(second);
  assert.equal(pool.status().totalWarm, 1);
});

test("a different account, model, sandbox, MCP profile or person is a different engine", async () => {
  const d = driver("anthropic");
  const pool = createPool({ placement: "device", drivers: [d], maxPerDriver: 10 });
  await pool.release(await pool.acquire(spec()));
  for (const s of [spec({ accountRef: "#Other" }), spec({ model: "claude-opus-4" }), spec({ sandboxId: "vyre-sbx-dana" }), spec({ mcpProfile: "plan" }), spec({}, { person: "usr_sam" })]) {
    const l = await pool.acquire(s);
    assert.equal(l.warm, false, keyString(s.key));
    await pool.release(l);
  }
  assert.equal(d.opens, 6);
  assert.equal(keyString(key()), keyString(key()));
  assert.notEqual(keyString(key()), keyString(key({ model: "x" })));
});

test("a hint opens the engine ahead of the first message, once, and the acquire after it is warm", async () => {
  const d = driver("anthropic", "api", { openMs: 30 });
  const pool = createPool({ placement: "device", drivers: [d] });
  pool.hint(spec());
  pool.hint(spec());
  await pool.settled();
  assert.equal(d.opens, 1, "two hints for one engine open one session");
  const l = await pool.acquire(spec());
  assert.deepEqual([l.warm, l.waited], [true, false]);
  assert.equal(d.opens, 1);
  assert.equal(pool.status().sessions[0]?.misses, 0, "a resumed chat never cold-starts its engine");
});

test("an acquire that arrives while the hint is still opening waits for it and opens nothing more", async () => {
  const d = driver("anthropic", "api", { openMs: 40 });
  const pool = createPool({ placement: "device", drivers: [d] });
  pool.hint(spec());
  const l = await pool.acquire(spec());
  assert.deepEqual([l.warm, l.waited], [true, true]);
  assert.equal(d.opens, 1);
  assert.equal(pool.status().sessions[0]?.hits, 1);
});

test("two acquires at once for a cold engine open one session each, not one shared", async () => {
  const d = driver("anthropic", "api", { openMs: 20 });
  const pool = createPool({ placement: "device", drivers: [d] });
  const [a, b] = await Promise.all([pool.acquire(spec()), pool.acquire(spec())]);
  assert.notEqual(a.session, b.session, "a session serves one turn at a time");
  assert.equal(d.opens, 2);
  await pool.release(a);
  await pool.release(b);
  assert.equal(pool.status().totalWarm, 2);
});

test("a hint that fails is no error; the acquire opens its own, and an acquire that fails says why", async () => {
  const d = driver("anthropic", "api", { fail: 1 });
  const pool = createPool({ placement: "device", drivers: [d] });
  pool.hint(spec());
  await pool.settled();
  assert.equal(pool.status().totalWarm, 0);
  const l = await pool.acquire(spec());
  assert.equal(l.warm, false);
  const broken = driver("anthropic", "api", { fail: 5 });
  const p2 = createPool({ placement: "device", drivers: [broken] });
  await assert.rejects(p2.acquire(spec()), /provider is down/);
  assert.equal(p2.status().totalBusy, 0);
});

test("a CLI session holds one thread; an API session serves any", async () => {
  const cli = driver("claude_code", "cli");
  const api = driver("anthropic", "api");
  const pool = createPool({ placement: "device", drivers: [cli, api] });
  const a = await pool.acquire(spec({ driver: "claude_code" }, { thread: "thr_a" }));
  await pool.release(a);
  const b = await pool.acquire(spec({ driver: "claude_code" }, { thread: "thr_b" }));
  assert.notEqual(b.session, a.session, "another thread's transcript is not loaded in the first CLI process");
  await pool.release(b);
  const again = await pool.acquire(spec({ driver: "claude_code" }, { thread: "thr_a" }));
  assert.equal(again.session, a.session);
  assert.equal(cli.opens, 2);

  const x = await pool.acquire(spec({}, { thread: "thr_a" }));
  await pool.release(x);
  const y = await pool.acquire(spec({}, { thread: "thr_b" }));
  assert.equal(y.session, x.session, "an API client is not tied to a thread");
});

test("a device keeps four sessions per driver; the fifth takes the place of the least recently used idle one", async () => {
  let clock = 1_000;
  const d = driver("anthropic");
  const pool = createPool({ placement: "device", drivers: [d], now: () => clock++ });
  for (let i = 1; i <= 4; i++) await pool.release(await pool.acquire(spec({ model: `m${i}` })));
  assert.equal(pool.status().sessions[0]?.warm, 4);
  assert.equal(pool.status().sessions[0]?.max, 4);
  // m1 is the oldest; touching m2 makes m1 still the oldest.
  await pool.release(await pool.acquire(spec({ model: "m2" })));
  await pool.release(await pool.acquire(spec({ model: "m5" })));
  const closed = d.provider.sessions.map((s) => s.closed);
  assert.deepEqual(closed, [true, false, false, false, false], "m1 was closed");
  const s = pool.status().sessions[0];
  assert.deepEqual([s?.warm, s?.evictions], [4, 1]);
  assert.equal((await pool.acquire(spec({ model: "m1" }))).warm, false);
});

test("on the host the cap is two per driver for each person, and 24 in all", async () => {
  const d = driver("anthropic");
  const pool = createPool({ placement: "host", drivers: [d] });
  const grab = async (person: string, model: string): Promise<void> => { await pool.release(await pool.acquire(spec({ model }, { person }))); };
  await grab("usr_dana", "m1");
  await grab("usr_dana", "m2");
  await grab("usr_sam", "m1");
  await grab("usr_sam", "m2");
  await grab("usr_dana", "m3");
  assert.equal(d.provider.sessions.filter((s) => s.closed).length, 1);
  assert.equal(d.provider.sessions[0]?.closed, true, "dana's oldest went, sam's were left alone");
  assert.equal(d.provider.sessions[2]?.closed, false);
  assert.equal(pool.status().sessions[0]?.warm, 4);

  const big = createPool({ placement: "host", drivers: [driver("anthropic")], maxPerPerson: 100 });
  for (let i = 0; i < 30; i++) await big.release(await big.acquire(spec({ model: `m${i}` }, { person: `usr_${i}` })));
  assert.equal(big.status().totalWarm, 24, "the total cap is 24");
});

test("a session that is in use is never taken away; a new one over the cap lasts one turn", async () => {
  const d = driver("anthropic");
  const pool = createPool({ placement: "device", drivers: [d], maxPerDriver: 1 });
  const held = await pool.acquire(spec({ model: "m1" }));
  const extra = await pool.acquire(spec({ model: "m2" }));
  assert.equal(pool.status().sessions[0]?.busy, 2, "both are running a turn");
  assert.equal(d.provider.sessions[0]?.closed, false);
  await pool.release(extra);
  assert.equal(d.provider.sessions[1]?.closed, true, "the one over the cap is closed when its turn ends");
  await pool.release(held);
  assert.equal(d.provider.sessions[0]?.closed, false);
  assert.equal(pool.status().totalWarm, 1);
});

test("an idle session is closed after ten minutes, and a release with reuse false closes at once", async () => {
  const clock = manualClock();
  const d = driver("anthropic");
  const pool = createPool({ placement: "device", drivers: [d], now: clock.now });
  await pool.release(await pool.acquire(spec()));
  clock.advance(9 * 60_000);
  assert.equal(await pool.sweep(), 0);
  assert.equal(d.provider.sessions[0]?.closed, false);
  clock.advance(60_000 + 1);
  assert.equal(await pool.sweep(), 1);
  assert.equal(d.provider.sessions[0]?.closed, true);
  assert.equal(pool.status().totalWarm, 0);

  const next = await pool.acquire(spec());
  assert.equal(next.warm, false);
  await pool.release(next, { reuse: false });
  assert.equal(d.provider.sessions[1]?.closed, true);

  const third = await pool.acquire(spec());
  await pool.release(third);
  clock.advance(11 * 60_000);
  assert.equal((await pool.acquire(spec())).warm, false, "acquire sweeps first: an expired session is not handed out");
});

test("status lists every driver, with warm, busy, hits, misses and evictions", async () => {
  const pool = createPool({ placement: "device", drivers: [driver("anthropic"), driver("codex", "cli")] });
  assert.deepEqual(pool.status(), {
    sessions: [
      { driver: "anthropic", warm: 0, busy: 0, max: 4, hits: 0, misses: 0, evictions: 0 },
      { driver: "codex", warm: 0, busy: 0, max: 4, hits: 0, misses: 0, evictions: 0 },
    ],
    totalWarm: 0, totalBusy: 0,
  });
  await assert.rejects(pool.acquire(spec({ driver: "nobody" })), /no driver nobody/);
});

test("closing the pool closes every session and refuses new work", async () => {
  const d = driver("anthropic", "api", { openMs: 20 });
  const pool = createPool({ placement: "device", drivers: [d] });
  await pool.release(await pool.acquire(spec({ model: "m1" })));
  pool.hint(spec({ model: "m2" }));
  await pool.close();
  assert.ok(d.provider.sessions.every((s) => s.closed));
  assert.equal(pool.status().totalWarm, 0);
  await assert.rejects(pool.acquire(spec()), /closed/);
  pool.hint(spec({ model: "m3" }));
  assert.equal(d.opens, 2, "a hint after close opens nothing");
});

test("behind the turn engine a second turn runs on the warm session, and a cancelled one is not given back warm", async () => {
  const d = driver("anthropic");
  const pool = createPool({ placement: "device", drivers: [d] });
  const resolve = (s: SessionSpec): PoolSpec => ({ key: key({ model: s.agent.model ?? "m" }), threadId: s.threadId, person: s.asker, session: s });
  const engine = createTurnEngine({ holder: "device:d1", openSession: poolOpenSession(pool, resolve) });
  engine.openThread({ id: "T", kind: "chat", starter: "usr_dana", agents: [{ id: "agt_intake", mode: "lead", model: "claude-sonnet-5-5" }] });
  engine.receive({ threadId: "T", author: { kind: "person", id: "usr_dana" }, body: "one" });
  await engine.idle("T");
  engine.receive({ threadId: "T", author: { kind: "person", id: "usr_dana" }, body: "two" });
  await engine.idle("T");
  assert.equal(d.provider.sessions.length, 1, "both turns ran on one session");
  assert.deepEqual(engine.turns("T").map((t) => t.state), ["completed", "completed"]);
  assert.equal(d.provider.sessions[0]?.closed, false, "the engine's close gave it back to the pool, still open");
  assert.equal(pool.status().sessions[0]?.hits, 1);

  // A turn that is cancelled leaves its stream half read: that session is closed, and the next turn starts a fresh one.
  const slow = driver("anthropic");
  const hold = scriptedProvider({ script: [{ type: "text", text: "a" }, { type: "done" }], beforeEvent: async () => { await sleep(500); } });
  slow.open = async (s) => { slow.opens++; return hold.openSession(s); };
  const p2 = createPool({ placement: "device", drivers: [slow] });
  const e2 = createTurnEngine({ holder: "device:d1", openSession: poolOpenSession(p2, resolve) });
  e2.openThread({ id: "T2", kind: "chat", starter: "usr_dana", agents: [{ id: "agt_intake", mode: "lead", model: "claude-sonnet-5-5" }] });
  e2.receive({ threadId: "T2", author: { kind: "person", id: "usr_dana" }, body: "go" });
  await sleep(30);
  await e2.stop("T2");
  await e2.idle("T2");
  assert.equal(hold.sessions[0]?.closed, true);
  assert.equal(p2.status().totalWarm, 0);
});

test("a warm hint never throws and never waits", async () => {
  const d = driver("anthropic", "api", { openMs: 20 });
  const pool = createPool({ placement: "device", drivers: [d] });
  const resolve = (s: SessionSpec): PoolSpec => ({ key: key(), threadId: s.threadId, person: s.asker, session: s });
  const s: SessionSpec = { threadId: "thr_a", agent: { id: "agt_intake", mode: "lead" }, asker: "usr_dana" };
  const t0 = performance.now();
  warmHint(pool, resolve, s);
  assert.ok(performance.now() - t0 < 10);
  warmHint(pool, () => { throw new Error("no such agent"); }, s);
  warmHint(pool, (x) => ({ ...resolve(x), key: key({ driver: "unknown" }) }), s);
  await pool.settled();
  assert.equal(d.opens, 1);
  assert.equal(pool.status().totalWarm, 1);
});
