// The Docker sandbox's plumbing: the Engine API calls and their error mapping, HTTP over the unix socket (a real socket), the exec stream, the archive writer, running a program under a deadline with
// the proxy variables nobody can override, and which sandbox each place uses.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { SandboxError, chooseSandbox, createDockerApi, demux, tarFiles, untar, unixSocketHttp } from "../src/index.ts";
import { startDockerSandbox } from "../src/docker.ts";
import type { DockerRequest, DockerResponse, ProxyHandle } from "../src/index.ts";
import { ROOTS, fakeDocker, spec } from "./helpers.ts";

const enc = new TextEncoder();
const j = (v: unknown): Uint8Array => enc.encode(JSON.stringify(v));

function engine(answer: (r: DockerRequest) => DockerResponse | undefined) {
  const seen: DockerRequest[] = [];
  const http_ = async (r: DockerRequest): Promise<DockerResponse> => { seen.push(r); return answer(r) ?? { status: 500, body: j({ message: `unexpected ${r.method} ${r.path}` }) }; };
  return { http: http_, seen, api: createDockerApi(http_) };
}

function frame(kind: 1 | 2, text: string): Uint8Array {
  const body = enc.encode(text);
  const out = new Uint8Array(8 + body.length);
  out[0] = kind;
  new DataView(out.buffer).setUint32(4, body.length);
  out.set(body, 8);
  return out;
}
const cat = (...parts: Uint8Array[]): Uint8Array => { const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { o.set(p, at); at += p.length; } return o; };

test("the exec stream is split into stdout and stderr by its frames, across frames and with a short trailing piece ignored", () => {
  const body = cat(frame(1, "hello "), frame(2, "warn: "), frame(1, "world\n"), frame(2, "bad\n"), new Uint8Array([1, 0, 0]));
  assert.deepEqual(demux(body), { stdout: "hello world\n", stderr: "warn: bad\n" });
  assert.deepEqual(demux(new Uint8Array(0)), { stdout: "", stderr: "" });
  const big = "x".repeat(70_000);
  assert.equal(demux(frame(1, big)).stdout.length, 70_000);
  assert.equal(demux(frame(1, "café")).stdout, "café");
});

test("images and containers: the calls the Engine gets, with their query strings, and its errors turned into ours", async () => {
  const e = engine((r) => {
    if (r.path === "/_ping") return { status: 200, body: enc.encode("OK") };
    if (r.path === "/images/vyre/person-sandbox:1/json") return { status: 200, body: j({}) };
    if (r.path === "/images/missing:1/json") return { status: 404, body: j({ message: "no such image" }) };
    if (r.path === "/images/broken:1/json") return { status: 500, body: j({ message: "engine is unwell" }) };
    if (r.path === "/containers/create") return r.query?.["name"] === "dup" ? { status: 409, body: j({ message: "Conflict. The container name is already in use" }) } : { status: 201, body: j({ Id: "abc123" }) };
    if (r.path === "/containers/abc123/start") return { status: 204, body: new Uint8Array(0) };
    if (r.path === "/containers/gone/start") return { status: 404, body: j({ message: "No such container: gone" }) };
    if (r.path === "/containers/abc123/stop") return { status: 304, body: new Uint8Array(0) };
    if (r.path === "/containers/abc123" && r.method === "DELETE") return { status: 204, body: new Uint8Array(0) };
    if (r.path === "/containers/abc123/json") return { status: 200, body: j({ State: { Running: true } }) };
    return undefined;
  });
  assert.equal(await e.api.ping(), true);
  assert.equal(await e.api.imageExists("vyre/person-sandbox:1"), true);
  assert.equal(await e.api.imageExists("missing:1"), false);
  await assert.rejects(() => e.api.imageExists("broken:1"), (x: unknown) => x instanceof SandboxError && x.code === "sandbox.docker" && /engine is unwell/.test(x.message));
  assert.equal(await e.api.containerCreate("vyre-sbx-dana", { Image: "x" } as never), "abc123");
  await assert.rejects(() => e.api.containerCreate("dup", {} as never), /already in use/);
  await e.api.containerStart("abc123");
  await assert.rejects(() => e.api.containerStart("gone"), /No such container/);
  await e.api.containerStop("abc123", 5);
  await e.api.containerRemove("abc123");
  assert.equal(await e.api.containerRunning("abc123"), true);
  const stop = e.seen.find((r) => r.path.endsWith("/stop"))!;
  assert.deepEqual(stop.query, { t: "5" });
  const rm = e.seen.find((r) => r.method === "DELETE")!;
  assert.deepEqual(rm.query, { force: "true", v: "true" });
  const create = e.seen.find((r) => r.path === "/containers/create")!;
  assert.deepEqual(create.query, { name: "vyre-sbx-dana" });
  assert.deepEqual(create.json, { Image: "x" });

  const down = createDockerApi(async () => { throw new Error("connect ENOENT /var/run/docker.sock"); });
  assert.equal(await down.ping(), false, "ping never throws");
});

test("the sandbox's network is an internal bridge with no container-to-container traffic, and its gateway is where the proxy goes", async () => {
  const e = engine((r) => {
    if (r.path === "/networks/create") return { status: 201, body: j({ Id: "net9" }) };
    if (r.path === "/networks/net9") return { status: 200, body: j({ IPAM: { Config: [{ Subnet: "172.30.9.0/24", Gateway: "172.30.9.1" }] } }) };
    if (r.path === "/networks/nogw") return { status: 200, body: j({ IPAM: { Config: [] } }) };
    return undefined;
  });
  assert.deepEqual(await e.api.networkCreate("vyre-sbx-dana-net", { "vyre.sandbox": "1" }), { id: "net9", gateway: "172.30.9.1" });
  const body = e.seen[0]!.json as Record<string, unknown>;
  assert.equal(body["Internal"], true);
  assert.equal(body["Driver"], "bridge");
  assert.equal(body["CheckDuplicate"], true);
  assert.deepEqual(body["Options"], { "com.docker.network.bridge.enable_icc": "false" });
  assert.deepEqual(body["Labels"], { "vyre.sandbox": "1" });
  const e2 = engine((r) => (r.path === "/networks/create" ? { status: 201, body: j({ Id: "nogw" }) } : r.path === "/networks/nogw" ? { status: 200, body: j({ IPAM: { Config: [] } }) } : undefined));
  await assert.rejects(() => e2.api.networkCreate("n", {}), /no gateway/);
  const e3 = engine((r) => (r.method === "DELETE" ? { status: 404, body: j({ message: "gone" }) } : undefined));
  await e3.api.networkRemove("net9");
});

test("exec: create, start and inspect, with the output split and the exit code read from the inspect", async () => {
  const e = engine((r) => {
    if (r.path === "/containers/abc/exec") return { status: 201, body: j({ Id: "exec1" }) };
    if (r.path === "/exec/exec1/start") return { status: 200, body: cat(frame(1, "out\n"), frame(2, "err\n")) };
    if (r.path === "/exec/exec1/json") return { status: 200, body: j({ ExitCode: 3, Running: false }) };
    return undefined;
  });
  const r = await e.api.exec("abc", { cmd: ["ls", "-la"], env: ["A=1"], workingDir: "/work", user: "10001:10001" });
  assert.deepEqual(r, { exitCode: 3, stdout: "out\n", stderr: "err\n" });
  assert.deepEqual(e.seen[0]!.json, { AttachStdout: true, AttachStderr: true, Tty: false, Cmd: ["ls", "-la"], Env: ["A=1"], WorkingDir: "/work", User: "10001:10001" });
  assert.deepEqual(e.seen[1]!.json, { Detach: false, Tty: false });
  const none = engine((r) => (r.path.endsWith("/exec") ? { status: 201, body: j({ Id: "x" }) } : r.path.endsWith("/start") ? { status: 200, body: new Uint8Array(0) } : { status: 200, body: j({ ExitCode: null }) }));
  assert.equal((await none.api.exec("c", { cmd: ["true"], env: [] })).exitCode, null);
  const bad = engine((r) => (r.path.endsWith("/exec") ? { status: 409, body: j({ message: "container is paused" }) } : undefined));
  await assert.rejects(() => bad.api.exec("c", { cmd: ["true"], env: [] }), /container is paused/);
});

test("putArchive sends a tar to the folder named, and a refusal is an error", async () => {
  const e = engine((r) => (r.path === "/containers/abc/archive" ? { status: 200, body: new Uint8Array(0) } : undefined));
  const tar = tarFiles([{ path: "a.txt", data: enc.encode("hi"), mode: 0o600, uid: 1, gid: 1, mtime: 1 }]);
  await e.api.putArchive("abc", "/home/agent", tar);
  assert.deepEqual(e.seen[0]!.query, { path: "/home/agent" });
  assert.equal(e.seen[0]!.contentType, "application/x-tar");
  assert.deepEqual(e.seen[0]!.body, tar);
  const refused = engine(() => ({ status: 403, body: j({ message: "read-only file system" }) }));
  await assert.rejects(() => refused.api.putArchive("abc", "/etc", tar), /read-only file system/);
});

// ---- the archive

test("tar: headers carry a valid checksum, long paths use the prefix field, sizes are padded to 512, parent folders get their own 0700 entry", () => {
  const long = `${"d".repeat(60)}/${"e".repeat(60)}/${"f".repeat(40)}.json`;
  const files = [
    { path: "a/b/c.txt", data: enc.encode("hello"), mode: 0o600, uid: 10001, gid: 10001, mtime: 1_760_000_000 },
    { path: long, data: new Uint8Array(1000).fill(7), mode: 0o600, uid: 10001, gid: 10001, mtime: 1_760_000_000 },
    { path: "empty", data: new Uint8Array(0), mode: 0o644, uid: 1, gid: 2, mtime: 1 },
  ];
  const tar = tarFiles(files);
  assert.equal(tar.length % 512, 0);
  const got = untar(tar);
  assert.deepEqual(got.map((e) => [e.path, e.type]), [["a", "dir"], ["a/b", "dir"], ["a/b/c.txt", "file"], [`${"d".repeat(60)}`, "dir"], [`${"d".repeat(60)}/${"e".repeat(60)}`, "dir"], [long, "file"], ["empty", "file"]]);
  assert.equal(new TextDecoder().decode(got[2]!.data), "hello");
  assert.equal(got[5]!.data.length, 1000);
  assert.ok(got[5]!.data.every((b) => b === 7));
  assert.deepEqual([got[0]!.mode, got[0]!.uid], [0o700, 10001]);
  assert.deepEqual([got[6]!.mode, got[6]!.uid, got[6]!.gid, got[6]!.data.length], [0o644, 1, 2, 0]);
  // every 512-byte header sums to its own checksum field
  for (let at = 0; at < tar.length - 1024;) {
    const h = tar.subarray(at, at + 512);
    if (h.every((b) => b === 0)) break;
    const stored = parseInt(new TextDecoder().decode(h.subarray(148, 154)), 8);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : (h[i] as number);
    assert.equal(sum, stored, `header at ${at}`);
    const size = parseInt(new TextDecoder().decode(h.subarray(124, 135)), 8);
    at += 512 + size + ((512 - (size % 512)) % 512);
  }
  assert.ok(tar.subarray(tar.length - 1024).every((b) => b === 0), "two empty blocks end the archive");
  for (const bad of ["/abs", "../x", "a/../b", "a//b", "", "a/./b"]) assert.throws(() => tarFiles([{ path: bad, data: new Uint8Array(1), mode: 0o600, uid: 1, gid: 1, mtime: 1 }]), (x: unknown) => x instanceof SandboxError, JSON.stringify(bad));
  assert.throws(() => tarFiles([{ path: "x".repeat(300), data: new Uint8Array(1), mode: 0o600, uid: 1, gid: 1, mtime: 1 }]), (x: unknown) => x instanceof SandboxError);
});

// ---- the unix socket

test("HTTP over a unix socket: the API version prefix, the query string, the JSON body and the status and body that come back; a silent engine times out", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vsb-"));
  const sock = path.join(dir, "d.sock");
  const seen: Array<{ method: string; url: string; type: string | undefined; body: string }> = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", type: req.headers["content-type"], body: Buffer.concat(chunks).toString() });
      if (req.url?.startsWith("/v1.43/slow")) return;   // never answers
      res.writeHead(req.url?.includes("create") ? 201 : 200, { "content-type": "application/json" }).end(JSON.stringify({ Id: "abc" }));
    });
  });
  await new Promise<void>((r) => server.listen(sock, r));
  try {
    const call = unixSocketHttp(sock, "v1.43");   // pinned: no /version round trip (the negotiation has its own test, sandbox.apiversion.test.ts)
    const a = await call({ method: "POST", path: "/containers/create", query: { name: "vyre-sbx-dana" }, json: { Image: "x" } });
    assert.equal(a.status, 201);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(a.body)), { Id: "abc" });
    assert.deepEqual(seen[0], { method: "POST", url: "/v1.43/containers/create?name=vyre-sbx-dana", type: "application/json", body: '{"Image":"x"}' });
    const b = await call({ method: "PUT", path: "/containers/abc/archive", query: { path: "/home/agent" }, body: new Uint8Array([1, 2, 3]), contentType: "application/x-tar" });
    assert.equal(b.status, 200);
    assert.equal(seen[1]!.type, "application/x-tar");
    assert.equal(seen[1]!.body, "\u0001\u0002\u0003");
    assert.equal(seen[1]!.url, "/v1.43/containers/abc/archive?path=%2Fhome%2Fagent");
    await assert.rejects(() => call({ method: "GET", path: "/slow", timeoutMs: 150 }), /did not answer/);
    await assert.rejects(() => unixSocketHttp(path.join(dir, "missing.sock"), "v1.43")({ method: "GET", path: "/_ping" }));
  } finally { server.closeAllConnections?.(); await new Promise<void>((r) => server.close(() => r())); fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- running a program

async function started() {
  const d = fakeDocker();
  const startProxy = async (): Promise<ProxyHandle> => ({ port: 4040, close: async () => undefined });
  return { d, sbx: await startDockerSandbox(spec(), { api: d.api, roots: ROOTS, startProxy }) };
}

test("exec runs under a deadline inside the container, in the folder asked for, with the proxy variables the caller cannot replace", async () => {
  const { d, sbx } = await started();
  d.script = (cmd) => (cmd.includes("slow") ? { exitCode: 124 } : { exitCode: 0, stdout: "claude 2.1\n", stderr: "" });
  const ok = await sbx.exec({ argv: ["claude", "--version"], cwd: "/work/site", env: { FOO: "bar", HTTPS_PROXY: "http://evil.example:1", http_proxy: "http://evil.example:1" }, timeoutMs: 2_500 });
  assert.deepEqual(ok, { exitCode: 0, stdout: "claude 2.1\n", stderr: "", timedOut: false });
  const run = d.execs[0]!;
  assert.deepEqual(run.cmd, ["timeout", "-k", "2", "3", "claude", "--version"], "2.5 s rounds up to 3");
  assert.equal(run.workingDir, "/work/site");
  assert.ok(run.env.includes("FOO=bar"));
  assert.ok(run.env.includes("HTTPS_PROXY=http://172.30.1.1:4040") && !run.env.some((e) => e.includes("evil.example")), run.env.join(","));
  assert.ok(run.env.includes("HOME=/home/agent"));

  const timedOut = await sbx.exec({ argv: ["slow"], timeoutMs: 1 });
  assert.equal(timedOut.timedOut, true);
  assert.deepEqual(d.execs[1]!.cmd.slice(0, 4), ["timeout", "-k", "2", "1"], "a deadline under a second is a second");
  await sbx.exec({ argv: ["true"] });
  assert.equal(d.execs[2]!.cmd[3], "600", "ten minutes by default");
  await assert.rejects(() => sbx.exec({ argv: [] }), (x: unknown) => x instanceof SandboxError && x.code === "sandbox.policy");
});

// ---- which sandbox

test("each place has its sandbox: Docker on the Space host, Seatbelt on a Mac, bwrap on Linux, WSL2's bwrap or the server on Windows", () => {
  assert.deepEqual(chooseSandbox({ placement: "host", platform: "linux", hasDocker: true }), { kind: "docker" });
  assert.deepEqual(chooseSandbox({ placement: "host", platform: "darwin", hasDocker: true }), { kind: "docker" });
  assert.throws(() => chooseSandbox({ placement: "host", platform: "linux" }), (e: unknown) => e instanceof SandboxError && e.code === "sandbox.unavailable");
  assert.deepEqual(chooseSandbox({ placement: "device", platform: "darwin" }), { kind: "seatbelt" });
  assert.deepEqual(chooseSandbox({ placement: "device", platform: "linux", hasBwrap: true }), { kind: "bwrap" });
  assert.throws(() => chooseSandbox({ placement: "device", platform: "linux" }), (e: unknown) => e instanceof SandboxError && e.code === "sandbox.unavailable");
  assert.deepEqual(chooseSandbox({ placement: "device", platform: "win32", wsl: true }), { kind: "bwrap", via: "wsl" });
  assert.deepEqual(chooseSandbox({ placement: "device", platform: "win32" }), { kind: "server" });
  assert.deepEqual(chooseSandbox({ placement: "device", platform: "win32", wsl: false }), { kind: "server" });
});
