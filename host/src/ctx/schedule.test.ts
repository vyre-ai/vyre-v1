// ctx.schedule over a real SQLite connection: due time, restart, retry with backoff, dead letters, cancel, crash lease, bad input.
import test from "node:test";
import assert from "node:assert/strict";
import { openRecordStore } from "../../../kernel/src/store/records.ts";
import { HostError } from "../routes/errors.ts";
import type { RawDb } from "./db.ts";
import { parseWhen, ScheduleQueue } from "./schedule.ts";
import type { ScheduledCall, ScheduleSeed } from "./schedule.ts";

const T0 = 1_760_000_000_000;
const seed: ScheduleSeed = { space: "spc_1", principal: { kind: "person", id: "usr_dana" }, trace: { traceId: "b".repeat(32) } };

function rig(o: { maxTries?: number; failFor?: number } = {}) {
  const db: RawDb = openRecordStore({ path: ":memory:", space: "sp_sched" }).host.tx;
  const clock = { t: T0 };
  const ran: ScheduledCall[] = [];
  const errors: { final: boolean; message: string }[] = [];
  let failsLeft = o.failFor ?? 0;
  const make = (): ScheduleQueue => new ScheduleQueue({
    db, now: () => clock.t, maxTries: o.maxTries ?? 5, backoffMs: (n) => n * 1000,
    run: async (c) => { ran.push(c); if (failsLeft > 0) { failsLeft--; throw new Error("boom"); } },
    onError: (_c, e, final) => errors.push({ final, message: e instanceof Error ? e.message : String(e) }),
  });
  return { db, clock, ran, errors, q: make(), make };
}

const bad = (code: string) => (e: unknown): boolean => e instanceof HostError && e.error.code === code;

test("parseWhen reads epoch milliseconds, ISO times and delays, and refuses the rest", () => {
  assert.equal(parseWhen(T0 + 5, T0), T0 + 5);
  assert.equal(parseWhen("+30s", T0), T0 + 30_000);
  assert.equal(parseWhen("in 2h", T0), T0 + 7_200_000);
  assert.equal(parseWhen("5m", T0), T0 + 300_000);
  assert.equal(parseWhen("1.5h", T0), T0 + 5_400_000);
  assert.equal(parseWhen("2026-10-25T10:00:00Z", T0), Date.parse("2026-10-25T10:00:00Z"));
  for (const x of [-1, Number.NaN, Number.POSITIVE_INFINITY, "soon", "", "12", "+5 weeks", "yesterday"]) {
    assert.throws(() => parseWhen(x, T0), bad("validation.bad_input"), String(x));
  }
});

test("a job waits for its time, then runs once as the principal who scheduled it", async () => {
  const r = rig();
  const id = await r.q.forCtx({ ...seed, actingFor: "usr_boss" })("+30s", "gate.expire", { taskId: "tsk_1" });
  assert.match(id, /^sch_[0-9a-f]{32}$/);
  assert.equal(await r.q.tick(), 0, "not due yet");
  r.clock.t += 29_999;
  assert.equal(await r.q.tick(), 0, "one millisecond early");
  r.clock.t += 1;
  assert.equal(await r.q.tick(), 1);
  assert.equal(r.ran.length, 1);
  assert.deepEqual(r.ran[0], {
    id, space: "spc_1", cap: "gate.expire", input: { taskId: "tsk_1" }, principal: { kind: "person", id: "usr_dana" }, actingFor: "usr_boss", traceId: "b".repeat(32), tries: 0,
  });
  assert.equal(await r.q.tick(), 0, "a finished job is gone");
  assert.deepEqual(r.q.counts(), { pending: 0, dead: 0 });
});

test("a job scheduled by a call with no trace carries none", async () => {
  const r = rig();
  const { trace: _t, ...bare } = seed;
  await r.q.forCtx(bare)(T0, "gate.expire", {});
  await r.q.tick();
  assert.equal("traceId" in r.ran[0]!, false);
});

test("jobs run oldest first and only the due ones", async () => {
  const r = rig();
  const add = r.q.forCtx(seed);
  await add(T0 + 3000, "a.third", {});
  await add(T0 + 1000, "a.first", {});
  await add(T0 + 2000, "a.second", {});
  await add(T0 + 99_000, "a.later", {});
  r.clock.t = T0 + 3000;
  assert.equal(await r.q.tick(), 3);
  assert.deepEqual(r.ran.map((c) => c.cap), ["a.first", "a.second", "a.third"]);
  assert.equal(r.q.counts().pending, 1);
});

test("jobs survive a restart: a new queue on the same database runs them", async () => {
  const r = rig();
  await r.q.forCtx(seed)("+1m", "gate.expire", { n: 1 });
  const again = r.make();
  r.clock.t += 60_000;
  assert.equal(await again.tick(), 1);
  assert.equal(r.ran[0]!.cap, "gate.expire");
});

test("a failure retries after the backoff, with the try count, and then succeeds", async () => {
  const r = rig({ failFor: 1 });
  await r.q.forCtx(seed)(T0, "mail.sync", {});
  assert.equal(await r.q.tick(), 1);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0]!.final, false);
  assert.deepEqual(r.q.counts(), { pending: 1, dead: 0 });
  r.clock.t += 999;
  assert.equal(await r.q.tick(), 0, "inside the backoff");
  r.clock.t += 1;
  assert.equal(await r.q.tick(), 1);
  assert.equal(r.ran.length, 2);
  assert.equal(r.ran[1]!.tries, 1);
  assert.deepEqual(r.q.counts(), { pending: 0, dead: 0 });
});

test("after maxTries failures a job is parked as dead and never runs again", async () => {
  const r = rig({ failFor: 99, maxTries: 2 });
  await r.q.forCtx(seed)(T0, "mail.sync", {});
  await r.q.tick();
  r.clock.t += 1000;
  await r.q.tick();
  assert.deepEqual(r.errors.map((e) => e.final), [false, true]);
  assert.deepEqual(r.q.counts(), { pending: 0, dead: 1 });
  r.clock.t += 3_600_000;
  assert.equal(await r.q.tick(), 0);
  assert.equal(r.ran.length, 2);
});

test("cancel removes a waiting job and nothing else", async () => {
  const r = rig();
  const id = await r.q.forCtx(seed)("+1m", "gate.expire", {});
  assert.equal(r.q.cancel("sch_nope"), false);
  assert.equal(r.q.cancel(id), true);
  assert.equal(r.q.cancel(id), false);
  r.clock.t += 120_000;
  assert.equal(await r.q.tick(), 0);
});

test("a claim left by a crashed host is taken again after the lease", async () => {
  const r = rig();
  const id = await r.q.forCtx(seed)(T0, "gate.expire", {});
  r.db.run("UPDATE host_schedule SET state = 'running', claimed_at = ? WHERE id = ?", T0, id);
  r.clock.t = T0 + 119_999;
  assert.equal(await r.q.tick(), 0, "the first host may still be running it");
  r.clock.t = T0 + 120_000;
  assert.equal(await r.q.tick(), 1);
  assert.equal(r.ran.length, 1);
});

test("two ticks at once share one pass", async () => {
  const r = rig();
  await r.q.forCtx(seed)(T0, "gate.expire", {});
  const a = r.q.tick();
  const b = r.q.tick();
  assert.equal(a, b);
  assert.equal(await a, 1);
  assert.equal(r.ran.length, 1);
});

test("bad input is refused before anything is stored", async () => {
  const r = rig();
  const add = r.q.forCtx(seed);
  await assert.rejects(add("later", "gate.expire", {}), bad("validation.bad_input"));
  await assert.rejects(add("+1m", "NotACap", {}), bad("validation.bad_input"));
  await assert.rejects(add("+1m", "nodots", {}), bad("validation.bad_input"));
  const cyc: Record<string, unknown> = {};
  cyc["self"] = cyc;
  await assert.rejects(add("+1m", "a.b", cyc), bad("validation.bad_input"));
  await assert.rejects(add("+1m", "a.b", { big: "x".repeat(70_000) }), bad("validation.too_large"));
  assert.deepEqual(r.q.counts(), { pending: 0, dead: 0 });
});

test("start and stop drive the ticks on a timer", async () => {
  const r = rig();
  await r.q.forCtx(seed)(T0, "gate.expire", {});
  r.q.start(5);
  r.q.start(5);
  for (let i = 0; i < 100 && r.ran.length === 0; i++) await new Promise((res) => setTimeout(res, 5));
  r.q.stop();
  assert.equal(r.ran.length, 1);
});

// P-H_01 final run: each named test shows its own ok line in the run on the last commit.
