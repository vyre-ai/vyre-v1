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
const BUDGET_MS = 100; // 90 of 100 pulls stay under this; the slowest may be 4 times it (a shared test machine adds jitter)
/** A revoke must reach the device fast: 12,000 rows all revoked are hidden within this many pulls and this much wall time. */
const MAX_PULLS = 100;
const MAX_WALL_MS = 10_000;

test("a rescan over a big Space is done in slices, none holds the loop past the budget, and every row is hidden in the end", async () => {
  const access = buildAccess();
  const s = openSync({ access: () => access, clock: () => NOW });
  await s.store.define({ add_types: [CONTACT_TYPE] });
  const ids: string[] = [];
  for (let i = 0; i < ROWS; i++) {
    const id = mintRecordId();
    ids.push(id);
    await s.store.create("contact", id, {
      name: `N${i}`,
      email: "n@example.com",
      phone: "+1",
      region: "eu",
      stage: "lead",
      owner: ADA,
    });
  }
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
  const took: number[] = [];
  let slowest = 0,
    calls = 0;
  for (;;) {
    const t0 = performance.now();
    const r = await pull(cur);
    took.push(performance.now() - t0);
    slowest = Math.max(slowest, performance.now() - t0);
    calls++;
    for (const h of r.hide) hidden.add(h.id);
    cur = r.next;
    if (!r.more && calls > 1) break;
    assert.ok(calls < 5000, "the rescan ends");
  }
  process.stderr.write(`[rescan] ${calls} pulls, ${Math.round(performance.now() - began)} ms wall, slowest ${Math.round(slowest)} ms\n`);
  assert.equal(hidden.size, ROWS, "every row the person can no longer see is hidden");
  took.sort((a, b) => a - b);
  const p90 = took[Math.floor(took.length * 0.9)]!;
  assert.ok(p90 <= BUDGET_MS, `90th percentile of a pull is ${Math.round(p90)} ms (budget ${BUDGET_MS} ms)`);
  assert.ok(slowest <= BUDGET_MS * 4, `one pull held the loop for ${Math.round(slowest)} ms (at most ${BUDGET_MS * 4} ms)`);
  assert.ok(calls > 2, "the work was split over several pulls");
  assert.ok(calls <= MAX_PULLS, `${calls} pulls to hide ${ROWS} rows (at most ${MAX_PULLS})`);
  assert.ok(performance.now() - began <= MAX_WALL_MS, `the revoke took ${Math.round(performance.now() - began)} ms (at most ${MAX_WALL_MS})`);
});

test("the entities that have rows are read from the table when the access state moves, not on every pull", async () => {
  const access = buildAccess();
  const s = openSync({ access: () => access, clock: () => NOW });
  await s.store.define({ add_types: [CONTACT_TYPE] });
  await s.store.create("contact", mintRecordId(), { name: "N", email: "n@example.com", phone: "+1", region: "eu", stage: "lead", owner: ADA });
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
    await s.store.create("contact", mintRecordId(), { name: `N${i}`, email: "n@example.com", phone: "+1", region: "eu", stage: "lead", owner: ADA });
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
    (w.s.deps.db.get<{ n: number }>("SELECT (SELECT count(*) FROM sync_scope_scan) + (SELECT count(*) FROM sync_scope_stamp) AS n")?.n ?? 0);
  assert.ok(rows() > 0, "a scan is open and the device has a stamp");
  const purge = createPurgeHandlers(purgeDepsOf(w.s, { purge: () => 0 }));
  await purge["sync.epoch.bump"]({ trace: { traceId: TRACE }, principal: ADA }, { personId: BO, reason: "device_revoked", deviceId: "dev1" });
  assert.equal(rows(), 0, "neither the scan nor the stamp is kept for a revoked device");
});
