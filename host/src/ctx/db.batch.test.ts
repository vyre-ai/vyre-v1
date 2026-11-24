// scopedDb offers batch only where the raw database has transactions (files.create_many refuses without it, so all or nothing holds).
import assert from "node:assert/strict";
import { test } from "node:test";
import { scopedDb, type RawDb } from "./db.ts";

test("scoped batch runs inside the raw transaction", () => {
  const log: string[] = [];
  const raw = {
    all: () => [],
    run: () => ({ changes: 0 }),
    tx<T>(fn: () => T): T {
      log.push("begin");
      const r = fn();
      log.push("commit");
      return r;
    },
  } as RawDb;
  const db = scopedDb("files", raw, "t1");
  assert.equal(typeof db.batch, "function");
  assert.equal(
    db.batch!(() => {
      log.push("work");
      return 7;
    }),
    7,
  );
  assert.deepEqual(log, ["begin", "work", "commit"]);
});

test("scoped batch is absent when the raw database has no transactions", () => {
  const raw: RawDb = { all: () => [], run: () => ({ changes: 0 }) };
  assert.equal(scopedDb("files", raw, "t2").batch, undefined);
});
