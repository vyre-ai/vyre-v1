// P-GF_11: an erased person stays erased after a restore (spec 2.26, ARCH 7.10). A Space is backed up, a person's record is erased, and the backup is restored over it with a real restart: the restored
// database still has the record, and the daemon replays the tombstones it kept before it serves anything. The record answers 404 again, the log says tombstones.reapplied, and the kept file is gone.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { createBackupHost } from "../src/seams/backup.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-restore-tomb-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "restore-tomb", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, tick: 3_600_000, hooks: 3_600_000 },
});

const post = (d: Daemon, p: string, body: unknown) => fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(body) });
async function ok<T>(d: Daemon, p: string, body: unknown): Promise<T> {
  const r = await post(d, p, body);
  const text = await r.text();
  assert.equal(r.status, 200, `${p}: ${text.slice(0, 400)}`);
  return (JSON.parse(text) as { data: T }).data;
}

test("erase, back up before it, restore, restart: the erased record is erased again before the Space serves it", async () => {
  const dir = seededDir();
  let d = await boot(dir);
  let recordId = "", other = "";
  let snapshot: Awaited<ReturnType<ReturnType<typeof createBackupHost>["source"]["snapshot"]>>;
  try {
    await ok(d, "/v1/schema/apply", { idempotencyKey: "tomb-type", ops: [{ op: "type.create", type: "rt_contact", def: { title: "Contact", plural: "Contacts", icon: "user", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }] } }] });
    recordId = (await ok<{ record: { id: string } }>(d, "/v1/records/create", { idempotencyKey: "tomb-pat", type: "rt_contact", fields: { name: "Pat Lee" } })).record.id;
    other = (await ok<{ record: { id: string } }>(d, "/v1/records/create", { idempotencyKey: "tomb-dana", type: "rt_contact", fields: { name: "Dana Other" } })).record.id;

    // the backup is taken while Pat is still there
    const seam = createBackupHost({
      root: dir, space: "spc_core", log: d.log!, owner: () => "usr_olivia", system: () => Promise.resolve({}), vault: {} as never,
      blobs: { put: () => Promise.resolve("blb_x") }, fetch: (() => Promise.reject(new Error("no network"))) as never,
    });
    snapshot = await seam.source.snapshot();

    // then Pat is erased: a finding that names the record, applied through the gateway
    await ok(d, "/v1/governance/holds/list", {});   // the module opens its tables
    d.db!.run(`INSERT INTO governance_finding ("id", "by", "at", "expiresAt", "recordIds", "items") VALUES (?, ?, ?, ?, ?, ?)`, "fnd_tomb0001", "usr_olivia", Date.now(), Date.now() + 3_600_000, JSON.stringify([recordId]), JSON.stringify({ records: [{ type: "rt_contact", id: recordId, title: "" }] }));
    await ok(d, "/v1/governance/erase/apply", { findingId: "fnd_tomb0001", include: ["records"], idempotencyKey: "tomb-apply" });
    assert.equal((await post(d, "/v1/records/get", { type: "rt_contact", recordId })).status, 404, "erased");
    await d.stop();

    // the owner approves a restore of the older backup: it is staged for the next start
    await seam.source.restore(snapshot, [], "live");
    assert.ok(fs.existsSync(path.join(dir, "restore-pending", "tombstones.json")), "the stage keeps the tombstones");

    d = await boot(dir);   // a real restart: the stage moves into place before any database opens
    assert.ok(!fs.existsSync(path.join(dir, "restore-pending")), "the stage is applied");
    assert.equal((await post(d, "/v1/records/get", { type: "rt_contact", recordId })).status, 404, "Pat is erased again after the restore");
    assert.equal((await post(d, "/v1/records/get", { type: "rt_contact", recordId: other })).status, 200, "Dana, who was never erased, is there");
    assert.ok(!fs.existsSync(path.join(dir, "restore-tombstones.json")), "the kept file goes once it is replayed");
    const types: string[] = [];
    for (let after = 0;;) { const page = await d.log!.read({ after, limit: 1000 }); if (!page.length) break; for (const e of page) { types.push(e.type); after = e.seq; } }
    assert.ok(types.includes("tombstones.reapplied"), "the log says the tombstones were replayed");
    const left = JSON.stringify(d.db!.all(`SELECT * FROM governance_tombstone`));
    assert.ok(left.includes(recordId), "the restored database now holds the tombstone too, so a second restart replays it as well");
  } finally { await d.stop(); }
});
