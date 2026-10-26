// The speed half of replica.store.test.ts (split out so only this file is a perf file, ruling 46); its functional tests stay in the original file and run on every PR.
// Replica store: one write path, prepared statements at open, reopen, and edit.local.
// Run with the other replica test file in one CI run so each shows its own ok line.
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
