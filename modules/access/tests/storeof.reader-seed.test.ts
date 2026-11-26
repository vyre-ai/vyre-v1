// A read never writes. On a Space whose access tables are empty (a fresh start, before the owner's claim) a read-only capability that finds no kept view gets the built-in roles and policies
// from memory; storeOf did write them to the tables, and that write could race the owner's claim (the removed warm-up did exactly this, and auth.entry failed at its next step under load).
import test from "node:test";
import assert from "node:assert/strict";
import { readOnly, storeOf } from "../projections.ts";
import type { AccessCtx, Db } from "../projections.ts";
import { ctxOf, fresh } from "../fixtures/incremental.ts";

const rows = (raw: { all: (sql: string) => unknown[] }, t: string): number => raw.all(`SELECT 1 FROM ${t}`).length;

test("a read-only capability on empty access tables answers from a seed in memory and writes nothing; a writer then seeds and keeps them", async () => {
  const { db: raw } = fresh("readseed");
  assert.equal(rows(raw, "access_roles"), 0, "a fresh Space has no roles in its tables");
  const ctx = ctxOf(raw);
  const writes: string[] = [];
  const db: Db = {
    all: (sql, ...a) => (ctx.db as Db).all(sql, ...a),
    run: (sql, ...a) => {
      writes.push(sql.slice(0, 40));
      return (ctx.db as Db).run(sql, ...a);
    },
  };
  const readerCtx = { ...ctx, db } as AccessCtx;
  const got = await readOnly(async (c: AccessCtx) => storeOf(c).roles.size)(readerCtx, undefined);
  assert.ok(got > 0, "the reader sees the built-in roles");
  assert.deepEqual(writes, [], "a read wrote nothing");
  assert.equal(rows(raw, "access_roles"), 0, "the tables are still empty after the read");
  // the writer's first call seeds and persists, as before
  storeOf(ctxOf(raw));
  assert.ok(rows(raw, "access_roles") > 0, "the writer persisted the built-in roles");
});
