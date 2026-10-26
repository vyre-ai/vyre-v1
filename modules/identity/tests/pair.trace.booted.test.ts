// Ruling 76: identity.pair_redeem opens the device and its session through calls the host makes as the server (devices.register is host-only). Those calls keep the caller's trace, so
// device.registered and session.started carry the traceId of the pair_redeem call and golden flow 15's single-trace chain holds.
// @reads /modules/identity/projections.ts
import test from "node:test";
// @reads /modules/identity/projections.ts
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

test("pair_redeem keeps the caller's trace on device.registered and session.started", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-pair-trace-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const PASSWORD = "correct horse battery staple 9";
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--role", "space,device", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "pair-trace", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const post = async (token: string | null, p: string, body: unknown, trace?: string): Promise<{ status: number; body: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(trace ? { "x-vyre-trace": trace } : {}) }, body: JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  try {
    const ctx = { space: "spc_core", trace: { traceId: "t".repeat(32) }, now: () => Date.now(), db: d.db, emit: () => undefined } as unknown as IdentityCtx;
    await provisionAccount(ctx, { personId: "usr_noah", username: "pairer", name: "Noah Berg", secret: PASSWORD });
    const signIn = await post(null, "/v1/identity/sign_in", { username: "pairer", password: PASSWORD, deviceName: "Mac", deviceClass: "desktop" });
    assert.equal(signIn.status, 200, JSON.stringify(signIn.body));
    const made = await post(signIn.body.data.session.token, "/v1/identity/pair_create", { purpose: "app", idempotencyKey: "pair-trace-1" });
    assert.equal(made.status, 200, JSON.stringify(made.body));

    const traceId = "5a".repeat(16);
    const redeemed = await post(null, "/v1/identity/pair_redeem", { code: made.body.data.code, deviceName: "Phone", deviceClass: "phone" }, `${traceId}-${"ab".repeat(8)}`);
    assert.equal(redeemed.status, 200, JSON.stringify(redeemed.body));
    for (const type of ["device.registered", "session.started"]) {
      const events = await d.log!.read({ type });
      const mine = events.filter((e) => e.trace_id === traceId);
      assert.equal(mine.length, 1, `${type} carries the pair_redeem call's trace`);
    }
    const signed = (await d.log!.read({ type: "signin.succeeded" })).filter((e) => e.trace_id === traceId);
    assert.equal(signed.length, 1, "and so does the sign-in event identity itself emits");
  } finally { await d.stop(); }
});
