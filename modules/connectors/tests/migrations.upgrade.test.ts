// @reads /modules/connectors/migrations/0001_connectors.sql
// A Space at the rc.42 schema (migrations 0001 to 0006_creators applied, no revision table) updates to this line: 0007_revisions is applied once, every connector it already holds gets its own revision, and starting again changes nothing. A fresh install applies every migration.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ensureTables } from "../projections.ts";
import type { Tx } from "../../../kernel/src/store/projection.ts";

const dir = new URL("../migrations/", import.meta.url);
const RC42 = [
  "0001_connectors.sql",
  "0002_source_folders.sql",
  "0003_oauth.sql",
  "0004_sync_specs.sql",
  "0005_hosts.sql",
  "0006_creators.sql",
];

/** A transaction handle over a bare database: ensureTables only execs SQL. A new object each call stands for a new start of the server. */
const txOf = (db: DatabaseSync): Tx => ({ exec: (sql: string) => db.exec(sql) }) as unknown as Tx;
const tables = (db: DatabaseSync): string[] =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>
  ).map((r) => r.name);
const revs = (db: DatabaseSync): Array<{ key: string; rev: number }> =>
  (db.prepare("SELECT key, rev FROM cn_revisions ORDER BY key").all() as Array<{ key: string; rev: number }>).map(
    (r) => ({
      key: r.key,
      rev: r.rev,
    }),
  );

test("a Space at the rc.42 schema updates to the merge: 0007_revisions is applied once, each connector gets a revision, a second start changes nothing", () => {
  const db = new DatabaseSync(":memory:");
  for (const f of RC42) db.exec(readFileSync(new URL(f, dir), "utf8"));
  assert.ok(tables(db).includes("cn_connection_creators"), "rc.42's creators table is there");
  assert.ok(!tables(db).includes("cn_revisions"), "and there is no revision table yet");
  for (const [i, key] of ["alpha", "beta", "gamma"].entries())
    db.prepare(
      "INSERT INTO cn_connectors (key, title, mode, scope, builtin, version, state, def, created_at, updated_at) VALUES (?, ?, 'api', 'space', 0, '1.0.0', 'live', '{}', ?, ?)",
    ).run(key, key, 100 + i, 100 + i);
  ensureTables(txOf(db));
  const first = revs(db);
  assert.deepEqual(
    first.map((r) => r.key),
    ["alpha", "beta", "gamma"],
    "every connector it already held has a revision",
  );
  assert.equal(new Set(first.map((r) => r.rev)).size, 3, "each its own");
  assert.ok(first.every((r) => r.rev > 0));
  const seq = (db.prepare("SELECT n FROM cn_revision_seq WHERE id = 1").get() as { n: number }).n;
  assert.ok(seq >= Math.max(...first.map((r) => r.rev)), "the counter is past them all");
  assert.ok(tables(db).includes("cn_tested"), "0008_tested is applied by the same update");
  // the next start (a new transaction handle) runs the same migrations again and changes nothing
  ensureTables(txOf(db));
  assert.deepEqual(revs(db), first, "the same revisions");
  assert.equal(
    (db.prepare("SELECT n FROM cn_revision_seq WHERE id = 1").get() as { n: number }).n,
    seq,
    "the same counter",
  );
  // the creators rows of rc.42 are untouched by the update
  db.prepare("INSERT INTO cn_connection_creators (connection_id, created_by) VALUES ('c1', 'usr_a')").run();
  ensureTables(txOf(db));
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM cn_connection_creators").get() as { n: number }).n, 1);
  db.close();
});

test("a fresh install applies every migration, creators and revisions both, and a connector made after gets the next revision", () => {
  const db = new DatabaseSync(":memory:");
  ensureTables(txOf(db));
  const t = tables(db);
  for (const name of ["cn_connectors", "cn_connection_creators", "cn_revision_seq", "cn_revisions", "cn_tested"])
    assert.ok(t.includes(name), `${name} exists on a fresh install`);
  db.prepare(
    "INSERT INTO cn_connectors (key, title, mode, scope, builtin, version, state, def, created_at, updated_at) VALUES ('one', 'one', 'api', 'space', 0, '1.0.0', 'live', '{}', 1, 1)",
  ).run();
  assert.deepEqual(revs(db), [{ key: "one", rev: 1 }]);
  db.close();
});
