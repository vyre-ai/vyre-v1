// backup.run and its parts (P-L7b_05; spec 5 Backups and export, 2.26): an encrypted backup restores byte-identical, targets, signing, schedule, rotation, health.
// @reads ../migrations/0001_init.sql

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { MEMORY_TARGET, NOW, world } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";
import { configureBackup, handlers } from "../handlers/index.ts";
import {
  DAY_MS, KEEP, dirTarget, exportBlocked, mergeTombstones, nextRun, pack, parseCron, pathProblem, readConfig, readIndex, s3Target, sha256Hex, signV4, signingKey, unpack, unwrap, wrap, zip,
} from "../handlers/run.ts";
import type { BackupCtx } from "../handlers/run.ts";

type Fn = (ctx: BackupCtx, input: never) => Promise<unknown>;
const call = (name: string, ctx: BackupCtx, input: unknown): Promise<unknown> => {
  const fn = (handlers as unknown as Record<string, Fn>)[name];
  assert.ok(fn, `a handler for ${name}`);
  return fn(ctx, input as never);
};
const dec = new TextDecoder();
const enc = new TextEncoder();

async function ready(o: { encrypt?: boolean } = {}): Promise<World> {
  const w = world(o);
  configureBackup(w.drivers);
  await w.space.append("contact/ada", "Ada Lovelace, ada@example.com");
  await w.space.append("contact/bob", "Bob Barker, bob@example.com");
  w.space.blobs.set("fil_1", "the engagement letter");
  await call("backup.config_set", w.ctx, { target: MEMORY_TARGET, schedule: "0 3 * * *", enabled: true });
  w.events.length = 0;
  w.scheduled.length = 0;
  return w;
}

const failed = async (p: Promise<unknown>): Promise<VyreErr> => {
  try { await p; } catch (e) { assert.ok(e instanceof VyreErr, "a typed error"); return e; }
  throw new Error("expected the call to fail");
};

afterEach(() => configureBackup(null));

test("an encrypted backup restores byte-identical projections", async () => {
  const w = await ready();
  const { backupId } = await call("backup.run", w.ctx, {}) as { backupId: string };
  assert.match(backupId, /^bkp_[a-z0-9]+$/);

  const blob = w.target.objects.get(`b/${backupId}.vybk`);
  assert.ok(blob, "the archive is on the target");
  const text = dec.decode(blob);
  for (const secret of ["Ada Lovelace", "ada@example.com", "engagement letter", "events.json"]) assert.ok(!text.includes(secret), `${secret} does not appear on the target`);
  assert.equal((JSON.parse(text) as { enc: boolean }).enc, true);

  // what the Space held at the time
  const before = await w.space.snapshot();
  const { header, entries } = await unpack(unwrap(w.ctx, blob));
  assert.equal(header.backupId, backupId);
  assert.equal(header.toSeq, 2);
  assert.equal(header.headHash, before.headHash);
  assert.deepEqual(entries.map((e) => e.path), before.entries.map((e) => e.path));
  for (const [i, e] of entries.entries()) assert.deepEqual(e.bytes, before.entries[i]!.bytes, `${e.path} is byte-identical`);

  // a brand new Space is given the archive
  const fresh = world();
  const result = await fresh.space.restore({ fromSeq: header.fromSeq, toSeq: header.toSeq, headHash: header.headHash, entries }, [], "live");
  assert.equal(result.chainOk, true);
  assert.equal(result.checkedEvents, 2);
  const after = await fresh.space.snapshot();
  for (const [i, e] of after.entries.entries()) assert.deepEqual(e.bytes, before.entries[i]!.bytes, `${e.path} comes back byte-identical`);
  assert.equal(after.headHash, before.headHash);

  assert.deepEqual(w.events.map((e) => e.name), ["backup.completed"]);
  assert.deepEqual(w.events[0]!.payload, { backupId, seq: 2, sizeBytes: blob.length });
});

test("with backup.encrypt off the archive is plain and says so", async () => {
  const w = await ready({ encrypt: false });
  const { backupId } = await call("backup.run", w.ctx, {}) as { backupId: string };
  const blob = w.target.objects.get(`b/${backupId}.vybk`)!;
  assert.equal((JSON.parse(dec.decode(blob)) as { enc: boolean }).enc, false);
  const out = await call("backup.config_get", w.ctx, {}) as { encrypted: boolean };
  assert.equal(out.encrypted, false);
  const { entries } = await unpack(unwrap(w.ctx, blob));
  assert.ok(entries.some((e) => e.path === "events.json"));
});

test("the index and the tombstone list sit next to the archive, sealed", async () => {
  const w = await ready();
  const { backupId } = await call("backup.run", w.ctx, {}) as { backupId: string };
  assert.deepEqual([...w.target.objects.keys()].sort(), [`b/${backupId}.vybk`, "index.vybk", "tombstones.vybk"]);
  assert.ok(!dec.decode(w.target.objects.get("index.vybk")!).includes(backupId), "the index is sealed");
  const index = await readIndex(w.ctx, w.target);
  assert.equal(index.length, 1);
  assert.equal(index[0]!.backupId, backupId);
});

test("a tampered or truncated archive is refused", async () => {
  const w = await ready();
  const archive = await pack({ backupId: "bkp_x", at: NOW, fromSeq: 1, toSeq: 1, headHash: "h", tombstones: [] }, [{ path: "a.txt", bytes: enc.encode("hello world") }]);
  const flipped = archive.slice();
  flipped[flipped.length - 1] = flipped[flipped.length - 1]! ^ 0xff;
  await assert.rejects(unpack(flipped), /does not match its hash/);
  await assert.rejects(unpack(archive.subarray(0, archive.length - 3)), /cut short/);
  await assert.rejects(unpack(enc.encode("not an archive at all")), /not a Vyre backup archive/);
  // sealed bytes changed on the target: the seal does not open
  const sealed = wrap(w.ctx, archive, true);
  const doc = JSON.parse(dec.decode(sealed)) as { bytes: string };
  doc.bytes = `${doc.bytes.slice(0, 8)}${doc.bytes[8] === "a" ? "b" : "a"}${doc.bytes.slice(9)}`;
  assert.throws(() => unwrap(w.ctx, enc.encode(JSON.stringify(doc))));
});

test("a failure while copying emits backup.failed, records the attempt and lists nothing", async () => {
  const w = await ready();
  w.space.failSnapshot = true;
  const { backupId } = await call("backup.run", w.ctx, {}) as { backupId: string };
  assert.deepEqual(w.events.map((e) => e.name), ["backup.failed"]);
  assert.deepEqual(w.events[0]!.payload, { backupId, reason: "the disk is full" });
  const list = await call("backup.list", w.ctx, {}) as { backups: unknown[]; total: number };
  assert.deepEqual([list.backups.length, list.total], [0, 0]);
  assert.equal(readConfig(w.ctx).lastOkAt, null);
  const row = w.raw.rows("backup_item")[0]!;
  assert.deepEqual([row["state"], row["reason"]], ["failed", "the disk is full"]);
  // it cannot be restored
  const err = await failed(call("backup.restore", w.ctx, { backupId, confirm: true }));
  assert.equal(err.error.code, "validation.not_found");
});

test("a target that is down fails the run the same way", async () => {
  const w = await ready();
  w.target.down = true;
  await call("backup.run", w.ctx, {});
  assert.deepEqual(w.events.map((e) => e.name), ["backup.failed"]);
  assert.match(String((w.events[0]!.payload as { reason: string }).reason), /target is down/);
});

test("running without a target is refused before anything is copied", async () => {
  const w = world();
  configureBackup(w.drivers);
  const err = await failed(call("backup.run", w.ctx, {}));
  assert.equal(err.error.code, "validation.precondition_failed");
  assert.deepEqual(w.events, []);
});

test("the drivers must be wired", async () => {
  const w = world();
  configureBackup(null);
  const err = await failed(call("backup.run", w.ctx, {}));
  assert.equal(err.error.code, "internal.unavailable");
});

test("list pages newest first and carries the row shape", async () => {
  const w = await ready();
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    w.setNow(NOW + i * 1000);
    ids.push((await call("backup.run", w.ctx, {}) as { backupId: string }).backupId);
  }
  const first = await call("backup.list", w.ctx, { limit: 2 }) as { backups: { backupId: string; kind: string; verified: boolean; target: string; seq: number }[]; next?: string; total: number };
  assert.deepEqual(first.backups.map((b) => b.backupId), [ids[2], ids[1]]);
  assert.equal(first.next, "2");
  assert.equal(first.total, 3);
  assert.deepEqual([first.backups[0]!.kind, first.backups[0]!.verified, first.backups[0]!.target, first.backups[0]!.seq], ["manual", false, "local:/srv/vyre-backups", 2]);
  const second = await call("backup.list", w.ctx, { limit: 2, cursor: "2" }) as { backups: { backupId: string }[]; next?: string };
  assert.deepEqual(second.backups.map((b) => b.backupId), [ids[0]]);
  assert.equal(second.next, undefined);
});

test("a new machine finds its backups through the target's index", async () => {
  const w = await ready();
  const { backupId } = await call("backup.run", w.ctx, {}) as { backupId: string };
  // same target and same Space key, an empty database
  const other = world();
  configureBackup({ ...other.drivers, openTarget: async () => w.target });
  Object.assign(other.ctx, { seal: w.ctx.seal });
  await call("backup.config_set", other.ctx, { target: MEMORY_TARGET, schedule: "0 3 * * *", enabled: false });
  const list = await call("backup.list", other.ctx, {}) as { backups: { backupId: string }[] };
  assert.deepEqual(list.backups.map((b) => b.backupId), [backupId]);
});

test("rotation keeps the newest backups and deletes the rest from the target", async () => {
  const w = await ready();
  const ids: string[] = [];
  for (let i = 0; i < KEEP + 2; i++) {
    w.setNow(NOW + i * 1000);
    ids.push((await call("backup.run", w.ctx, {}) as { backupId: string }).backupId);
  }
  const list = await call("backup.list", w.ctx, { limit: 500 }) as { backups: { backupId: string }[]; total: number };
  assert.equal(list.total, KEEP);
  assert.deepEqual(list.backups.map((b) => b.backupId), ids.slice(2).reverse());
  assert.ok(!w.target.objects.has(`b/${ids[0]}.vybk`) && !w.target.objects.has(`b/${ids[1]}.vybk`));
  assert.equal((await readIndex(w.ctx, w.target)).length, KEEP);
});

test("erasing a person purges the older backups that still hold them at the next backup", async () => {
  const w = await ready();
  w.setNow(NOW);
  const old = (await call("backup.run", w.ctx, {}) as { backupId: string }).backupId;
  w.setNow(NOW + 1000);
  const mid = (await call("backup.run", w.ctx, {}) as { backupId: string }).backupId;
  w.space.erase("contact/ada", NOW + 2000);
  w.setNow(NOW + 3000);
  const fresh = (await call("backup.run", w.ctx, {}) as { backupId: string }).backupId;
  const list = await call("backup.list", w.ctx, {}) as { backups: { backupId: string }[] };
  assert.deepEqual(list.backups.map((b) => b.backupId), [fresh]);
  assert.ok(!w.target.objects.has(`b/${old}.vybk`) && !w.target.objects.has(`b/${mid}.vybk`));
  // the tombstone list on the target now names the erasure
  const tomb = JSON.parse(dec.decode(unwrap(w.ctx, w.target.objects.get("tombstones.vybk")!))) as { tombstones: { subject: string }[] };
  assert.deepEqual(tomb.tombstones.map((t) => t.subject), ["contact/ada"]);
});

test("delete removes the file from the target and the list", async () => {
  const w = await ready();
  const a = (await call("backup.run", w.ctx, {}) as { backupId: string }).backupId;
  w.setNow(NOW + 1000);
  const b = (await call("backup.run", w.ctx, {}) as { backupId: string }).backupId;
  assert.deepEqual(await call("backup.delete", w.ctx, { backupId: a }), { deleted: true });
  assert.ok(!w.target.objects.has(`b/${a}.vybk`));
  assert.deepEqual((await readIndex(w.ctx, w.target)).map((i) => i.backupId), [b]);
  const err = await failed(call("backup.delete", w.ctx, { backupId: a }));
  assert.equal(err.error.code, "validation.not_found");
});

test("config_set checks the target, proves a write and arms the schedule", async () => {
  const w = world();
  configureBackup(w.drivers);
  const bad = async (input: unknown): Promise<string> => (await failed(call("backup.config_set", w.ctx, input))).error.message;
  assert.match(await bad({ target: { kind: "local" }, schedule: "0 3 * * *", enabled: true }), /folder/i);
  assert.match(await bad({ target: { kind: "local", path: "relative/dir" }, schedule: "0 3 * * *", enabled: true }), /full path/);
  assert.match(await bad({ target: { kind: "local", path: "/srv/../etc" }, schedule: "0 3 * * *", enabled: true }), /\.\./);
  assert.match(await bad({ target: { kind: "s3", bucket: "b", region: "us-east-1" }, schedule: "0 3 * * *", enabled: true }), /Vault item/);
  assert.match(await bad({ target: { kind: "s3", bucket: "b", region: "us-east-1", vaultName: "S3_KEY", path: "/abs" }, schedule: "0 3 * * *", enabled: true }), /plain name/);
  assert.match(await bad({ target: MEMORY_TARGET, schedule: "every night", enabled: true }), /five fields/);
  w.target.down = true;
  assert.match(await bad({ target: MEMORY_TARGET, schedule: "0 3 * * *", enabled: true }), /did not accept a test write/);
  assert.equal(readConfig(w.ctx).target, null, "nothing was saved");

  w.target.down = false;
  w.setNow(NOW);
  assert.deepEqual(await call("backup.config_set", w.ctx, { target: MEMORY_TARGET, schedule: "30 2 * * *", enabled: true }), { ok: true });
  const cfg = readConfig(w.ctx);
  assert.deepEqual([cfg.target, cfg.schedule, cfg.enabled], [MEMORY_TARGET, "30 2 * * *", true]);
  const cron = parseCron("30 2 * * *")!;
  assert.equal(cfg.nextAt, nextRun(cron, NOW));
  assert.deepEqual(w.scheduled, [{ at: cfg.nextAt, cap: "backup.run", input: {} }]);
  assert.deepEqual(w.events.map((e) => e.name), ["backup.config_changed"]);
  assert.deepEqual(w.events[0]!.payload, { target: "local:/srv/vyre-backups", schedule: "30 2 * * *" });

  // switching off schedules nothing and the event says so
  w.scheduled.length = 0;
  await call("backup.config_set", w.ctx, { target: MEMORY_TARGET, schedule: "30 2 * * *", enabled: false });
  assert.deepEqual(w.scheduled, []);
  assert.equal(readConfig(w.ctx).nextAt, null);
  assert.equal((w.events.at(-1)!.payload as { schedule: string }).schedule, "off");
});

test("the scheduled run continues the chain; a manual run before it does not start another", async () => {
  const w = await ready();
  const nextAt = readConfig(w.ctx).nextAt!;
  assert.ok(nextAt > NOW);
  // a button press before the time: manual, nothing armed
  await call("backup.run", w.ctx, {});
  assert.deepEqual(w.scheduled, []);
  assert.equal(w.raw.rows("backup_item")[0]!["kind"], "manual");
  // the scheduler fires at the armed time: scheduled, and the next one is armed
  w.setNow(nextAt);
  await call("backup.run", w.ctx, {});
  assert.equal(w.raw.rows("backup_item").find((r) => r["at"] === nextAt)!["kind"], "scheduled");
  assert.equal(w.scheduled.length, 1);
  assert.equal(w.scheduled[0]!.cap, "backup.run");
  const armed = readConfig(w.ctx).nextAt!;
  assert.equal(armed, nextAt + DAY_MS);
  assert.equal(w.scheduled[0]!.at, armed);
  // a stale duplicate of the job that fires just after: manual, so the chain is not doubled
  w.scheduled.length = 0;
  w.setNow(nextAt + 1000);
  await call("backup.run", w.ctx, {});
  assert.deepEqual(w.scheduled, []);
  assert.equal(readConfig(w.ctx).nextAt, armed);
});

test("a job that fires after the switch was turned off takes a manual backup and arms nothing", async () => {
  const w = await ready();
  await call("backup.config_set", w.ctx, { target: MEMORY_TARGET, schedule: "0 3 * * *", enabled: false });
  w.scheduled.length = 0;
  w.setNow(NOW + 2 * DAY_MS);
  await call("backup.run", w.ctx, {});
  assert.equal(w.raw.rows("backup_item")[0]!["kind"], "manual");
  assert.deepEqual(w.scheduled, []);
});

test("health reads the age of the last good backup and whether the target takes a write", async () => {
  const w = world();
  configureBackup(w.drivers);
  assert.deepEqual(await call("backup.health", w.ctx, {}), { state: "degraded", detail: "No backup target is set." });
  const r = await ready();
  assert.equal(((await call("backup.health", r.ctx, {})) as { state: string }).state, "degraded");
  await call("backup.run", r.ctx, {});
  const fresh = await call("backup.health", r.ctx, {}) as { state: string; ageHours: number };
  assert.deepEqual([fresh.state, fresh.ageHours], ["healthy", 0]);
  r.setNow(NOW + 31 * 3_600_000);
  assert.equal(((await call("backup.health", r.ctx, {})) as { state: string }).state, "degraded");
  r.setNow(NOW + 73 * 3_600_000);
  assert.equal(((await call("backup.health", r.ctx, {})) as { state: string }).state, "down");
  r.setNow(NOW);
  r.target.down = true;
  const down = await call("backup.health", r.ctx, {}) as { state: string; detail: string };
  assert.equal(down.state, "down");
  assert.match(down.detail, /cannot be written/);
});

test("config_get reports the target, schedule, encryption and the last good backup", async () => {
  const w = await ready();
  assert.deepEqual(await call("backup.config_get", w.ctx, {}), { target: MEMORY_TARGET, schedule: "0 3 * * *", encrypted: true });
  await call("backup.run", w.ctx, {});
  assert.deepEqual(await call("backup.config_get", w.ctx, {}), { target: MEMORY_TARGET, schedule: "0 3 * * *", encrypted: true, lastBackupAt: NOW });
  assert.deepEqual(await call("backup.config_get", world().ctx, {}), { schedule: "0 3 * * *", encrypted: true });
});

// ---- the pieces

test("Signature V4: the published signing-key vector", async () => {
  const key = await signingKey("wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "20150830", "us-east-1", "iam");
  assert.equal(Array.from(key, (b) => b.toString(16).padStart(2, "0")).join(""), "c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9");
  assert.equal(await sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("Signature V4 signs the host, the date and the payload hash", async () => {
  const h = await signV4({ method: "PUT", host: "s3.example.com", path: "/bkt/b/x.vybk", payloadHash: await sha256Hex("body"), region: "eu-west-1", key: "AKIDEXAMPLE", secret: "secret", headers: { "content-length": "4" }, now: Date.UTC(2026, 9, 25, 3, 0, 0) });
  assert.equal(h["x-amz-date"], "20261025T030000Z");
  assert.match(h["authorization"]!, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261025\/eu-west-1\/s3\/aws4_request, SignedHeaders=content-length;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
});

test("the S3 target signs every call, uses path-style keys under the folder and maps 404 to null", async () => {
  const seen: { method: string; url: string; headers: Record<string, string>; body?: Uint8Array }[] = [];
  const store = new Map<string, Uint8Array>();
  const t = s3Target({
    endpoint: "https://s3.example.com", bucket: "bkt", region: "eu-west-1", prefix: "vyre/", creds: { key: "AKID", secret: "sec" }, now: () => NOW,
    transport: async (req) => {
      seen.push(req);
      if (req.method === "PUT") { store.set(req.url, req.body!); return { status: 200, body: new Uint8Array(0) }; }
      if (req.method === "GET") { const b = store.get(req.url); return b ? { status: 200, body: b } : { status: 404, body: new Uint8Array(0) }; }
      if (req.method === "DELETE") { store.delete(req.url); return { status: 204, body: new Uint8Array(0) }; }
      return { status: 200, body: new Uint8Array(0) };
    },
  });
  await t.ping();
  await t.put("b/one.vybk", enc.encode("hello"));
  assert.deepEqual(dec.decode((await t.get("b/one.vybk"))!), "hello");
  assert.equal(await t.get("b/missing.vybk"), null);
  await t.del("b/one.vybk");
  assert.equal(await t.get("b/one.vybk"), null);
  assert.equal(seen[0]!.url, "https://s3.example.com/bkt");
  assert.equal(seen[1]!.url, "https://s3.example.com/bkt/vyre/b/one.vybk");
  for (const r of seen) assert.match(r.headers["authorization"]!, /^AWS4-HMAC-SHA256 Credential=AKID\//);
  await assert.rejects(t.put("../escape", enc.encode("x")), /bad key/);
  const broken = s3Target({ endpoint: "https://s3.example.com", bucket: "b", region: "r", prefix: "", creds: { key: "k", secret: "s" }, now: () => NOW, transport: async () => ({ status: 403, body: new Uint8Array(0) }) });
  await assert.rejects(broken.put("a", enc.encode("x")), /s3 put 403/);
  await assert.rejects(broken.ping(), /s3 head 403/);
});

test("an S3 target is opened through the Vault lookup and the host transport", async () => {
  const w = world();
  const calls: string[] = [];
  configureBackup({
    source: w.space, exports: w.drivers.exports,
    credentials: async (name) => { calls.push(name); return { key: "AKID", secret: "sec", endpoint: "https://s3.example.com" }; },
    transport: async (req) => { calls.push(`${req.method} ${req.url}`); return { status: 200, body: new Uint8Array(0) }; },
  });
  await call("backup.config_set", w.ctx, { target: { kind: "s3", bucket: "bkt", region: "eu-west-1", path: "vyre", vaultName: "S3_BACKUP" }, schedule: "0 3 * * *", enabled: false });
  assert.deepEqual(calls, ["S3_BACKUP", "HEAD https://s3.example.com/bkt"]);
  assert.deepEqual(w.raw.rows("backup_config").find((r) => r["key"] === "target")!["value"], JSON.stringify({ kind: "s3", bucket: "bkt", region: "eu-west-1", path: "vyre", vaultName: "S3_BACKUP" }));
  assert.ok(!JSON.stringify(w.raw.rows("backup_config")).includes("sec\""), "no credential in the tables");
  // without the wiring the error says what is missing
  configureBackup({ source: w.space, exports: w.drivers.exports });
  const err = await failed(call("backup.config_set", w.ctx, { target: { kind: "s3", bucket: "bkt", region: "eu-west-1", vaultName: "S3_BACKUP" }, schedule: "0 3 * * *", enabled: false }));
  assert.equal(err.error.code, "internal.unavailable");
});

test("the folder target writes atomically, reads back and refuses keys that climb out", async () => {
  const root = mkdtempSync(join(tmpdir(), "vyre-backup-"));
  try {
    const t = dirTarget(join(root, "drive"));
    await t.ping();
    await t.put("b/one.vybk", enc.encode("hello"));
    assert.equal(dec.decode((await t.get("b/one.vybk"))!), "hello");
    assert.equal(await t.get("b/none.vybk"), null);
    assert.deepEqual(readdirSync(join(root, "drive", "b")), ["one.vybk"], "no temp file is left behind");
    await t.del("b/one.vybk");
    assert.equal(await t.get("b/one.vybk"), null);
    await assert.rejects(t.put("../x", enc.encode("x")), /bad key/);
    await assert.rejects(t.put("a//b", enc.encode("x")), /bad key/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("path rules", () => {
  assert.equal(pathProblem("/Volumes/Backup/vyre"), null);
  assert.match(pathProblem("rel")!, /full path/);
  assert.match(pathProblem("/a/../b")!, /\.\./);
  assert.match(pathProblem("/")!, /root/);
});

test("cron: next run for fixed times, steps, lists and weekdays (UTC)", () => {
  const at = (iso: string): number => Date.parse(iso);
  const next = (line: string, after: string): string => new Date(nextRun(parseCron(line)!, at(after))!).toISOString();
  assert.equal(next("0 3 * * *", "2026-10-25T02:59:30Z"), "2026-10-25T03:00:00.000Z");
  assert.equal(next("0 3 * * *", "2026-10-25T03:00:00Z"), "2026-10-26T03:00:00.000Z");
  assert.equal(next("*/15 * * * *", "2026-10-25T10:07:00Z"), "2026-10-25T10:15:00.000Z");
  assert.equal(next("0 0,12 * * *", "2026-10-25T01:00:00Z"), "2026-10-25T12:00:00.000Z");
  assert.equal(next("30 4 1 * *", "2026-10-25T00:00:00Z"), "2026-11-01T04:30:00.000Z");
  assert.equal(next("0 9 * * 1", "2026-10-25T00:00:00Z"), "2026-10-26T09:00:00.000Z");
  assert.equal(next("0 9 * * 1-5", "2026-10-24T10:00:00Z"), "2026-10-26T09:00:00.000Z");
  assert.equal(next("0 0 29 2 *", "2026-10-25T00:00:00Z"), "2028-02-29T00:00:00.000Z");
  for (const bad of ["", "* * * *", "61 * * * *", "* 24 * * *", "*/0 * * * *", "a b c d e", "5-1 * * * *"]) assert.equal(parseCron(bad), null, `"${bad}" is refused`);
  assert.ok(DAY_MS > 0);
});

test("tombstones merge by kind and subject, keeping the earliest erasure", () => {
  const merged = mergeTombstones([{ kind: "subject", subject: "a", at: 5 }, { kind: "subject", subject: "b", at: 3 }], [{ kind: "subject", subject: "a", at: 2 }, { kind: "file", subject: "a", at: 9 }]);
  assert.deepEqual(merged, [{ kind: "subject", subject: "a", at: 2 }, { kind: "subject", subject: "b", at: 3 }, { kind: "file", subject: "a", at: 9 }]);
});

test("zip stores entries with correct sizes, names and a central directory", () => {
  const z = zip([{ path: "a.txt", bytes: enc.encode("hello") }, { path: "dir/b.txt", bytes: enc.encode("world!") }], NOW);
  const view = new DataView(z.buffer, z.byteOffset, z.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const end = z.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2, "two entries");
  const text = dec.decode(z);
  assert.ok(text.includes("a.txt") && text.includes("dir/b.txt") && text.includes("hello") && text.includes("world!"));
});

test("the export path deny list", () => {
  for (const p of ["vault/item.json", "a/secrets/x", "keys/main", "private/chat.json", "memory/personal/me.md", "chats/private/1.json", ".env", "x/.env.local", "tls/server.pem", "id_rsa"]) assert.equal(exportBlocked(p), true, p);
  for (const p of ["records/evt_1.json", "files/letter.docx", "chats/channels/general.json", "memory/space/facts.md", "keysmith.txt"]) assert.equal(exportBlocked(p), false, p);
});
