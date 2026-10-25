// The query layer over a real ReplicaStore on SQLite (ARCH 9, P-L1_09b). client/src/query is tested against fakes in client/; this wires it to the real replica (sync/src/replica on node:sqlite,
// the generated replica schema) with 100,000 rows: a pulled change shows up in a live query, a window reads only the rows on screen, one edit patches one row, and a screen opens
// from the generated index inside the first-paint budget. Timings are real SQLite reads; each prints a METRIC line (median of 5, warm-up discarded, worst printed, ruling 43).
import test from "node:test";
import assert from "node:assert/strict";
import { createNodeDriver, openReplica } from "../../../../sync/src/replica/index.ts";
import type { ReplicaStore } from "../../../../sync/src/replica/index.ts";
import { createChangeFeed, createSpaceStore, observeReplica } from "../../../../client/src/store/index.ts";
import type { LocalDb } from "../../../../client/src/store/index.ts";
import { asQuery, createPrefetcher, createQueryClient } from "../../../../client/src/query/index.ts";
import type { ListDef, ListWindow, QueryDef, QueryState } from "../../../../client/src/query/index.ts";
import { manualScheduler } from "../../../../client/src/connection/scheduler.ts";
import { screens } from "../../../../generated/screens.ts";

const NOW = 1_700_000_000_000;
const ROWS = 100_000;
const FRAME_MS = 16;
const FIRST_PAINT_MS = 50;
const hlc = (n: number): string => `${(NOW + n).toString(16).padStart(12, "0")}-0001-dev1`;

interface Calendar { id: string; title: string; version: number }
const ids = (n: number): string => `cld_${String(n).padStart(6, "0")}`;

/** A desktop replica on a real SQLite file in memory, seeded in bulk (the way a first snapshot lands), with the query layer on top. */
function rig(rows: number) {
  const driver = createNodeDriver();
  const replica = openReplica({ driver, deviceClass: "desktop", registryHash: "h1", personId: "usr_ada", clock: () => NOW });
  driver.transaction(() => {
    const insert = driver.prepare(`INSERT INTO "calendar_list" ("id", "title", "state", "version") VALUES (?, ?, 'active', 1)`);
    for (let i = 0; i < rows; i++) insert.run([ids(i), `Calendar ${i}`]);
  });
  const changes = createChangeFeed();
  const store = createSpaceStore("spc_real", driver, changes);
  const observed: ReplicaStore = observeReplica(replica, changes);
  let n = 0;
  const pull = (entity: string, id: string, fields: Record<string, string | number | null>) =>
    observed.write({ entity, id, fields, hlc: hlc(++n), actor: "usr_ada", origin: "mirror", seq: n });
  return { driver, replica, store, changes, client: createQueryClient(store), pull };
}

const calendars: QueryDef<{ prefix: string }, Calendar[]> = {
  cap: "calendar.search", entities: ["calendar"],
  run: (db: LocalDb, i) => db.all(`SELECT id, title, version FROM "calendar_list" WHERE deleted_at IS NULL AND title LIKE ? ORDER BY title LIMIT 20`, [`${i.prefix}%`]) as unknown as Calendar[],
};

const list: ListDef<Record<string, never>, Calendar> = {
  cap: "calendar.list", entity: "calendar",
  orderIds: (db) => db.all(`SELECT id FROM "calendar_list" WHERE deleted_at IS NULL ORDER BY id`).map((r) => String(r["id"])),
  readRows: (db, want) => db.all(`SELECT id, title, version FROM "calendar_list" WHERE id IN (${want.map(() => "?").join(",")})`, want) as unknown as Calendar[],
  idOf: (r) => r.id,
  versionOf: (r) => r.version,
  orderKey: (r) => r.id,
};

const ready = <T>(s: QueryState<T>): T => { assert.equal(s.status, "ready"); return (s as { data: T }).data; };

/** Median of 5 after one discarded warm-up; prints the worst. */
function measure(name: string, fn: () => void): number {
  fn();
  const t: number[] = [];
  for (let i = 0; i < 5; i++) { const t0 = performance.now(); fn(); t.push(performance.now() - t0); }
  t.sort((a, b) => a - b);
  console.log(`METRIC ${name} median=${t[2]!.toFixed(2)}ms worst=${t[4]!.toFixed(2)}ms rows=${ROWS}`);
  return t[2]!;
}

test("a change pulled into the real replica appears in a live query, and a change to another entity does not wake it", () => {
  const r = rig(1000);
  const q = r.client.query(calendars, { prefix: "Zed" });
  let woken = 0;
  const off = q.subscribe(() => { woken++; });
  assert.deepEqual(ready(q.getSnapshot()), []);
  const before = q.getSnapshot();

  assert.equal(r.pull("calendar", "cld_new", { title: "Zed Hearings", state: "active" }).applied, true);
  assert.equal(woken, 1, "the pulled row woke the query that reads calendars");
  assert.deepEqual(ready(q.getSnapshot()).map((c) => c.title), ["Zed Hearings"]);
  assert.notEqual(q.getSnapshot(), before);

  const settled = q.getSnapshot();
  r.pull("star", "str_thread.thr_1", { resourceType: "thread", resourceId: "thr_1", person: "usr_ada" });
  assert.equal(woken, 1, "a star write never woke a calendar query");
  assert.strictEqual(q.getSnapshot(), settled, "and the snapshot is the same object");

  r.replica.hide("calendar", "cld_new", 9_999);
  assert.equal(woken, 2, "a hide row is a change too");
  assert.deepEqual(ready(q.getSnapshot()), [], "the hidden row leaves the result");
  off();
});

test("100,000 rows: a window reads only the rows on screen, scrolling reads the next rows once, and one pulled edit patches one row", () => {
  const r = rig(ROWS);
  const l = r.client.list(list, {});
  const w0 = performance.now();
  const win = ready(l.getSnapshot());
  const openMs = performance.now() - w0;
  assert.equal(win.count, ROWS);
  const reads0 = r.client.stats().listRowReads;
  assert.equal(reads0, 0, "opening reads ids, not rows");

  const first = win.rows(0, 50);
  assert.equal(first.length, 50);
  assert.equal(first[0]?.title, "Calendar 0");
  assert.equal(r.client.stats().listRowReads, 50);
  win.rows(0, 50);
  assert.equal(r.client.stats().listRowReads, 50, "cached rows are not read again");
  win.rows(40, 90);
  assert.equal(r.client.stats().listRowReads, 90, "only the 40 new rows were read");
  console.log(`METRIC list.open ids=${ROWS} ms=${openMs.toFixed(2)}`);

  const winMs = measure("window.read50", () => { const s = r.client.list(list, {}).getSnapshot(); ready(s).rows(60_000, 60_050); });
  assert.ok(winMs < FRAME_MS * 4, `reading a 50-row window of ${ROWS} rows took ${winMs.toFixed(2)} ms`);

  // one edit pulled from the server: the row is patched, no 100,000-row ids query, other rows keep their identity
  const keep = win.row(ids(10));
  const rebuilds = r.client.stats().listRebuilds;
  let k = 0;
  const editMs = measure("edit.patch1", () => { r.pull("calendar", ids(5), { title: `Edited ${++k}` }); const s = ready(l.getSnapshot()) as ListWindow<Calendar>; s.rows(0, 50); });
  assert.ok(editMs < FRAME_MS, `a pulled edit patched in ${editMs.toFixed(2)} ms`);
  assert.equal(ready(l.getSnapshot()).row(ids(5))?.title, `Edited ${k}`);
  assert.equal(r.client.stats().listRebuilds, rebuilds, "a title edit never re-ran the ids query");
  assert.strictEqual(ready(l.getSnapshot()).row(ids(10)), keep, "an untouched row is the same object");
});

test("a row added or hidden rebuilds the ids once and the window shows it", () => {
  const r = rig(5000);
  const l = r.client.list(list, {});
  const win = ready(l.getSnapshot());
  win.rows(0, 20);
  const before = r.client.stats().listRebuilds;
  r.pull("calendar", "cld_000000a", { title: "Inserted", state: "active" });
  const after = ready(l.getSnapshot());
  assert.equal(after.count, 5001);
  assert.equal(after.row("cld_000000a")?.title, "Inserted");
  assert.equal(r.client.stats().listRebuilds, before + 1);
  r.replica.hide("calendar", ids(3), 5_000);
  assert.equal(ready(l.getSnapshot()).count, 5001 - 1 + 0, "the hidden row is gone from the ids");
});

test("navigate over real reads: 20 screens from the generated index open under 50 ms first paint, 90 percent prefetched", () => {
  const r = rig(ROWS);
  const chosen = screens.filter((s) => Object.values(s.queries).some((q) => q.live)).slice(0, 20);
  assert.equal(chosen.length, 20, "the generated index has at least 20 screens with a live query");
  const defs = new Map<string, ReturnType<typeof asQuery>>();
  for (const s of chosen) for (const q of Object.values(s.queries)) {
    if (q.live) defs.set(q.cap, asQuery<unknown, Calendar[]>({ cap: q.cap, entities: ["calendar"], run: (db) => db.all(`SELECT id, title, version FROM "calendar_list" ORDER BY title LIMIT 200`) as unknown as Calendar[] }));
  }
  const sched = manualScheduler();
  const p = createPrefetcher({ client: r.client, screens: new Map(chosen.map((s) => [s.id, s])), defs, scheduler: sched });
  const paints: number[] = [];
  chosen.forEach((s, i) => {
    if (i % 2 === 0) { p.hover(s.id); sched.advance(60); } else p.focus(s.id);
    paints.push(p.open(s.id).firstPaintMs);
  });
  paints.sort((a, b) => a - b);
  const worst = paints[paints.length - 1] ?? 0;
  console.log(`METRIC navigate.first_paint median=${paints[10]!.toFixed(2)}ms worst=${worst.toFixed(2)}ms screens=20 rows=${ROWS} hit=${(p.stats().hitRate * 100).toFixed(0)}%`);
  assert.ok(p.stats().hitRate >= 0.9, `prefetched ${(p.stats().hitRate * 100).toFixed(0)} percent of opens`);
  assert.ok(worst < FIRST_PAINT_MS, `slowest first paint ${worst.toFixed(2)} ms is over ${FIRST_PAINT_MS} ms`);
});
