// P-SEC_06: sync.epoch.bump purges a person's devices, so only an Admin (access.manage) or the host's own internal call may raise it. A booted daemon on the seeded Space, called through the gateway
// with real tokens: a member who calls POST /v1/sync/epoch/bump directly gets 403 and nothing is bumped; an admin and the owner are allowed; no token gets 401. The host's own internal call (devices.revoke
// reaching sync.epoch.bump as svc_host, so a member can revoke their own device) is proven in host/tests/session.revoke.test.ts.
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
import type { Handler } from "../../../host/src/invoke.ts";

const PEOPLE: Record<string, string> = { "tok-noah": "usr_noah", "tok-adam": "usr_adam", "tok-olivia": "usr_olivia" };
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

test("sync.epoch.bump guard: a member's direct call is 403 and bumps nothing; an admin and the owner are allowed; no token is 401", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-epoch-guard-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const bumps: unknown[] = [];
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "epoch-guard", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const who = PEOPLE[/^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1] ?? ""];
      return who ? ({ space: "spc_core", principal: { kind: "person", id: who }, device: `dev_${who}` } as never) : null;
    },
    extra: { handlers: { "sync.epoch.bump": ((_c: unknown, input: unknown) => { bumps.push(input); return { epoch: bumps.length }; }) as Handler } },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  try {
    const bump = (token: string | null) => fetch(`${d.url}/v1/sync/epoch/bump`, {
      method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ personId: "usr_olivia", reason: "suspended" }),
    });
    const noah = await bump("tok-noah");
    assert.equal(noah.status, 403, "a member cannot purge another person's devices");
    assert.equal(bumps.length, 0, "and nothing was bumped");
    assert.equal((await bump(null)).status, 401);
    const adam = await bump("tok-adam");
    assert.equal(adam.status, 200, JSON.stringify(await adam.clone().json()));
    assert.equal((await bump("tok-olivia")).status, 200);
    assert.equal(bumps.length, 2);
  } finally { await d.stop(); }
});
