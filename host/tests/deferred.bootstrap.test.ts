// P-L9_30: a signed-in client learns which capabilities the server defers (ruling 60) from identity.whoami, the bootstrap it already makes. A booted daemon on the seeded `core` Space,
// called through the gateway with a real token; a call without a token is refused.
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

test("whoami lists the deferred capabilities, so the client can hide Sites", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-deferred-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "deferred-boot", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      return t === OWNER_TOKEN ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "dev_deferred" } : null;
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  try {
    // the seeded core Space has people in access but no identity accounts (those come with the small seed), and whoami reads the caller's account
    d.db!.run("INSERT INTO identity_accounts (person_id, username, name, verifier, totp_secret, totp_last_step, github_id, github_login, keys_json, recovery_hash, fails, locked_until, epoch, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "usr_olivia", "olivia", "Olivia", "unused", null, 0, null, null, null, null, 0, 0, 0, 1_790_000_000_000);
    const post = (token: string | null, p: string) =>
      fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: "{}" });
    const res = await post(OWNER_TOKEN, "/v1/identity/whoami");
    assert.equal(res.status, 200, await res.clone().text());
    const body = (await res.json()) as { data?: { deferred?: string[]; deferredModules?: string[] } };
    const deferred = body.data?.deferred ?? [];
    assert.ok(deferred.includes("sites.create"), `sites.create is deferred: ${JSON.stringify(deferred).slice(0, 200)}`);
    assert.ok(deferred.includes("vault.import"), "an action of a live module is listed too");
    assert.ok(!deferred.includes("files.read"), "a real capability is not listed");
    // a place is deferred whole when every one of its capabilities is: Sites yes, Vault (one deferred action) no. The client turns these lists into rt.deferredModules (client/src/runtime/deferred.test.ts).
    const modules = body.data?.deferredModules ?? [];
    assert.ok(modules.includes("sites"), `sites is a deferred module: ${JSON.stringify(modules)}`);
    assert.ok(!modules.includes("vault"), "vault has real capabilities, so it is not deferred whole");
    // no token, no list
    assert.equal((await post(null, "/v1/identity/whoami")).status, 401);
  } finally { await d.stop(); }
});
