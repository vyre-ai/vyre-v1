// The hook runner's cursors (host/src/daemon/consumers.ts): a delivered event is stored at once; moving past events a consumer does not take is stored once at the end of a pass, and only
// when it moved. What a crash in the middle of a pass replays: for each consumer, at most the one event it was being handed (at least once), and the events it does not take since its last
// stored position, which it skips again. Nothing it was already handed is handed to it again.
import test from "node:test";
import assert from "node:assert/strict";
import { createHookRunner } from "../src/daemon/consumers.ts";
import type { ModuleHooks } from "../src/daemon/consumers.ts";
import type { Invoke } from "../src/invoke.ts";

const ev = (seq: number, type: string) => ({ id: `e${seq}`, seq, type, entity: null, entity_id: null, enc: 0, payload: new TextEncoder().encode("{}"), actor: "a", trace_id: "t".repeat(32), at: 1, depth: 0, run_id: null, device: null });
// 1..10: x at 3 and 8, the rest other
const EVENTS = Array.from({ length: 10 }, (_, i) => ev(i + 1, i + 1 === 3 || i + 1 === 8 ? "x" : "other"));

function runner(db: Map<string, number>, got: { name: string; seq: number }[], hang?: { at: number; then: Promise<void> }) {
  const writes: string[] = [];
  const consumer = (name: string, on: string[]) => ({ name, module: "m", on, run: async (_c: unknown, e: { seq: number }) => { got.push({ name, seq: e.seq }); if (hang && name === "m.x" && e.seq === hang.at) await hang.then; } });
  const hooks: ModuleHooks[] = [{ module: "m", periodic: [], consumers: [consumer("m.x", ["x"]), consumer("m.none", ["never"])] as never }];
  const holder: { r?: ReturnType<typeof createHookRunner> } = {};
  const invoke = (async (cap: string, input: unknown) => ({ status: "ok", output: await holder.r!.handlers[cap]!({} as never, input as never), traceId: "t" })) as unknown as Invoke;
  holder.r = createHookRunner({
    space: "spc_t", now: () => 1, invoke, emitsOf: () => [], capOf: () => undefined, warn: () => undefined, hooks,
    db: {
      all: (_sql: string, name?: unknown) => (db.has(String(name)) ? [{ seq: db.get(String(name)) }] : []),
      run: (sql: string, ...a: unknown[]) => { if (sql.startsWith("INSERT")) { db.set(String(a[0]), Number(a[1])); writes.push(`${String(a[0])}=${Number(a[1])}`); } return { changes: 1 }; },
    },
    log: { read: async ({ after = 0, limit = 200 }) => EVENTS.filter((e) => e.seq > after).slice(0, limit) as never, currentHead: async () => ({ seq: 0 }) },
  } as never);
  return { r: holder.r, writes };
}

test("a full pass stores each consumer's cursor at the head, writing a consumer that takes nothing once", async () => {
  const db = new Map<string, number>([["m.x", 0], ["m.none", 0]]);
  const got: { name: string; seq: number }[] = [];
  const { r, writes } = runner(db, got);
  await r.pump();
  assert.deepEqual(got, [{ name: "m.x", seq: 3 }, { name: "m.x", seq: 8 }]);
  assert.deepEqual(Object.fromEntries(db), { "m.x": 10, "m.none": 10 });
  assert.deepEqual(writes.filter((w) => w.startsWith("m.none")), ["m.none=10"], "one write for the consumer that took nothing");
  writes.length = 0;
  await r.pump();
  assert.deepEqual(writes, [], "a pass with nothing new writes nothing");
});

test("a crash in the middle of a pass replays at most the event in flight, and never one already handed over", async () => {
  const db = new Map<string, number>([["m.x", 0], ["m.none", 0]]);
  const got: { name: string; seq: number }[] = [];
  let release!: () => void;
  const { r } = runner(db, got, { at: 8, then: new Promise<void>((done) => { release = done; }) });
  const pass = r.pump();
  await new Promise((done) => setTimeout(done, 20));
  // the server stops here, while m.x is being handed event 8: what is stored is what a restart starts from
  const stored = Object.fromEntries(db);
  assert.deepEqual(stored, { "m.x": 3, "m.none": 0 }, "m.x stored the event it was handed (3); m.none's skipping is not stored yet");
  // the restart: a new runner on what was stored
  const after: { name: string; seq: number }[] = [];
  const again = runner(new Map(Object.entries(stored)), after);
  await again.r.pump();
  assert.deepEqual(after, [{ name: "m.x", seq: 8 }], "only the event in flight is handed over again; 3 is not");
  release(); await pass;
});
