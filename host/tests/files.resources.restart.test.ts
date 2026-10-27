// The Files root folders reach the access module's tables once, however many times the daemon starts (ruling 65 with ruling 70): a second boot on the same data directory neither fails nor
// adds rows, and the folders are there for authorize.
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

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER_TOKEN = "tok-usr_olivia";

test("booting twice on one data directory registers the Files root folders once and fails on nothing", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-files-res-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const boot = () => startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "files-res", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const count = (d: Awaited<ReturnType<typeof boot>>): { folders: number; rows: number } => ({
    folders: Number((d.db!.all("SELECT COUNT(*) AS n FROM access_resources WHERE type = 'folder'")[0] as { n: number }).n),
    rows: Number((d.db!.all("SELECT COUNT(*) AS n FROM access_resources")[0] as { n: number }).n),
  });
  const first = await boot();
  const one = count(first);
  await first.stop();
  assert.ok(one.folders > 0, "the Files root folders are in the access module's tables");
  const second = await boot();
  try {
    assert.deepEqual(count(second), one, "a second boot adds nothing");
  } finally { await second.stop(); }
});

test("folder sensitivity and large host uploads work through production paths in a Personal Space", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-files-personal-label-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space-kind", "personal"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "files-personal", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => (/^Bearer tok-usr_olivia$/.test(String(h["authorization"] ?? "")) ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "files-personal" } : null),
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const post = async (route: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> => {
    const response = await fetch(`${d.url}${route}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OWNER_TOKEN}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
    return { status: response.status, body: JSON.parse(await response.text()) as Record<string, unknown> };
  };
  try {
    const tree = await post("/v1/files/tree", {});
    assert.equal(tree.status, 200, JSON.stringify(tree.body));
    const roots = ((tree.body["data"] as { roots: Array<{ key: string; folderId?: string }> }).roots);
    const personal = roots.find((root) => root.key === "personal")?.folderId;
    assert.ok(personal);
    const made = await post("/v1/files/folder/create", { idempotencyKey: "personal-label-folder", parentId: personal, name: "Private" });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const folderId = ((made.body["data"] as { folder: { folderId: string } }).folder.folderId);
    const changed = await post("/v1/files/folder/settings", { folderId, label: "restricted" });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    const resource = d.db!.all("SELECT label FROM access_resources WHERE id = ?", folderId)[0] as { label?: string } | undefined;
    assert.equal(resource?.label, "restricted", "the Files setting updates the Access source of truth");

    const bytes = Buffer.alloc(2 * 1024 * 1024, 0x5a);
    const slot = await post("/v1/files/upload_url", { size: bytes.length });
    assert.equal(slot.status, 200, JSON.stringify(slot.body));
    const upload = slot.body["data"] as { blobId: string; url: string };
    const token = new URL(upload.url, "http://vyred").searchParams.get("token");
    assert.ok(token);
    await d.hooks!.call("files.put_upload", { blobId: upload.blobId, token, base64: bytes.toString("base64") });
    const madeLarge = await post("/v1/files/create", { idempotencyKey: "personal-large-file", folderId, name: "dl.bin", content: { blobId: upload.blobId } });
    assert.equal(madeLarge.status, 200, JSON.stringify(madeLarge.body));
    assert.equal(((madeLarge.body["data"] as { file: { size: number } }).file.size), bytes.length);
  } finally { await d.stop(); }
});
