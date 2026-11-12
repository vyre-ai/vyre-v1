// An event a consumer keeps for the next start (its service is stopping) and the hook runner's stop (host/src/daemon/consumers.ts).
//   kept    the consumer throws the host's kept error (routes/errors.ts keptForRestart). That is not a failed try: however many passes run while the server stops, the event is never skipped
//           (before, the fifth pass gave up on it, MAX_TRIES), the events after it wait behind it, and once the consumer takes it, it is handed over exactly once.
//   close   the server is stopping: the pass in flight ends after the event it is on, no consumer is handed another event, and a new runner on the stored cursor (the next start) delivers what
//           committed meanwhile at its first pass, in order, once.
import test from "node:test";
import assert from "node:assert/strict";
import { createHookRunner, MAX_TRIES } from "../src/daemon/consumers.ts";
import type { ModuleHooks } from "../src/daemon/consumers.ts";
import type { Invoke } from "../src/invoke.ts";
import { keptForRestart } from "../src/routes/errors.ts";

const ev = (seq: number, type: string) => ({ id: `e${seq}`, seq, type, entity: null, entity_id: null, enc: 0, payload: new TextEncoder().encode("{}"), actor: "a", trace_id: "t".repeat(32), at: 1, depth: 0, run_id: null, device: null });

function runner(db: Map<string, number>, events: ReturnType<typeof ev>[], take: (seq: number) => Promise<void> | void, warns: string[] = []) {
  const consumer = { name: "m.x", module: "m", on: ["x"], run: async (_c: unknown, e: { seq: number }) => { await take(e.seq); } };
  const hooks: ModuleHooks[] = [{ module: "m", periodic: [], consumers: [consumer] as never }];
  const holder: { r?: ReturnType<typeof createHookRunner> } = {};
  // the invoke pipeline throws a handler's HostError again as a HostError with the same shaped error, which is what the runner sees
  const invoke = (async (cap: string, input: unknown) => ({ status: "ok", output: await holder.r!.handlers[cap]!({} as never, input as never), traceId: "t" })) as unknown as Invoke;
  holder.r = createHookRunner({
    space: "spc_t", now: () => 1, invoke, emitsOf: () => [], capOf: () => undefined, warn: (msg) => { warns.push(msg); }, hooks,
    db: {
      all: (_sql: string, name?: unknown) => (db.has(String(name)) ? [{ seq: db.get(String(name)) }] : []),
      run: (sql: string, ...a: unknown[]) => { if (sql.startsWith("INSERT")) db.set(String(a[0]), Number(a[1])); return { changes: 1 }; },
    },
    log: { read: async ({ after = 0, limit = 200 }) => events.filter((e) => e.seq > after).slice(0, limit) as never, currentHead: async () => ({ seq: 0 }) },
  } as never);
  return holder.r;
}

test("an event kept for the next start is not a failed try: more passes than MAX_TRIES never skip it, later events wait behind it, and it is handed over once when the service is back", async () => {
  const db = new Map<string, number>([["m.x", 0]]);
  const events = [ev(1, "x"), ev(2, "x"), ev(3, "x")];
  let stopping = true;
  const got: number[] = [];
  const warns: string[] = [];
  const r = runner(db, events, (seq) => { if (stopping && seq === 2) throw keptForRestart("t".repeat(32)); got.push(seq); }, warns);
  for (let i = 0; i < MAX_TRIES + 3; i++) await r.pump();
  assert.deepEqual(got, [1], "event 2 is kept, and 3 waits behind it (the order in the chat holds)");
  assert.equal(db.get("m.x"), 1, "the stored cursor stays before the kept event");
  assert.deepEqual(warns.filter((w) => /failed|gave up/.test(w)), [], "a kept event is not a failure: no 'failed' or 'gave up' line");
  // the runner is not closing here (no stop), so the keep is said once, as a warning: in a real daemon a service only stops after the runner has closed, and this consumer's queue now waits
  assert.deepEqual(warns, ["a consumer kept an event for the next start while the server is running: its later events wait behind it"]);
  stopping = false;
  await r.pump();
  assert.deepEqual(got, [1, 2, 3], "the service is back: the kept event and the ones after it are handed over, in order, once");
  await r.pump();
  assert.deepEqual(got, [1, 2, 3]);
});

test("the next start delivers an event the last one kept: a new runner on the stored cursor hands it over at its first pass, once", async () => {
  const db = new Map<string, number>([["m.x", 0]]);
  const events = [ev(1, "x"), ev(2, "x")];
  const first = runner(db, events, (seq) => { if (seq === 2) throw keptForRestart("t".repeat(32)); });
  for (let i = 0; i < MAX_TRIES + 1; i++) await first.pump();
  const got: number[] = [];
  const next = runner(new Map(db), events, (seq) => { got.push(seq); });
  await next.pump();
  assert.deepEqual(got, [2]);
});

test("a kept event during a stop is not a warning: the runner is closing, so it is the expected case", async () => {
  const db = new Map<string, number>([["m.x", 0]]);
  const events = [ev(1, "x")];
  const warns: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((done) => { release = done; });
  let first = true;
  const r = runner(db, events, async () => { if (first) { first = false; await held; throw keptForRestart("t".repeat(32)); } }, warns);
  const pass = r.pump();
  await new Promise((done) => setTimeout(done, 10));
  const closed = r.close();
  release();
  await closed; await pass;
  assert.deepEqual(warns, []);
  assert.equal(db.get("m.x"), 0, "the kept event stays for the next start");
});

test("close with a bound lets a hanging consumer go: close answers at the bound, nothing is stored after it, and the next start hands the same event over once", async () => {
  const db = new Map<string, number>([["m.x", 0]]);
  const events = [ev(1, "x"), ev(2, "x")];
  const warns: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((done) => { release = done; });
  const got: number[] = [];
  const r = runner(db, events, async (seq) => { got.push(seq); if (seq === 2) await held; }, warns);
  const pass = r.pump();
  await new Promise((done) => setTimeout(done, 10));
  const t0 = Date.now();
  await r.close(50);
  assert.ok(Date.now() - t0 < 1_000, "close answered at its bound");
  assert.deepEqual(warns, ["a consumer was still running when the server stopped; it is handed the same event again at the next start"]);
  release(); await pass;
  assert.equal(db.get("m.x"), 1, "event 2 finished after the bound: its cursor was not written");
  await r.close(50);   // a second close (the closer after stop) answers at once
  const after: number[] = [];
  const next = runner(new Map(db), events, (seq) => { after.push(seq); });
  await next.pump();
  assert.deepEqual(after, [2], "the next start hands event 2 over again, once");
});

test("a stop: the pass in flight ends after the event it is on, nothing is handed over after close(), and the next start delivers what committed meanwhile, in order, once", async () => {
  const db = new Map<string, number>([["m.x", 0]]);
  const events = [ev(1, "x"), ev(2, "x"), ev(3, "x")];
  const got: number[] = [];
  let release!: () => void;
  const held = new Promise<void>((done) => { release = done; });
  const r = runner(db, events, async (seq) => { got.push(seq); if (seq === 1) await held; });
  const pass = r.pump();
  await new Promise((done) => setTimeout(done, 10));
  const closed = r.close();
  release();
  await closed; await pass;
  assert.deepEqual(got, [1], "event 1 was in flight and finishes; 2 and 3 are left for the next start");
  // an event committed during the stop, and the pumps a commit makes then, hand nothing over
  events.push(ev(4, "x"));
  await r.pump();
  assert.deepEqual(got, [1]);
  assert.equal(db.get("m.x"), 1, "the stored cursor is where the stop left it");
  const after: number[] = [];
  const next = runner(new Map(db), events, (seq) => { after.push(seq); });
  await next.pump();
  assert.deepEqual(after, [2, 3, 4], "the next start hands over everything from the stored cursor, in order, once");
});
