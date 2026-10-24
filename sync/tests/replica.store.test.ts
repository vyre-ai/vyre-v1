// Replica store: one write path, prepared statements at open, reopen, and edit.local.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { formatHlc } from "../../lib/hlc.ts";
import { CLIENT_SQL, parseTables, resolveEntities, resolveReplicaSql } from "../src/replica/ddl.ts";
import {
  ReplicaError, bindWaSqlite, createExpoDriver, createNodeDriver, createWaDriver, loadCatalog, loadReplicaSql, openReplica, openWaReplica,
} from "../src/replica/index.ts";
import { asRow, asValue, bind, isDuplicateColumn, quoteIdent, schemaChanged } from "../src/replica/sql.ts";
import type { ExpoDatabase, ExpoRunResult, ExpoStatement, SqlValue, WaDatabase, WaSqlite3, WaStatement } from "../src/replica/index.ts";

const ACTOR = "usr_ada";
const NOW = 1_700_000_000_000;

function hlc(ms: number, counter = 1): string {
  return formatHlc({ ms, counter, deviceId: "dev1" });
}

function scratch(): string {
  return path.join(os.tmpdir(), `vyre-replica-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}.db`);
}

function wipe(file: string): void {
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}-wal`, { force: true });
  fs.rmSync(`${file}-shm`, { force: true });
}

function args(params: readonly SqlValue[]): SqlValue[] {
  return [...params];
}

function wrapExpo(file = ":memory:"): ExpoDatabase {
  const db = new DatabaseSync(file);
  return {
    execSync(sql) {
      db.exec(sql);
    },
    prepareSync(sql): ExpoStatement {
      const stmt = db.prepare(sql);
      const query = /^\s*(select|pragma|with)\b/i.test(sql);
      return {
        executeSync(params: readonly SqlValue[] = []): ExpoRunResult {
          const bound = args(params);
          if (query) {
            const rows = stmt.all(...bound) as Record<string, unknown>[];
            return { getFirstSync: () => rows[0] ?? null, getAllSync: () => rows, changes: 0, lastInsertRowid: 0 };
          }
          const info = stmt.run(...bound) as { changes?: number; lastInsertRowid?: number | bigint };
          return {
            getFirstSync: () => null,
            getAllSync: () => [],
            changes: Number(info.changes ?? 0),
            lastInsertRowid: Number(info.lastInsertRowid ?? 0),
          };
        },
        finalizeSync() {},
      };
    },
    closeSync() {
      db.close();
    },
    withTransactionSync(fn) {
      db.exec("BEGIN IMMEDIATE");
      try {
        fn();
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

function wrapWa(file = ":memory:"): WaDatabase {
  const db = new DatabaseSync(file);
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async prepare(sql): Promise<WaStatement> {
      const stmt = db.prepare(sql);
      const query = /^\s*(select|pragma|with)\b/i.test(sql);
      let params: SqlValue[] = [];
      return {
        bind(next) {
          params = args(next);
        },
        async step() {
          if (query) stmt.all(...params);
          else stmt.run(...params);
          return false;
        },
        row() {
          return [];
        },
        columns() {
          return [];
        },
        reset() {
          params = [];
        },
        finalize() {},
      };
    },
    async get(sql, params) {
      const row = db.prepare(sql).get(...args(params)) as Record<string, unknown> | undefined;
      return row ? asRow(row) : undefined;
    },
    async all(sql, params) {
      const rows = db.prepare(sql).all(...args(params)) as Record<string, unknown>[];
      const out = [];
      for (const row of rows) {
        const mapped = asRow(row);
        if (mapped) out.push(mapped);
      }
      return out;
    },
    async close() {
      db.close();
    },
  };
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  return null;
}

test("open prepares statements, then one write invalidates and round-trips", async () => {
  let now = NOW;
  const store = openReplica({
    driver: createNodeDriver(),
    deviceClass: "desktop",
    registryHash: "hash-1",
    clock: () => now,
    blobBudgetBytes: 10,
  });
  try {
    assert.equal(store.deviceClass, "desktop");
    assert.equal(store.registryHash, "hash-1");
    assert.equal(store.upgraded, false);
    assert.ok(store.preparedCount > 50, `prepared ${store.preparedCount}`);
    assert.equal(store.getState("registry_hash"), "hash-1");
    assert.equal(store.getState("missing"), null);
    for (const name of ["fts", "pending_ops", "sync_state", "rejected", "conflicts_local", "doc_local", "blob_cache", "hide_seq", "replica_keep", "calendar_list", "chat_message"]) {
      assert.equal(store.hasTable(name), true, name);
    }
    assert.equal(store.hasTable("no_such_table"), false);

    let hits = 0;
    const stop = store.subscribe({ entity: "calendar", id: "cld_1" }, () => { hits += 1; });
    let other = 0;
    store.subscribe({ entity: "calendar", id: "cld_other" }, () => { other += 1; });
    const wrote = store.write({ entity: "calendar", id: "cld_1", fields: { title: "Standup" }, hlc: hlc(100, 2), actor: ACTOR });
    assert.deepEqual(wrote, { applied: true, reason: "ok" });
    assert.equal(hits, 1);
    assert.equal(other, 0);
    assert.equal(store.read("calendar", "cld_1")?.title, "Standup");
    assert.equal(num(store.read("calendar", "cld_1")?.version), 1);
    stop();
    const again = store.write({ entity: "calendar", id: "cld_1", fields: { title: "Standup 2" }, hlc: hlc(100, 3), actor: ACTOR });
    assert.equal(again.applied, true);
    assert.equal(hits, 1);
    assert.equal(num(store.read("calendar", "cld_1")?.version), 2);

    const stale = store.write({ entity: "calendar", id: "cld_1", fields: { title: "Old" }, hlc: hlc(100, 1), actor: ACTOR, origin: "mirror", seq: 1 });
    assert.deepEqual(stale, { applied: false, reason: "older" });
    assert.equal(store.read("calendar", "cld_1")?.title, "Standup 2");
    const fresh = store.write({ entity: "calendar", id: "cld_1", fields: { title: "Server" }, hlc: hlc(100, 4), actor: ACTOR, origin: "mirror", seq: 2 });
    assert.equal(fresh.applied, true);
    assert.equal(store.read("calendar", "cld_1")?.title, "Server");

    const message = store.write({ entity: "message", id: "msg_1", fields: { body: "hello team", thread: "thr_1", createdAt: NOW }, hlc: hlc(200), actor: ACTOR });
    assert.equal(message.applied, true);
    assert.deepEqual(store.readFts("message", "msg_1"), { title: "hello team", body: "" });

    const queued = store.write({
      entity: "calendar", id: "cld_out", fields: { title: "Queued" }, hlc: hlc(300), actor: ACTOR,
      op: { opId: "op-1", traceId: "trace-1", cap: "calendar.update", v: 1, input: "{}", baseSeq: "0" },
    });
    assert.equal(queued.applied, true);
    assert.equal(store.pendingCount(), 1);
    store.write({
      entity: "calendar", id: "cld_out", fields: { title: "Queued" }, hlc: hlc(301), actor: ACTOR,
      op: { opId: "op-1", traceId: "trace-1", cap: "calendar.update", v: 1, input: "{}", baseSeq: "0" },
    });
    assert.equal(store.pendingCount(), 1);

    store.hide("calendar", "cld_1", 4);
    assert.equal(store.read("calendar", "cld_1"), null);
    assert.equal(store.readFts("calendar", "cld_1"), null);
    const replay = store.write({ entity: "calendar", id: "cld_1", fields: { title: "Back" }, hlc: hlc(400), actor: ACTOR, origin: "mirror", seq: 4 });
    assert.deepEqual(replay, { applied: false, reason: "hidden" });
    const revived = store.write({ entity: "calendar", id: "cld_1", fields: { title: "Back" }, hlc: hlc(401), actor: ACTOR, origin: "mirror", seq: 5 });
    assert.equal(revived.applied, true);
    assert.equal(store.read("calendar", "cld_1")?.title, "Back");

    const small = new Uint8Array(6).fill(7);
    const large = new Uint8Array(6).fill(8);
    store.putBlob("h-a", small);
    const got = store.getBlob("h-a");
    assert.ok(got instanceof Uint8Array);
    assert.equal(got.length, 6);
    assert.equal(got[0], 7);
    now = NOW + 50;
    store.putBlob("h-b", large);
    assert.equal(store.getBlob("h-a"), null);
    assert.equal(store.getBlob("h-b")?.length, 6);

    assert.throws(() => store.write({ entity: "", id: "x", fields: {}, hlc: hlc(1), actor: ACTOR }), /entity and id/);
    assert.throws(() => store.write({ entity: "not_an_entity", id: "x", fields: {}, hlc: hlc(1), actor: ACTOR }), /no replica entity/);
    assert.throws(() => store.write({ entity: "calendar", id: "cld_bad", fields: { noSuch: "x" }, hlc: hlc(1), actor: ACTOR }), /not a column/);

    const loaded = await store.load("message", "msg_1");
    assert.equal(loaded?.body, "hello team");

    store.write({ entity: "calendar", id: "cld_perf", fields: { title: "warm" }, hlc: hlc(500), actor: ACTOR });
    let perfHits = 0;
    store.subscribe({ entity: "calendar", id: "cld_perf" }, () => { perfHits += 1; });
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const result = store.write({ entity: "calendar", id: "cld_perf", fields: { title: `edit ${i}` }, hlc: hlc(501 + i), actor: ACTOR });
      samples.push(performance.now() - t0);
      assert.equal(result.applied, true, result.reason);
    }
    assert.equal(perfHits, 5);
    const ordered = [...samples].sort((a, b) => a - b);
    const median = ordered[2];
    console.log(`PERF edit.local median ${String(median)} ms of 5 (budget 10 ms): ${ordered.map((x) => x.toFixed(3)).join(",")}`);
    assert.ok(typeof median === "number" && median < 10, `edit.local median ${String(median)} ms samples ${ordered.join(",")}`);

    await store.close();
    assert.throws(() => store.read("calendar", "cld_perf"), /closed/);
  } finally {
    await store.close();
  }
});

test("reopen keeps the row and a registry hash change rebuilds the schema", async () => {
  const file = scratch();
  try {
    const first = openReplica({ driver: createNodeDriver(file), deviceClass: "desktop", registryHash: "hash-a", clock: () => NOW });
    assert.equal(first.write({ entity: "calendar", id: "cld_keep", fields: { title: "Kept" }, hlc: hlc(1), actor: ACTOR }).applied, true);
    assert.equal(first.upgraded, false);
    first.write({ entity: "calendar", id: "cld_pend", fields: { title: "Queued" }, hlc: hlc(2), actor: ACTOR, op: { opId: "op_keep", traceId: "t1", cap: "calendar.update", v: 1, input: "{}", baseSeq: "{}" } });
    assert.equal(first.pendingCount(), 1);
    await first.close();

    const second = openReplica({ driver: createNodeDriver(file), deviceClass: "desktop", registryHash: "hash-a", clock: () => NOW });
    assert.equal(second.upgraded, false);
    assert.equal(second.read("calendar", "cld_keep")?.title, "Kept");
    assert.equal(second.getState("registry_hash"), "hash-a");
    await second.close();

    const third = openReplica({ driver: createNodeDriver(file), deviceClass: "desktop", registryHash: "hash-b", clock: () => NOW });
    assert.equal(third.upgraded, true);
    assert.equal(third.read("calendar", "cld_keep"), null);
    assert.equal(third.getState("registry_hash"), "hash-b");
    assert.equal(third.getState("needs_snapshot"), "1");
    assert.equal(third.pendingCount(), 1, "unsynced edits survive a schema rebuild");
    assert.equal(third.hasTable("fts"), true);
    assert.equal(third.write({ entity: "calendar", id: "cld_new", fields: { title: "New" }, hlc: hlc(2), actor: ACTOR }).applied, true);
    await third.close();
  } finally {
    wipe(file);
  }
});

test("expo adapter writes, invalidates and reads back", async () => {
  const store = openReplica({ driver: createExpoDriver(wrapExpo()), deviceClass: "desktop", registryHash: "hash-expo", clock: () => NOW });
  try {
    let hits = 0;
    store.subscribe({ entity: "message", id: "msg_e" }, () => { hits += 1; });
    const wrote = store.write({ entity: "message", id: "msg_e", fields: { body: "from expo", createdAt: NOW }, hlc: hlc(1), actor: ACTOR });
    assert.equal(wrote.applied, true);
    assert.equal(hits, 1);
    assert.equal(store.read("message", "msg_e")?.body, "from expo");
    assert.deepEqual(store.readFts("message", "msg_e"), { title: "from expo", body: "" });
    assert.equal(store.preparedCount > 50, true);
    const node = createNodeDriver();
    assert.equal(node.kind, "node");
    assert.equal(node.sync, true);
    node.close();
  } finally {
    await store.close();
  }
});

test("wa adapter applies in memory, reloads after flush, and rebuilds on a new registry hash", async () => {
  const file = scratch();
  try {
    const first = await openWaReplica(wrapWa(file), { deviceClass: "desktop", registryHash: "hash-wa", clock: () => NOW });
    let hits = 0;
    first.subscribe({ entity: "calendar", id: "cld_wa" }, () => { hits += 1; });
    const wrote = first.write({ entity: "calendar", id: "cld_wa", fields: { title: "Async" }, hlc: hlc(1), actor: ACTOR });
    assert.equal(wrote.applied, true);
    assert.equal(hits, 1);
    assert.equal(first.read("calendar", "cld_wa")?.title, "Async");
    await first.flush();
    assert.equal((await first.load("calendar", "cld_wa"))?.title, "Async");
    await first.close();

    const second = await openWaReplica(wrapWa(file), { deviceClass: "desktop", registryHash: "hash-wa", clock: () => NOW });
    assert.equal(second.upgraded, false);
    assert.equal((await second.load("calendar", "cld_wa"))?.title, "Async");
    await second.close();

    const third = await openWaReplica(wrapWa(file), { deviceClass: "desktop", registryHash: "hash-wa-2", clock: () => NOW });
    assert.equal(third.upgraded, true);
    assert.equal(await third.load("calendar", "cld_wa"), null);
    await third.close();
  } finally {
    wipe(file);
  }
});

test("expo driver caches statements and rolls a transaction back", () => {
  const log: string[] = [];
  let prepares = 0;
  const result: ExpoRunResult = { getFirstSync: () => ({ id: "1" }), getAllSync: () => [{ id: "1" }], changes: 1, lastInsertRowid: 1 };
  const db: ExpoDatabase = {
    execSync(sql) {
      log.push(sql);
      if (sql === "COMMIT") throw new Error("commit failed");
    },
    prepareSync() {
      prepares += 1;
      return { executeSync: () => result, finalizeSync() { log.push("finalize"); } };
    },
    closeSync() {
      log.push("close");
    },
  };
  const driver = createExpoDriver(db);
  assert.equal(driver.kind, "expo");
  assert.equal(driver.sync, true);
  const q = driver.prepare("SELECT id FROM t WHERE id = ?");
  assert.deepEqual(q.get(["1"]), { id: "1" });
  assert.deepEqual(q.all(["1"]), [{ id: "1" }]);
  q.run(["1"]);
  assert.equal(prepares, 1);
  driver.exec("CREATE TABLE t (id TEXT)");
  assert.ok(log.includes("finalize"));
  driver.prepare("SELECT id FROM t WHERE id = ?").get(["1"]);
  assert.equal(prepares, 2);
  assert.throws(() => driver.transaction(() => { driver.prepare("INSERT INTO t (id) VALUES (?)").run(["1"]); }), /commit failed/);
  assert.ok(log.includes("BEGIN IMMEDIATE"));
  assert.ok(log.includes("ROLLBACK"));
  driver.close();
  assert.ok(log.includes("close"));

  let used = false;
  const wrapped = createExpoDriver({
    execSync() {},
    prepareSync() {
      return { executeSync: () => ({ getFirstSync: () => null, getAllSync: () => [], changes: 0, lastInsertRowid: 0 }), finalizeSync() {} };
    },
    closeSync() {},
    withTransactionSync(fn) {
      used = true;
      fn();
    },
  });
  wrapped.transaction(() => { wrapped.prepare("SELECT 1").run([]); });
  assert.equal(used, true);
  wrapped.close();
});

test("wa driver queues sql, swallows a duplicate pending column, and bindWaSqlite maps rows", async () => {
  const log: string[] = [];
  const rolling = createWaDriver({
    async exec(sql) { log.push(sql); },
    async prepare() {
      return { bind() {}, async step() { throw new Error("step failed"); }, row: () => [], columns: () => [], reset() {}, finalize() {} };
    },
    async get() { return { id: "row-1", title: "Hello" }; },
    async all() { return []; },
    async close() { log.push("close"); },
  });
  assert.equal(rolling.kind, "wa");
  assert.equal(rolling.sync, false);
  const insert = rolling.prepare("INSERT INTO t (id) VALUES (?)");
  await rolling.flush();
  rolling.transaction(() => { insert.run(["1"]); });
  await assert.rejects(rolling.flush(), /step failed/);
  assert.ok(log.includes("BEGIN IMMEDIATE"));
  assert.ok(log.includes("ROLLBACK"));
  assert.equal(log.includes("COMMIT"), false);

  const reading = createWaDriver({
    async exec() {},
    async prepare() {
      return { bind() {}, async step() { return false; }, row: () => [], columns: () => [], reset() {}, finalize() {} };
    },
    async get(_sql, params) { return params[0] === "row-1" ? { id: "row-1", title: "Hello" } : undefined; },
    async all() { return []; },
    async close() {},
  });
  assert.deepEqual(await reading.query("SELECT id, title FROM t WHERE id = ?", ["row-1"]), { id: "row-1", title: "Hello" });
  assert.equal(await reading.query("SELECT id FROM t WHERE id = ?", ["missing"]), undefined);

  const dup = createWaDriver({
    async exec(sql) {
      if (sql.includes("ADD COLUMN pending")) throw new Error("duplicate column name: pending");
      if (sql.includes("BROKEN")) throw new Error("no such table");
    },
    async prepare() { throw new Error("not prepared"); },
    async get() { return undefined; },
    async all() { return []; },
    async close() {},
  });
  dup.exec("ALTER TABLE t ADD COLUMN pending INTEGER");
  await dup.flush();
  dup.exec("BROKEN");
  await assert.rejects(dup.flush(), /no such table/);

  let steps = 0;
  const sqlite3: WaSqlite3 = {
    async exec() {},
    async prepare_v2(_db, sql) { return sql === "bad" ? null : 4; },
    bind_collection() {},
    async step() { steps += 1; return steps === 1 ? 100 : 0; },
    column_count() { return 2; },
    column_name(_stmt, i) { return i === 0 ? "id" : "title"; },
    column(_stmt, i) { return i === 0 ? "id-1" : "Hello"; },
    reset() {},
    async finalize() {},
    async close() {},
  };
  const bound = bindWaSqlite(sqlite3, 3);
  assert.deepEqual(await bound.get("SELECT id, title FROM t", []), { id: "id-1", title: "Hello" });
  await assert.rejects(bound.prepare("bad"), (err: unknown) => err instanceof ReplicaError && err.code === "bad_sql");
  await bound.close();

  let allSteps = 0;
  const listed: WaSqlite3 = {
    async exec() {},
    async prepare_v2() { return 2; },
    bind_collection() {},
    async step() { allSteps += 1; return allSteps <= 2 ? 100 : 0; },
    column_count() { return 1; },
    column_name() { return "id"; },
    column() { return allSteps === 1 ? "a" : "b"; },
    reset() {},
    async finalize() {},
    async close() {},
  };
  const listedDb = bindWaSqlite(listed, 2);
  assert.deepEqual(await listedDb.all("SELECT id FROM t", []), [{ id: "a" }, { id: "b" }]);
  await listedDb.close();

  let namedSteps = 0;
  const named: WaSqlite3 = {
    async exec() {},
    async prepare_v2() { return 1; },
    bind_collection() {},
    async step() { namedSteps += 1; return namedSteps === 1 ? 7 : 0; },
    column_count() { return 1; },
    column_name() { return "ignored"; },
    column() { return "ignored"; },
    column_names() { return ["id"]; },
    row() { return ["only"]; },
    reset() {},
    async finalize() {},
    async close() {},
  };
  const namedDb = bindWaSqlite(named, 1, 7);
  assert.deepEqual(await namedDb.get("SELECT id FROM t", []), { id: "only" });
  await namedDb.close();
});

test("catalog, replica DDL and sql helpers load from the generated files", () => {
  const catalog = loadCatalog();
  assert.equal(loadCatalog(), catalog);
  const message = catalog.get("message");
  assert.ok(message);
  assert.equal(message.table, "chat_message");
  assert.equal(message.profile.phone, "window");
  assert.equal(message.window.days, 90);
  assert.equal(catalog.get("file_version")?.profile.phone, "none");
  assert.ok(catalog.get("client_plan")?.fieldLabels.taxId === 3);

  const ddl = loadReplicaSql();
  assert.equal(ddl.path, resolveReplicaSql());
  assert.equal(fs.existsSync(ddl.path), true);
  assert.equal(fs.existsSync(resolveEntities()), true);
  const calendar = ddl.tables.find((t) => t.name === "calendar_list");
  assert.ok(calendar);
  assert.equal(calendar.fm, false);
  const version = calendar.columns.find((c) => c.name === "version");
  assert.ok(version);
  assert.equal(version.notNull, true);
  assert.equal(version.hasDefault, true);
  assert.equal(version.defaultValue, 0);
  assert.equal(ddl.tables.find((t) => t.name === "calendar_list__fm")?.fm, true);
  assert.match(CLIENT_SQL, /CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5/);
  assert.match(CLIENT_SQL, /CREATE TABLE IF NOT EXISTS pending_ops/);
  assert.match(ddl.sql, /CREATE TABLE IF NOT EXISTS "calendar_list"/);

  const parsed = parseTables('CREATE TABLE IF NOT EXISTS "t" (\n  "id" TEXT PRIMARY KEY,\n  "n" INTEGER NOT NULL DEFAULT 0\n);');
  const table = parsed[0];
  assert.ok(table);
  assert.equal(table.name, "t");
  assert.equal(table.columns[1]?.defaultValue, 0);
  assert.throws(() => parseTables("SELECT 1"), (err: unknown) => err instanceof ReplicaError && err.code === "bad_ddl");
  assert.throws(() => parseTables('CREATE TABLE IF NOT EXISTS "t" (\n  PRIMARY KEY ("id")\n);'), /no columns/);

  assert.equal(quoteIdent("id"), '"id"');
  assert.throws(() => quoteIdent("a-b"), (err: unknown) => err instanceof ReplicaError && err.code === "bad_name");
  assert.equal(schemaChanged("CREATE TABLE t (id TEXT)"), true);
  assert.equal(schemaChanged("CREATE VIRTUAL TABLE fts USING fts5(body)"), true);
  assert.equal(schemaChanged("ALTER TABLE t ADD COLUMN pending INTEGER"), true);
  assert.equal(schemaChanged("DROP TABLE t"), true);
  assert.equal(schemaChanged("SELECT 1"), false);
  assert.equal(asValue(true), 1);
  assert.equal(asValue(false), 0);
  assert.equal(asValue(undefined), null);
  const bytes = new Uint8Array([1]);
  assert.equal(asValue(bytes), bytes);
  assert.equal(asRow(null), undefined);
  assert.deepEqual(asRow({ title: "A", on: true, n: 1 }), { title: "A", on: 1, n: 1 });
  const src = ["a"] as const;
  const copy = bind(src);
  assert.deepEqual(copy, ["a"]);
  assert.notEqual(copy, src);
  assert.equal(isDuplicateColumn(new Error("duplicate column name: pending")), true);
  assert.equal(isDuplicateColumn(new Error("no such table")), false);
});
