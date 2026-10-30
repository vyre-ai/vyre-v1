// A private document address is refused by the live host. The page text is not on this route.
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
const NOT_PUBLIC = "That address is not a public host.";

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-open-doc-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string): Promise<Daemon> => startDaemon({
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
    const token = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    return token === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "exec-live" } : null;
  },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
} satisfies DaemonOptions);

async function openDocument(d: Daemon, url: string): Promise<{ status: number; data: Record<string, unknown>; text: string }> {
  const response = await fetch(`${d.url}/v1/automations/open_document`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(8_000),
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* the body is not JSON */ }
  return { status: response.status, data: (json["data"] as Record<string, unknown> | undefined) ?? {}, text };
}

test("a private document address is refused and the page is not returned", async () => {
  const dir = seededDir();
  const daemon = await boot(dir);
  try {
    for (const url of ["https://127.0.0.1/latest", "https://10.1.2.3/v1", "https://169.254.169.254/latest/meta-data"]) {
      const reply = await openDocument(daemon, url);
      assert.equal(reply.status, 200, reply.text);
      assert.equal(reply.data["ok"], false, reply.text);
      assert.equal(reply.data["reason"], NOT_PUBLIC, reply.text);
      assert.equal(Object.hasOwn(reply.data, "text"), false);
      assert.equal(reply.text.includes("ignore previous instructions"), false);
    }
  } finally {
    await daemon.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
