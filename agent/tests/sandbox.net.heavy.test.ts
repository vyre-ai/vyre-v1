// @heavy docker
// The network wall of the person's sandbox (spec S8, 4.17), proved against the real thing. P-L2_HEAVY found two gaps and stated them: a Docker sandbox could reach a host service bound to every address
// through its bridge's gateway, and a bwrap sandbox shared the machine's network and was only steered by variables. sandbox/src/net replaces both with a wall: the sandbox has NO network (loopback
// only) and one way out, a unix socket that leads to the egress proxy, with a small bridge program inside that listens on 127.0.0.1:3128. These tests ask the real sandboxes to do what a wall must stop:
// reach a host service on 0.0.0.0, the gateway, the machine's addresses, the proxy's own port, another sandbox, a name server; and to do what it must allow: reach a listed name through the proxy.
//
// The first block needs no container and always runs: the command and the config the wall builds, and the bridge program on its own against a real egress proxy. The rest runs only with
// VYRE_HEAVY_DOCKER=1 (the l2-heavy job in check.yml sets it) and, with it on, nothing is skipped: a missing Docker daemon, image or bwrap fails the test, so a green job means the proofs ran.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The agent package may not import the sandbox package (scripts/boundaries.json, layer rule). These proofs have to drive it, so the modules are loaded by path (this file is listed in rules.dynamicOk)
// and typed by the small structural shapes below, which are the parts of @vyre/sandbox the test uses.
interface ExecResult { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }
interface ExecSpec { argv: readonly string[]; cwd?: string; env?: Readonly<Record<string, string>>; timeoutMs?: number }
interface Sandbox {
  readonly id: string; readonly kind: "docker" | "seatbelt" | "bwrap";
  exec(spec: ExecSpec): Promise<ExecResult>;
  putCredentials(files: readonly { path: string; data: Uint8Array }[]): Promise<void>;
  wipeCredentials(): Promise<void>;
  stop(): Promise<void>;
  env(): Readonly<Record<string, string>>;
}
type Walled = Sandbox & { readonly network: "wall"; readonly proxyPort: number; readonly enforcement?: { files: string; network: string } };
interface Mount { host: string; guest?: string; mode: "ro" | "rw" }
interface SandboxSpec {
  id: string; person: string; kind: "docker" | "seatbelt" | "bwrap"; image?: string; mounts: readonly Mount[]; scratch?: string; egressHosts: readonly string[];
  limits?: Partial<{ cpus: number; memoryMb: number; pids: number }>; env?: Readonly<Record<string, string>>;
}
interface Roots { work: readonly string[]; scratch: readonly string[] }
interface EgressEvent { verdict: "allow" | "deny"; host: string; port: number; reason: string }
interface EgressOptions {
  allow: readonly string[]; lookup?: (host: string) => Promise<readonly string[]>; connect?: (host: string, port: number, ip: string) => Promise<net.Socket>; onEvent?: (e: EgressEvent) => void;
}
interface ContainerConfig { Cmd: string[]; Env: string[]; HostConfig: { NetworkMode: string; Binds: string[]; [k: string]: unknown }; [k: string]: unknown }
interface DockerApi { ping(): Promise<boolean>; imageExists(name: string): Promise<boolean> }
interface ProbeResult { ok: boolean; failures: string[] }
interface NetWall { dir: string; socket: string; proxyPort: number; close(): Promise<void> }
interface WallProbeResult { walled: boolean; checks: Array<{ name: string; ok: boolean; detail?: string }> }
interface SandboxLib {
  DEFAULT_IMAGE: string;
  confinementProbe(sbx: Sandbox, o: { outsidePaths: readonly string[]; mounts: ReadonlyArray<{ guest: string; mode: "ro" | "rw" }>; deniedHost: string; allowedHost?: string }): Promise<ProbeResult>;
  containerConfig(spec: SandboxSpec, mounts: ReadonlyArray<{ host: string; guest: string; mode: "ro" | "rw" }>, proxyUrl: string): ContainerConfig;
  createDockerApi(http: unknown): DockerApi;
  unixSocketHttp(socketPath?: string): unknown;
  validateSpec(spec: SandboxSpec, roots: Roots): { mounts: Array<{ host: string; guest: string; mode: "ro" | "rw" }> };
}
interface NetLib {
  GUEST_BRIDGE: string; GUEST_DIR: string; GUEST_PORT: number; GUEST_SOCKET: string;
  startNetWall(o: { allow: readonly string[]; egress?: Partial<EgressOptions>; baseDir?: string }): Promise<NetWall>;
  startWalledDockerSandbox(spec: SandboxSpec, deps: { api: DockerApi; roots: Roots; egress?: Partial<EgressOptions> }): Promise<Walled>;
  startWalledBwrapSandbox(spec: SandboxSpec, deps: { roots: Roots; egress?: Partial<EgressOptions> }): Promise<Walled>;
  bwrapWallCommand(spec: SandboxSpec, roots: Roots, argv: readonly string[], o: { wallDir: string; node?: string }): { cmd: string; args: string[]; env: Record<string, string>; enforcement: { files: string; network: string } };
  networkWall(sbx: Sandbox, o: { hostServices: ReadonlyArray<{ host: string; port: number }>; allowed?: { url: string; expect: string } }): Promise<WallProbeResult>;
  wallConfig(c: ContainerConfig, wallDir: string): ContainerConfig;
  reviewWallConfig(c: ContainerConfig, id: string, workRoots: readonly string[], wallDir: string): string[];
}
const here = import.meta.dirname;
const lib = (await import(pathToFileURL(path.resolve(here, "../../sandbox/src/index.ts")).href)) as unknown as SandboxLib;
const wallLib = (await import(pathToFileURL(path.resolve(here, "../../sandbox/src/net/index.ts")).href)) as unknown as NetLib;
const { DEFAULT_IMAGE, confinementProbe, containerConfig, createDockerApi, unixSocketHttp, validateSpec } = lib;
const { GUEST_BRIDGE, GUEST_DIR, GUEST_PORT, GUEST_SOCKET, bwrapWallCommand, networkWall, reviewWallConfig, startNetWall, startWalledBwrapSandbox, startWalledDockerSandbox, wallConfig } = wallLib;

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the 20 s shard never starts containers or namespaces)";

// ---- the world the sandboxes are put in -------------------------------------------------------------------------------------------------------------

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-net-heavy-")));
const danaRoot = path.join(base, "people", "dana");
const raviRoot = path.join(base, "people", "ravi");
const site = path.join(danaRoot, "site");
const reference = path.join(danaRoot, "reference");
const OUTSIDE = path.join(base, "outside.txt");
const RAVI_SECRET = path.join(raviRoot, "secret.txt");
const TOKEN = `TOP-SECRET-${Math.random().toString(36).slice(2)}`;
const suffix = `${process.pid}${Math.random().toString(36).slice(2, 6)}`;

function world(): void {
  for (const d of [site, reference, raviRoot, path.join(base, "scratch", "dana")]) fs.mkdirSync(d, { recursive: true });
  fs.chmodSync(site, 0o777);
  fs.chmodSync(reference, 0o755);
  fs.writeFileSync(path.join(site, "hello.txt"), "hello from the work folder\n", { mode: 0o666 });
  fs.chmodSync(path.join(site, "hello.txt"), 0o666);
  fs.writeFileSync(OUTSIDE, `${TOKEN}-outside\n`, { mode: 0o644 });
  fs.chmodSync(raviRoot, 0o755);
  fs.writeFileSync(RAVI_SECRET, `${TOKEN}-ravi\n`, { mode: 0o644 });
}

const roots = (person: string, root: string): Roots => ({ work: [root], scratch: [path.join(base, "scratch", person)] });

function danaSpec(id: string, over: Partial<SandboxSpec> = {}): SandboxSpec {
  return {
    id, person: "usr_dana", kind: "docker", mounts: [{ host: site, mode: "rw" }, { host: reference, mode: "ro" }],
    egressHosts: ["allowed.test", "internal.test", "metadata.test"], limits: { cpus: 1, memoryMb: 512, pids: 128 }, ...over,
  };
}

// ---- small real servers and runners ------------------------------------------------------------------------------------------------------------------

const servers: net.Server[] = [];
function listen(server: net.Server, host: string): Promise<number> {
  servers.push(server);
  return new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, host, () => resolve((server.address() as net.AddressInfo).port)); });
}
const answer = (body: string) => http.createServer((_q, r) => { r.writeHead(200, { "content-type": "text/plain" }); r.end(body); });

function runHost(cmd: string, args: readonly string[], o: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env: o.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false;
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    const t = setTimeout(() => { timedOut = true; p.kill("SIGKILL"); }, o.timeoutMs ?? 30_000);
    p.on("error", (e) => { clearTimeout(t); resolve({ exitCode: null, stdout, stderr: `${stderr}${e.message}`, timedOut }); });
    p.on("close", (code) => { clearTimeout(t); resolve({ exitCode: code, stdout, stderr, timedOut }); });
  });
}
const docker = (args: readonly string[]): string => {
  const r = spawnSync("docker", args, { encoding: "utf8", timeout: 60_000 });
  return r.status === 0 ? r.stdout : "";
};

const sh = (s: Sandbox, script: string, timeoutMs = 20_000): Promise<ExecResult> => s.exec({ argv: ["sh", "-c", script], timeoutMs });
const ok = (r: ExecResult): string => `exit ${String(r.exitCode)} stdout=${JSON.stringify(r.stdout.slice(0, 300))} stderr=${JSON.stringify(r.stderr.slice(0, 300))}`;
const curl = (s: Sandbox, args: string, timeoutS = 6): Promise<ExecResult> => sh(s, `curl -sS -m ${timeoutS} ${args}`, (timeoutS + 5) * 1000);

let upstreamPort = 0;
let hostPort = 0;
const events: EgressEvent[] = [];
/** Names the proxy is told about resolve where the test says; the connection always ends at the local upstream, whatever address passed. */
const egress: Partial<EgressOptions> = {
  lookup: async (h: string) => (h === "allowed.test" ? ["93.184.216.34"] : h === "internal.test" ? ["10.0.0.5"] : h === "metadata.test" ? ["169.254.169.254"] : []),
  connect: (_h: string, _port: number, _ip: string) =>
    new Promise<net.Socket>((resolve, reject) => { const s = net.connect({ host: "127.0.0.1", port: upstreamPort }); s.once("connect", () => resolve(s)); s.once("error", reject); }),
  onEvent: (e: EgressEvent) => { events.push(e); },
};

/** Every address a host service could be reached on from a container or a namespace: the machine's own, loopback, and the gateways Docker hands out. */
function hostAddresses(): string[] {
  const own = Object.values(os.networkInterfaces()).flatMap((l) => l ?? []).filter((i) => i.family === "IPv4").map((i) => i.address);
  const gateway = docker(["network", "inspect", "bridge", "-f", "{{range .IPAM.Config}}{{.Gateway}}{{end}}"]).trim();
  return [...new Set([...own, "127.0.0.1", gateway, "172.17.0.1", "10.0.2.2", "192.168.65.2"].filter(Boolean))];
}

before(async () => {
  world();
  upstreamPort = await listen(answer("upstream-ok"), "127.0.0.1");
  hostPort = await listen(answer("host-service-reached"), "0.0.0.0");
});

// ---- no container needed: what the wall builds, and the bridge on its own --------------------------------------------------------------------------------

test("bwrap: the wall command has its own network namespace, the socket folder read-only, and the proxy variables on loopback", () => {
  const spec: SandboxSpec = { ...danaSpec("vyre-sbx-bwunit"), kind: "bwrap" };
  const w = bwrapWallCommand(spec, roots("dana", danaRoot), ["echo", "hi"], { wallDir: "/tmp/vyre-net-unit", node: "/usr/bin/node" });
  assert.equal(w.cmd, "bwrap");
  assert.ok(w.args.includes("--unshare-all"));
  assert.ok(!w.args.includes("--share-net"), "the network is never shared");
  const i = w.args.indexOf("--ro-bind");
  const wallBind = w.args.map((x, k) => (x === "--ro-bind" && w.args[k + 2] === GUEST_DIR ? w.args[k + 1] : null)).filter(Boolean);
  assert.deepEqual(wallBind, ["/tmp/vyre-net-unit"]);
  assert.ok(i >= 0);
  assert.deepEqual(w.enforcement, { files: "kernel", network: "kernel" });
  const tail = w.args.slice(w.args.indexOf("--") + 1);
  assert.deepEqual(tail, ["/usr/bin/node", GUEST_BRIDGE, GUEST_SOCKET, String(GUEST_PORT), "--", "echo", "hi"]);
  const setenv = w.args.map((x, k) => (x === "--setenv" ? `${w.args[k + 1]}=${w.args[k + 2]}` : null)).filter(Boolean);
  assert.ok(setenv.includes(`HTTP_PROXY=http://127.0.0.1:${GUEST_PORT}`));
  assert.ok(setenv.includes(`HTTPS_PROXY=http://127.0.0.1:${GUEST_PORT}`));
  assert.ok(w.args.indexOf("--ro-bind") < w.args.indexOf("--remount-ro"), "the socket folder is mounted before the root is made read-only");
  assert.ok(w.args.indexOf("--clearenv") < w.args.indexOf("--setenv"));
  assert.throws(() => bwrapWallCommand(spec, roots("dana", danaRoot), [], { wallDir: "/tmp/x" }), /nothing to run/);
  assert.throws(() => bwrapWallCommand({ ...spec, mounts: [{ host: "/etc", mode: "rw" }] }, roots("dana", danaRoot), ["true"], { wallDir: "/tmp/x" }), /never holds|outside/);
});

test("docker: the wall config has no network, the bridge as its command, and the socket folder as its one extra, read-only bind; anything else is refused", () => {
  const spec = danaSpec("vyre-sbx-wallunit");
  const mounts = validateSpec(spec, roots("dana", danaRoot)).mounts;
  const built = containerConfig(spec, mounts, `http://127.0.0.1:${GUEST_PORT}`);
  const walled = wallConfig(built, "/tmp/vyre-net-unit");
  assert.equal(walled.HostConfig.NetworkMode, "none");
  assert.deepEqual(walled.Cmd, ["node", GUEST_BRIDGE, GUEST_SOCKET, String(GUEST_PORT)]);
  assert.equal(walled.HostConfig.Binds.at(-1), `/tmp/vyre-net-unit:${GUEST_DIR}:ro`);
  assert.deepEqual(reviewWallConfig(walled, spec.id, [danaRoot], "/tmp/vyre-net-unit"), []);
  const bad = (f: (c: ContainerConfig) => void): string[] => { const c = structuredClone(walled); f(c); return reviewWallConfig(c, spec.id, [danaRoot], "/tmp/vyre-net-unit"); };
  assert.ok(bad((c) => { c.HostConfig.NetworkMode = `${spec.id}-net`; }).some((p) => /network is/.test(p)));
  assert.ok(bad((c) => { c.HostConfig.NetworkMode = "bridge"; }).some((p) => /network is/.test(p)));
  assert.ok(bad((c) => { c.HostConfig.Binds = c.HostConfig.Binds.map((b) => b.replace(":ro", ":rw")); }).some((p) => /socket folder/.test(p)));
  assert.ok(bad((c) => { c.Cmd = ["sleep", "infinity"]; }).some((p) => /not the bridge/.test(p)));
  assert.ok(bad((c) => { c.Env = c.Env.map((e) => e.replace(/^HTTP_PROXY=.*/, "HTTP_PROXY=http://172.18.0.1:3128")); }).some((p) => /proxy variable/.test(p)));
  assert.ok(bad((c) => { c.HostConfig["Privileged"] = true; }).some((p) => /privileged/.test(p)), "the whole existing review still applies");
  assert.ok(bad((c) => { c.HostConfig.Binds.push("/var/run/docker.sock:/work/docker.sock:rw"); }).length > 0);
});

test("the bridge: a process that speaks proxy to 127.0.0.1:3128 reaches the host's proxy through the socket, and nothing else; an exit status passes through", async () => {
  events.length = 0;
  const wall = await startNetWall({ allow: ["allowed.test"], egress });
  try {
    assert.equal(fs.statSync(wall.socket).isSocket(), true);
    assert.equal((fs.statSync(wall.socket).mode & 0o777).toString(8), "666");
    assert.equal(fs.readFileSync(path.join(wall.dir, "bridge.mjs"), "utf8").includes("net.createServer"), true);
    const port = 41000 + Math.floor(Math.random() * 2000);
    const bridge = spawn(process.execPath, [path.join(wall.dir, "bridge.mjs"), wall.socket, String(port)], { stdio: "ignore" });
    try {
      for (let i = 0; i < 100; i++) {
        const up = await new Promise<boolean>((resolve) => { const c = net.connect(port, "127.0.0.1"); c.once("connect", () => { c.destroy(); resolve(true); }); c.once("error", () => resolve(false)); });
        if (up) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const get = (url: string): Promise<{ status: number; body: string }> => new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, method: "GET", path: url, headers: { host: new URL(url).host } }, (res) => {
          let body = ""; res.on("data", (d) => (body += d)); res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        });
        req.on("error", reject);
        req.end();
      });
      assert.deepEqual(await get("http://allowed.test/"), { status: 200, body: "upstream-ok" });
      assert.equal((await get("http://denied.test/")).status, 403);
      assert.equal((await get("http://internal.test/")).status, 403, "a listed name that points at a private address is refused");
      assert.ok(events.some((e) => e.verdict === "allow" && e.host === "allowed.test"));
    } finally { bridge.kill("SIGKILL"); }
    // With a program, the bridge starts it once it listens, and ends with its exit status.
    const withProgram = await runHost(process.execPath, [path.join(wall.dir, "bridge.mjs"), wall.socket, String(41000 + Math.floor(Math.random() * 2000)), "--", "sh", "-c", "echo from-program; exit 7"]);
    assert.equal(withProgram.exitCode, 7);
    assert.equal(withProgram.stdout.trim(), "from-program");
  } finally {
    await wall.close();
  }
  assert.equal(fs.existsSync(wall.dir), false, "closing removes the folder and the socket");
  await wall.close();
});

// ---- Docker -----------------------------------------------------------------------------------------------------------------------------------------

const api = createDockerApi(unixSocketHttp(process.env["DOCKER_SOCKET"] ?? "/var/run/docker.sock"));
const idA = `vyre-sbx-hv${suffix}wa`;
const idB = `vyre-sbx-hv${suffix}wb`;
let A: Walled;
let B: Walled;

async function ensureImage(): Promise<void> {
  if (await api.imageExists(DEFAULT_IMAGE)) return;
  const r = await runHost("docker", ["build", "-t", DEFAULT_IMAGE, "--build-arg", "ENGINE_PACKAGES=is-odd@3.0.1", "images/person-sandbox"], { timeoutMs: 600_000 });
  assert.equal(r.exitCode, 0, `building ${DEFAULT_IMAGE} failed: ${r.stderr.slice(-800)}`);
}

let dockerStarted: Promise<void> | undefined;
function dockerUp(): Promise<void> {
  dockerStarted ??= (async () => {
    assert.equal(await api.ping(), true, "no Docker daemon answers on this runner");
    await ensureImage();
    A = await startWalledDockerSandbox(danaSpec(idA), { api, roots: roots("dana", danaRoot), egress });
    B = await startWalledDockerSandbox({ ...danaSpec(idB), person: "usr_ravi", mounts: [{ host: raviRoot, mode: "ro" }], egressHosts: ["allowed.test"] }, { api, roots: roots("ravi", raviRoot), egress });
  })();
  return dockerStarted;
}

after(async () => {
  if (dockerStarted) { await dockerStarted.catch(() => undefined); await A?.stop().catch(() => undefined); await B?.stop().catch(() => undefined); }
  for (const s of servers) s.close();
  for (const n of spawnSync("docker", ["ps", "-aq", "--filter", `name=vyre-sbx-hv${suffix}`], { encoding: "utf8" }).stdout.split("\n").filter(Boolean)) spawnSync("docker", ["rm", "-f", n]);
  for (const n of spawnSync("docker", ["network", "ls", "-q", "--filter", `name=vyre-sbx-hv${suffix}`], { encoding: "utf8" }).stdout.split("\n").filter(Boolean)) spawnSync("docker", ["network", "rm", n]);
  fs.rmSync(base, { recursive: true, force: true });
});

test("docker wall: the container has no network: only loopback, no route, no name server, and no network was made for it", { skip }, async () => {
  await dockerUp();
  assert.equal(A.network, "wall");
  assert.equal(docker(["inspect", "-f", "{{.HostConfig.NetworkMode}}", idA]).trim(), "none");
  // Docker prints "invalid IP" for a container with no address; what matters is that no IPv4 address is there.
  assert.doesNotMatch(docker(["inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", idA]), /\d+\.\d+\.\d+\.\d+/, "no address on any network");
  assert.equal(docker(["network", "ls", "-q", "--filter", `name=${idA}`]).trim(), "", "no network of its own either");
  const nics = await sh(A, "tail -n +3 /proc/net/dev | cut -d: -f1 | tr -d ' '");
  assert.equal(nics.stdout.trim(), "lo");
  const routes = await sh(A, "tail -n +2 /proc/net/route | wc -l");
  assert.equal(routes.stdout.trim(), "0");
  assert.match(docker(["inspect", "-f", "{{json .HostConfig.Binds}}", idA]), new RegExp(`:${GUEST_DIR}:ro`));
});

test("docker wall: a host service on every address is unreachable on every address a host service could have, the proxy's own port included, and the whole self-test passes", { skip }, async (t) => {
  await dockerUp();
  const addrs = hostAddresses();
  t.diagnostic(`host addresses tried: ${addrs.join(" ")} on port ${hostPort}; the proxy's own host port ${A.proxyPort}`);
  const r = await networkWall(A, {
    hostServices: [...addrs.map((host) => ({ host, port: hostPort })), { host: "127.0.0.1", port: A.proxyPort }, { host: "127.0.0.1", port: hostPort }],
    allowed: { url: "http://allowed.test/", expect: "upstream-ok" },
  });
  assert.deepEqual(r.checks.filter((c) => !c.ok), [], "every check of the wall holds");
  assert.equal(r.walled, true);
  const mounts = validateSpec(danaSpec(idA), roots("dana", danaRoot)).mounts.map((m) => ({ guest: m.guest, mode: m.mode }));
  const p = await confinementProbe(A, { outsidePaths: [OUTSIDE, RAVI_SECRET, "/etc/shadow"], mounts, deniedHost: "denied.test" });
  assert.deepEqual(p.failures, []);
  assert.equal(p.ok, true);
});

test("docker wall: the only way out is the egress proxy: an allowed name gets through, a name that is not listed, a private address and an address literal do not", { skip }, async () => {
  await dockerUp();
  events.length = 0;
  const good = await curl(A, "http://allowed.test/");
  assert.equal(good.exitCode, 0, ok(good));
  assert.equal(good.stdout, "upstream-ok", "the allowed host answered through the proxy");
  assert.match((await curl(A, "-i http://denied.test/")).stdout, /^HTTP\/1\.[01] 403/);
  assert.match((await curl(A, "-i http://internal.test/")).stdout, /^HTTP\/1\.[01] 403/, "a listed name that points at a private address is refused");
  assert.match((await curl(A, "-i http://metadata.test/")).stdout, /^HTTP\/1\.[01] 403/, "and so is one that points at the cloud metadata address");
  assert.match((await curl(A, "-i http://93.184.216.34/")).stdout, /^HTTP\/1\.[01] 403/, "an address literal is not a name on the list");
  assert.notEqual((await curl(A, "-i https://denied.test/")).exitCode, 0, "CONNECT to an unlisted host fails");
  const verdicts = events.map((e) => `${e.verdict}:${e.host}:${e.reason}`);
  for (const v of ["allow:allowed.test:ok", "deny:denied.test:not_listed", "deny:internal.test:private_address", "deny:metadata.test:private_address"]) assert.ok(verdicts.includes(v), `${v} in ${verdicts.join(" ")}`);
});

test("docker wall: a process that unsets the proxy variables, or asks for the old gateway, has nowhere to go; the socket folder cannot be written and the other sandbox is not an address", { skip }, async () => {
  await dockerUp();
  const noProxy = "env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy -u NO_PROXY -u no_proxy";
  for (const target of ["http://1.1.1.1/", "http://93.184.216.34/", "http://example.com/", "http://169.254.169.254/latest/meta-data/", `http://172.17.0.1:${hostPort}/`, `http://127.0.0.1:${hostPort}/`]) {
    const r = await sh(A, `${noProxy} curl -sS -m 4 -o /dev/null ${target}; echo $?`, 15_000);
    assert.notEqual(r.stdout.trim().split("\n").pop(), "0", `${target} must be unreachable: ${ok(r)}`);
  }
  assert.notEqual((await sh(A, `touch ${GUEST_DIR}/escape`)).exitCode, 0, "the socket folder is read-only");
  assert.notEqual((await sh(A, `rm -f ${GUEST_SOCKET}`)).exitCode, 0, "and the socket cannot be removed");
  assert.doesNotMatch(docker(["inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", idB]), /\d+\.\d+\.\d+\.\d+/, "the other person's sandbox has no address to find");
  assert.equal((await sh(A, "echo still-here")).stdout.trim(), "still-here");
});

test("docker wall: stopping removes the container, the socket folder and the proxy; it fails closed when the bridge dies", { skip }, async () => {
  await dockerUp();
  const id = `vyre-sbx-hv${suffix}wd`;
  const s = await startWalledDockerSandbox(danaSpec(id), { api, roots: roots("dana", danaRoot), egress });
  const url = new URL(s.env()["HTTP_PROXY"] ?? "");
  assert.equal(url.host, `127.0.0.1:${GUEST_PORT}`);
  assert.ok(docker(["ps", "-a", "--filter", `name=${id}`, "--format", "{{.Names}}"]).includes(id));
  const dirBind = (JSON.parse(docker(["inspect", "-f", "{{json .HostConfig.Binds}}", id])) as string[]).find((b) => b.endsWith(`:${GUEST_DIR}:ro`)) ?? "";
  const dir = dirBind.split(":")[0] ?? "";
  assert.ok(fs.existsSync(path.join(dir, "proxy.sock")), "the socket is there while the sandbox runs");
  await s.stop();
  await s.stop();
  assert.equal(docker(["ps", "-a", "--filter", `name=${id}`, "--format", "{{.Names}}"]).trim(), "", "container gone");
  assert.equal(fs.existsSync(dir), false, "socket folder gone");
  const closed = await new Promise<boolean>((resolve) => { const c = net.connect({ host: "127.0.0.1", port: s.proxyPort }); c.setTimeout(3000, () => { c.destroy(); resolve(true); }); c.once("connect", () => { c.destroy(); resolve(false); }); c.once("error", () => resolve(true)); });
  assert.equal(closed, true, "the proxy no longer listens");
  await assert.rejects(() => s.exec({ argv: ["true"] }), /stopped/);

  // The bridge is the container's main process: if it is killed, the container ends and there is no way out at all.
  const f = await startWalledDockerSandbox(danaSpec(`vyre-sbx-hv${suffix}we`), { api, roots: roots("dana", danaRoot), egress });
  try {
    assert.equal((await curl(f, "http://allowed.test/")).stdout, "upstream-ok", "it works before");
    await sh(f, "pkill -f bridge.mjs; true", 10_000).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const after_ = await curl(f, "http://allowed.test/", 4).catch(() => null);
    assert.ok(after_ === null || after_.exitCode !== 0 || after_.stdout !== "upstream-ok", `with the bridge gone nothing reaches the proxy: ${after_ ? ok(after_) : "the sandbox is gone"}`);
  } finally { await f.stop().catch(() => undefined); }
});

// ---- bubblewrap -------------------------------------------------------------------------------------------------------------------------------------

const bwrapSpec = (): SandboxSpec => ({ ...danaSpec(`vyre-sbx-bw${suffix}`), kind: "bwrap" });
let W: Walled | undefined;
async function bwrapUp(): Promise<Walled> {
  const v = await runHost("bwrap", ["--version"]);
  assert.equal(v.exitCode, 0, `bwrap is not installed: ${ok(v)}`);
  W ??= await startWalledBwrapSandbox(bwrapSpec(), { roots: roots("dana", danaRoot), egress });
  return W;
}
after(async () => { await W?.stop().catch(() => undefined); });

test("bwrap wall: it can make its namespaces, says its network is kernel-enforced, and has only loopback", { skip }, async () => {
  const w = await bwrapUp();
  const r = await sh(w, "echo namespaces-ok");
  assert.equal(r.stdout.trim(), "namespaces-ok", `bwrap could not start (unprivileged user namespaces may be blocked on this runner): ${ok(r)}`);
  assert.equal(w.network, "wall");
  assert.deepEqual(w.enforcement, { files: "kernel", network: "kernel" });
  const nics = await sh(w, "tail -n +3 /proc/net/dev | cut -d: -f1 | tr -d ' '");
  assert.equal(nics.stdout.trim(), "lo");
  assert.equal((await sh(w, "tail -n +2 /proc/net/route | wc -l")).stdout.trim(), "0");
});

test("bwrap wall: no host service is reachable on any address, with or without the proxy variables; the proxy still works; the whole self-test passes", { skip }, async (t) => {
  const w = await bwrapUp();
  const addrs = hostAddresses();
  t.diagnostic(`host addresses tried: ${addrs.join(" ")} on port ${hostPort}; the proxy's own host port ${w.proxyPort}`);
  const r = await networkWall(w, {
    hostServices: [...addrs.map((host) => ({ host, port: hostPort })), { host: "127.0.0.1", port: w.proxyPort }, { host: "127.0.0.1", port: hostPort }],
    allowed: { url: "http://allowed.test/", expect: "upstream-ok" },
  });
  assert.deepEqual(r.checks.filter((c) => !c.ok), [], "every check of the wall holds");
  assert.equal(r.walled, true);
  // P-L2_HEAVY: a bwrap process that unset the variables reached the host's loopback. Now it does not.
  const around = await sh(w, `env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy curl --noproxy "*" -sS -m 3 -o /dev/null http://127.0.0.1:${hostPort}/; echo $?`, 15_000);
  assert.notEqual(around.stdout.trim().split("\n").pop(), "0", `the host's loopback is not there: ${ok(around)}`);
  const mounts = validateSpec(bwrapSpec(), roots("dana", danaRoot)).mounts.map((m) => ({ guest: m.host, mode: m.mode }));
  const p = await confinementProbe(w, { outsidePaths: [OUTSIDE, RAVI_SECRET, "/etc/shadow"], mounts, deniedHost: "denied.test" });
  assert.deepEqual(p.failures, []);
});

test("bwrap wall: the only way out is the egress proxy over the bridged socket, and a command's output and exit status pass through the bridge", { skip }, async () => {
  const w = await bwrapUp();
  events.length = 0;
  const good = await curl(w, "http://allowed.test/");
  assert.equal(good.exitCode, 0, ok(good));
  assert.equal(good.stdout, "upstream-ok");
  assert.match((await curl(w, "-i http://denied.test/")).stdout, /^HTTP\/1\.[01] 403/);
  assert.match((await curl(w, "-i http://internal.test/")).stdout, /^HTTP\/1\.[01] 403/);
  assert.match((await curl(w, "-i http://93.184.216.34/")).stdout, /^HTTP\/1\.[01] 403/);
  assert.notEqual((await curl(w, "-i https://denied.test/")).exitCode, 0);
  const verdicts = events.map((e) => `${e.verdict}:${e.host}:${e.reason}`);
  for (const v of ["allow:allowed.test:ok", "deny:denied.test:not_listed", "deny:internal.test:private_address"]) assert.ok(verdicts.includes(v), `${v} in ${verdicts.join(" ")}`);
  const exit = await sh(w, "echo out; echo err >&2; exit 5");
  assert.deepEqual([exit.exitCode, exit.stdout.trim(), exit.stderr.trim()], [5, "out", "err"]);
  assert.notEqual((await sh(w, `touch ${GUEST_DIR}/escape`)).exitCode, 0, "the socket folder is read-only");
  assert.equal(fs.readFileSync(path.join(site, "hello.txt"), "utf8"), "hello from the work folder\n");
  assert.equal((await sh(w, `cat ${JSON.stringify(path.join(site, "hello.txt"))}`)).stdout.trim(), "hello from the work folder", "its own folder is there");
});

test("bwrap wall: stopping removes the socket folder and the proxy", { skip }, async () => {
  const s = await startWalledBwrapSandbox({ ...bwrapSpec(), id: `vyre-sbx-bw${suffix}x` }, { roots: roots("dana", danaRoot), egress });
  assert.equal((await curl(s, "http://allowed.test/")).stdout, "upstream-ok");
  await s.stop();
  await s.stop();
  const closed = await new Promise<boolean>((resolve) => { const c = net.connect({ host: "127.0.0.1", port: s.proxyPort }); c.setTimeout(3000, () => { c.destroy(); resolve(true); }); c.once("connect", () => { c.destroy(); resolve(false); }); c.once("error", () => resolve(true)); });
  assert.equal(closed, true, "the proxy no longer listens");
  await assert.rejects(() => s.exec({ argv: ["true"] }), /stopped/);
});
