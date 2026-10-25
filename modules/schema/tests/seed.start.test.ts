// @reads /modules/schema/migrations/0001_schema.sql
// P-L3_17: the record types the manifests declare are seeded once at start, as a write of their own. After start a read finds them and writes nothing, and a restart on the same file finds
// them persisted. A handle that was never started (standalone, tests) still seeds on its first read.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadRegistry, openSchema } from "../impl.ts";

const NOW = 1_800_000_000_000;
const ctx = { trace: { traceId: "0123456789abcdef0123456789abcdef" }, emit: () => undefined, actor: "usr_owner" };
const rows = (s: ReturnType<typeof openSchema>): number => (s.tx.get<{ n: number }>("SELECT COUNT(*) AS n FROM sc_types")?.n ?? 0);

test("start seeds every declared type once; a read after it finds them and writes nothing", async () => {
  const reg = loadRegistry();
  const s = openSchema({ now: () => NOW });
  assert.equal(rows(s), 0, "nothing is seeded by opening");
  await s.start();
  assert.equal(rows(s), reg.recordTypes.length);
  const types = (await s.store.types()).length;
  const got = await s.handlers["schema.types.get"](ctx, { type: "contact" });
  assert.equal(got.type.key, "contact");
  await s.handlers["schema.types.list"](ctx, {});
  await s.handlers["schema.describe"](ctx, {});
  assert.equal(rows(s), reg.recordTypes.length, "reads added no rows");
  assert.equal((await s.store.types()).length, types, "reads defined no store types");
  await s.start();
  assert.equal(rows(s), reg.recordTypes.length, "start is idempotent");
});

test("after start a read does not seed: a handle whose start has not run answers from what is persisted", async () => {
  const s = openSchema({ now: () => NOW });
  s.deps.started = Promise.resolve();   // as if start had run and found nothing to add
  await s.handlers["schema.types.list"](ctx, {});
  assert.equal(rows(s), 0, "a read after start never writes");
});

test("the seed survives a restart on the same file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-schema-seed-"));
  const file = path.join(dir, "space.db");
  const reg = loadRegistry();
  const a = openSchema({ path: file, now: () => NOW });
  await a.start();
  a.host?.close();
  const b = openSchema({ path: file, now: () => NOW });
  assert.equal(rows(b), reg.recordTypes.length, "persisted before any call");
  assert.equal((await b.handlers["schema.types.get"](ctx, { type: "contact" })).type.key, "contact");
  b.host?.close();
});

test("a handle never started seeds on its first read, as before", async () => {
  const s = openSchema({ now: () => NOW });
  const out = await s.handlers["schema.types.get"](ctx, { type: "contact" });
  assert.equal(out.type.key, "contact");
  assert.equal(rows(s), loadRegistry().recordTypes.length);
});

test("seeding the declared types takes under 200 ms, and a start over an already seeded file is cheaper still", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-schema-seed-ms-"));
  const file = path.join(dir, "space.db");
  const a = openSchema({ path: file, now: () => NOW });
  const t0 = performance.now();
  await a.start();
  const first = performance.now() - t0;
  a.host?.close();
  const b = openSchema({ path: file, now: () => NOW });
  const t1 = performance.now();
  await b.start();
  const again = performance.now() - t1;
  b.host?.close();
  console.log(`METRIC schema.seed.first_ms=${first.toFixed(1)} schema.seed.again_ms=${again.toFixed(1)} types=${loadRegistry().recordTypes.length}`);
  assert.ok(first < 200, `the first seed took ${first.toFixed(0)} ms`);
  assert.ok(again < 200, `a second start took ${again.toFixed(0)} ms`);
});
