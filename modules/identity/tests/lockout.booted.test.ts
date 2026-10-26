// P-GF_06: a refused sign-in leaves two things behind. The failed-attempt counter trips the lockout (brute force stops), and the signin.failed event is in the log, one per attempt.
// @reads /modules/identity/projections.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../../../host/src/platform/index.ts";
import type { FetchFn } from "../../../host/src/platform/probes.ts";
import { loadConfig } from "../../../host/src/daemon/config.ts";
import { startDaemon } from "../../../host/src/daemon/daemon.ts";
import { LOCK_AFTER, provisionAccount } from "../projections.ts";
import type { IdentityCtx } from "../projections.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

test("wrong passwords lock the account after the limit and every attempt leaves a signin.failed event; a wrong pair code does too", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-lockout-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const PASSWORD = "correct horse battery staple 9";
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "lockout", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const signIn = async (password: string): Promise<{ status: number; code?: string }> => {
    const r = await fetch(`${d.url}/v1/identity/sign_in`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "lockme", password, deviceName: "Mac", deviceClass: "desktop" }) });
    const body = (await r.json()) as { error?: { code?: string } };
    return { status: r.status, ...(body.error?.code ? { code: body.error.code } : {}) };
  };
  const failedFor = async (name: string): Promise<number> => (await d.log!.read({ type: "signin.failed" })).filter((e) => JSON.parse(new TextDecoder().decode(e.payload)).username === name).length;
  try {
    const ctx = { space: "spc_core", trace: { traceId: "t".repeat(32) }, now: () => Date.now(), db: d.db, emit: () => undefined } as unknown as IdentityCtx;
    await provisionAccount(ctx, { personId: "usr_noah", username: "lockme", name: "Noah Berg", secret: PASSWORD });
    for (let i = 1; i <= LOCK_AFTER; i++) {
      const r = await signIn("wrong password number " + i);
      assert.notEqual(r.status, 200);
      assert.equal(await failedFor("lockme"), i, `attempt ${i} left its signin.failed event`);
    }
    const locked = await signIn(PASSWORD);
    assert.notEqual(locked.status, 200, "the right password is refused while the account is locked");
    assert.equal(await failedFor("lockme"), LOCK_AFTER + 1, "and the refusal is logged too");
    const row = d.db!.all("SELECT fails, locked_until FROM identity_accounts WHERE person_id = ?", "usr_noah")[0] as { fails: number; locked_until: number };
    assert.ok(row.fails >= LOCK_AFTER && row.locked_until > Date.now(), "the counter and the lock are stored");

    const before = await failedFor("pair");
    const bad = await fetch(`${d.url}/v1/identity/pair_redeem`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "NOPE-NOPE", deviceName: "Phone", deviceClass: "phone" }) });
    assert.notEqual(bad.status, 200);
    assert.equal(await failedFor("pair"), before + 1, "a wrong pair code leaves its signin.failed event");
  } finally { await d.stop(); }
});
