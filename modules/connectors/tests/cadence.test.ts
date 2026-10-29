// @reads /modules/connectors/migrations/0001_connectors.sql
// @reads /modules/sources/migrations/0001_sources.sql
// P-L3_18: sync cadence. A fake clock drives dueSyncs and runDue over the real cn_* and sy_* tables: types poll at 2 min when in use, 15 min idle and 1 h dormant, the nightly reconcile
// fires once a day, a paused type or one that needs review is left alone, and a new synced type asks on conflicts when it mirrors a sensitive-looking field.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOW, kit } from "../fixtures/kit.ts";
import type { Kit } from "../fixtures/kit.ts";
import { ensureSyncTables } from "../handlers/sync.ts";
import { ACTIVE_WINDOW_MS, DEFAULT_POLLING, DORMANT_AFTER_MS, USE_WRITE_EVERY_MS, conflictDefault, dueSyncs, noteUse, runDue, usedAtOf, useStateOf } from "../handlers/cadence.ts";
import { periodic } from "../impl.ts";

const SOURCES_SQL = readFileSync(new URL("../../sources/migrations/0001_sources.sql", import.meta.url), "utf8");
const MIN = 60_000;
// 2027-01-15 12:00 UTC: after the nightly hour, so use `midnight()` to test the reconcile and a morning clock for the polling
const NOON = Date.UTC(2027, 0, 15, 12, 0, 0);

function world(): Kit {
  const k = kit();
  k.tx.exec(SOURCES_SQL);
  ensureSyncTables(k.tx);
  k.tx.run("INSERT INTO cn_connections (connection_id, connector, title, owner_kind, owner_id, state, created_at) VALUES ('con_a', 'acme', 'Acme', 'space', 'space', 'connected', ?)", NOON - 30 * 86_400_000);
  return k;
}
let n = 0;
function bind(k: Kit, type: string, o: { polling?: object; nightly?: number; paused?: number; changes?: unknown[]; lastRun?: number; createdAt?: number } = {}): string {
  const id = `syt_${String(++n).padStart(4, "0")}`;
  k.tx.run(
    "INSERT INTO cn_synced_types (sync_type_id, type, connector, connection_id, remote, fields, match, polling, nightly, paused, schema_changes, created_at, updated_at) VALUES (?, ?, 'acme', 'con_a', 'x', '[]', '[]', ?, ?, ?, ?, ?, ?)",
    id, type, JSON.stringify(o.polling ?? DEFAULT_POLLING), o.nightly ?? 0, o.paused ?? 0, JSON.stringify(o.changes ?? []), o.createdAt ?? NOON - 30 * 86_400_000, NOON - 30 * 86_400_000,
  );
  if (o.lastRun !== undefined) k.tx.run("INSERT OR REPLACE INTO sy_state (sync_type, cursor, last_run_at, pending_deletes) VALUES (?, NULL, ?, NULL)", id, o.lastRun);
  return id;
}
const due = (k: Kit, now: number, used: Record<string, number> = {}) => dueSyncs({ tx: k.tx, now: () => now, usedAt: (t) => used[t] });

test("the defaults are 2 minutes, 15 minutes and 1 hour", () => {
  assert.deepEqual(DEFAULT_POLLING, { activeSec: 120, idleSec: 900, dormantSec: 3600 });
});

test("use state: looked at within 15 minutes is active, nothing known is idle, a week without a look is dormant", () => {
  assert.equal(useStateOf(NOON - 5 * MIN, NOON), "active");
  assert.equal(useStateOf(NOON - ACTIVE_WINDOW_MS, NOON), "active");
  assert.equal(useStateOf(NOON - ACTIVE_WINDOW_MS - 1, NOON), "idle");
  assert.equal(useStateOf(undefined, NOON), "idle");
  assert.equal(useStateOf(NOON - DORMANT_AFTER_MS, NOON), "dormant");
});

test("a type in use polls every 2 minutes, an idle one every 15, a dormant one every hour", () => {
  const k = world();
  const a = bind(k, "active_t", { lastRun: NOON - 119_000 });
  const i = bind(k, "idle_t", { lastRun: NOON - 14 * MIN });
  const d = bind(k, "dormant_t", { lastRun: NOON - 58 * MIN });
  const used = { active_t: NOON - MIN, dormant_t: NOON - 8 * 86_400_000 };
  assert.deepEqual(due(k, NOON, used), [], "nothing is due a second early");
  assert.deepEqual(due(k, NOON + 1_000, used).map((x) => [x.syncTypeId, x.useState]), [[a, "active"]], "active is due at 2 minutes");
  assert.deepEqual(due(k, NOON + MIN, used).map((x) => x.syncTypeId), [a, i], "idle is due at 15 minutes");
  assert.deepEqual(due(k, NOON + 2 * MIN, used).map((x) => [x.syncTypeId, x.useState]), [[a, "active"], [i, "idle"], [d, "dormant"]], "dormant is due at an hour");
  assert.ok(due(k, NOON, used).every((x) => x.mode === "incremental"));
});

test("a type's own polling row is the interval, and a run already asked for counts as the last turn", () => {
  const k = world();
  const own = bind(k, "own_t", { polling: { activeSec: 30, idleSec: 60, dormantSec: 300 }, lastRun: NOON - 61_000 });
  assert.deepEqual(due(k, NOON).map((x) => x.syncTypeId), [own], "idle on its own 60 s");
  k.tx.run("INSERT INTO cn_sync_requests (run_id, sync_types, mode, run_automations, requested_by, at) VALUES ('run_x', ?, 'incremental', 0, 'svc_host', ?)", JSON.stringify([own]), NOON - 10_000);
  assert.deepEqual(due(k, NOON), [], "a run asked for ten seconds ago is not asked for again");
});

test("a paused type, a type with schema changes to review and a connection that needs reconnecting are left alone", () => {
  const k = world();
  bind(k, "paused_t", { paused: 1 });
  bind(k, "review_t", { changes: [{ kind: "added" }] });
  const ok = bind(k, "ok_t");
  assert.deepEqual(due(k, NOON).map((x) => x.syncTypeId), [ok]);
  k.tx.run("UPDATE cn_connections SET state = 'needs_reconnect'");
  assert.deepEqual(due(k, NOON), []);
});

test("the nightly reconcile is due once a day from 03:00 UTC, and not before it", () => {
  const k = world();
  const id = bind(k, "night_t", { nightly: 1, lastRun: NOON - MIN });
  const twoAm = Date.UTC(2027, 0, 15, 2, 0, 0), threeAm = Date.UTC(2027, 0, 15, 3, 0, 0);
  k.tx.run("UPDATE sy_state SET last_run_at = ?", twoAm - MIN);
  assert.deepEqual(due(k, twoAm).filter((x) => x.mode === "reconcile"), [], "not before 03:00");
  k.tx.run("UPDATE sy_state SET last_run_at = ?", threeAm);
  const at = due(k, threeAm + MIN);
  assert.deepEqual(at.map((x) => [x.syncTypeId, x.mode]), [[id, "reconcile"]], "at 03:01 it is the reconcile");
  k.tx.run("INSERT INTO cn_sync_requests (run_id, sync_types, mode, run_automations, requested_by, at) VALUES ('run_n', ?, 'reconcile', 0, 'svc_host', ?)", JSON.stringify([id]), threeAm + MIN);
  assert.deepEqual(due(k, threeAm + 2 * MIN).filter((x) => x.mode === "reconcile"), [], "once it has been asked for, not again that day");
  assert.deepEqual(due(k, threeAm + 86_400_000 + MIN).map((x) => x.mode), ["reconcile"], "and again the next day");
  const off = bind(k, "no_night_t", { nightly: 0, lastRun: threeAm });
  assert.ok(!due(k, threeAm + MIN).some((x) => x.syncTypeId === off && x.mode === "reconcile"), "a type with the nightly reconcile off never gets one");
});

test("runDue starts sync_now for each due type once per slot, and one refusal does not stop the others", async () => {
  const k = world();
  const a = bind(k, "a_t", { lastRun: NOON - 20 * MIN });
  const b = bind(k, "b_t", { lastRun: NOON - 20 * MIN });
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const warns: string[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if ((input as { syncTypeId: string }).syncTypeId === a) throw { error: { message: "paused" } };
    return { runId: "run_1" };
  };
  const started = await runDue({ tx: k.tx, now: () => NOON }, call, { warn: (m) => { warns.push(m); } });
  assert.deepEqual(started.map((x) => x.syncTypeId), [b]);
  assert.deepEqual(calls.map((c) => c.cap), ["connectors.sync_now", "connectors.sync_now"]);
  assert.equal(warns.length, 1);
  const again = await runDue({ tx: k.tx, now: () => NOON + 1_000 }, async (_c, input) => { calls.push({ cap: "x", input: input as Record<string, unknown> }); return {}; });
  const key = (id: string, t: number): unknown => calls.find((c) => c.input["syncTypeId"] === id && c.input["idempotencyKey"] === `cadence:${id}:incremental:${Math.floor(t / (15 * MIN))}`);
  assert.ok(key(b, NOON), "the key names type, mode and slot");
  assert.equal(again.length, 2, "both are still due in the same slot, and the same key would make the capability a no-op");
  assert.equal(calls.filter((c) => c.input["syncTypeId"] === b).every((c) => c.input["idempotencyKey"] === `cadence:${b}:incremental:${Math.floor(NOON / (15 * MIN))}`), true);
});

test("the periodic hook runs dueSyncs on the live handle and calls connectors.sync_now through the host", () => {
  assert.equal(periodic["connectors.cadence"].everyMs, 30_000);
  assert.equal(typeof periodic["connectors.cadence"].run, "function");
});

test("a new synced type's conflict rule is newest, but asks when it mirrors a sensitive-looking field; a chosen rule stays", () => {
  const f = (remote: string, dir: "both" | "off" = "both") => ({ key: remote, remote, dir });
  assert.equal(conflictDefault([f("full_name"), f("email")], undefined), "newest");
  assert.equal(conflictDefault([f("full_name"), f("ssn")], undefined), "ask");
  assert.equal(conflictDefault([f("full_name"), f("date_of_birth")], undefined), "ask");
  assert.equal(conflictDefault([f("ssn", "off")], undefined), "newest", "a sensitive field that is Off is not mirrored, so nothing to ask about");
  assert.equal(conflictDefault([f("ssn")], "vyre"), "vyre", "a rule the person chose is kept");
  void NOW;
});

test("a type a person read polls at 2 minutes and one nobody read at 15; reading is written at most once a minute", () => {
  const k = world();
  const read = bind(k, "read_t", { lastRun: NOON - 3 * MIN });
  const unread = bind(k, "unread_t", { lastRun: NOON - 3 * MIN });
  assert.equal(usedAtOf(k.tx, "read_t"), undefined);
  noteUse(k.tx, "read_t", NOON - MIN);
  assert.equal(usedAtOf(k.tx, "read_t"), NOON - MIN);
  assert.deepEqual(dueSyncs({ tx: k.tx, now: () => NOON }).map((x) => [x.syncTypeId, x.useState]), [[read, "active"]], "the one somebody read is due at 3 minutes, the other is not");
  assert.ok(!dueSyncs({ tx: k.tx, now: () => NOON }).some((x) => x.syncTypeId === unread));
  assert.deepEqual(dueSyncs({ tx: k.tx, now: () => NOON + 13 * MIN }).map((x) => x.syncTypeId).sort(), [read, unread].sort(), "the unread type is due at 15 minutes");
  noteUse(k.tx, "read_t", NOON - MIN + 10_000);
  assert.equal(usedAtOf(k.tx, "read_t"), NOON - MIN, "a second look inside a minute writes nothing");
  noteUse(k.tx, "read_t", NOON - MIN + USE_WRITE_EVERY_MS);
  assert.equal(usedAtOf(k.tx, "read_t"), NOON - MIN + USE_WRITE_EVERY_MS, "and one a minute later does");
  assert.equal(useStateOf(NOON - MIN + USE_WRITE_EVERY_MS + ACTIVE_WINDOW_MS + 1, NOON + 20 * MIN), "idle");
});

test("looking at a synced type through sync_types.get and sync_types.log marks it as in use", async () => {
  const k = world();
  k.tx.exec("DELETE FROM cn_synced_types");
  bind(k, "viewed_t");
  assert.equal(usedAtOf(k.tx, "viewed_t"), undefined);
  await k.hs["sync_types.get"](k.ctx, { type: "viewed_t" });
  assert.equal(usedAtOf(k.tx, "viewed_t"), k.clock.t);
  k.tx.run("DELETE FROM cn_type_use");
  await k.hs["sync_types.log"](k.ctx, { type: "viewed_t" });
  assert.equal(usedAtOf(k.tx, "viewed_t"), k.clock.t);
});
