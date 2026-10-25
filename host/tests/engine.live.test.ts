// P-L2_23: a booted daemon hands the engine module its host half through the generic seam, with engine live. Nothing is faked inside the daemon: the loader collects
// `hostSeams.setEngineHost` from modules/engine/impl.ts and the daemon wires it with host/src/seams/engine.ts (the invoke pipeline, the Vault ports, the Space data directory). The runtime the
// module builds on its first call is bound: engine.stop on a thread opens it from threads.get and answers, where an unbound engine answers internal.unavailable. The CLI sandbox is the
// platform's default plan (bwrap with the network wall on a Linux runner), built on the first CLI turn; this test starts no CLI. engine is live in host/modules.json (P-L2_23 added the last three handlers).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-engine-live-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

async function boot(dir: string, codeRoot: string): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot,
    platform: fakePlatform({
      os: "linux", hostname: "engine-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}

async function call(d: Daemon, cap: string, input: unknown): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}

test("engine live: a booted daemon wires setEngineHost with the data directory, and the first engine call builds and binds the runtime", async () => {
  const dir = seededDir();
  const d = await boot(dir, CODE_ROOT);
  try {
    assert.ok(d.seams?.wired.includes("setEngineHost"), "setEngineHost is wired by the generic loader and daemon");
    assert.deepEqual(d.seams?.missing, [], "no module is left without its driver");
    const r = await call(d, "engine.stop", { threadId: "thr_a1b2c3" });
    assert.notEqual(r.data?.error?.code ?? r.data?.code, "internal.unavailable", `the engine is bound: ${JSON.stringify(r.data)}`);
  } finally { await d.stop(); }
});
