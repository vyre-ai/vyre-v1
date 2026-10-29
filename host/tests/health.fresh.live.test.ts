// A new Space with nothing set up reads Healthy and stays Healthy: unset integrations, no backups yet, no first audit checkpoint, no Docker and no agent computer are hints, not failures.
// The clock is injected so six minutes (and a day) pass in seconds; the host-only probes are real, with a machine that has no Docker.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startDaemon } from "../src/daemon/daemon.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { fakePlatform } from "../src/platform/index.ts";
import { diskEncrypted as diskProbe } from "../src/platform/probes.ts";

const MIN = 60_000, HOUR = 3_600_000;
let fileVaultOff = false;
const mac = fakePlatform({ os: "darwin", commands: { "fdesetup status": { stdout: "FileVault is Off.\n" } } });
const encrypted = () => (fileVaultOff ? diskProbe(mac, "/data") : Promise.resolve({ state: "healthy" as const, detail: "The data directory sits on an encrypted volume." }));

test("a new Space with no Docker, no integrations, no backups and no computers reads Server healthy for six minutes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-health-fresh-"));
  const token = "health-fresh-owner-token";
  fs.writeFileSync(path.join(dir, "admin.token"), `${token}\n`, { mode: 0o600 });
  let skew = 0;
  const now = (): number => Date.now() + skew;
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_hf", "--space-name", "Fresh Co"], {}, "1.0.0"),
    platform: fakePlatform({ now }), now, probes: { diskEncrypted: encrypted }, computersSocketPath: path.join(dir, "no-container-engine.sock"),
    intervals: { tick: 100, fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const call = async (cap: string, input: object = {}) => {
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
    return { status: r.status, body: (await r.json()) as { data?: any } };
  };
  const read = async () => {
    await new Promise((r) => setTimeout(r, 400)); // the scheduler ticks on the moved clock
    await d.runProbes();
    assert.equal((await call("health.run")).status, 200);
    const s = (await call("health.status")).body.data;
    const o = (await call("console.overview")).body.data;
    return { overall: s.overall as string, bad: (s.checks as { key: string; state: string; detail?: string }[]).filter((c) => c.state !== "healthy"), console: o?.health };
  };
  try {
    for (let minute = 0; minute <= 6; minute += 2) {
      skew = minute * MIN;
      const r = await read();
      assert.deepEqual(r.bad, [], `minute ${minute}: nothing is failing on a new Space`);
      assert.equal(r.overall, "healthy", `minute ${minute}`);
    }
    // FileVault off is a posture warning: amber with a plain fix line, never Down, and the Console dot follows.
    fileVaultOff = true;
    const posture = await read();
    assert.equal(posture.overall, "degraded");
    const disk = posture.bad.find((c) => c.key === "host.disk_encrypted");
    assert.equal(disk?.state, "degraded");
    assert.match(disk?.detail ?? "", /Turn on FileVault in System Settings/);
    assert.deepEqual(posture.bad.map((c) => c.key), ["host.disk_encrypted"]);
    assert.equal(posture.console, "degraded");
    fileVaultOff = false;
    // A real failure still shows: once an agent computer exists, a runtime that is not there is Down, on the Docker check and on the computers check.
    d.db!.run("INSERT INTO computers_computers (computer_id, agent_id, state, tabs, tab_limit, idle_sleep_minutes, host, created_at) VALUES ('cmp_h1', 'agt_h1', 'asleep', 0, 5, 30, 'server', ?)", now());
    const failing = await read();
    assert.equal(failing.overall, "down");
    assert.equal(failing.bad.find((c) => c.key === "host.docker")?.state, "down");
    assert.equal(failing.bad.find((c) => c.key === "computers")?.state, "down");
    assert.equal(failing.console, "down", "the Console dot follows the same answer");
    d.db!.run("DELETE FROM computers_computers WHERE computer_id = 'cmp_h1'");
    // The opposite case: the same Space a day later does say so. The hint was a grace period, not a mute.
    skew = 25 * HOUR;
    const later = await read();
    const backup = later.bad.find((c) => c.key === "backups.recent");
    assert.ok(backup, "after a day with no backup target, backups read degraded");
    assert.equal(backup.state, "degraded");
    assert.match(backup.detail ?? "", /No backup target is set/);
    const chain = later.bad.find((c) => c.key === "audit.chain");
    assert.equal(chain?.state, "degraded", "after a day with no signed checkpoint, the audit chain reads degraded");
    assert.notEqual(later.overall, "healthy");
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
