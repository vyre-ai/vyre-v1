// @reads /modules/sync/migrations/0001_pull.sql
// P-L1_05, golden 14 input: after every grant, revoke and label change the replica equals a fresh filtered snapshot, including its FTS rows and saved documents (ARCH 5.7).
// The server is the real log with the sync.changes projection and the real pull handlers; the devices are real replicas on node:sqlite that take pulls the way the sync engine will.
import test from "node:test";
import assert from "node:assert/strict";
import { compareHlc, parseHlc } from "../../../lib/hlc.ts";
import type { Hlc } from "../../../lib/hlc.ts";
import { createNodeDriver, openReplica } from "../../../sync/src/replica/index.ts";
import type { ReplicaStore, SqlDriver, SqlRow, SqlValue } from "../../../sync/src/replica/index.ts";
import { applyHides, docPrefix, pullHides } from "../../../sync/src/purge/index.ts";
import type { Change, Hide } from "../../../sync/src/protocol.ts";
import type { AccessSnapshot } from "../../../kernel/src/authorize/snapshot.ts";
import { openSync } from "../impl.ts";
import type { SyncHandle } from "../impl.ts";
import { createPurgeHandlers, purgeDepsOf } from "../handlers/purge.ts";
import type { PurgeHandlers } from "../handlers/purge.ts";
import type { PullCtx } from "../handlers/index.ts";
import { ADA, BO, NOW, buildAccess } from "../fixtures/world.ts";

const TRACE = "0123456789abcdef0123456789abcdef";
const ENT = "note_board";
const GRANT = "gr_bo_record";

interface World { s: SyncHandle; access: AccessSnapshot; admin: PurgeHandlers; grant(): void; revoke(): void }
function world(): World {
  const access = buildAccess({ boFilter: null, boHidden: [] });
  const s = openSync({ access: () => access, clock: () => NOW });
  const admin = createPurgeHandlers(purgeDepsOf(s, { purge: () => 0 }));
  return {
    s, access, admin,
    revoke: () => access.revokeGrant(GRANT),
    grant: () => access.putGrant({ id: GRANT, subject_kind: "actor", subject_id: BO, resource_type: "record", resource_id: null, level: "view", conditions: { hiddenFields: [] } }),
  };
}
const adminCtx = { trace: { traceId: TRACE }, principal: ADA };
const reindex = (w: World) => w.admin["sync.acl.reindex"](adminCtx, { resourceType: "record", resourceId: "*" });

function upsert(w: World, id: string, fields: Record<string, unknown>): number {
  return w.s.host.append({ type: "sync.row", sv: 1, trace_id: TRACE, actor: ADA, vis: "space", payload: { entity: ENT, id, op: "upsert", fields, at: NOW } }).seq;
}
function patch(w: World, id: string, fields: Record<string, unknown>, label?: number): number {
  return w.s.host.append({ type: "sync.row", sv: 1, trace_id: TRACE, actor: ADA, vis: "space", ...(label !== undefined ? { label } : {}), payload: { entity: ENT, id, op: "patch", fields, at: NOW } }).seq;
}
function remove(w: World, id: string): number {
  return w.s.host.append({ type: "sync.row", sv: 1, trace_id: TRACE, actor: ADA, vis: "space", payload: { entity: ENT, id, op: "delete", fields: {}, at: NOW } }).seq;
}

// ---- devices ----

interface Dev { person: string; device: string; driver: SqlDriver; store: ReplicaStore; cursor: number; epoch: number }
function device(person: string, name: string): Dev {
  const driver = createNodeDriver();
  const store = openReplica({ driver, deviceClass: "desktop", registryHash: "h1", personId: person });
  return { person, device: name, driver, store, cursor: 0, epoch: 0 };
}
const ctx = (d: Dev): PullCtx => ({ trace: { traceId: TRACE }, principal: d.person, deviceId: d.device, deviceClass: "desktop" });

function newest(fields: Record<string, { hlc: string }>): string {
  let best: Hlc | null = null;
  let text = "";
  for (const f of Object.values(fields)) {
    const h = parseHlc(f.hlc);
    if (h && (best === null || compareHlc(h, best) > 0)) { best = h; text = f.hlc; }
  }
  return text;
}
function values(fields: Record<string, { v: unknown }>): Record<string, SqlValue> {
  const out: Record<string, SqlValue> = {};
  for (const [k, c] of Object.entries(fields)) out[k] = c.v as SqlValue;
  return out;
}

function apply(d: Dev, c: Change): void {
  if (c.op === "delete") return; // taken away with the hides (pullHides)
  const r = d.store.write({ entity: c.entity, id: c.id, fields: values(c.fields), hlc: newest(c.fields), actor: ADA, origin: "mirror", seq: c.seq });
  assert.ok(r.applied || r.reason === "older", `${c.op} ${c.id}: ${r.reason}`);
}

/** Pull until caught up, apply changes then hides. Returns the hides the server sent. */
async function pullAll(w: World, d: Dev): Promise<Hide[]> {
  const hides: Hide[] = [];
  for (let i = 0; i < 50; i++) {
    const res = await w.s.handlers["sync.pull"](ctx(d), { cursor: d.cursor, epoch: d.epoch });
    assert.equal(res.reset, undefined, "no purge in this test");
    for (const c of res.changes) apply(d, c);
    const gone = pullHides(res);
    await applyHides(d.store, gone, { driver: d.driver });
    hides.push(...res.hide);
    d.cursor = res.next;
    if (!res.more) return hides;
  }
  throw new Error("pull did not finish");
}

/** A new device that takes a snapshot: what the replica must equal. */
async function fresh(w: World, person: string): Promise<Dev> {
  const d = device(person, `fresh_${Math.random().toString(16).slice(2, 8)}`);
  const begin = await w.s.handlers["sync.snapshot.begin"](ctx(d), { deviceClass: "desktop" });
  for (const p of begin.plan) {
    let after: string | undefined;
    for (let i = 0; i < 50; i++) {
      const page = await w.s.handlers["sync.snapshot.page"](ctx(d), { entity: p.entity, ...(after !== undefined ? { after } : {}), asOf: begin.asOfSeq });
      for (const row of page.rows) {
        const r = d.store.write({ entity: p.entity, id: row.id, fields: values(row.fields), hlc: newest(row.fields), actor: ADA, origin: "mirror", seq: row.seq });
        assert.ok(r.applied, `snapshot ${row.id}: ${r.reason}`);
      }
      if (page.done || page.last === undefined) break;
      after = page.last;
    }
  }
  return d;
}

interface Dump { rows: SqlRow[]; fts: SqlRow[]; docs: string[] }
function dump(d: Dev): Dump {
  const all = (sql: string): SqlRow[] => d.driver.prepare(sql).all([]);
  return {
    rows: all(`SELECT id, title, body FROM "rt_${ENT}" ORDER BY id`),
    fts: all("SELECT entity, id, title, body FROM fts ORDER BY entity, id"),
    docs: all("SELECT doc FROM doc_local ORDER BY doc").map((r) => String(r["doc"])),
  };
}

/** The mandatory check: row tables and FTS identical to a fresh filtered snapshot, and no saved document of a row the person cannot see. */
async function converged(w: World, d: Dev, label: string): Promise<void> {
  const want = await fresh(w, d.person);
  const have = dump(d), ref = dump(want);
  assert.deepEqual(have.rows, ref.rows, `${label}: rows`);
  assert.deepEqual(have.fts, ref.fts, `${label}: fts rows`);
  const visible = new Set(ref.rows.map((r) => String(r["id"])));
  for (const doc of have.docs) {
    const owner = [...visible].find((id) => doc === docPrefix(ENT, id) || doc.startsWith(`${docPrefix(ENT, id)}:`));
    assert.ok(owner, `${label}: document ${doc} belongs to a row the person can no longer see`);
  }
  for (const r of have.rows) assert.notEqual(d.store.read(ENT, String(r["id"])), null, `${label}: the read path agrees with the table`);
  await want.store.close();
}

function saveDocs(d: Dev, ids: readonly string[]): void {
  const put = d.driver.prepare("INSERT INTO doc_local (doc, state, sv, dirty) VALUES (?, ?, ?, ?) ON CONFLICT(doc) DO NOTHING");
  for (const id of ids) {
    put.run([docPrefix(ENT, id), new Uint8Array([1, 2]), new Uint8Array([3]), 0]);
    put.run([`${docPrefix(ENT, id)}:body`, new Uint8Array([4, 5]), new Uint8Array([6]), 1]);
  }
}

const ids = (d: Dev): string[] => dump(d).rows.map((r) => String(r["id"]));

test("label change, revoke and re-grant: the replica equals a fresh filtered snapshot after each, FTS rows and saved documents included", async () => {
  const w = world();
  for (const [id, title] of [["n1", "Alpha plan"], ["n2", "Beta plan"], ["n3", "Gamma plan"]] as const) upsert(w, id, { title, body: `${title} body` });
  const bo = device(BO, "bo1");
  await pullAll(w, bo);
  assert.deepEqual(ids(bo), ["n1", "n2", "n3"]);
  assert.equal(dump(bo).fts.length, 3, "every row is searchable");
  saveDocs(bo, ["n1", "n2", "n3"]);
  await converged(w, bo, "after the first pull");

  // A label change above bo's clearance hides the row without a grant change.
  patch(w, "n2", { title: "Beta plan" }, 2);
  const hidden = await pullAll(w, bo);
  assert.deepEqual(hidden.map((h) => h.id), ["n2"]);
  assert.deepEqual(ids(bo), ["n1", "n3"]);
  assert.equal(bo.store.read(ENT, "n2"), null);
  assert.equal(bo.store.readFts(ENT, "n2"), null, "its search entry is gone");
  assert.deepEqual(dump(bo).docs.filter((d) => d.startsWith(docPrefix(ENT, "n2"))), [], "its saved documents are gone");
  await converged(w, bo, "after a label raise");

  // The label comes back down: the row returns whole.
  patch(w, "n2", { title: "Beta plan v2" }, 0);
  await pullAll(w, bo);
  assert.deepEqual(ids(bo), ["n1", "n2", "n3"]);
  assert.equal(bo.store.readFts(ENT, "n2")?.title, "Beta plan v2");
  await converged(w, bo, "after the label returns");

  // Revoke bo's grant: the rows do not change, so the reindex makes the server look again.
  w.revoke();
  const rescanned = await reindex(w);
  assert.equal(rescanned.changed, 3);
  const gone = await pullAll(w, bo);
  assert.deepEqual(gone.map((h) => h.id).sort(), ["n1", "n2", "n3"]);
  assert.deepEqual(dump(bo), { rows: [], fts: [], docs: [] });
  await converged(w, bo, "after the revoke");

  // Re-grant: the rows come back through the same path.
  w.grant();
  await reindex(w);
  await pullAll(w, bo);
  assert.deepEqual(ids(bo), ["n1", "n2", "n3"]);
  await converged(w, bo, "after the re-grant");
  await bo.store.close();
});

test("a device that was offline through the revoke gets the same hides when it returns", async () => {
  const w = world();
  upsert(w, "n1", { title: "One", body: "a" });
  upsert(w, "n2", { title: "Two", body: "b" });
  const live = device(BO, "bo_live"), away = device(BO, "bo_away");
  await pullAll(w, live);
  await pullAll(w, away);
  saveDocs(away, ["n1", "n2"]);
  w.revoke();
  await reindex(w);
  upsert(w, "n3", { title: "Three", body: "c" });
  patch(w, "n1", { title: "One edited" });
  await pullAll(w, live);
  assert.deepEqual(ids(live), []);
  const late = await pullAll(w, away);
  assert.deepEqual(late.map((h) => h.id).sort(), ["n1", "n2"]);
  assert.deepEqual(dump(away), { rows: [], fts: [], docs: [] });
  await converged(w, away, "the returning device");
  await live.store.close();
  await away.store.close();
});

test("a deleted row leaves the replica with its search entry and documents, and a hide for a row the replica never held is only recorded", async () => {
  const w = world();
  upsert(w, "n1", { title: "Keep", body: "k" });
  upsert(w, "n2", { title: "Drop", body: "d" });
  const bo = device(BO, "bo1");
  await pullAll(w, bo);
  saveDocs(bo, ["n1", "n2"]);
  remove(w, "n2");
  await pullAll(w, bo);
  assert.deepEqual(ids(bo), ["n1"]);
  assert.equal(bo.store.readFts(ENT, "n2"), null);
  const rep = await applyHides(bo.store, [{ entity: ENT, id: "never", seq: 99_999 }], { driver: bo.driver });
  assert.deepEqual({ dropped: rep.dropped, recorded: rep.recorded }, { dropped: 0, recorded: 1 });
  assert.equal(bo.store.write({ entity: ENT, id: "never", fields: { title: "late" }, hlc: "000000000001-0000-srv", actor: ADA, origin: "mirror", seq: 5 }).reason, "hidden", "an older change for a hidden row is refused");
  await converged(w, bo, "after a delete");
  await bo.store.close();
});

/** A small seeded walk over edits, adds, deletes, label changes and grant changes; two devices, one syncing every step and one every fifth. */
test("property: a seeded walk of 80 changes leaves both replicas equal to a fresh filtered snapshot whenever they sync", async () => {
  const w = world();
  let seed = 0x2545f491;
  const rnd = (n: number): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
  const alive: string[] = [];
  let next = 1, granted = true, version = 0;
  const add = (): void => { const id = `n${next++}`; alive.push(id); upsert(w, id, { title: `Note ${id} ${rnd(1000)}`, body: `text ${rnd(1000)}` }); };
  for (let i = 0; i < 4; i++) add();
  const fast = device(BO, "bo_fast"), slow = device(BO, "bo_slow");
  for (let step = 1; step <= 80; step++) {
    const pick = (): string => alive[rnd(alive.length)] ?? "n1";
    const op = rnd(8);
    if (op <= 1 && alive.length > 0) patch(w, pick(), { title: `Edit ${++version}` });
    else if (op === 2) add();
    else if (op === 3 && alive.length > 2) { const id = pick(); alive.splice(alive.indexOf(id), 1); remove(w, id); }
    else if (op === 4 && alive.length > 0) patch(w, pick(), { body: `raised ${++version}` }, 2);
    else if (op === 5 && alive.length > 0) patch(w, pick(), { body: `lowered ${++version}` }, 0);
    else if (op === 6) { if (granted) w.revoke(); else w.grant(); granted = !granted; await reindex(w); }
    else add();
    await pullAll(w, fast);
    if (step % 5 === 0) await pullAll(w, slow);
    if (step % 4 === 0) saveDocs(fast, ids(fast));
    await converged(w, fast, `step ${step} fast`);
    if (step % 5 === 0) await converged(w, slow, `step ${step} slow`);
  }
  await fast.store.close();
  await slow.store.close();
});

// P-L1_05 final run: this file shows its own ok line (purge.replica.test.ts) in the run on the last commit.
