// Ruling 62, 63 through the real identity module: a member signs in (the gateway issues their session token), their client hands the daemon the key it unwrapped over loopback, their Mine provider then opens for their
// own turn, signing out locks it, and no key bytes reach the data directory. (Unlock, lock, another person's turn and restart without identity are in host/tests/vault.key.test.ts.)
// The person is a seeded member: a person made by an invite is not yet known to the daemon's authorize snapshot (access projection finding sent to the lead).
// @reads /modules/identity/projections.ts
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../../../host/src/platform/index.ts";
import type { FetchFn } from "../../../host/src/platform/probes.ts";
import { loadConfig } from "../../../host/src/daemon/config.ts";
import { startDaemon } from "../../../host/src/daemon/daemon.ts";
import { provisionAccount } from "../projections.ts";
import type { IdentityCtx } from "../projections.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test("a signed-in member unlocks their key from their own client, signing out locks it, and the key never reaches disk", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-identity-key-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const PASSWORD = "correct horse battery staple 9", SECRET = "sk-ant-mine-NEVER-ON-DISK";
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--role", "space,device", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "identity-key", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const post = async (token: string | null, p: string, body: unknown): Promise<{ status: number; body: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const personKey = crypto.randomBytes(32);
  try {
    const ctx = { space: "spc_core", trace: { traceId: "t".repeat(32) }, now: () => Date.now(), db: d.db, emit: () => undefined } as unknown as IdentityCtx;
    await provisionAccount(ctx, { personId: "usr_noah", username: "keyed", name: "Noah Berg", secret: PASSWORD });
    const signIn = async (device: string): Promise<string> => {
      const r = await post(null, "/v1/identity/sign_in", { username: "keyed", password: PASSWORD, deviceName: device, deviceClass: "desktop" });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.data.session.token as string;
    };
    const t1 = await signIn("Mac");
    const unlock = (t: string) => post(t, "/local/vault/key/unlock", { key: personKey.toString("base64") });
    assert.equal((await unlock(t1)).status, 204, "their client hands over the key it unwrapped");
    const added = await post(t1, "/v1/providers/add", { providerKey: "anthropic", connection: "api_key", scope: "mine", apiKey: SECRET, idempotencyKey: "l7-key-provider" });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    const fill = (t: string) => post(t, "/v1/vault/fill", { handle: "#Anthropic.api_key", target: { kind: "env", ref: "x" }, returnValue: true });
    assert.equal((await fill(t1)).body.data.value, SECRET, "their own turn opens their Mine key");

    const t2 = await signIn("Phone");
    assert.equal((await fill(t2)).status, 200, "the key belongs to the person on this node, whichever of their sessions asks");
    assert.equal((await post(t1, "/v1/identity/sign_out", {})).status, 200);
    assert.equal((await fill(t2)).body.error?.code, "auth.unauthenticated", "signing out took the key out of memory");

    for (const f of walk(dir)) {
      const bytes = fs.readFileSync(f);
      for (const needle of [personKey, Buffer.from(personKey.toString("hex")), Buffer.from(personKey.toString("base64")), Buffer.from(SECRET)]) assert.ok(!bytes.includes(needle), `${path.basename(f)} holds nothing key-like`);
    }
  } finally { await d.stop(); }
});
