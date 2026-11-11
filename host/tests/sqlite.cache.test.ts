// The host's prepared statement cache (host/src/daemon/sqlite.ts): a statement is prepared once per SQL text, the cache is bounded, a schema change never hands back a stale
// statement, and a closed database refuses every call.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { STATEMENT_CACHE, keptStatements, openDb } from "../src/daemon/sqlite.ts";

const file = (): string => path.join(fs.mkdtempSync(path.join(process.env["TMPDIR"] ?? os.tmpdir(), "sqlite-cache-")), "x.db");
const plain = (rows: unknown[]): unknown[] => rows.map((r) => ({ ...(r as object) }));

test("one statement per SQL text, and the cache stays within its bound", () => {
  const db = openDb(file());
  db.exec("CREATE TABLE t (a INTEGER)");
  for (let i = 0; i < 50; i++) db.run("INSERT INTO t (a) VALUES (?)", i);
  assert.equal(keptStatements(db), 1);
  for (let i = 0; i < STATEMENT_CACHE + 100; i++) db.all(`SELECT a FROM t WHERE a = ${i}`);
  assert.equal(keptStatements(db), STATEMENT_CACHE, "bounded");
  assert.deepEqual(plain(db.all("SELECT count(*) AS n FROM t")), [{ n: 50 }]);
  db.close();
});

test("a schema change never hands back a stale statement", () => {
  const db = openDb(file());
  db.exec("CREATE TABLE t (a INTEGER)");
  db.run("INSERT INTO t (a) VALUES (1)");
  assert.deepEqual(plain(db.all("SELECT * FROM t")), [{ a: 1 }]);
  db.exec("ALTER TABLE t ADD COLUMN b TEXT DEFAULT 'x'");
  assert.deepEqual(plain(db.all("SELECT * FROM t")), [{ a: 1, b: "x" }], "a column added");
  db.exec("DROP TABLE t; CREATE TABLE t (c TEXT, a INTEGER)");
  db.run("INSERT INTO t (c, a) VALUES ('z', 2)");
  assert.deepEqual(plain(db.all("SELECT * FROM t")), [{ c: "z", a: 2 }], "the table made again with other columns");
  db.exec("DROP TABLE t");
  assert.throws(() => db.all("SELECT * FROM t"), /no such table/, "a table that is gone");
  db.exec("CREATE TABLE t (a INTEGER)");
  assert.deepEqual(plain(db.all("SELECT * FROM t")), [], "and back");
  // a change made through another connection to the same file
  const f = file();
  const one = openDb(f), two = openDb(f);
  one.exec("CREATE TABLE u (a INTEGER)");
  one.run("INSERT INTO u (a) VALUES (1)");
  assert.deepEqual(plain(two.all("SELECT * FROM u")), [{ a: 1 }]);
  one.exec("ALTER TABLE u ADD COLUMN b INTEGER DEFAULT 7");
  assert.deepEqual(plain(two.all("SELECT * FROM u")), [{ a: 1, b: 7 }], "another connection's schema change is seen");
  one.close(); two.close();
  db.close();
});

test("a closed database refuses every call, and VACUUM and transactions still work with kept statements", () => {
  const db = openDb(file());
  db.exec("CREATE TABLE t (a INTEGER)");
  db.run("INSERT INTO t (a) VALUES (1)");
  db.all("SELECT a FROM t");
  db.exec("VACUUM");
  assert.throws(() => db.tx(() => { db.run("INSERT INTO t (a) VALUES (2)"); throw new Error("rolled back"); }), /rolled back/);
  assert.deepEqual(plain(db.all("SELECT a FROM t")), [{ a: 1 }], "the rolled back insert is not there");
  db.close();
  assert.equal(keptStatements(db), 0);
  assert.throws(() => db.all("SELECT a FROM t"));
  assert.throws(() => db.run("INSERT INTO t (a) VALUES (3)"));
});
