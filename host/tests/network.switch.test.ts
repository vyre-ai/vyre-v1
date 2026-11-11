// Re-running the installer with another way to reach the server (a domain instead of the relay, or another domain) must take effect on a Space that already exists. The row made at the first start
// used to keep the old way for good, so a new domain never got its site. The installer writes VYRE_NETWORK_REV when it changes the way; the Space applies a new value once. The same file checks
// that the disk choice made at install (VYRE_DISK_ENCRYPTION) is what the health probe says.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

const boot = (dir: string, argv: string[], env: Record<string, string> = {}): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_net", "--space-name", "Net Co", ...argv], env, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "net", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/vda1\n" },
      "lsblk -s -n -o TYPE /dev/vda1": { stdout: "part\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
});
const row = (d: Daemon): { address: string; mode: string } => { const r = d.db!.all("SELECT address, mode FROM network_config WHERE id = 1")[0] as { address: string; mode: string }; return { address: r.address, mode: r.mode }; };

test("a changed way of reaching the server (VYRE_NETWORK_REV) is applied once; the same value leaves the Console's own changes alone", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-net-"));
  let d = await boot(dir, ["--address", "one.example.com"]);
  try {
  assert.deepEqual(row(d), { address: "one.example.com", mode: "own_domain" });
  await d.stop();
  // the walk's case: a server first installed another way (the relay's row), then the installer is run with a domain
  d = await boot(dir, ["--address", "one.example.com"]);
  d.db!.run("UPDATE network_config SET mode = 'relay', address = 'http://0.0.0.0:8420', relay_address = 'relay.vyre.run' WHERE id = 1");
  d.db!.run("INSERT OR REPLACE INTO network_endpoint (kind, url, state, rtt_ms, heartbeat_at) VALUES ('direct', 'https://one.example.com', 'healthy', NULL, 1)");
  await d.stop();
  d = await boot(dir, ["--address", "two.example.com"], { VYRE_NETWORK_REV: "1000" });
  assert.deepEqual(row(d), { address: "two.example.com", mode: "own_domain" }, "the new domain replaced the old way");
  assert.equal((d.db!.all("SELECT value FROM network_info WHERE key = 'network_rev'")[0] as { value: string }).value, "1000");
  const kept = d.db!.all("SELECT relay_address, domain FROM network_config WHERE id = 1")[0] as { relay_address: string | null; domain: string | null };
  assert.equal(kept.relay_address, "relay.vyre.run", "the relay address stays, so the Console's own switch back to the relay still has an address to use");
  assert.equal(kept.domain, "two.example.com");
  assert.equal((d.db!.all("SELECT state FROM network_endpoint WHERE kind = 'direct' AND url = 'https://one.example.com'")[0] as { state: string }).state, "down", "the old address is no longer offered as a way in");
  assert.equal(d.db!.all("SELECT address FROM network_config WHERE id = 1 AND mode = 'own_domain'").length, 1, "the host the ingress reads is there: Caddy gets its site");
  // somebody changes the address in the Console; a restart with the same rev must not undo it
  d.db!.run("UPDATE network_config SET address = 'console.example.com' WHERE id = 1");
  await d.stop();
  d = await boot(dir, ["--address", "two.example.com"], { VYRE_NETWORK_REV: "1000" });
  assert.equal(row(d).address, "console.example.com", "the same rev changes nothing");
  await d.stop();
  d = await boot(dir, ["--address", "three.example.com"], { VYRE_NETWORK_REV: "2000" });
  assert.equal(row(d).address, "three.example.com", "a new rev applies again");
  } finally { await d.stop(); }
});

test("the health probe reports the disk choice made at install: plain is a standing warning in plain words, the provider's volume is the person's word", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-net-"));
  const probe = async (env: Record<string, string>): Promise<{ state?: string; detail?: string }> => {
    const d = await boot(dir, ["--address", "one.example.com"], env);
    try { return (await d.runProbes(["disk_encrypted"])).disk_encrypted ?? {}; } finally { await d.stop(); }
  };
  const none = await probe({});
  assert.equal(none.state, "degraded", "no choice and no encrypted disk visible: the old warning");
  const plain = await probe({ VYRE_DISK_ENCRYPTION: "plain", VYRE_DISK_ENCRYPTION_SINCE: "2026-11-11" });
  assert.equal(plain.state, "degraded");
  assert.match(plain.detail ?? "", /The data is NOT encrypted at rest\. You chose to install on a plain disk on 2026-11-11/);
  const prov = await probe({ VYRE_DISK_ENCRYPTION: "provider", VYRE_DISK_ENCRYPTION_SINCE: "2026-11-11" });
  assert.equal(prov.state, "degraded", "the person's word is not a verified volume: never the same state as one");
  assert.match(prov.detail ?? "", /^Not verified: your provider's encryption, as you stated on 2026-11-11\. This server cannot check it/);
  const seen = await probe({ VYRE_DISK_ENCRYPTION: "detected" });
  assert.equal(seen.state, "healthy");
  assert.match(seen.detail ?? "", /verified by the host at the last start/);
  assert.equal((await probe({ VYRE_DISK_ENCRYPTION: "luks" })).state, "degraded", "a value this version does not know is not trusted: the old check runs");
});
