// One access sync of the daemon (host/src/daemon/access.ts createAccessRun, review 2 of #905, findings A and B):
//   A  a push made while the run reads the log is not lost: the next run folds it (before, the run cleared what was pushed after its read, and a seq -1 record type pushed then never reached access)
//   B  a log read that fails is a sync failure: tried once more, logged, the snapshot marked stale, a retry armed, and after adoption the caller does not get an error
import test from "node:test";
import assert from "node:assert/strict";
import { createAccessRun } from "../src/daemon/access.ts";
import { AccessSnapshot } from "../../kernel/src/authorize/index.ts";

type Ev = { seq: number; type: string; payload: unknown };
const enc = (o: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(o));

function rig(o: { read?: (after: number, limit: number) => Promise<{ seq: number; type: string; payload: unknown }[]> } = {}) {
  const st = { pending: [] as Ev[], adopted: false, stale: false, fedTo: 0, calls: [] as Ev[][], failed: [] as string[], heals: 0 };
  const log = [{ seq: 1, type: "resource.created", payload: enc({ id: "spc", type: "space" }) }];
  const run = createAccessRun({
    take: () => { const h = st.pending; st.pending = []; return h; },
    putBack: (es) => { st.pending = [...es, ...st.pending]; },
    pending: () => st.pending.length,
    read: o.read ?? (async (after) => log.filter((e) => e.seq > after)),
    call: async (events) => { st.calls.push(events); return new AccessSnapshot(); },
    adopt: () => { st.adopted = true; }, adopted: () => st.adopted,
    stale: { get: () => st.stale, set: (v) => { st.stale = v; } },
    fedTo: { get: () => st.fedTo, set: (n) => { st.fedTo = n; } },
    noModule: () => false,
    failed: (e) => { st.failed.push(e); },
    healLater: () => { st.heals++; },
  });
  return { st, run, log };
}

test("A: a seq -1 record type pushed while a run waits on the log read is folded by the next run", async () => {
  let release!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  let first = true;
  const { st, run } = rig({ read: async (after) => { if (first) { first = false; await gate; } return after < 1 ? [{ seq: 1, type: "resource.created", payload: enc({ id: "spc", type: "space" }) }] : []; } });
  st.pending.push({ seq: 1, type: "resource.created", payload: {} });
  const running = run(true);
  await new Promise((done) => setTimeout(done, 5));
  st.pending.push({ seq: -1, type: "resource.created", payload: { id: "contact", type: "record_type" } });   // the boot code, while the run is in the read
  release();
  await running;
  assert.deepEqual(st.pending.map((e) => e.seq), [-1], "still waiting, not thrown away");
  await run();   // the chained run the boot code asked for (no force)
  assert.deepEqual(st.calls.at(-1)?.map((e) => e.seq), [-1], "folded");
  assert.deepEqual(st.pending, []);
});

test("B: a failing log read marks the snapshot stale, logs, arms a retry and does not fail the caller once adopted; the next run heals", async () => {
  let fail = false;
  const { st, run } = rig({ read: async (after) => { if (fail) throw new Error("the log worker stopped"); return after < 1 ? [{ seq: 1, type: "resource.created", payload: enc({}) }] : []; } });
  await run(true);
  assert.equal(st.adopted, true);
  fail = true;
  st.pending.push({ seq: -1, type: "resource.created", payload: { id: "deal", type: "record_type" } }, { seq: 7, type: "member.removed", payload: {} });
  await run(true);   // does not throw
  assert.equal(st.stale, true, "only the owner is answered until a sync succeeds");
  assert.deepEqual(st.failed, ["the log worker stopped"]);
  assert.equal(st.heals, 1, "a retry is armed");
  assert.deepEqual(st.pending.map((e) => e.seq), [-1], "the host's own object is kept; seq 7 is read from the log again");
  assert.equal(st.fedTo, 1, "the log is read again from the same point");
  fail = false;
  await run(true);
  assert.equal(st.stale, false);
  assert.deepEqual(st.calls.at(-1)?.map((e) => e.seq), [-1]);
});

test("B: before the module's snapshot was adopted, a failing read still fails the start", async () => {
  const { run, st } = rig({ read: async () => { throw new Error("no log"); } });
  await assert.rejects(run(true), /no log/);
  assert.equal(st.adopted, false);
});
