// A Space of hundreds of thousands of rows: every change of what a person may read made one pull go through all the rows in one stretch (24 s of a 60 s profile on a firm's server, Nov 2026),
// and the live stream asked again at every commit. The rescan now works in slices of a few ms across pulls, keeps its place, and ends with the same hides.
import test from "node:test";
import assert from "node:assert/strict";
import { mintRecordId } from "../../../lib/ids.ts";
import type { PullRes } from "../../../sync/src/protocol.ts";
import { openSync } from "../impl.ts";
import { createPurgeHandlers, purgeDepsOf } from "../handlers/purge.ts";
import type { PullCtx } from "../handlers/index.ts";
import { BO, ADA, CONTACT_TYPE, NOW, buildAccess } from "../fixtures/world.ts";

const TRACE = "0123456789abcdef0123456789abcdef";
const ROWS = 12_000;
const BUDGET_MS = 100; // CPU time of one pull (the unsliced scan took 1,414 ms)
/** A revoke must reach the device fast: 12,000 rows all revoked are hidden within this many pulls and this much wall time. */
const MAX_PULLS = 100;
const WALL_PULL_MS = 500;
const MAX_WALL_MS = 10_000;

// the calling thread's own CPU time (user plus system): V8's helper threads (garbage collection, compiler) are not the work of the pull and are not what holds the event loop
const cpuMs = (u: NodeJS.CpuUsage): number => (u.user + u.system) / 1000;
const cpuNow = (prev?: NodeJS.CpuUsage): NodeJS.CpuUsage =>
  (process as unknown as { threadCpuUsage?: (p?: NodeJS.CpuUsage) => NodeJS.CpuUsage }).threadCpuUsage
    ? (process as unknown as { threadCpuUsage: (p?: NodeJS.CpuUsage) => NodeJS.CpuUsage }).threadCpuUsage(prev)
    : process.cpuUsage(prev);

test("a rescan over a big Space is done in slices: every pull is at most 100 ms of work, and every row is hidden within the bounds", async () => {
  const access = buildAccess();
  const s = openSync({ access: () => access, clock: () => NOW });
  await s.store.define({ add_types: [CONTACT_TYPE] });
  for (let i = 0; i < ROWS; i++)
    await s.store.create("contact", mintRecordId(), {
      name: `N${i}`,
      email: "n@example.com",
      phone: "+1",
      region: "eu",
      stage: "lead",
      owner: ADA,
    });
  const ctx: PullCtx = { trace: { traceId: TRACE }, principal: BO, deviceId: "dev1", deviceClass: "desktop" };
  const pull = (cursor: number): Promise<PullRes> => s.handlers["sync.pull"](ctx, { cursor, epoch: 0 });
  // the device holds every row (pulled in as many pulls as it takes)
  let cur = 0;
  for (;;) {
    const r = await pull(cur);
    cur = r.next;
    if (!r.more) break;
  }
  access.revokeGrant("gr_bo_record");
  const began = performance.now();
  const hidden = new Set<string>();
  let slowest = 0,
    slowestWall = 0,
    calls = 0;
  for (;;) {
    const w0 = performance.now();
    // The work of one pull is its CPU time (user plus system): that is what holds the event loop, and a pause of the machine (another process, a disk wait) is not counted against it.
    const before = cpuNow();
    const r = await pull(cur);
    slowest = Math.max(slowest, cpuMs(cpuNow(before)));
    slowestWall = Math.max(slowestWall, performance.now() - w0);
    calls++;
    for (const h of r.hide) hidden.add(h.id);
    cur = r.next;
    if (!r.more && calls > 1) break;
    assert.ok(calls < 5000, "the rescan ends");
  }
  const wall = performance.now() - began;
  process.stderr.write(
    `[rescan] ${calls} pulls, ${Math.round(wall)} ms wall, slowest pull ${Math.round(slowest)} ms of CPU\n`,
  );
  assert.equal(hidden.size, ROWS, "every row the person can no longer see is hidden");
  assert.ok(calls > 2, "the work was split over several pulls");
  assert.ok(calls <= MAX_PULLS, `${calls} pulls to hide ${ROWS} rows (at most ${MAX_PULLS})`);
  assert.ok(wall <= MAX_WALL_MS, `the revoke took ${Math.round(wall)} ms (at most ${MAX_WALL_MS})`);
  // a wait that is not CPU (a lock, a disk) still holds the loop: a generous wall-clock bound on every pull beside the CPU bound
  assert.ok(
    slowestWall <= WALL_PULL_MS,
    `one pull took ${Math.round(slowestWall)} ms of wall time (at most ${WALL_PULL_MS} ms)`,
  );
  assert.ok(slowest <= BUDGET_MS, `one pull was ${Math.round(slowest)} ms of work (budget ${BUDGET_MS} ms)`);
});

test("the entities that have rows are read from the table when the access state moves, not on every pull", async () => {
  const access = buildAccess();
  const s = openSync({ access: () => access, clock: () => NOW });
  await s.store.define({ add_types: [CONTACT_TYPE] });
  await s.store.create("contact", mintRecordId(), {
    name: "N",
    email: "n@example.com",
    phone: "+1",
    region: "eu",
    stage: "lead",
    owner: ADA,
  });
  const db = s.deps.db;
  let distinct = 0;
  const all = db.all.bind(db);
  (db as { all: unknown }).all = (sql: string, ...a: unknown[]) => {
    if (/SELECT DISTINCT entity FROM sync_rows/.test(sql)) distinct++;
    return (all as (q: string, ...x: unknown[]) => unknown)(sql, ...a);
  };
  const ctx: PullCtx = { trace: { traceId: TRACE }, principal: BO, deviceId: "dev1", deviceClass: "desktop" };
  let cur = 0;
  for (let i = 0; i < 25; i++) cur = (await s.handlers["sync.pull"](ctx, { cursor: cur, epoch: 0 })).next;
  assert.ok(distinct <= 1, `the whole table was walked ${distinct} times in 25 pulls`);
  const before = distinct;
  access.revokeGrant("gr_bo_record");
  await s.handlers["sync.pull"](ctx, { cursor: cur, epoch: 0 });
  assert.equal(distinct, before + 1, "a change of the access state reads it again");
});

async function held(rows: number) {
  const access = buildAccess();
  const s = openSync({ access: () => access, clock: () => NOW });
  await s.store.define({ add_types: [CONTACT_TYPE] });
  for (let i = 0; i < rows; i++)
    await s.store.create("contact", mintRecordId(), {
      name: `N${i}`,
      email: "n@example.com",
      phone: "+1",
      region: "eu",
      stage: "lead",
      owner: ADA,
    });
  const ctx: PullCtx = { trace: { traceId: TRACE }, principal: BO, deviceId: "dev1", deviceClass: "desktop" };
  const pull = (cursor: number): Promise<PullRes> => s.handlers["sync.pull"](ctx, { cursor, epoch: 0 });
  // the device's copy: what it holds after applying every answer
  const device = new Set<string>();
  const apply = (r: PullRes): void => {
    for (const c of r.changes) device.add(c.id);
    for (const h of r.hide) device.delete(h.id);
  };
  let cur = 0;
  for (;;) {
    const r = await pull(cur);
    apply(r);
    cur = r.next;
    if (!r.more) break;
  }
  return { access, s, pull, apply, device, cursor: () => cur, setCursor: (c: number) => (cur = c) };
}

test("an access change in the middle of a scan: the scan ends, a fresh full scan follows, and nothing the new access allows stays hidden", async () => {
  const w = await held(1500);
  assert.equal(w.device.size, 1500);
  w.access.revokeGrant("gr_bo_record");
  const first = await w.pull(w.cursor());
  w.apply(first);
  w.setCursor(first.next);
  assert.equal(first.more, true, "the scan is not done after one slice");
  assert.ok(w.device.size < 1500, "some rows are already hidden");
  // the grant comes back while the scan is still running
  w.access.putGrant({
    id: "gr_bo_record",
    subject_kind: "actor",
    subject_id: BO,
    resource_type: "record",
    resource_id: null,
    level: "view",
    conditions: { rowFilter: { op: "eq", field: "region", value: "eu" } },
  });
  for (let i = 0; i < 400; i++) {
    const r = await w.pull(w.cursor());
    w.apply(r);
    w.setCursor(r.next);
    if (!r.more) break;
  }
  assert.equal(w.device.size, 1500, "every row the person can see again is back on the device");
  const open = w.s.deps.db.get<{ n: number }>("SELECT count(*) AS n FROM sync_scope_scan")?.n;
  assert.equal(open, 0, "no scan is left open");
});

test("a removed device takes its rescan state with it", async () => {
  const w = await held(600);
  w.access.revokeGrant("gr_bo_record");
  const r = await w.pull(w.cursor());
  assert.equal(r.more, true);
  const rows = (): number =>
    w.s.deps.db.get<{ n: number }>(
      "SELECT (SELECT count(*) FROM sync_scope_scan) + (SELECT count(*) FROM sync_scope_stamp) AS n",
    )?.n ?? 0;
  assert.ok(rows() > 0, "a scan is open and the device has a stamp");
  const purge = createPurgeHandlers(purgeDepsOf(w.s, { purge: () => 0 }));
  await purge["sync.epoch.bump"](
    { trace: { traceId: TRACE }, principal: ADA },
    { personId: BO, reason: "device_revoked", deviceId: "dev1" },
  );
  assert.equal(rows(), 0, "neither the scan nor the stamp is kept for a revoked device");
});

test("a revoke reaches a device that holds a few rows in its first pull, however many rows the Space has", async () => {
  const access = buildAccess();
  const s = openSync({ access: () => access, clock: () => NOW });
  await s.store.define({ add_types: [CONTACT_TYPE] });
  const mine = mintRecordId();
  await s.store.create("contact", mine, { name: "Mine", email: "n@example.com", phone: "+1", region: "eu", stage: "lead", owner: ADA });
  for (let i = 0; i < 1500; i++)
    await s.store.create("contact", mintRecordId(), { name: `Other ${i}`, email: "o@example.com", phone: "+1", region: "us", stage: "lead", owner: ADA });
  const ctx: PullCtx = { trace: { traceId: TRACE }, principal: BO, deviceId: "dev1", deviceClass: "desktop" };
  const pull = (cursor: number): Promise<PullRes> => s.handlers["sync.pull"](ctx, { cursor, epoch: 0 });
  const first = await pull(0);
  assert.deepEqual(first.changes.map((c) => c.id), [mine], "the device holds the one row it may see");
  access.revokeGrant("gr_bo_record");
  const next = await pull(first.next);
  assert.deepEqual(next.hide.map((h) => h.id), [mine], "the revoked row is hidden in the very next pull");
});

test("a pull of a few hundred rows is whole in one answer, however slow the machine is that moment", async () => {
  const access = buildAccess();
  const s = openSync({ access: () => access, clock: () => NOW });
  await s.store.define({ add_types: [CONTACT_TYPE] });
  const ids: string[] = [];
  for (let i = 0; i < 600; i++) {
    const id = mintRecordId();
    ids.push(id);
    await s.store.create("contact", id, { name: `N${i}`, email: "n@example.com", phone: "+1", region: "eu", stage: "lead", owner: ADA });
  }
  const ctx: PullCtx = { trace: { traceId: TRACE }, principal: ADA, deviceId: "dev1", deviceClass: "desktop" };
  const r = await s.handlers["sync.pull"](ctx, { cursor: 0, epoch: 0 });
  assert.equal(r.changes.length, 600);
  assert.equal(r.more, false, "nothing is left for a second pull");
});
