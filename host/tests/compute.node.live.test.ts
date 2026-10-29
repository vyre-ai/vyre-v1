// A computer joins a booted Space for compute through the real `vyred --role compute` process: it enrolls with a one-time code, prints its fingerprint, waits, is approved by a person, reports in so
// its row turns healthy, survives a restart without the code, and stops with its credential wiped when it is removed or turned away.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";

/** A fresh Space the owner claims and signs in to (ruling 71), the way a person gets in; the returned token is a real session. */
async function boot(): Promise<{ d: Daemon; owner: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-compute-space-"));
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_compute", "--space-name", "Forms Co", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "actor-cred", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const post = async (p: string, body: unknown, token?: string): Promise<{ status: number; json: { data?: any } }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as { data?: any } };   // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
  const device = { deviceName: "Mac", deviceClass: "desktop" };
  const claimed = await post("/v1/identity/claim_owner", { code, spaceId: "spc_compute", username: "olivia", displayName: "Olivia", password: PASSWORD, ...device, keys: KEYS });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.json));
  const signedIn = await post("/v1/identity/sign_in", { username: "olivia", password: PASSWORD, ...device });
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.json));
  const owner = signedIn.json.data.session.token as string;
  return { d, owner };
}


const post = async <T>(d: Daemon, p: string, body: unknown, token: string | null): Promise<{ status: number; data?: T; error?: { code: string } }> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, ...((await r.json()) as object) };
};
const MAIN = fileURLToPath(new URL("../src/daemon/main.ts", import.meta.url));

/** The compute process, with its output collected and a way to wait for a line or for it to end. */
function startNode(d: Daemon, dataDir: string, join?: string): { child: ChildProcess; lines: string[]; waitFor(re: RegExp, ms?: number): Promise<string>; ended: Promise<number | null> } {
  const child = spawn(process.execPath, [MAIN, "--role", "compute", "--data-dir", dataDir, "--server", d.url, ...(join ? ["--join", join] : [])], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, VYRE_POLL_MS: "300" } });
  const lines: string[] = [];
  const onData = (b: Buffer): void => { for (const l of b.toString().split("\n")) if (l.trim()) lines.push(l.trim()); };
  child.stdout!.on("data", onData); child.stderr!.on("data", onData);
  const ended = new Promise<number | null>((r) => child.once("exit", (c) => r(c)));
  const waitFor = async (re: RegExp, ms = 20_000): Promise<string> => { const t0 = Date.now(); for (;;) { const hit = lines.find((l) => re.test(l)); if (hit) return hit; if (Date.now() - t0 > ms) throw new Error(`no line matching ${re} in ${JSON.stringify(lines)}`); await new Promise((x) => setTimeout(x, 100)); } };
  return { child, lines, waitFor, ended };
}
const rows = async (d: Daemon, owner: string) => (await post<{ servers: { serverId: string; name: string; state: string; enrollment?: string; fingerprint?: string; facts?: { docker: boolean } }[] }>(d, "/v1/network/servers", {}, owner)).data!.servers;

test("a computer joins for compute: code, fingerprint, one approval, reports in, restarts, and is cut off when removed", async () => {
  const { d, owner } = await boot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-compute-node-"));
  const nodes: ChildProcess[] = [];
  try {
    const code = (await post<{ code: string }>(d, "/v1/network/server_join_code", { idempotencyKey: "cn-1" }, owner)).data!.code;
    const node = startNode(d, dir, code); nodes.push(node.child);
    const printed = await node.waitFor(/Fingerprint [A-Z2-9]{4}-[A-Z2-9]{4}/);
    const fingerprint = /Fingerprint ([A-Z2-9]{4}-[A-Z2-9]{4})/.exec(printed)![1]!;
    let waiting: Awaited<ReturnType<typeof rows>>[number] | undefined;
    for (let i = 0; i < 50 && !waiting; i++) { waiting = (await rows(d, owner)).find((r) => r.enrollment === "pending"); if (!waiting) await new Promise((x) => setTimeout(x, 100)); }
    assert.ok(waiting, "the computer shows as waiting");
    assert.equal(waiting!.fingerprint, fingerprint, "the Space shows the fingerprint the computer printed");
    assert.equal(typeof waiting!.facts?.docker, "boolean");
    assert.equal(waiting!.state, "down");
    assert.equal((await post(d, "/v1/network/server_approve", { serverId: waiting!.serverId }, owner)).status, 200);
    await node.waitFor(/Approved\./);
    let healthy = false; for (let i = 0; i < 60 && !healthy; i++) { healthy = (await rows(d, owner)).some((r) => r.serverId === waiting!.serverId && r.state === "healthy"); if (!healthy) await new Promise((x) => setTimeout(x, 200)); }
    assert.ok(healthy, "once admitted it reports in and its row turns healthy");
    // the files it keeps are private and hold no Space data
    const key = fs.statSync(path.join(dir, "compute-key.json")).mode & 0o777, st = fs.statSync(path.join(dir, "compute-state.json")).mode & 0o777;
    assert.deepEqual([key, st], [0o600, 0o600]);
    assert.deepEqual(fs.readdirSync(dir).sort(), ["compute-key.json", "compute-state.json"]);
    // once it holds a credential it reports with that and never asks enroll_status again, so it does not rotate its own credential on every poll
    const credentialAt = (): string => (JSON.parse(fs.readFileSync(path.join(dir, "compute-state.json"), "utf8")) as { credential: string }).credential;
    const held = credentialAt();
    await new Promise((x) => setTimeout(x, 1500));   // several polls at 300 ms
    assert.equal(credentialAt(), held, "the credential is the same after many polls");
    assert.ok((await rows(d, owner)).some((r) => r.serverId === waiting!.serverId && r.state === "healthy"), "and it still reports in with it");
    // a restart needs no code and does not enroll a second time
    node.child.kill("SIGTERM"); assert.equal(await node.ended, 0);
    const again = startNode(d, dir); nodes.push(again.child);
    await new Promise((x) => setTimeout(x, 1500));
    assert.equal((await rows(d, owner)).filter((r) => r.name !== "Space server" && r.enrollment !== undefined).length, 1, "still one computer");
    assert.ok(!again.lines.some((l) => /Asked to join/.test(l)));
    // the Space removes it: the credential stops at once and the computer forgets everything
    assert.equal((await post<{ removed: boolean }>(d, "/v1/network/server_remove", { serverId: waiting!.serverId }, owner)).status, 200);
    assert.equal(await again.ended, 4, "the computer ends as removed");
    await again.waitFor(/removed from the Space/);
    assert.deepEqual(fs.readdirSync(dir), [], "it wiped its key and credential");
    // a wrong code is refused with words, and nothing is left behind
    const bad = startNode(d, dir, "VYRE-NOPE-NOPE"); nodes.push(bad.child);
    assert.equal(await bad.ended, 1); assert.ok(bad.lines.some((l) => /did not accept the join code/.test(l)), JSON.stringify(bad.lines));
  } finally { for (const c of nodes) c.kill("SIGKILL"); fs.rmSync(dir, { recursive: true, force: true }); await d.stop(); }
});

test("a computer that is turned away stops, and its credential never works", async () => {
  const { d, owner } = await boot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-compute-node-"));
  let child: ChildProcess | undefined;
  try {
    const code = (await post<{ code: string }>(d, "/v1/network/server_join_code", { idempotencyKey: "cn-2" }, owner)).data!.code;
    const node = startNode(d, dir, code); child = node.child;
    await node.waitFor(/Fingerprint/);
    let w: { serverId: string } | undefined; for (let i = 0; i < 50 && !w; i++) { w = (await rows(d, owner)).find((r) => r.enrollment === "pending"); if (!w) await new Promise((x) => setTimeout(x, 100)); }
    assert.equal((await post(d, "/v1/network/server_decline", { serverId: w!.serverId }, owner)).status, 200);
    assert.equal(await node.ended, 3, "the computer ends as declined");
    assert.deepEqual(fs.readdirSync(dir), []);
    assert.equal((await fetch(`${d.url}/compute/poll`, { method: "POST", headers: { authorization: "Bearer vcc_00" }, body: "{}" })).status, 401);
    assert.equal((await fetch(`${d.url}/compute/poll`, { method: "POST", body: "{}" })).status, 401);
  } finally { child?.kill("SIGKILL"); fs.rmSync(dir, { recursive: true, force: true }); await d.stop(); }
});
