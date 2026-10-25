// backup.restore, restore_preview, verify and the owner export (P-L7b_05; spec 5 Backups and export, 2.26; golden flow 11 restore side): Run in CI.
// a restore replays tombstones so erased data never comes back, and the export zip carries no secret.
// @reads ../migrations/0001_init.sql

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { MEMORY_TARGET, NOW, world } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";
import { configureBackup, handlers } from "../handlers/index.ts";
import { readIndex, unpack, unwrap, writeTombstones } from "../handlers/run.ts";
import type { BackupCtx } from "../handlers/run.ts";

type Fn = (ctx: BackupCtx, input: never) => Promise<unknown>;
const call = (name: string, ctx: BackupCtx, input: unknown): Promise<unknown> => {
  const fn = (handlers as unknown as Record<string, Fn>)[name];
  assert.ok(fn, `a handler for ${name}`);
  return fn(ctx, input as never);
};
const dec = new TextDecoder();
const enc = new TextEncoder();

async function ready(): Promise<World> {
  const w = world();
  configureBackup(w.drivers);
  await w.space.append("contact/ada", "Ada Lovelace, ada@example.com");
  await w.space.append("contact/bob", "Bob Barker, bob@example.com");
  w.space.blobs.set("fil_1", "the engagement letter");
  await call("backup.config_set", w.ctx, { target: MEMORY_TARGET, schedule: "0 3 * * *", enabled: false });
  w.events.length = 0;
  return w;
}

const failed = async (p: Promise<unknown>): Promise<VyreErr> => {
  try { await p; } catch (e) { assert.ok(e instanceof VyreErr, "a typed error"); return e; }
  throw new Error("expected the call to fail");
};
const backupNow = async (w: World, at: number): Promise<string> => {
  w.setNow(at);
  return (await call("backup.run", w.ctx, {}) as { backupId: string }).backupId;
};

afterEach(() => configureBackup(null));

test("restore brings the Space back to the backup and the hash chain verifies", async () => {
  const w = await ready();
  const id = await backupNow(w, NOW);
  const atBackup = await w.space.snapshot();
  await w.space.append("contact/cy", "Cy Young, written after the backup");
  w.space.blobs.set("fil_2", "added later");
  w.events.length = 0;

  const out = await call("backup.restore", w.ctx, { backupId: id, confirm: true }) as { runId: string };
  assert.equal(out.runId, "run_testrun1");
  const now = await w.space.snapshot();
  assert.equal(now.headHash, atBackup.headHash);
  assert.equal(now.toSeq, 2);
  assert.deepEqual(now.entries.map((e) => e.path), atBackup.entries.map((e) => e.path));
  for (const [i, e] of now.entries.entries()) assert.deepEqual(e.bytes, atBackup.entries[i]!.bytes);
  assert.deepEqual(w.space.restores.map((r) => r.mode), ["live"]);
  assert.deepEqual(w.events.map((e) => e.name), ["backup.completed", "backup.restored"], "the safety backup is reported, then the restore");
});

test("a restore takes a fresh backup first, so it can be undone", async () => {
  const w = await ready();
  const id = await backupNow(w, NOW);
  await w.space.append("contact/cy", "Cy Young");
  w.setNow(NOW + 5000);
  await call("backup.restore", w.ctx, { backupId: id, confirm: true });
  const rows = w.raw.rows("backup_item").sort((a, b) => Number(a["at"]) - Number(b["at"]));
  assert.deepEqual(rows.map((r) => r["kind"]), ["manual", "manual"]);
  assert.equal(rows[1]!["seq"], 3, "the safety backup holds the Space as it was before the restore");
  // restoring the safety backup brings Cy back
  await call("backup.restore", w.ctx, { backupId: String(rows[1]!["backup_id"]), confirm: true });
  assert.equal((await w.space.snapshot()).toSeq, 3);
});

test("erased data does not come back: the tombstone is replayed before the Space opens", async () => {
  const w = await ready();
  const id = await backupNow(w, NOW);
  // Ada is erased after the backup, so the backup still holds her
  assert.equal(w.space.erase("contact/ada", NOW + 1000), 1);
  assert.deepEqual(w.space.payloads("contact/ada"), [null]);
  const inBackup = await unpack(unwrap(w.ctx, w.target.objects.get(`b/${id}.vybk`)!));
  assert.ok(dec.decode(inBackup.entries[0]!.bytes).includes("Ada Lovelace"), "the old backup does hold her");

  w.setNow(NOW + 2000);
  w.events.length = 0;
  await call("backup.restore", w.ctx, { backupId: id, confirm: true });

  assert.deepEqual(w.space.payloads("contact/ada"), [null], "Ada stays erased after the restore");
  assert.deepEqual(w.space.payloads("contact/bob"), ["Bob Barker, bob@example.com"], "everyone else comes back");
  const replayed = w.space.restores.at(-1)!;
  assert.deepEqual(replayed.tombstones.map((t) => t.subject), ["contact/ada"]);
  const restored = w.events.find((e) => e.name === "backup.restored")!;
  assert.deepEqual(restored.payload, { backupId: id, tombstonesReplayed: 1 });
  // the tombstone list on the target survives, and the safety backup (taken after the erase) has no trace of her
  const safety = w.raw.rows("backup_item").filter((r) => Number(r["at"]) === NOW + 2000)[0];
  assert.ok(safety);
  const safetyArchive = await unpack(unwrap(w.ctx, w.target.objects.get(String(safety["object_key"]))!));
  assert.ok(!dec.decode(safetyArchive.entries[0]!.bytes).includes("Ada Lovelace"));
});

test("a tombstone known only to the target's list is replayed too", async () => {
  const w = await ready();
  const id = await backupNow(w, NOW);
  // Bob is erased after the backup; the machine then loses its log's tombstones (a rebuilt disk) but the target's list still names him
  w.space.erase("contact/bob", NOW + 10);
  const tomb = [{ kind: "subject", subject: "contact/bob", at: NOW + 10 }];
  w.space.tombstoneList = [];
  await writeTombstones(w.ctx, w.target, tomb, true);
  await call("backup.restore", w.ctx, { backupId: id, confirm: true });
  assert.deepEqual(w.space.restores.at(-1)!.tombstones.map((t) => t.subject), ["contact/bob"]);
  assert.deepEqual(w.space.payloads("contact/bob"), [null], "Bob was in the archive and is erased again before the Space opens");
  assert.deepEqual(w.space.payloads("contact/ada"), ["Ada Lovelace, ada@example.com"]);
});

test("restore_preview shows the range, the tombstones to replay and the time the Space is closed", async () => {
  const w = await ready();
  const id = await backupNow(w, NOW);
  await w.space.append("contact/cy", "Cy Young");
  await w.space.append("contact/di", "Di Prince");
  w.space.erase("contact/ada", NOW + 1);
  const out = await call("backup.restore_preview", w.ctx, { backupId: id }) as { fromSeq: number; toSeq: number; tombstones: number; downtimeSeconds: number };
  assert.deepEqual([out.fromSeq, out.toSeq, out.tombstones], [2, 4, 1]);
  assert.equal(out.downtimeSeconds, 6);
  const err = await failed(call("backup.restore_preview", w.ctx, { backupId: "bkp_nope" }));
  assert.equal(err.error.code, "validation.not_found");
});

test("restore needs the confirmation and a backup that exists", async () => {
  const w = await ready();
  const id = await backupNow(w, NOW);
  assert.equal((await failed(call("backup.restore", w.ctx, { backupId: id, confirm: false }))).error.code, "validation.bad_input");
  assert.equal((await failed(call("backup.restore", w.ctx, { backupId: "bkp_nope", confirm: true }))).error.code, "validation.not_found");
  assert.deepEqual(w.space.restores, []);
});

test("a damaged archive stops the restore before anything is touched", async () => {
  const w = await ready();
  const id = await backupNow(w, NOW);
  const key = `b/${id}.vybk`;
  const doc = JSON.parse(dec.decode(w.target.objects.get(key)!)) as { bytes: string };
  doc.bytes = `${doc.bytes.slice(0, 8)}${doc.bytes[8] === "a" ? "b" : "a"}${doc.bytes.slice(9)}`;
  w.target.objects.set(key, enc.encode(JSON.stringify(doc)));
  await w.space.append("contact/cy", "Cy Young");
  const before = await w.space.snapshot();
  const err = await failed(call("backup.restore", w.ctx, { backupId: id, confirm: true }));
  assert.equal(err.error.code, "validation.precondition_failed");
  assert.match(err.error.message, /cannot be opened/);
  assert.deepEqual(w.space.restores, []);
  assert.equal((await w.space.snapshot()).headHash, before.headHash);
  assert.equal(w.raw.rows("backup_item").length, 1, "no safety backup was taken for a restore that could not start");
  // the file gone from the target is reported the same way
  w.target.objects.delete(key);
  assert.equal((await failed(call("backup.restore", w.ctx, { backupId: id, confirm: true }))).error.code, "validation.not_found");
});

test("if the safety backup cannot be taken the restore does not start", async () => {
  const w = await ready();
  const id = await backupNow(w, NOW);
  w.space.failSnapshot = true;
  const err = await failed(call("backup.restore", w.ctx, { backupId: id, confirm: true }));
  assert.equal(err.error.code, "validation.precondition_failed");
  assert.match(err.error.message, /nothing was changed/);
  assert.deepEqual(w.space.restores, []);
});

test("a restored log that does not verify is reported with the safety backup to go back to", async () => {
  const w = await ready();
  const id = await backupNow(w, NOW);
  const real = w.space.restore.bind(w.space);
  w.space.restore = async (snap, tombs, mode) => ({ ...(await real(snap, tombs, mode)), chainOk: false });
  const err = await failed(call("backup.restore", w.ctx, { backupId: id, confirm: true }));
  assert.equal(err.error.code, "internal.unexpected");
  assert.match(err.error.message, /did not verify/);
  assert.match(String(err.error.details?.["safetyBackupId"]), /^bkp_/);
  assert.ok(!w.events.some((e) => e.name === "backup.restored"));
});

test("verify restores into a scratch directory, checks the chain and marks the backup verified", async () => {
  const w = await ready();
  const id = await backupNow(w, NOW);
  w.events.length = 0;
  const out = await call("backup.verify", w.ctx, { backupId: id }) as { ok: boolean; checkedEvents: number };
  assert.deepEqual(out, { ok: true, checkedEvents: 2 });
  assert.deepEqual(w.space.restores.map((r) => r.mode), ["scratch"]);
  assert.deepEqual(w.events.map((e) => e.name), ["backup.verified"]);
  const list = await call("backup.list", w.ctx, {}) as { backups: { verified: boolean }[] };
  assert.equal(list.backups[0]!.verified, true);
  assert.equal((await w.space.snapshot()).toSeq, 2, "the live Space was not touched");
});

test("verify reports a chain that does not hold and does not mark the backup", async () => {
  const w = await ready();
  const id = await backupNow(w, NOW);
  w.events.length = 0;
  const real = w.space.restore.bind(w.space);
  w.space.restore = async (snap, tombs, mode) => ({ ...(await real(snap, tombs, mode)), chainOk: false });
  const out = await call("backup.verify", w.ctx, { backupId: id }) as { ok: boolean };
  assert.equal(out.ok, false);
  assert.deepEqual(w.events, []);
  assert.equal(w.raw.rows("backup_item")[0]!["verified"], 0);
});

test("verify refuses an archive whose head hash is not the one recorded", async () => {
  const w = await ready();
  const id = await backupNow(w, NOW);
  w.raw.run("UPDATE backup_item SET head_hash = ? WHERE backup_id = ?", "0000", id);
  const err = await failed(call("backup.verify", w.ctx, { backupId: id }));
  assert.equal(err.error.code, "validation.precondition_failed");
});

test("a restore on a new machine finds the backup through the target's index", async () => {
  const w = await ready();
  const id = await backupNow(w, NOW);
  const other = world();
  Object.assign(other.ctx, { seal: w.ctx.seal });
  configureBackup({ ...other.drivers, openTarget: async () => w.target });
  await call("backup.config_set", other.ctx, { target: MEMORY_TARGET, schedule: "0 3 * * *", enabled: false });
  assert.equal(other.raw.rows("backup_item").length, 0);
  await call("backup.restore", other.ctx, { backupId: id, confirm: true });
  assert.equal((await other.space.snapshot()).headHash, (await w.space.snapshot()).headHash);
  assert.equal((await readIndex(other.ctx, w.target)).length, 2, "the safety backup joined the index");
});

// ---- the owner export

const unzipNames = (z: Uint8Array): string[] => {
  const view = new DataView(z.buffer, z.byteOffset, z.byteLength);
  const end = z.length - 22;
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const nlen = view.getUint16(at + 28, true), xlen = view.getUint16(at + 30, true), clen = view.getUint16(at + 32, true);
    names.push(dec.decode(z.subarray(at + 46, at + 46 + nlen)));
    at += 46 + nlen + xlen + clen;
  }
  return names;
};

test("the export zip contains no secrets", async () => {
  const w = await ready();
  w.space.vault.set("MAILGUN_KEY", "key-9f8e7d6c5b4a39281706");
  w.space.vault.set("DB_PASSWORD", "correct-horse-battery-staple");
  // a secret that leaked into a record field is found by its value, and a file named after one is left out
  await w.space.append("note/leak", "deploy with key-9f8e7d6c5b4a39281706 on friday");
  w.space.extraExport.push(
    { path: "files/.env", bytes: enc.encode("API=1") },
    { path: "files/tokens.txt", bytes: enc.encode("correct-horse-battery-staple") },
    { path: "private/dm-with-ada.json", bytes: enc.encode("{}") },
    { path: "memory/personal/ada.md", bytes: enc.encode("my own notes") },
    { path: "files/notes.txt", bytes: enc.encode("quarterly plan") },
  );
  w.events.length = 0;

  const out = await call("backup.export_start", w.ctx, {}) as { runId: string };
  assert.equal(out.runId, "run_testrun1");
  assert.equal(w.saved.length, 1);
  const zip = w.saved[0]!;
  assert.match(zip.name, /^vyre-export-\d{4}-\d{2}-\d{2}\.zip$/);
  const text = dec.decode(zip.bytes);
  for (const secret of ["key-9f8e7d6c5b4a39281706", "correct-horse-battery-staple", "MAILGUN_KEY", "DB_PASSWORD", "API=1", "my own notes", "dm-with-ada"]) assert.ok(!text.includes(secret), `${secret} is not in the zip`);
  const names = unzipNames(zip.bytes);
  assert.deepEqual(names.sort(), ["README.txt", "files/notes.txt", "files/fil_1", "records/evt_1.json", "records/evt_2.json"].sort());
  assert.ok(text.includes("Ada Lovelace") && text.includes("engagement letter") && text.includes("quarterly plan"), "everything that is the owner's is there");
  const row = w.raw.rows("backup_export")[0]!;
  assert.deepEqual([row["state"], row["file_id"], row["by_principal"], row["entries"], row["skipped"]], ["done", zip.fileId, "usr_owner", 4, 7]);
  assert.deepEqual(w.events, [], "the audit entry comes from the pipeline (audit: always)");
});

test("a full export needs the Space-wide export permission", async () => {
  const w = await ready();
  w.allowExport(false);
  const err = await failed(call("backup.export_start", w.ctx, {}));
  assert.equal(err.error.code, "permission.role_lacks_permission");
  assert.deepEqual(w.saved, []);
});
