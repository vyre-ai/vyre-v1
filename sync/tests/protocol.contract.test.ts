import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PULL_LIMIT, FRAME_TYPES, MAX_PULL_LIMIT, MAX_PUSH_OPS, MODES, decideMode, parseChange, parseFrame, parseHello, parseHelloOk, parseOp, parsePullReq, parsePullRes, parsePushReq, parsePushRes,
} from "../src/protocol.ts";
import type { Change, Hello, Op, ServerState } from "../src/protocol.ts";

const HLC = "0000000000ff-0001-dev1";
const hello = (over: Partial<Hello> = {}): Hello => ({ deviceId: "dev1", deviceClass: "desktop", appVersion: "1.0.0", registryHash: "reg-now", cursor: 10, epoch: 3, replica: { entities: { record: 2, task: 1 } }, ...over });
const server = (over: Partial<ServerState> = {}): ServerState => ({
  serverVersion: "1.0.0", epoch: 3, head: 50, serverHlc: HLC, registryHash: "reg-now", compatibleRegistryHashes: ["reg-prev"], olderRegistryHashes: ["reg-old", "reg-older"], entityVersions: { record: 2, task: 1 }, ...over,
});
const op = (over: Partial<Op> = {}): Op => ({ opId: "op-1", traceId: "0123456789abcdef0123456789abcdef", hlc: HLC, cap: "records.update", v: 1, entity: "record", id: "rec_1", input: { fields: { name: "x" }, base: { name: 4 } }, baseSeq: { name: 4 }, ...over });
const change = (over: Partial<Change> = {}): Change => ({ seq: 5, entity: "record", id: "rec_1", op: "patch", fields: { name: { v: "Ann", hlc: HLC, actor: "usr_dana" } }, ...over });

// ---- handshake ----
test("hello: the frozen shape parses, and each missing or wrong field is named", () => {
  const ok = parseHello(hello());
  assert.equal(ok.ok, true);
  for (const [bad, why] of [[{ deviceClass: "tv" }, /deviceClass/], [{ appVersion: "" }, /appVersion/], [{ registryHash: undefined }, /registryHash/], [{ cursor: -1 }, /cursor/], [{ epoch: 1.5 }, /epoch/], [{ replica: { entities: { record: "2" } } }, /replica/]] as const) {
    const r = parseHello({ ...hello(), ...bad });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, why);
  }
  assert.equal(parseHello(null).ok, false);
});

test("hello_ok: every mode parses; an unknown mode or a bad hlc does not", () => {
  for (const mode of MODES) assert.equal(parseHelloOk({ serverVersion: "1", epoch: 1, serverHlc: HLC, mode, head: 0, entityVersions: {} }).ok, true, mode);
  assert.deepEqual([...MODES], ["live", "update_required", "resync", "purge"]);
  assert.equal(parseHelloOk({ serverVersion: "1", epoch: 1, serverHlc: HLC, mode: "sleep", head: 0, entityVersions: {} }).ok, false);
  assert.equal(parseHelloOk({ serverVersion: "1", epoch: 1, serverHlc: "later", mode: "live", head: 0, entityVersions: {} }).ok, false);
});

test("decideMode: live for the current registry, and for a hash the server can still bridge", () => {
  assert.equal(decideMode(hello(), server()).mode, "live");
  assert.equal(decideMode(hello({ registryHash: "reg-prev" }), server()).mode, "live");
  const ok = decideMode(hello(), server());
  assert.deepEqual([ok.head, ok.epoch, ok.serverHlc, ok.entityVersions], [50, 3, HLC, { record: 2, task: 1 }]);
});

test("decideMode: an older registry hash is update_required (the client goes read-only)", () => {
  assert.equal(decideMode(hello({ registryHash: "reg-old" }), server()).mode, "update_required");
  assert.equal(decideMode(hello({ registryHash: "reg-older" }), server()).mode, "update_required");
});

test("decideMode: revocation beats everything; drift and a cursor from the future mean resync", () => {
  assert.equal(decideMode(hello({ epoch: 2, registryHash: "reg-old" }), server()).mode, "purge", "a lower epoch is revocation, even for an old client");
  assert.equal(decideMode(hello({ registryHash: "reg-unknown" }), server()).mode, "resync");
  assert.equal(decideMode(hello({ cursor: 51 }), server()).mode, "resync", "a cursor past the head: the server was restored from an older copy");
  assert.equal(decideMode(hello({ replica: { entities: { record: 3 } } }), server()).mode, "resync", "a replica schema ahead of the server");
  assert.equal(decideMode(hello({ replica: { entities: { widget: 1 } } }), server()).mode, "resync", "an entity the server no longer has");
  assert.equal(decideMode(hello({ replica: { entities: { record: 1 } } }), server({ breakingEntities: ["record"] })).mode, "resync", "a schema change incremental DDL cannot bridge");
  assert.equal(decideMode(hello({ replica: { entities: { record: 1 } } }), server()).mode, "live", "an older schema that DDL events can bridge");
});

// ---- pull ----
test("pull request: limit defaults to 2000, is capped at 5000, entities is a list of names", () => {
  const d = parsePullReq({ cursor: 0, epoch: 1 });
  assert.deepEqual(d.ok && d.value, { cursor: 0, epoch: 1, limit: DEFAULT_PULL_LIMIT });
  assert.equal(DEFAULT_PULL_LIMIT, 2000);
  assert.equal(parsePullReq({ cursor: 0, epoch: 1, limit: MAX_PULL_LIMIT }).ok, true);
  assert.equal(parsePullReq({ cursor: 0, epoch: 1, limit: MAX_PULL_LIMIT + 1 }).ok, false);
  assert.equal(parsePullReq({ cursor: 0, epoch: 1, limit: 0 }).ok, false);
  const e = parsePullReq({ cursor: 7, epoch: 1, entities: ["record"] });
  assert.deepEqual(e.ok && e.value.entities, ["record"]);
  assert.equal(parsePullReq({ cursor: 0, epoch: 1, entities: [""] }).ok, false);
  assert.equal(parsePullReq({ cursor: "0", epoch: 1 }).ok, false);
});

test("change: upsert, patch and delete; a field carries v, hlc and actor, ciphertext says how; a delete has no fields", () => {
  assert.equal(parseChange(change()).ok, true);
  assert.equal(parseChange(change({ op: "upsert" })).ok, true);
  assert.equal(parseChange(change({ op: "delete", fields: {} })).ok, true);
  assert.equal(parseChange(change({ op: "delete" })).ok, false);
  assert.equal(parseChange(change({ op: "merge" as never })).ok, false);
  assert.equal(parseChange(change({ fields: { name: { v: "x", hlc: "never", actor: "usr_dana" } } })).ok, false);
  assert.equal(parseChange(change({ fields: { name: { v: "ct", hlc: HLC, actor: "usr_dana", enc: { key: "k1", nonce: "n1" } } } })).ok, true);
  assert.equal(parseChange(change({ fields: { name: { v: "ct", hlc: HLC, actor: "usr_dana", enc: { key: "k1" } as never } } })).ok, false);
  assert.equal(parseChange({ ...change(), id: "" }).ok, false);
  assert.equal(parseChange(change({ fields: { name: { hlc: HLC, actor: "a" } as never } })).ok, false, "v is required, even when null");
  assert.equal(parseChange(change({ fields: { name: { v: null, hlc: HLC, actor: "usr_dana" } } })).ok, true);
});

test("pull result: changes ordered by seq, hide frames, next at least the last seq scanned, more, serverHlc", () => {
  const res = { epoch: 3, changes: [change({ seq: 5 }), change({ seq: 9 })], hide: [{ entity: "record", id: "rec_2", seq: 7 }], next: 12, more: true, serverHlc: HLC };
  assert.equal(parsePullRes(res).ok, true);
  assert.equal(parsePullRes({ ...res, changes: [change({ seq: 9 }), change({ seq: 5 })] }).ok, false, "out of order");
  assert.equal(parsePullRes({ ...res, next: 8 }).ok, false, "next behind the last returned change");
  assert.equal(parsePullRes({ ...res, hide: [{ entity: "record", id: "rec_2" }] }).ok, false);
  assert.equal(parsePullRes({ ...res, more: "yes" }).ok, false);
  assert.equal(parsePullRes({ ...res, reset: "purge", changes: [], hide: [] }).ok, true);
  assert.equal(parsePullRes({ ...res, reset: "wipe" }).ok, false);
  const withExtras = { ...res, conflicts: [{ id: "c1", entity: "record", rowId: "rec_1", field: "status", state: "open" }], rejected: [{ opId: "op-1", error: { code: "permission.denied", message: "no" }, copyOut: { name: "x" } }] };
  assert.equal(parsePullRes(withExtras).ok, true);
  assert.equal(parsePullRes({ ...withExtras, conflicts: [{ id: "c1" }] }).ok, false);
  assert.equal(parsePullRes({ ...withExtras, rejected: [{ opId: "op-1", error: { code: "x" }, copyOut: 1 }] }).ok, false);
});

// ---- push ----
test("op: the idempotency key, trace, hlc, capability and per-field base seqs are all required", () => {
  assert.equal(parseOp(op()).ok, true);
  for (const bad of [{ opId: "" }, { traceId: undefined }, { hlc: "soon" }, { cap: "" }, { v: 0 }, { baseSeq: { name: "4" } }, { after: { name: 7 } }, { enc: { key: "k" } }, { entity: "" }]) {
    assert.equal(parseOp({ ...op(), ...bad }).ok, false, JSON.stringify(bad));
  }
  const { input: _i, ...noInput } = op();
  assert.equal(parseOp(noInput).ok, false);
  assert.equal(parseOp(op({ after: { name: "op-0" }, enc: { key: "k", nonce: "n" } })).ok, true);
  assert.equal(parseOp(op({ input: null })).ok, true, "a capability call may take no input");
});

test("push request: at most 200 ops, each opId once", () => {
  assert.equal(MAX_PUSH_OPS, 200);
  const ops = (n: number) => Array.from({ length: n }, (_, i) => op({ opId: `op-${i}` }));
  assert.equal(parsePushReq({ deviceId: "dev1", epoch: 3, ops: ops(200) }).ok, true);
  const tooMany = parsePushReq({ deviceId: "dev1", epoch: 3, ops: ops(201) });
  assert.equal(tooMany.ok, false);
  if (!tooMany.ok) assert.match(tooMany.error, /200/);
  assert.equal(parsePushReq({ deviceId: "dev1", epoch: 3, ops: [op(), op()] }).ok, false, "a repeated opId");
  assert.equal(parsePushReq({ deviceId: "dev1", epoch: 3, ops: [] }).ok, true);
  assert.equal(parsePushReq({ deviceId: "", epoch: 3, ops: [] }).ok, false);
  assert.equal(parsePushReq({ deviceId: "dev1", epoch: 3, ops: [{ opId: "x" }] }).ok, false);
});

test("push result: applied, rejected (with copyOut), conflicts, held", () => {
  const res = { applied: [{ opId: "op-1", seq: 60 }], rejected: [{ opId: "op-2", error: { code: "permission.denied", message: "no" }, copyOut: { name: "x" } }], conflicts: [{ id: "c1", entity: "record", rowId: "rec_1", field: "status", state: "open", opId: "op-3" }], held: [{ opId: "op-4", taskId: "tsk_1" }], serverHlc: HLC };
  assert.equal(parsePushRes(res).ok, true);
  assert.equal(parsePushRes({ ...res, applied: [{ opId: "op-1" }] }).ok, false);
  assert.equal(parsePushRes({ ...res, held: [{ opId: "op-4" }] }).ok, false);
  assert.equal(parsePushRes({ ...res, serverHlc: "x" }).ok, false);
});

// ---- live frames ----
test("frames: every type in the table parses, an unknown type or a missing field does not", () => {
  assert.equal(FRAME_TYPES.length, new Set(FRAME_TYPES).size);
  const samples: Record<string, unknown> = {
    hello: { t: "hello", hello: hello() },
    hello_ok: { t: "hello_ok", ok: { serverVersion: "1", epoch: 1, serverHlc: HLC, mode: "live", head: 0, entityVersions: {} } },
    hb: { t: "hb", seq: 4 }, ack: { t: "ack", seq: 4 }, pull_hint: { t: "pull_hint", seq: 9 },
    ev: { t: "ev", seq: 6, items: [change()], hide: [{ entity: "record", id: "rec_9", seq: 6 }] },
    turn: { t: "turn", turn: "trn_1", delta: "hel" }, presence: { t: "presence", data: {} }, typing: { t: "typing", data: {} }, "computer.frame": { t: "computer.frame", data: "jpeg" },
    "ydoc.sync1": { t: "ydoc.sync1", doc: "doc_1", data: "sv" }, "ydoc.sync2": { t: "ydoc.sync2", doc: "doc_1", data: "u" }, "ydoc.update": { t: "ydoc.update", doc: "doc_1", data: "u" }, "ydoc.awareness": { t: "ydoc.awareness", doc: "doc_1", data: {} },
    purge: { t: "purge", epoch: 4 }, op: { t: "op", op: op() },
  };
  assert.deepEqual(Object.keys(samples).sort(), [...FRAME_TYPES].sort(), "one sample per frame type in the table");
  for (const [t, f] of Object.entries(samples)) { const r = parseFrame(f); assert.equal(r.ok, true, `${t}: ${r.ok ? "" : r.error}`); }
  assert.equal(parseFrame({ t: "dance" }).ok, false);
  assert.equal(parseFrame({ seq: 1 }).ok, false);
  assert.equal(parseFrame({ t: "hb" }).ok, false);
  assert.equal(parseFrame({ t: "ev", seq: 1, items: [{ seq: 1 }] }).ok, false);
  assert.equal(parseFrame({ t: "ydoc.update", data: "u" }).ok, false);
  assert.equal(parseFrame({ t: "purge" }).ok, false);
  assert.equal(parseFrame("hb").ok, false);
});

// ---- types ----
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
test("protocol.ts and this test typecheck under tsconfig.base.json, with the checker left on", { timeout: 120_000 }, () => {
  const files = ["sync/src/protocol.ts", "sync/tests/protocol.contract.test.ts"];
  for (const f of files) assert.ok(!new RegExp("@ts-" + "(nocheck|ignore|expect-error)").test(fs.readFileSync(path.join(REPO, f), "utf8")), `${f} must not switch the type checker off`);
  let cache = "";
  for (const d of ["/var/lib/ci-run/tsc-cache-v1", path.join(os.tmpdir(), "tsc-cache-v1")]) { try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); cache = d; break; } catch { /* next */ } }
  assert.ok(cache, "a writable cache directory");
  const tsc = path.join(cache, "node_modules/typescript/bin/tsc");
  if (!fs.existsSync(tsc)) {
    fs.writeFileSync(path.join(cache, "package.json"), '{"private":true}');
    const r = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", "typescript@5.9.3", "@types/node@24"], { cwd: cache, encoding: "utf8" });
    assert.equal(r.status, 0, `npm install failed: ${r.stderr}`);
  }
  const cfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tsc-")), "tsconfig.json");
  fs.writeFileSync(cfg, JSON.stringify({ extends: path.join(REPO, "tsconfig.base.json"), compilerOptions: { typeRoots: [path.join(cache, "node_modules/@types")], types: ["node"], noEmit: true }, files: files.map((f) => path.join(REPO, f)) }));
  const r = spawnSync(process.execPath, [tsc, "-p", cfg, "--pretty", "false"], { cwd: REPO, encoding: "utf8" });
  const mine = r.stdout.split("\n").filter((l) => /^(sync|lib)\/.*\(\d+,\d+\): error/.test(l));
  assert.deepEqual(mine.slice(0, 200), [], `${mine.length} type errors`);
});
