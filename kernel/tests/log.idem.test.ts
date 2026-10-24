import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LogClient, LogError, LogStore } from "../src/log/index.ts";
import { IdempotencyTable, IDEM_TTL_MS, createIdempotency } from "../src/idempotency/index.ts";

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "vyre-idem-"));

test("once: the same key runs once, repeats return the first result", async () => {
  const log = await LogClient.open({ path: path.join(dir(), "events.db"), space: "sp_1" });
  try {
    const idem = log.idempotency();
    let runs = 0;
    const act = () => idem.once("usr_dana", "records.update", "k1", { id: 1 }, async () => ({ n: ++runs }));
    assert.deepEqual(await act(), { n: 1 });
    assert.deepEqual(await act(), { n: 1 });
    assert.equal(runs, 1);
    assert.deepEqual(await idem.once("usr_sam", "records.update", "k1", { id: 1 }, async () => ({ n: ++runs })), { n: 2 }, "scoped to the principal");
    assert.deepEqual(await idem.once("usr_dana", "records.create", "k1", { id: 1 }, async () => ({ n: ++runs })), { n: 3 }, "scoped to the capability");
  } finally { await log.close(); }
});

test("once: different input under one key is a conflict; no key just runs", async () => {
  const log = await LogClient.open({ path: path.join(dir(), "events.db"), space: "sp_1" });
  try {
    const idem = log.idempotency();
    await idem.once("usr_dana", "c.x", "k", { a: 1 }, async () => 1);
    await assert.rejects(idem.once("usr_dana", "c.x", "k", { a: 2 }, async () => 2), (e: unknown) => e instanceof LogError && e.code === "idem_conflict");
    let n = 0;
    await idem.once("usr_dana", "c.x", undefined, {}, async () => ++n);
    await idem.once("usr_dana", "c.x", undefined, {}, async () => ++n);
    assert.equal(n, 2);
    await assert.rejects(idem.once("usr_dana", "c.x", "x".repeat(201), {}, async () => 1), (e: unknown) => e instanceof LogError && e.code === "bad_key");
  } finally { await log.close(); }
});

test("once: a failure frees the key; two racing callers share one run", async () => {
  const log = await LogClient.open({ path: path.join(dir(), "events.db"), space: "sp_1" });
  try {
    const idem = log.idempotency();
    await assert.rejects(idem.once("usr_dana", "c.x", "f", {}, async () => { throw new Error("boom"); }), /boom/);
    assert.equal(await idem.once("usr_dana", "c.x", "f", {}, async () => "retry ok"), "retry ok");
    let runs = 0;
    const slow = () => idem.once("usr_dana", "c.x", "race", { q: 1 }, async () => { await new Promise((r) => setTimeout(r, 20)); return ++runs; });
    const [a, b] = await Promise.all([slow(), slow()]);
    assert.deepEqual([a, b, runs], [1, 1, 1]);
  } finally { await log.close(); }
});

test("records survive a restart and expire after 30 days", () => {
  const file = path.join(dir(), "events.db");
  const store = new LogStore({ db: new DatabaseSync(file), space: "sp_1" });
  const t = new IdempotencyTable(store.db);
  const T0 = 1_800_000_000_000;
  assert.equal(t.put("a|b|k", "a", "b", { hash: "h", result: { v: 1 } }, T0), true);
  assert.equal(t.put("a|b|k", "a", "b", { hash: "h", result: { v: 2 } }, T0 + 1000), false, "first writer wins");
  store.close();
  const again = new IdempotencyTable(new LogStore({ db: new DatabaseSync(file), space: "sp_1" }).db);
  assert.deepEqual(again.get("a|b|k", T0 + 1000), { hash: "h", result: { v: 1 } });
  assert.deepEqual(again.get("a|b|k", T0 + IDEM_TTL_MS), { hash: "h", result: { v: 1 } });
  assert.equal(again.get("a|b|k", T0 + IDEM_TTL_MS + 1), null);
  assert.equal(again.put("a|b|k", "a", "b", { hash: "h2", result: 3 }, T0 + IDEM_TTL_MS + 5), true, "an expired key can be used again");
  assert.equal(again.purge(T0 + 2 * IDEM_TTL_MS + 10), 1);
});

test("an in-memory backend works too (createIdempotency takes any backend)", async () => {
  const m = new Map<string, { hash: string; result: unknown }>();
  const idem = createIdempotency({ get: (k) => m.get(k) ?? null, put: (k, _p, _c, r) => { m.set(k, r); } });
  let n = 0;
  assert.equal(await idem.once("p", "c", "k", null, async () => ++n), 1);
  assert.equal(await idem.once("p", "c", "k", null, async () => ++n), 1);
});
