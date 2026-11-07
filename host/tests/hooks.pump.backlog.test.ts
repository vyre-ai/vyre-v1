// A large hook backlog must not hold the daemon's event loop (rc.22: hooks.pump took 21 to 23 seconds and every request waited behind it).
import test from "node:test";
import assert from "node:assert/strict";
import { createHookRunner } from "../src/daemon/consumers.ts";
import type { ModuleHooks } from "../src/daemon/consumers.ts";
import { startLoopLag } from "../src/scheduler/looplag.ts";
import type { Invoke } from "../src/invoke.ts";

const TOTAL = 20_000;
const events = Array.from({ length: TOTAL }, (_, i) => ({ id: `e${i}`, seq: i + 1, type: i % 3 === 0 ? "other" : "x", entity: null, entity_id: null, enc: 0, payload: new TextEncoder().encode("{}"), actor: "a", trace_id: "t".repeat(32), at: 1, depth: 0, run_id: null, device: null }));

test("a 20,000 event backlog is delivered in full while the event loop never stalls past 200 ms", async () => {
  let delivered = 0;
  const hooks: ModuleHooks[] = [{ module: "m", periodic: [], consumers: [{ name: "m.c", module: "m", on: ["x"], run: () => { delivered++; const end = performance.now() + 0.05; while (performance.now() < end) { /* the consumer's own work */ } } }] }];
  const cursors = new Map<string, number>();
  const holder: { r?: ReturnType<typeof createHookRunner> } = {};
  const invoke = (async (cap: string, input: unknown) => ({ status: "ok", output: await holder.r!.handlers[cap]!({} as never, input as never), traceId: "t" })) as unknown as Invoke;
  holder.r = createHookRunner({
    space: "spc_t", now: () => 1, invoke, emitsOf: () => [], capOf: () => undefined, warn: () => undefined, hooks,
    db: { all: (_sql: string, name?: unknown) => (cursors.has(String(name)) ? [{ seq: cursors.get(String(name)) }] : []), run: (sql: string, ...a: unknown[]) => { if (sql.startsWith("INSERT")) cursors.set(String(a[0]), Number(a[1])); return { changes: 1 }; } },
    log: { read: async ({ after = 0, limit = 200 }) => events.filter((e) => e.seq > after).slice(0, limit) as never, currentHead: async () => ({ seq: 0 }) },
  } as never);
  await holder.r.start();
  cursors.set("m.c", 0);
  const lag = startLoopLag();
  await holder.r.pump();
  const got = lag.take();
  lag.stop();
  assert.equal(delivered, events.filter((e) => e.type === "x").length);
  assert.ok(got.maxMs <= 200, `the pump held the loop ${got.maxMs} ms`);
});
