// The Windows sandbox's own parts (sandbox/src/wsl), on Linux: paths as the VM sees them, WSL on or off, the pinned distribution imported only when it is not there and only from its checked
// file, and the real agent (agent.ts, the program the VM runs) started through startWslAgent: its net wall lets the policy's hosts through and nothing else, a new policy applies from the next
// connection, and an MCP connection is relayed over its stdio and served on this side, a wrong token closed before anything is posted.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { AGENT_PATH, TURN_ON_WSL_STEPS, ensureDistro, setupScript, startWslAgent, toWslPath, wslState } from "../src/wsl/wsl.ts";
import type { WslResult } from "../src/wsl/wsl.ts";
import { DISTRO_PIN } from "../src/wsl/pins.ts";
import type { DistroPin } from "../src/wsl/pins.ts";
import { shortTempRoot } from "../src/sock.ts";

test("a Windows path as the VM sees it; a network path has no place there", () => {
  assert.equal(toWslPath("C:\\Users\\Dana Lee\\AppData\\Roaming\\ai.vyre.desktop\\personal\\work\\usr_dana\\thr_1"), "/mnt/c/Users/Dana Lee/AppData/Roaming/ai.vyre.desktop/personal/work/usr_dana/thr_1");
  assert.equal(toWslPath("D:/data/"), "/mnt/d/data");
  assert.equal(toWslPath("E:"), "/mnt/e");
  assert.throws(() => toWslPath("\\\\server\\share\\x"), (e: { code?: string }) => e.code === "sandbox.policy");
  assert.throws(() => toWslPath("/home/dana"), (e: { code?: string }) => e.code === "sandbox.policy");
});

test("WSL is off when wsl.exe is missing or says so, on when its status answers", () => {
  const r = (x: Partial<WslResult>) => () => ({ status: 0, stdout: "", stderr: "", ...x });
  assert.deepEqual(wslState(r({ error: new Error("ENOENT") })), { on: false, why: "missing" });
  assert.deepEqual(wslState(r({ status: 1 })), { on: false, why: "off" });
  assert.deepEqual(wslState(r({ status: 0, stdout: "Default Version: 2" })), { on: true });
  assert.ok(TURN_ON_WSL_STEPS.some((s) => s.includes("wsl --install --no-distribution")) && TURN_ON_WSL_STEPS.some((s) => /Restart/.test(s)));
});

test("the set-up: no Windows programs from inside, the pinned packages, an unprivileged user, the stamp", () => {
  const s = setupScript(DISTRO_PIN);
  assert.match(s, /\[interop\]\\nenabled=false\\nappendWindowsPath=false/);
  for (const p of ["bubblewrap~0.12", "nodejs~22", "bash"]) assert.ok(s.includes(p), p);
  assert.match(s, /adduser -D -u 1000 -s \/bin\/bash vyre/);
  assert.ok(s.includes(DISTRO_PIN.stamp));
  for (const b of Object.values(DISTRO_PIN.builds)) { assert.match(b.sha256, /^[0-9a-f]{64}$/); assert.ok(b.url.startsWith("https://dl-cdn.alpinelinux.org/")); }
});

function fakeWsl(listed: boolean, stamp: string) {
  const calls: string[][] = [];
  const run = async (args: readonly string[]): Promise<WslResult> => {
    calls.push([...args]);
    if (args[0] === "-l") return { status: 0, stdout: listed ? "Ubuntu\r\nvyre-sandbox\r\n" : "Ubuntu\r\n", stderr: "" };
    if (args.includes("/etc/vyre-sandbox")) return { status: 0, stdout: `${stamp}\n`, stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
  return { run, calls };
}

test("the distribution: nothing is downloaded when it is set up at this pin; otherwise the checked file is imported, set up and restarted", async () => {
  const tar = Buffer.from("not really a tarball");
  const sha = Buffer.from(await globalThis.crypto.subtle.digest("SHA-256", tar)).toString("hex");
  const pin: DistroPin = { ...DISTRO_PIN, builds: { x64: { url: "https://dl-cdn.alpinelinux.org/x.tar.gz", size: tar.length, sha256: sha } } };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-wsl-"));
  let fetched = 0;
  const get = (async () => { fetched++; return new Response(new Uint8Array(tar)); }) as unknown as typeof fetch;

  const ready = fakeWsl(true, pin.stamp);
  const phases: string[] = [];
  await ensureDistro({ root, pin, run: ready.run, fetch: get, arch: "x64", onPhase: (p) => phases.push(p) });
  assert.equal(fetched, 0);
  assert.deepEqual(phases, ["start"]);
  assert.ok(!ready.calls.some((c) => c.includes("--import")));

  const fresh = fakeWsl(false, "");
  await ensureDistro({ root, pin, run: fresh.run, fetch: get, arch: "x64", onPhase: (p) => phases.push(p) });
  assert.equal(fetched, 1);
  assert.equal(phases.at(-1), "import");
  const imp = fresh.calls.find((c) => c[0] === "--import");
  assert.deepEqual(imp, ["--import", "vyre-sandbox", path.join(root, "disk"), path.join(root, "rootfs.tar.gz"), "--version", "2"]);
  const set = fresh.calls.find((c) => c.includes("/bin/sh"));
  assert.deepEqual(set?.slice(0, 6), ["-d", "vyre-sandbox", "-u", "root", "--exec", "/bin/sh"]);
  assert.deepEqual(fresh.calls.at(-1), ["--terminate", "vyre-sandbox"]);
  assert.ok(!fs.existsSync(path.join(root, "rootfs.tar.gz")), "the download is not kept");

  const old = fakeWsl(true, "an-older-pin");
  await ensureDistro({ root, pin, run: old.run, fetch: get, arch: "x64" });
  assert.ok(old.calls.some((c) => c[0] === "--unregister"), "an older pin is set up again from scratch");

  const bad = (async () => new Response(new Uint8Array(Buffer.from("something else")))) as unknown as typeof fetch;
  const none = fakeWsl(false, "");
  await assert.rejects(ensureDistro({ root, pin, run: none.run, fetch: bad, arch: "x64" }), (e: { code?: string }) => e.code === "sandbox.wsl_setup");
  assert.ok(!none.calls.some((c) => c[0] === "--import"), "a file that is not the pinned one is never imported");
  const elsewhere = (async () => new Response(null, { status: 302, headers: { location: "https://evil.example/x.tar.gz" } })) as unknown as typeof fetch;
  await assert.rejects(ensureDistro({ root, pin, run: fakeWsl(false, "").run, fetch: elsewhere, arch: "x64" }), /not Alpine's/);
  fs.rmSync(root, { recursive: true, force: true });
});

/** The real agent, run by this Node as the VM's Node would run it (startWslAgent's spawnAgent). */
const localAgent = (args: string[]) => spawn(process.execPath, [AGENT_PATH, args.at(-1) as string], { stdio: ["pipe", "pipe", "pipe"] });

function proxied(socket: string, url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const c = net.connect(socket);
    let got = "";
    c.on("connect", () => c.write(`GET ${url} HTTP/1.1\r\nHost: ${new URL(url).host}\r\nConnection: close\r\n\r\n`));
    c.setEncoding("utf8").on("data", (d: string) => { got += d; });
    c.on("close", () => resolve(Number(/^HTTP\/1\.1 (\d+)/.exec(got)?.[1] ?? 0)));
    c.on("error", reject);
  });
}

test("the agent: its wall lets the policy's hosts through, a new policy applies from the next connection, and an MCP connection is relayed and served here", async () => {
  const site = http.createServer((_q, r) => r.end("hi")).listen(0, "127.0.0.1");
  await new Promise((r) => site.once("listening", r));
  const port = (site.address() as net.AddressInfo).port;
  const base = fs.mkdtempSync(path.join(shortTempRoot(), "vw-"));
  const agent = await startWslAgent({ options: { wall: { allow: ["allowed.test"] }, base, testRoutes: { "allowed.test": port } }, spawnAgent: localAgent as never });
  assert.ok(agent.wallDir.startsWith(base) && fs.existsSync(path.join(agent.wallDir, "proxy.sock")));
  assert.equal(typeof agent.splitUsr, "boolean");
  const sock = path.join(agent.wallDir, "proxy.sock");
  assert.equal(await proxied(sock, "http://allowed.test/"), 200);
  assert.equal(await proxied(sock, "http://not-listed.test/"), 403);
  agent.setPolicy({ allow: [] });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(await proxied(sock, "http://allowed.test/"), 403, "the turn's new policy applies from the next connection");

  // MCP: the socket is in the wall's folder (the sandbox sees it at /run/vyre-net); each connection is served on this side, token first
  const posted: string[] = [];
  const { mcpConnection } = await import("../../modules/engine/mcp-bridge.ts");
  const f = (async (_u: string, init: RequestInit) => { posted.push(String(init.body)); return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }), { headers: { "content-type": "application/json" } }); }) as unknown as typeof fetch;
  const guest = await agent.openMcp("abc123def456", (wire) => mcpConnection({ url: "http://x/mcp", token: "tok" }, f, wire));
  assert.equal(guest, "/run/vyre-net/mcp-abc123def456.sock");
  const real = path.join(agent.wallDir, "mcp-abc123def456.sock");
  const talk = (lines: string[]): Promise<string> => new Promise((resolve) => {
    const c = net.connect(real);
    let got = "";
    c.setEncoding("utf8").on("data", (d: string) => { got += d; if (got.includes("\n")) c.end(); });
    c.on("connect", () => c.write(lines.map((l) => `${l}\n`).join("")));
    c.on("close", () => resolve(got));
  });
  assert.deepEqual(JSON.parse((await talk([JSON.stringify({ auth: "tok" }), JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })])).trim()), { jsonrpc: "2.0", id: 1, result: { ok: true } });
  assert.equal(posted.length, 1);
  assert.equal(await talk([JSON.stringify({ auth: "wrong" }), JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })]), "", "a wrong token is closed");
  assert.equal(posted.length, 1, "and nothing was posted for it");
  agent.closeMcp("abc123def456");
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!fs.existsSync(real), "a closed session's socket is gone");

  await agent.close();
  await agent.exited;
  assert.ok(!fs.existsSync(agent.wallDir), "the wall goes with the agent");
  site.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("an agent that never comes up is refused in time, with sandbox.wsl_start", async () => {
  const hang = () => spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: ["pipe", "pipe", "pipe"] });
  await assert.rejects(startWslAgent({ options: { wall: { allow: [] }, base: "/tmp/x" }, readyMs: 500, spawnAgent: hang as never }), (e: { code?: string }) => e.code === "sandbox.wsl_start");
});
