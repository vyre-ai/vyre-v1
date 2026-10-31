// Adding to the Vault on a booted daemon, the way the Add to the Vault sheet does it: Mine (made on first use when there is none), then vault.item.put for every kind and every app template.
// Personal Space and Team Space. A person who owns the Vault must never meet "not found" for their own folder.
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

for (const kind of ["personal", "team"] as const) {
  test(`${kind} Space: every kind and every app template can be added to Mine, and to a shared folder`, async () => {
    const { d, dir } = await boot(kind);
    try {
      const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
      assert.equal(unlock.status, 204);
      // the owner's own state: an AI account was added first (the provider flows keep their items in a Mine folder of their own), so the Add sheet finds a Mine folder and uses it
      const provider = await call(d, "providers.add", { providerKey: "openai", connection: "api_key", apiKey: "sk-proj-fake-fake-fake-fake", scope: "mine" });
      assert.equal(provider.status, 200, JSON.stringify(provider.data));
      const listed = await call(d, "vault.folders.list", {});
      const folderId = (listed.data.folders as { id: string; scope: string }[]).find((f) => f.scope === "mine")!.id;
      const { TEMPLATES } = await import("../apps/app/src/places/vault/itemenv/env.ts");
      const failures: string[] = [];
      const add = async (label: string, body: Record<string, unknown>): Promise<void> => {
        const r = await call(d, "vault.item.put", { folderId, ...body });
        if (r.status !== 200) failures.push(`${label}: ${r.status} ${JSON.stringify(r.data?.error ?? r.data).slice(0, 200)}`);
      };
      for (const k of ["login", "api_key", "env", "card", "note", "totp", "ssh_key", "other"]) await add(`kind ${k}`, { name: `Plain ${k}`, kind: k, fields: [{ key: k === "login" ? "PASSWORD" : "VALUE", value: "x1y2z3", secret: true }] });
      for (const t of TEMPLATES) if (t.id !== "custom") await add(`template ${t.id}`, { name: `Tpl ${t.name}`, kind: t.kind, ...(t.id !== "custom" ? { template: t.id } : {}), fields: t.keys.map((f) => ({ key: f.key, value: "v-123456", secret: f.secret })) });
      const shared = await call(d, "vault.folders.create", { name: "Marketing", scope: "shared" });
      assert.equal(shared.status, 200, JSON.stringify(shared.data));
      const inShared = await call(d, "vault.item.put", { folderId: shared.data.folder.id, name: "Shared Twilio", kind: "api_key", template: "twilio", fields: [{ key: "TWILIO_AUTH_TOKEN", value: "x", secret: true }] });
      if (inShared.status !== 200) failures.push(`shared folder: ${inShared.status} ${JSON.stringify(inShared.data).slice(0, 200)}`);
      assert.deepEqual(failures, [], failures.join("\n"));
    } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test("a folder an older server made quietly is registered when the server starts, so its owner can put into it", async () => {
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
    const r = await call(again, "vault.item.put", { folderId, name: "Twilio", kind: "api_key", template: "twilio", fields: [{ key: "TWILIO_AUTH_TOKEN", value: "x", secret: true }] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  } finally { await again.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
