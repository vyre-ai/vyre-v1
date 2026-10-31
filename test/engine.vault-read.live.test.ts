// A chat turn reads its AI account key with vault.use. On a server from before the AI providers folder was registered, putting into or reading that folder answered "not found", the chat said the Vault could not
// be read, and the turn fell back to another account. After a restart the folder is registered and the account in it is readable (the repair is 686cfc2ad).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../fixtures/seed/core/index.ts";
import { fakePlatform } from "../host/src/platform/index.ts";
import type { FetchFn } from "../host/src/platform/probes.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../host/src/daemon/daemon.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const TOKEN = "tok-usr_olivia";

async function boot(kind: "personal" | "team"): Promise<{ d: Daemon; dir: string }> {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vyre-vault-put-${kind}-`));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", ...(kind === "personal" ? ["--space-kind", "personal"] : [])], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: `vault-put-${kind}`, free: 80e9, commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    } }),
    fetch: caddyFetch,
    session: (h) => (/^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1] === TOKEN ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "mac" } : null),
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  return { d, dir };
}

let keys = 0;
async function call(d: Daemon, cap: string, input: Record<string, unknown>): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ idempotencyKey: `vp-${++keys}`, ...input }) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}

test("a Claude account kept in the folder an older server made quietly is readable by a turn once the server has restarted", async () => {
  // boot, make the AI providers folder, then forget its resource the way a server from before the fix never had it: write the folder row with no registration, restart, and put into it
  const { d, dir } = await boot("personal");
  let folderId = "";
  try {
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    assert.equal(unlock.status, 204);
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(dir, "modules.db"));
    folderId = "vfd_legacyquiet1";
    db.prepare(`INSERT INTO vault_folder ("id", "name", "parentId", "scope", "owner", "whoCanExport", "createdAt") VALUES (?, 'AI providers', NULL, 'mine', 'usr_olivia', '[]', 1)`).run(folderId);
    db.close();
    const before = await call(d, "vault.item.put", { folderId, name: "Twilio", kind: "api_key", template: "twilio", fields: [{ key: "TWILIO_AUTH_TOKEN", value: "x", secret: true }] });
    assert.equal(before.status, 404, "unregistered: the bug");
  } finally { await d.stop(); }
  const again = await (async () => {
    const d2 = await startDaemon({
      config: loadConfig(["--data-dir", dir, "--port", "0", "--space-kind", "personal"], {}, "1.2.3"), codeRoot: CODE_ROOT,
      platform: fakePlatform({ os: "linux", hostname: "vault-put-restart", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
      fetch: caddyFetch, session: (h) => (/^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1] === TOKEN ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "mac" } : null),
      intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    });
    return d2;
  })();
  try {
    const unlock = await fetch(`${again.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    assert.equal(unlock.status, 204);
    const put = await call(again, "vault.item.put", { folderId, name: "Dana_Claude", kind: "api_key", fields: [{ key: "setup_token", value: "sk-ant-oat01-fake-fake-fake-fake", secret: true }] });
    assert.equal(put.status, 200, JSON.stringify(put.data));
    // the read a chat turn makes for its account key (host/src/seams/engine-session.ts lookup): vault.use as the person
    const used = await call(again, "vault.use", { item: "Dana_Claude", fields: ["setup_token"], purpose: "engine account" });
    assert.equal(used.status, 200, JSON.stringify(used.data));
  } finally { await again.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
