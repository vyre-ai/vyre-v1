// automations.validate refuses a loop above the runtime cap and accepts the cap.
// The drive step cap is a different ceiling and is not exercised here.
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
import type { Daemon, DaemonOptions } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER = "tok-usr_olivia";

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-limits-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string, extra: Partial<DaemonOptions> = {}): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "exec-live", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  session: (h) => {
    const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    return t === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "exec-live" } : null;
  },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000, tick: 3_600_000 },
  ...extra,
});

interface Reply { status: number; data: Record<string, unknown>; text: string }

const call = async (d: Daemon, p: string, body: unknown): Promise<Reply> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* the body is not JSON */ }
  return { status: r.status, data: (json["data"] as Record<string, unknown> | undefined) ?? {}, text };
};

function loopDef(maxIterations: number): unknown {
  return {
    triggers: [{ key: "manual" }],
    nodes: [
      { id: "each", key: "loop", input: { items: "trigger.items", maxIterations }, branches: [{ label: "body", to: "make" }], next: ["after"] },
      { id: "make", key: "records.create", input: { type: "note_board", fields: { title: "Item" } } },
      { id: "after", key: "stop", input: {} },
    ],
  };
}

test("validation refuses a loop of 1001 and accepts a loop of 1000", async () => {
  const d = await boot(seededDir());
  try {
    const over = await call(d, "/v1/automations/validate", { definition: loopDef(1001) });
    assert.equal(over.status, 200, over.text);
    assert.equal(over.data["ok"], false, over.text);
    const issues = over.data["issues"] as { severity?: string; message?: string }[];
    assert.ok(issues.some((i) => i.severity === "error" && i.message === "A loop allows at most 1000 iterations."), over.text);
    const atCap = await call(d, "/v1/automations/validate", { definition: loopDef(1000) });
    assert.equal(atCap.status, 200, atCap.text);
    assert.equal(atCap.data["ok"], true, atCap.text);
    const errors = (atCap.data["issues"] as { severity?: string }[]).filter((i) => i.severity === "error");
    assert.deepEqual(errors, [], atCap.text);
  } finally { await d.stop(); }
});
