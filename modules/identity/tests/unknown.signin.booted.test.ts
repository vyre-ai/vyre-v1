// P-GF_01: a person whose principal the Space does not have (erased, or never admitted) is refused at password sign-in, however right the password is. Only the call that creates a person
// (invite accept, owner claim) may meet an unknown one.
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
import { provisionAccount } from "../projections.ts";
import type { IdentityCtx } from "../projections.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

test("an account with no principal in the Space cannot sign in; a seeded member with the same kind of account can", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-unknown-signin-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const PASSWORD = "correct horse battery staple 9";
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "unknown-signin", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const signIn = async (username: string): Promise<{ status: number; code?: string }> => {
    const r = await fetch(`${d.url}/v1/identity/sign_in`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PASSWORD, deviceName: "Mac", deviceClass: "desktop" }) });
    const body = (await r.json()) as { error?: { code?: string } };
    return { status: r.status, ...(body.error?.code ? { code: body.error.code } : {}) };
  };
  try {
    const ctx = { space: "spc_core", trace: { traceId: "t".repeat(32) }, now: () => Date.now(), db: d.db, emit: () => undefined } as unknown as IdentityCtx;
    await provisionAccount(ctx, { personId: "usr_ghost", username: "ghost", name: "Ghost", secret: PASSWORD });
    await provisionAccount(ctx, { personId: "usr_noah", username: "noahb", name: "Noah Berg", secret: PASSWORD });
    const ghost = await signIn("ghost");
    assert.notEqual(ghost.status, 200, "no principal, no session");
    assert.equal(ghost.code, "auth.bad_credentials");
    assert.equal((await signIn("noahb")).status, 200, "a member the Space has signs in");
  } finally { await d.stop(); }
});
