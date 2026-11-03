// A real device daemon answers the desktop shell's question before an app update (GET /local/daemon/busy, POST /local/daemon/drain): the engine's running turns, with the admin token only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

test("a device daemon says what runs on this computer, and hands over on drain, to the admin token only", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-daemon-busy-"));
  const platform = fakePlatform({ os: "linux", hostname: "busy-test", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" } } });
  const d = await startDaemon({ config: loadConfig(["--role", "device", "--data-dir", dir, "--port", "0"], {}, "1"), platform, fetch: caddyFetch, intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000 } });
  try {
    const busy = await fetch(`${d.url}/local/daemon/busy`, { headers: { authorization: `Bearer ${d.token}` } });
    assert.equal(busy.status, 200);
    assert.deepEqual(((await busy.json()) as { data: unknown }).data, { turns: 0, sources: [{ name: "engine", turns: 0 }] });
    const drain = await fetch(`${d.url}/local/daemon/drain`, { method: "POST", headers: { authorization: `Bearer ${d.token}` } });
    assert.equal(((await drain.json()) as { data: { turns: number } }).data.turns, 0);
    assert.equal((await fetch(`${d.url}/local/daemon/busy`)).status, 401);
    assert.equal((await fetch(`${d.url}/local/daemon/drain`, { method: "POST", headers: { authorization: "Bearer not-the-token" } })).status, 401);
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
