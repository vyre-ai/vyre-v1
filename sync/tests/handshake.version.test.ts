// P-L1_13 (ARCH 3.6, 5.2, spec 3.10): the server supports apps within 2 minor versions. An older app gets update_required and goes read-only: its writes are refused (and returned with their values),
// reads and pulls still work, an update lifts it, and revocation still beats everything. Real SQLite ledger, real push over the guarded dependencies.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import type { Tx } from "../../kernel/src/store/projection.ts";
import { pushOps } from "../src/server/push/index.ts";
import type { InvokeCall, PushDeps } from "../src/server/push/index.ts";
import type { Hello, ServerState } from "../src/protocol.ts";
import { createHandshake, decideHello, hashLists, minorsBehind, parseVersion, supportOf, updateRequiredError } from "../src/handshake/index.ts";
import type { Handshake, ReleaseTable } from "../src/handshake/index.ts";

const HLC = "0000000000ff-0001-dev1";
const TRACE = "0123456789abcdef0123456789abcdef";
const RELEASES: ReleaseTable = [
  { version: "1.0.0", registryHash: "h-1.0" }, { version: "1.1.2", registryHash: "h-1.1" }, { version: "1.2.0", registryHash: "h-1.2" },
  { version: "1.3.5", registryHash: "h-1.3" }, { version: "1.4.0", registryHash: "h-1.4" },
];
const server = (over: Partial<ServerState> = {}): ServerState => ({
  serverVersion: "1.4.0", epoch: 3, head: 50, serverHlc: HLC, registryHash: "h-1.4", compatibleRegistryHashes: [], olderRegistryHashes: [], entityVersions: { record: 2 }, ...over,
});
const hello = (over: Partial<Hello> = {}): Hello => ({ deviceId: "dev1", deviceClass: "desktop", appVersion: "1.4.0", registryHash: "h-1.4", cursor: 10, epoch: 3, replica: { entities: { record: 2 } }, ...over });

function tx(db = new DatabaseSync(":memory:")): Tx & { raw: DatabaseSync } {
  return {
    raw: db,
    run: (sql, ...a) => { const r = db.prepare(sql).run(...a); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; },
    get: <T>(sql: string, ...a: unknown[]) => db.prepare(sql).get(...(a as never[])) as T | undefined,
    all: <T>(sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as never[])) as T[],
    exec: (sql) => { db.exec(sql); },
  };
}
const rig = (state: Partial<ServerState> = {}, db = tx()): { hs: Handshake; db: ReturnType<typeof tx>; clock: { t: number } } => {
  const clock = { t: 1_000 };
  return { db, clock, hs: createHandshake({ db, state: () => server(state), releases: () => RELEASES, now: () => clock.t }) };
};
const errCode = (e: unknown): string | undefined => (e as { error?: { code?: string } }).error?.code;

test("support window: the server serves its own minor and two behind; further back and older majors are too old; ahead is newer; not a version is unknown", () => {
  const s = "1.4.2";
  for (const [app, want] of [
    ["1.4.0", "current"], ["1.4.9", "current"], ["1.3.0", "supported"], ["1.2.7", "supported"], ["v1.2.0", "supported"], ["1.2.0-rc.1", "supported"],
    ["1.1.9", "too_old"], ["1.0.0", "too_old"], ["0.9.0", "too_old"], ["1.5.0", "newer"], ["2.0.0", "newer"], ["dev", "unknown"], ["", "unknown"], ["1.4", "unknown"],
  ] as const) assert.equal(supportOf(app, s), want, `${app} against ${s}`);
  assert.equal(supportOf("2.9.0", "3.0.0"), "too_old", "an older major is always too old");
  assert.equal(supportOf("1.1.0", "1.4.0", 3), "supported", "the window is a parameter");
  assert.deepEqual(parseVersion("v10.20.30-beta.2+build"), { major: 10, minor: 20, patch: 30 });
  assert.equal(parseVersion("1.2"), null);
  assert.equal(minorsBehind("1.1.0", "1.4.0"), 3);
  assert.equal(minorsBehind("1.5.0", "1.4.0"), 0);
  assert.equal(minorsBehind("0.9.0", "1.4.0"), Number.POSITIVE_INFINITY);
});

test("registry hashes come from the release table: supported releases are compatible, older ones are known-older, the server's own is neither", () => {
  assert.deepEqual(hashLists(RELEASES, "1.4.0", "h-1.4"), { compatible: ["h-1.2", "h-1.3"], older: ["h-1.0", "h-1.1"] });
  assert.deepEqual(hashLists([...RELEASES, { version: "1.5.0", registryHash: "h-1.5" }], "1.4.0", "h-1.4").compatible, ["h-1.2", "h-1.3"], "a newer release is neither");
  assert.deepEqual(hashLists([{ version: "1.1.0", registryHash: "same" }, { version: "1.3.0", registryHash: "same" }], "1.4.0", "h-1.4"), { compatible: ["same"], older: [] });
});

test("an older app gets update_required, the others get live: current, one and two minors behind", () => {
  const cases: [string, string, string, string][] = [
    ["1.4.0", "h-1.4", "live", "ok"], ["1.3.5", "h-1.3", "live", "ok"], ["1.2.0", "h-1.2", "live", "ok"],
    ["1.1.2", "h-1.1", "update_required", "app_too_old"], ["1.0.0", "h-1.0", "update_required", "app_too_old"],
  ];
  for (const [v, h, mode, reason] of cases) {
    const r = decideHello(hello({ appVersion: v, registryHash: h }), server(), RELEASES);
    assert.equal(r.ok.mode, mode, `${v} gets ${mode}`);
    assert.equal(r.reason, reason, `${v}: ${reason}`);
  }
});

test("too old by version beats a matching hash: the app keeps its replica (no resync) and is only read-only", () => {
  const r = decideHello(hello({ appVersion: "1.0.0", registryHash: "h-1.4" }), server(), RELEASES);
  assert.equal(r.ok.mode, "update_required");
  assert.equal(r.support, "too_old");
});

test("an older hash with a supported version string is also update_required (the hash is the authority on what it can speak)", () => {
  const r = decideHello(hello({ appVersion: "1.3.0", registryHash: "h-1.1" }), server(), RELEASES);
  assert.equal(r.ok.mode, "update_required");
  assert.equal(r.reason, "registry_older");
});

test("revocation beats everything; resync reasons are named; a newer app on an older server is not blocked by version", () => {
  assert.equal(decideHello(hello({ appVersion: "1.0.0", epoch: 1 }), server(), RELEASES).ok.mode, "purge");
  assert.equal(decideHello(hello({ appVersion: "1.0.0", epoch: 1 }), server(), RELEASES).reason, "revoked");
  const drift = decideHello(hello({ registryHash: "h-unknown" }), server(), RELEASES);
  assert.deepEqual([drift.ok.mode, drift.reason], ["resync", "registry_changed"]);
  const ahead = decideHello(hello({ cursor: 999 }), server(), RELEASES);
  assert.deepEqual([ahead.ok.mode, ahead.reason], ["resync", "cursor_ahead"]);
  const schema = decideHello(hello({ replica: { entities: { record: 9 } } }), server(), RELEASES);
  assert.deepEqual([schema.ok.mode, schema.reason], ["resync", "schema_changed"]);
  const newer = decideHello(hello({ appVersion: "1.5.0", registryHash: "h-1.4" }), server(), RELEASES);
  assert.deepEqual([newer.ok.mode, newer.support], ["live", "newer"]);
});

test("server ledger: an older app's hello makes the device read-only; writes are refused with permission.update_required; other devices and unknown devices still write", () => {
  const { hs } = rig();
  const old = hs.hello({ person: "usr_ada", device: "dev1" }, hello({ appVersion: "1.0.0", registryHash: "h-1.0" }), TRACE);
  assert.equal(old.ok.mode, "update_required");
  assert.equal(hs.canWrite("usr_ada", "dev1"), false);
  assert.throws(() => hs.assertCanWrite("usr_ada", "dev1", TRACE), (e) => errCode(e) === "permission.update_required");
  assert.deepEqual(hs.seen("usr_ada", "dev1")?.mode, "update_required");
  hs.hello({ person: "usr_ada", device: "dev2" }, hello({ deviceId: "dev2" }), TRACE);
  assert.equal(hs.canWrite("usr_ada", "dev2"), true);
  assert.equal(hs.canWrite("usr_ada", "never_said_hello"), true);
  assert.equal(hs.canWrite("usr_bo", "dev1"), true, "the ledger is per person");
});

test("updating the app lifts read-only on the next hello; the ledger keeps the newest version, hash and time", () => {
  const { hs, clock } = rig();
  hs.hello({ person: "usr_ada", device: "dev1" }, hello({ appVersion: "1.0.0", registryHash: "h-1.0" }), TRACE);
  assert.equal(hs.canWrite("usr_ada", "dev1"), false);
  clock.t = 5_000;
  const ok = hs.hello({ person: "usr_ada", device: "dev1" }, hello(), TRACE);
  assert.equal(ok.ok.mode, "live");
  assert.equal(hs.canWrite("usr_ada", "dev1"), true);
  assert.deepEqual(hs.seen("usr_ada", "dev1"), { person: "usr_ada", device: "dev1", appVersion: "1.4.0", registryHash: "h-1.4", mode: "live", at: 5_000 });
});

test("the ledger is in SQLite: a restarted server still knows which devices are read-only; revoking forgets the row", () => {
  const db = tx();
  const first = rig({}, db);
  first.hs.hello({ person: "usr_ada", device: "dev1" }, hello({ appVersion: "1.0.0", registryHash: "h-1.0" }), TRACE);
  const again = rig({}, db);
  assert.equal(again.hs.canWrite("usr_ada", "dev1"), false);
  again.hs.hello({ person: "usr_ada", device: "dev1" }, hello({ appVersion: "1.0.0", registryHash: "h-1.0", epoch: 1 }), TRACE);
  assert.equal(again.hs.seen("usr_ada", "dev1"), undefined, "a purge leaves no row");
  first.hs.hello({ person: "usr_ada", device: "dev3" }, hello({ deviceId: "dev3", appVersion: "1.0.0", registryHash: "h-1.0" }), TRACE);
  first.hs.forget("usr_ada", "dev3");
  assert.equal(first.hs.canWrite("usr_ada", "dev3"), true);
});

test("a malformed hello or one for another device is refused before anything is remembered", () => {
  const { hs } = rig();
  assert.throws(() => hs.hello({ person: "usr_ada", device: "dev1" }, { deviceId: "dev1" }, TRACE), (e) => errCode(e) === "validation.bad_input");
  assert.throws(() => hs.hello({ person: "usr_ada", device: "dev1" }, hello({ deviceId: "dev_other" }), TRACE), (e) => errCode(e) === "validation.bad_input");
  assert.equal(hs.seen("usr_ada", "dev1"), undefined);
});

function pushDeps(calls: InvokeCall[]): PushDeps {
  const deps = {
    now: () => 1_000, hlc: () => HLC, epochOf: () => 3,
    invoke: async (call: InvokeCall) => { calls.push(call); return { kind: "applied" as const, seq: calls.length }; },
    clocks: () => ({}), appliedSeq: () => undefined, policy: () => "lww", restricted: () => false,
    history: () => undefined, openConflict: () => "cf_1",
    once: async <T>(_p: string, _c: string, _k: string, _i: unknown, run: () => Promise<T>) => run(),
  };
  return deps as unknown as PushDeps;
}
const op = (id: string) => ({ opId: id, traceId: TRACE, hlc: HLC, cap: "notes.create", v: 1, input: { title: `note ${id}` }, baseSeq: {} });

test("push from a read-only device: every op comes back rejected with its values and nothing is applied; a current device pushes normally", async () => {
  const { hs } = rig();
  hs.hello({ person: "usr_ada", device: "dev1" }, hello({ appVersion: "1.0.0", registryHash: "h-1.0" }), TRACE);
  hs.hello({ person: "usr_ada", device: "dev2" }, hello({ deviceId: "dev2" }), TRACE);
  const calls: InvokeCall[] = [];
  const guarded = hs.guardPushDeps(pushDeps(calls));

  const refused = await pushOps(guarded, { person: "usr_ada", device: "dev1" }, { deviceId: "dev1", epoch: 3, ops: [op("a"), op("b")] }, TRACE);
  assert.deepEqual(refused.applied, []);
  assert.deepEqual(refused.rejected.map((r) => [r.opId, r.error.code]), [["a", "permission.update_required"], ["b", "permission.update_required"]]);
  assert.deepEqual(refused.rejected.map((r) => r.copyOut), [{ title: "note a" }, { title: "note b" }], "what was typed on the old app can be copied out");
  assert.equal(calls.length, 0);

  const fine = await pushOps(guarded, { person: "usr_ada", device: "dev2" }, { deviceId: "dev2", epoch: 3, ops: [op("c")] }, TRACE);
  assert.equal(fine.applied.length, 1);
  assert.equal(calls.length, 1);

  // After the update the same device pushes again.
  hs.hello({ person: "usr_ada", device: "dev1" }, hello(), TRACE);
  const after = await pushOps(guarded, { person: "usr_ada", device: "dev1" }, { deviceId: "dev1", epoch: 3, ops: [op("d")] }, TRACE);
  assert.equal(after.applied.length, 1);
});

test("the error says what to do: update the app, nothing is lost, reading still works", () => {
  const e = updateRequiredError(TRACE, "1.0.0");
  assert.equal(e.error.code, "permission.update_required");
  assert.match(e.error.message, /read everything/);
  assert.match(e.error.message, /kept/);
  assert.equal(e.error.next[0]?.kind, "update_app");
  assert.equal(e.error.retryable, false);
  assert.ok(!/[—§]/.test(e.error.message), "no em dash or section sign in copy");
});
