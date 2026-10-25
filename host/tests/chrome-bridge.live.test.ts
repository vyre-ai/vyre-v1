// P-L10_06b: the Chrome bridge answers on a real booted daemon. /chrome-bridge/v1/rpc and /chrome-bridge/v1/events are the two endpoints the native messaging host (apps/chrome/src/worker/native/host.js)
// talks to; before this they existed only in a fake daemon in the extension's tests. Here the daemon is the real one on the seeded Space, and the rest of the daemon's HTTP face still works beside them.
// The extension side of the same chain (host -> framed Chrome messages) is in apps/chrome/tests/ext-core.test.ts and ext-agent.real.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { ChromeToolError } from "../src/bridge/chrome.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-chrome-bridge-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

async function boot(): Promise<Daemon> {
  const dir = seededDir();
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "chrome-bridge", free: 80e9,
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

const rpc = (d: Daemon, body: unknown, token: string | null = d.token): Promise<Response> =>
  fetch(`${d.url}/chrome-bridge/v1/rpc`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

/** Open the events stream and collect its lines until `n` have arrived. */
function events(d: Daemon, token: string): { lines: unknown[]; status: Promise<number>; until(n: number): Promise<void>; close(): void } {
  const lines: unknown[] = [];
  let req!: http.ClientRequest;
  let resolveStatus!: (n: number) => void;
  const status = new Promise<number>((r) => { resolveStatus = r; });
  let wake: (() => void) | null = null;
  req = http.get(`${d.url}/chrome-bridge/v1/events`, { headers: { authorization: `Bearer ${token}` } }, (res) => {
    resolveStatus(res.statusCode ?? 0);
    let buf = "";
    res.setEncoding("utf8");
    res.on("data", (c: string) => {
      buf += c;
      let at: number;
      while ((at = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, at).trim(); buf = buf.slice(at + 1); if (l) lines.push(JSON.parse(l)); }
      wake?.();
    });
    res.on("error", () => {});
  });
  req.on("error", () => {});
  return {
    lines, status,
    until: async (n) => { for (let i = 0; i < 300 && lines.length < n; i++) await new Promise<void>((r) => { wake = r; setTimeout(r, 20); }); },
    close: () => req.destroy(),
  };
}

test("chrome bridge: a booted daemon answers /chrome-bridge/v1/rpc and /events, refuses a wrong token, and keeps its own routes", async () => {
  const d = await boot();
  try {
    assert.ok(d.chromeBridge, "the daemon has a Chrome bridge");
    assert.equal((await fetch(`${d.url}/healthz`)).status, 200, "the daemon's own routes still answer");
    assert.equal((await fetch(`${d.url}/v1/nope/nothing`, { method: "POST", headers: { authorization: `Bearer ${d.token}` }, body: "{}" })).status, 404, "and the gateway still owns every other path");

    assert.equal((await rpc(d, { id: "r0", type: "bridge", op: "hello", input: {} }, null)).status, 401, "no token");
    assert.equal((await rpc(d, { id: "r0", type: "bridge", op: "hello", input: {} }, "wrong")).status, 401, "a wrong token");
    const sameLength = d.token.slice(0, -1) + (d.token.endsWith("a") ? "b" : "a");
    assert.equal(sameLength.length, d.token.length);
    assert.equal((await rpc(d, { id: "r0", type: "bridge", op: "hello", input: {} }, sameLength)).status, 401, "a wrong token of the same length");
    assert.equal((await fetch(`${d.url}/chrome-bridge/v1/events`)).status, 401, "the events stream needs the token too");

    const ok = await rpc(d, { id: "r1", type: "bridge", op: "agent.event", input: { event: "driving", agent: "agt_scout", tabId: "t1" } });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { id: "r1", ok: true, output: {} });
    const open = await rpc(d, { id: "r2", type: "bridge", op: "hello", input: {} });
    assert.deepEqual(await open.json(), { id: "r2", ok: false, error: { code: "not_available", message: "The Vyre app cannot answer that yet." } });
    assert.equal((await rpc(d, "nonsense")).status, 200);
    const bad = await fetch(`${d.url}/chrome-bridge/v1/rpc`, { method: "POST", headers: { authorization: `Bearer ${d.token}` }, body: "{not json" });
    assert.equal(bad.status, 400);
  } finally { await d.stop(); }
});

test("chrome bridge: an agent tool call reaches a connected extension on the events stream and its result, or its failure with the extension's code, comes back through rpc", async () => {
  const d = await boot();
  const stream = events(d, d.token);
  try {
    assert.equal(await stream.status, 200);
    d.chromeBridge.optIn(["spc_core"], "computer");
    await stream.until(1);
    assert.deepEqual(stream.lines[0], { type: "agent.optin", spaces: ["spc_core"], mode: "computer" });

    const call = d.chromeBridge.callTool({ tool: "chrome_status", agent: { id: "agt_scout", name: "Scout" }, space: "spc_core" });
    await stream.until(2);
    const cmd = stream.lines[1] as { type: string; id: string; tool: string; agent: { id: string }; space: string };
    assert.equal(cmd.type, "agent.call");
    assert.equal(cmd.tool, "chrome_status");
    assert.deepEqual([cmd.agent.id, cmd.space], ["agt_scout", "spc_core"]);
    const back = await rpc(d, { id: "r3", type: "bridge", op: "agent.result", input: { callId: cmd.id, ok: true, output: { tabs: 1 } } });
    assert.equal(back.status, 200);
    assert.deepEqual(await call, { tabs: 1 });

    const second = d.chromeBridge.callTool({ tool: "chrome_act", agent: { id: "agt_scout", name: "Scout" }, space: "spc_core" });
    await stream.until(3);
    await rpc(d, { id: "r5", type: "bridge", op: "agent.result", input: { callId: (stream.lines[2] as { id: string }).id, ok: false, error: { code: "paused", message: "The person stopped the agent." } } });
    await assert.rejects(second, (e: unknown) => e instanceof ChromeToolError && e.code === "paused");
  } finally {
    stream.close();
    await d.stop();
  }
});
