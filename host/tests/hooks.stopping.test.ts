// A long consumer (a fill of a computed field) looks at the stop flag between its slices: a normal stop does not wait for the whole job, the event is kept, and the next start hands it over again.
import test from "node:test";
import assert from "node:assert/strict";
import { createHookRunner } from "../src/daemon/consumers.ts";
import type { ModuleHooks } from "../src/daemon/consumers.ts";
import type { Invoke } from "../src/invoke.ts";
import { keptForRestart } from "../src/routes/errors.ts";

const ev = (seq: number, type: string) => ({
  id: `e${seq}`,
  seq,
  type,
  entity: null,
  entity_id: null,
  enc: 0,
  payload: new TextEncoder().encode("{}"),
  actor: "a",
  trace_id: "t".repeat(32),
  at: 1,
  depth: 0,
  run_id: null,
  device: null,
});

function runner(
  db: Map<string, number>,
  events: ReturnType<typeof ev>[],
  take: (seq: number, stopping?: () => boolean) => Promise<void> | void,
  warns: string[] = [],
) {
  const consumer = {
    name: "m.x",
    module: "m",
    on: ["x"],
    run: async (_c: unknown, e: { seq: number; stopping?: () => boolean }) => {
      await take(e.seq, e.stopping);
    },
  };
  const hooks: ModuleHooks[] = [{ module: "m", periodic: [], consumers: [consumer] as never }];
  const holder: { r?: ReturnType<typeof createHookRunner> } = {};
  // the invoke pipeline throws a handler's HostError again as a HostError with the same shaped error, which is what the runner sees
  const invoke = (async (cap: string, input: unknown) => ({
    status: "ok",
    output: await holder.r!.handlers[cap]!({} as never, input as never),
    traceId: "t",
  })) as unknown as Invoke;
  holder.r = createHookRunner({
    space: "spc_t",
    now: () => 1,
    invoke,
    emitsOf: () => [],
    capOf: () => undefined,
    warn: (msg) => {
      warns.push(msg);
    },
    hooks,
    db: {
      all: (_sql: string, name?: unknown) => (db.has(String(name)) ? [{ seq: db.get(String(name)) }] : []),
      run: (sql: string, ...a: unknown[]) => {
        if (sql.startsWith("INSERT")) db.set(String(a[0]), Number(a[1]));
        return { changes: 1 };
      },
    },
    log: {
      read: async ({ after = 0, limit = 200 }) => events.filter((e) => e.seq > after).slice(0, limit) as never,
      currentHead: async () => ({ seq: 0 }),
    },
  } as never);
  return holder.r;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const JOB_SLICES = 400; // 400 slices of 5 ms: 2 s if nothing stops it

test("a normal stop does not wait for a whole fill: the consumer sees the flag at its next slice, the stop answers in a few slices, and the next start gives it the same event again", async () => {
  const db = new Map<string, number>([["m.x", 0]]);
  const events = [ev(1, "x")];
  let done = 0;
  let sawStop = false;
  const first = runner(db, events, async (_seq, stopping) => {
    for (; done < JOB_SLICES; done++) {
      if (stopping?.()) {
        sawStop = true;
        throw keptForRestart("t".repeat(32));
      }
      await sleep(5);
    }
  });
  const pass = first.pump();
  await sleep(60);
  const t0 = performance.now();
  await first.close(5_000);
  const took = Math.round(performance.now() - t0);
  await pass;
  assert.ok(sawStop, "the consumer saw the stop flag");
  assert.ok(done < JOB_SLICES / 4, `the fill stopped partway (${done} of ${JOB_SLICES} slices)`);
  assert.ok(took < 200, `the stop answered in ${took} ms, not after the whole fill (about ${JOB_SLICES * 5} ms)`);
  assert.equal(db.get("m.x"), 0, "the cursor stayed before the event");
  // the next start: a new runner on the stored cursor hands the same event over, and this time nothing stops it
  let again = 0;
  const next = runner(new Map(db), events, async (_seq, stopping) => {
    for (let i = 0; i < 10; i++) {
      assert.equal(stopping?.(), false, "a running server does not say it is stopping");
      again++;
    }
  });
  await next.pump();
  assert.equal(again, 10, "the next start delivered the event once, and the fill ran");
});
