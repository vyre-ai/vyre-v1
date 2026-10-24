// @heavy docker
// Security sign-off for the person's sandbox (spec S8, 4.17): the confinement the unit tests only describe, proved against the real thing. A real Docker container made by startDockerSandbox,
// and a real bubblewrap process, are asked to do what they must not be able to do: read outside their folders, reach the host or another sandbox, see a Vault value or a host process.
// Every check runs a command inside the sandbox and looks at the answer, so it proves the sandbox that exists, not the config that was meant.
//
// Runs only with VYRE_HEAVY_DOCKER=1 (the l2-heavy job in check.yml sets it and installs bubblewrap and tmux). Without it every test here is skipped with its reason; a skip is never a pass of the real
// thing. With it on, nothing is skipped: a missing Docker daemon, image or bwrap fails the test, so a green run means the proofs ran.
//
// Where the sandbox is weaker than the spec says, the test says so in its name and in a diagnostic line, and asserts what is true today, so a change that closes (or opens) the gap shows up here:
//   - bwrap shares the machine's network and steers it with proxy variables ("proxy-env"): a process that unsets them can reach loopback services and the internet. Without a proxy port bwrap has no network at all.
//   - Docker: see the gateway test below.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The agent package may not import the sandbox package (scripts/boundaries.json, layer rule). This proof has to drive it, so the module is loaded by path (this file is listed in rules.dynamicOk)
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
interface DockerApi { ping(): Promise<boolean>; imageExists(name: string): Promise<boolean> }
interface EgressProxy { listen(port?: number, host?: string): Promise<{ port: number; host: string }>; close(): Promise<void> }
interface ProbeResult { ok: boolean; failures: string[] }
interface SandboxLib {
  DEFAULT_IMAGE: string;
  bwrapCommand(spec: SandboxSpec, roots: Roots, argv: readonly string[], o?: { proxyPort?: number }): { cmd: string; args: string[]; env: Record<string, string>; enforcement: { files: string; network: string } };
  confinementProbe(sbx: Sandbox, o: { outsidePaths: readonly string[]; mounts: ReadonlyArray<{ guest: string; mode: "ro" | "rw" }>; deniedHost: string; allowedHost?: string }): Promise<ProbeResult>;
  createDockerApi(http: unknown): DockerApi;
  createEgressProxy(o: EgressOptions): EgressProxy;
  startDockerSandbox(spec: SandboxSpec, deps: { api: DockerApi; roots: Roots; egress?: Partial<EgressOptions> }): Promise<Sandbox>;
  unixSocketHttp(socketPath?: string): unknown;
  validateSpec(spec: SandboxSpec, roots: Roots): { mounts: Array<{ host: string; guest: string; mode: "ro" | "rw" }> };
}
const lib = (await import(pathToFileURL(path.resolve(import.meta.dirname, "../../sandbox/src/index.ts")).href)) as unknown as SandboxLib;
const { DEFAULT_IMAGE, bwrapCommand, confinementProbe, createDockerApi, createEgressProxy, startDockerSandbox, unixSocketHttp, validateSpec } = lib;

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the 20 s shard never starts containers or namespaces)";

// ---- the world the sandboxes are put in -------------------------------------------------------------------------------------------------------------

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sbx-heavy-")));
const danaRoot = path.join(base, "people", "dana");
const raviRoot = path.join(base, "people", "ravi");
const site = path.join(danaRoot, "site");
const reference = path.join(danaRoot, "reference");
const OUTSIDE = path.join(base, "outside.txt");
const RAVI_SECRET = path.join(raviRoot, "secret.txt");
const TOKEN = `TOP-SECRET-${Math.random().toString(36).slice(2)}`;
const VAULT_ENV = "VYRE_HEAVY_VAULT_VALUE";
const VAULT_VALUE = `vault-sk-live-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
const suffix = `${process.pid}${Math.random().toString(36).slice(2, 6)}`;

function world(): void {
  for (const d of [site, reference, raviRoot, path.join(base, "scratch", "dana")]) fs.mkdirSync(d, { recursive: true });
  // The sandbox user is not the runner's user: give the folders the modes a person's real folders would have to be given for the engine to work in them.
  fs.chmodSync(site, 0o777);
  fs.chmodSync(reference, 0o755);
  fs.writeFileSync(path.join(site, "hello.txt"), "hello from the work folder\n", { mode: 0o666 });
  fs.chmodSync(path.join(site, "hello.txt"), 0o666);
  fs.writeFileSync(path.join(reference, "ref.txt"), "reference material\n", { mode: 0o644 });
  // Readable by everyone, so the only thing that can stop a read is that the sandbox cannot see the path.
  fs.writeFileSync(OUTSIDE, `${TOKEN}-outside\n`, { mode: 0o644 });
  fs.chmodSync(raviRoot, 0o755);
  fs.writeFileSync(RAVI_SECRET, `${TOKEN}-ravi\n`, { mode: 0o644 });
  // A link inside the work folder that points at another person's file by its host path.
  fs.symlinkSync(RAVI_SECRET, path.join(site, "to-ravi"));
  fs.symlinkSync("/etc/passwd", path.join(site, "to-passwd"));
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

/** Run a program on this machine and capture it. */
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

// ---- Docker -----------------------------------------------------------------------------------------------------------------------------------------

const api = createDockerApi(unixSocketHttp(process.env["DOCKER_SOCKET"] ?? "/var/run/docker.sock"));
const events: EgressEvent[] = [];
let upstreamPort = 0;
let hostPort = 0;
let A: Sandbox;
let B: Sandbox;
let gateway = "";
let proxyUrl = "";
const idA = `vyre-sbx-hv${suffix}a`;
const idB = `vyre-sbx-hv${suffix}b`;

/** Names the proxy is told about resolve where the test says; everything else is not an address at all. The connection always ends at the local upstream, whatever address passed. */
const egress: Partial<EgressOptions> = {
  lookup: async (h: string) => (h === "allowed.test" ? ["93.184.216.34"] : h === "internal.test" ? ["10.0.0.5"] : h === "metadata.test" ? ["169.254.169.254"] : []),
  connect: (_h: string, _port: number, _ip: string) =>
    new Promise<net.Socket>((resolve, reject) => { const s = net.connect({ host: "127.0.0.1", port: upstreamPort }); s.once("connect", () => resolve(s)); s.once("error", reject); }),
  onEvent: (e: EgressEvent) => { events.push(e); },
};

async function ensureImage(): Promise<void> {
  if (await api.imageExists(DEFAULT_IMAGE)) return;
  // Built from the repository's own Dockerfile, with one tiny pinned package standing in for the engines (the image's build refuses an unpinned engine).
  const r = await runHost("docker", ["build", "-t", DEFAULT_IMAGE, "--build-arg", "ENGINE_PACKAGES=is-odd@3.0.1", "images/person-sandbox"], { timeoutMs: 600_000 });
  assert.equal(r.exitCode, 0, `building ${DEFAULT_IMAGE} failed: ${r.stderr.slice(-800)}`);
}

before(async () => {
  world();
  process.env[VAULT_ENV] = VAULT_VALUE;
  upstreamPort = await listen(answer("upstream-ok"), "127.0.0.1");
  hostPort = await listen(answer("host-service-reached"), "0.0.0.0");
});

/** The two Docker sandboxes, started once by the first Docker test that needs them (so a Docker failure fails the Docker tests and leaves the bwrap ones to run). */
let dockerStarted: Promise<void> | undefined;
function dockerUp(): Promise<void> {
  dockerStarted ??= (async () => {
    const info = spawnSync("docker", ["version", "--format", "{{.Server.Version}} api {{.Server.APIVersion}} min {{.Server.MinAPIVersion}}"], { encoding: "utf8", timeout: 20_000 });
    process.stderr.write(`docker server ${info.stdout.trim() || "unknown"}\n`);
    assert.equal(await api.ping(), true, "no Docker daemon answers on this runner");
    await ensureImage();
    A = await startDockerSandbox(danaSpec(idA), { api, roots: roots("dana", danaRoot), egress });
    B = await startDockerSandbox({ ...danaSpec(idB), person: "usr_ravi", mounts: [{ host: raviRoot, mode: "ro" }], egressHosts: ["allowed.test"] }, { api, roots: roots("ravi", raviRoot), egress });
    proxyUrl = A.env()["HTTP_PROXY"] ?? "";
    gateway = new URL(proxyUrl).hostname;
  })();
  return dockerStarted;
}

after(async () => {
  if (dockerStarted) { await dockerStarted.catch(() => undefined); await A?.stop().catch(() => undefined); await B?.stop().catch(() => undefined); }
  for (const s of servers) s.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("docker: the confinement self-test passes against the real container", { skip }, async () => {
  await dockerUp();
  await dockerUp();
  const mounts = validateSpec(danaSpec(idA), roots("dana", danaRoot)).mounts.map((m) => ({ guest: m.guest, mode: m.mode }));
  const r = await confinementProbe(A, { outsidePaths: [OUTSIDE, RAVI_SECRET, "/etc/shadow"], mounts, deniedHost: "denied.test" });
  assert.deepEqual(r.failures, []);
  assert.equal(r.ok, true);
});

test("docker: the process runs as the sandbox user with no capabilities, no new privileges and a read-only root", { skip }, async () => {
  await dockerUp();
  await dockerUp();
  const id = await sh(A, "id -u; id -g");
  assert.equal(id.stdout.trim(), "10001\n10001");
  const st = await sh(A, "grep -E '^(CapEff|CapBnd|NoNewPrivs|Seccomp):' /proc/self/status");
  assert.match(st.stdout, /CapEff:\s*0000000000000000/);
  assert.match(st.stdout, /CapBnd:\s*0000000000000000/);
  assert.match(st.stdout, /NoNewPrivs:\s*1/);
  assert.match(st.stdout, /Seccomp:\s*2/, "the default seccomp filter is on");
  assert.notEqual((await sh(A, "touch /etc/vyre-escape")).exitCode, 0, "root filesystem is read-only");
  assert.notEqual((await sh(A, "mount -t tmpfs none /mnt")).exitCode, 0, "nothing can mount");
  assert.notEqual((await sh(A, "chmod u+s /bin/sh")).exitCode, 0, "no setuid can be made");
  const nic = await sh(A, "ls /sys/class/net | tr '\\n' ' '");
  assert.doesNotMatch(nic.stdout, /docker0/, "the host's bridge is not visible by name");
});

test("docker: the agent process cannot read outside its folders, however it asks", { skip }, async () => {
  await dockerUp();
  await dockerUp();
  const mounts = (await sh(A, "ls /work")).stdout.split("\n").filter(Boolean).sort();
  assert.deepEqual(mounts, ["reference", "site"], "only the two folders are there");
  for (const p of [OUTSIDE, RAVI_SECRET, "/etc/shadow", "/root/.bashrc", "/proc/1/root/etc/shadow"]) {
    const r = await sh(A, `cat ${JSON.stringify(p)} >/dev/null 2>&1; echo $?`);
    assert.notEqual(r.stdout.trim(), "0", `read ${p}: ${ok(r)}`);
  }
  for (const p of [base, danaRoot, raviRoot, os.homedir(), "/var/run/docker.sock", "/run/docker.sock", "/host", "/srv/vyre"]) {
    const r = await sh(A, `test -e ${JSON.stringify(p)}; echo $?`);
    assert.notEqual(r.stdout.trim(), "0", `${p} is not there: ${ok(r)}`);
  }
  // Names that would reach the host if the folder's own links or dots were followed on the host side.
  const viaLink = await sh(A, "cat /work/site/to-ravi 2>&1; echo $?");
  assert.doesNotMatch(viaLink.stdout, new RegExp(TOKEN), "a link in the folder to another person's file leads nowhere inside");
  const viaDots = await sh(A, `cat /work/site/../../..${OUTSIDE} 2>&1; cat /work/site/../../outside.txt 2>&1; true`);
  assert.doesNotMatch(viaDots.stdout, new RegExp(TOKEN));
  const find = await sh(A, `grep -rIl ${JSON.stringify(TOKEN)} /work /home /tmp /mnt /srv /opt /run /etc /var /media 2>/dev/null | head -5; true`, 60_000);
  assert.equal(find.stdout.trim(), "", `no file the sandbox can see holds the host's secret: ${find.stdout}`);
});

test("docker: the work folder is writable, the reference folder is not, and the host sees exactly what was written", { skip }, async () => {
  await dockerUp();
  await dockerUp();
  const w = await sh(A, "echo written-in-container > /work/site/new.txt && cat /work/site/hello.txt");
  assert.equal(w.exitCode, 0, ok(w));
  assert.equal(fs.readFileSync(path.join(site, "new.txt"), "utf8"), "written-in-container\n");
  assert.notEqual((await sh(A, "echo no > /work/reference/ref.txt")).exitCode, 0);
  assert.notEqual((await sh(A, "touch /work/reference/new.txt")).exitCode, 0);
  assert.equal(fs.readFileSync(path.join(reference, "ref.txt"), "utf8"), "reference material\n", "the read-only folder is untouched");
  assert.equal(fs.existsSync(path.join(reference, "new.txt")), false);
  await sh(A, "echo no > /work/site/to-passwd");
  assert.equal(fs.readFileSync("/etc/passwd", "utf8").startsWith("no"), false, "writing through a link to a system file changes nothing on the host");
});

test("docker: the process sees no Vault value and no host environment", { skip }, async () => {
  await dockerUp();
  await dockerUp();
  assert.equal(process.env[VAULT_ENV], VAULT_VALUE, "the test process holds the value, like the daemon would");
  const env = await sh(A, "env; cat /proc/1/environ /proc/self/environ 2>/dev/null | tr '\\0' '\\n'");
  assert.doesNotMatch(env.stdout, new RegExp(VAULT_VALUE));
  assert.doesNotMatch(env.stdout, new RegExp(VAULT_ENV));
  assert.match(env.stdout, /HTTP_PROXY=http:\/\//, "the proxy variables are set by the sandbox");
  const names = env.stdout.split("\n").map((l) => l.split("=")[0]);
  assert.ok(!names.includes("VYRE_HEAVY_DOCKER"), "the runner's own variables did not come in");
});

test("docker: credentials live in memory in the person's home, mode 0600, and a wipe removes them", { skip }, async () => {
  await dockerUp();
  await dockerUp();
  const secret = `oauth-${TOKEN}`;
  await A.putCredentials([{ path: ".claude/.credentials.json", data: new TextEncoder().encode(secret) }]);
  const read = await sh(A, "cat /home/agent/.claude/.credentials.json && stat -c '%a %u' /home/agent/.claude/.credentials.json && stat -f -c '%T' /home/agent");
  assert.equal(read.exitCode, 0, ok(read));
  assert.ok(read.stdout.includes(secret));
  assert.match(read.stdout, /600 10001\n/);
  assert.match(read.stdout, /tmpfs/, "the home is RAM");
  const onHost = spawnSync("grep", ["-rl", secret, base], { encoding: "utf8" });
  assert.equal(onHost.stdout.trim(), "", "the credential never reached a folder on the host");
  const writable = docker(["diff", idA]);
  assert.doesNotMatch(writable, /credentials/, "nor the container's own layer");
  await A.wipeCredentials();
  const gone = await sh(A, "test -e /home/agent/.claude/.credentials.json; echo $?");
  assert.equal(gone.stdout.trim(), "1");
});

test("docker: the process sees its own processes only, none of the host's", { skip }, async () => {
  await dockerUp();
  await dockerUp();
  const ps = await sh(A, "ps -eo pid,user,args");
  const lines = ps.stdout.split("\n").filter((l) => l.trim() !== "").slice(1);
  assert.ok(lines.length > 0 && lines.length < 12, `a handful of processes, not the machine's: ${ps.stdout}`);
  assert.doesNotMatch(ps.stdout, /sandbox\.heavy|node --test|dockerd|containerd|runner|systemd/i, "no host process by name");
  const hostPid = await sh(A, `test -d /proc/${process.pid}; echo $?`);
  const pid1 = await sh(A, "tr '\\0' ' ' </proc/1/cmdline");
  assert.match(pid1.stdout, /docker-init|tini|sleep/, `pid 1 is the container's own init: ${pid1.stdout}`);
  if (process.pid > 1000) assert.equal(hostPid.stdout.trim(), "1", "the runner's pid is not a process in the sandbox");
  const kill = await sh(A, `kill -0 ${process.pid} 2>&1; echo $?`);
  if (process.pid > 1000) assert.notEqual(kill.stdout.trim().split("\n").pop(), "0", "the sandbox cannot signal a host process");
});

test("docker: the process cannot start more processes than its limit", { skip }, async () => {
  await dockerUp();
  await dockerUp();
  const small = await startDockerSandbox(danaSpec(`vyre-sbx-hv${suffix}c`, { limits: { cpus: 1, memoryMb: 256, pids: 32 } }), { api, roots: roots("dana", danaRoot), egress });
  try {
    const r = await sh(small, "for i in $(seq 1 100); do sleep 20 >/dev/null 2>&1 & done; sleep 1; echo started $(ps -eo args | grep -c '^sleep 20')", 30_000);
    const started = Number(/started (\d+)/.exec(r.stdout)?.[1] ?? "NaN");
    assert.ok(started > 0 && started <= 32, `at most 32 processes ran: ${r.stdout}${r.stderr}`);
    assert.equal((await sh(small, "echo still-alive")).stdout.trim(), "still-alive", "the sandbox survives its own fork storm");
  } finally { await small.stop(); }
});

// ---- the network ------------------------------------------------------------------------------------------------------------------------------------

const curl = (s: Sandbox, args: string, timeoutS = 6): Promise<ExecResult> => sh(s, `curl -sS -m ${timeoutS} ${args}`, (timeoutS + 5) * 1000);

test("docker: the only way out is the egress proxy: an allowed name gets through, a name that is not listed, a private address and an address literal do not", { skip }, async () => {
  await dockerUp();
  await dockerUp();
  events.length = 0;
  const good = await curl(A, "http://allowed.test/");
  assert.equal(good.exitCode, 0, ok(good));
  assert.equal(good.stdout, "upstream-ok", "the allowed host answered through the proxy");
  const denied = await curl(A, "-i http://denied.test/");
  assert.match(denied.stdout, /^HTTP\/1\.[01] 403/);
  assert.match(denied.stdout, /Blocked by this Space's network policy/);
  const internal = await curl(A, "-i http://internal.test/");
  assert.match(internal.stdout, /^HTTP\/1\.[01] 403/, "a listed name that points at a private address is refused");
  const meta = await curl(A, "-i http://metadata.test/");
  assert.match(meta.stdout, /^HTTP\/1\.[01] 403/, "and so is one that points at the cloud metadata address");
  const literal = await curl(A, "-i http://93.184.216.34/");
  assert.match(literal.stdout, /^HTTP\/1\.[01] 403/, "an address literal is not a name on the list");
  const tunnel = await curl(A, "-i https://denied.test/");
  assert.notEqual(tunnel.exitCode, 0, "CONNECT to an unlisted host fails");
  const verdicts = events.map((e) => `${e.verdict}:${e.host}:${e.reason}`);
  assert.ok(verdicts.includes("allow:allowed.test:ok"), verdicts.join(" "));
  assert.ok(verdicts.includes("deny:denied.test:not_listed"), verdicts.join(" "));
  assert.ok(verdicts.includes("deny:internal.test:private_address"), verdicts.join(" "));
  assert.ok(verdicts.includes("deny:metadata.test:private_address"), verdicts.join(" "));
});

test("docker: without the proxy there is no route: no connection to the internet, to another sandbox, or to anything but the proxy's own address", { skip }, async () => {
  await dockerUp();
  await dockerUp();
  const noProxy = "env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy -u NO_PROXY -u no_proxy";
  for (const target of ["http://1.1.1.1/", "http://93.184.216.34/", "http://example.com/", "http://169.254.169.254/latest/meta-data/"]) {
    const r = await sh(A, `${noProxy} curl -sS -m 4 -o /dev/null ${target}; echo $?`, 15_000);
    assert.notEqual(r.stdout.trim(), "0", `${target} must be unreachable: ${ok(r)}`);
  }
  const dns = await sh(A, "getent hosts example.com; echo $?");
  assert.notEqual(dns.stdout.trim().split("\n").pop(), "0", "names do not resolve inside");
  // Another person's sandbox is on a network of its own: its address is not routable from here.
  const ipB = docker(["inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", idB]).trim();
  assert.match(ipB, /^\d+\.\d+\.\d+\.\d+$/, "found the other sandbox's address");
  const toB = await sh(A, `${noProxy} curl -sS -m 3 -o /dev/null http://${ipB}:80/; echo $?`, 15_000);
  assert.notEqual(toB.stdout.trim(), "0", "the other person's container is unreachable");
  // The proxy of the other sandbox listens on its own gateway address, which this one cannot route to either.
  const otherProxy = new URL(B.env()["HTTP_PROXY"] ?? "http://127.0.0.1:1").host;
  const toBProxy = await sh(A, `${noProxy} curl -sS -m 3 -o /dev/null http://${otherProxy}/; echo $?`, 15_000);
  assert.notEqual(toBProxy.stdout.trim(), "0", "nor can it use the other person's proxy");
});

test("docker: a service on the host that listens on every address is not reachable from the sandbox (gateway address)", { skip }, async (t) => {
  await dockerUp();
  // The proxy has to listen on the host side of the sandbox's network, so the sandbox can reach the host's gateway address. Whether it can also reach OTHER host services bound to 0.0.0.0 is the question.
  const r = await sh(A, `env -u HTTP_PROXY -u http_proxy curl -sS -m 4 http://${gateway}:${hostPort}/; echo " exit=$?"`, 15_000);
  const reached = r.stdout.includes("host-service-reached");
  t.diagnostic(`gateway ${gateway}: a host service on 0.0.0.0:${hostPort} ${reached ? "IS reachable from the sandbox (weaker than the spec says)" : "is not reachable from the sandbox"}: ${ok(r)}`);
  assert.equal(reached, false, `the sandbox reached a host service through the gateway address: ${ok(r)}`);
});

test("docker: stopping removes the container, its network, its proxy and its credentials", { skip }, async () => {
  await dockerUp();
  await dockerUp();
  const id = `vyre-sbx-hv${suffix}d`;
  const s = await startDockerSandbox(danaSpec(id), { api, roots: roots("dana", danaRoot), egress });
  await s.putCredentials([{ path: ".codex/auth.json", data: new TextEncoder().encode("x-secret-value") }]);
  const url = new URL(s.env()["HTTP_PROXY"] ?? "");
  assert.ok(docker(["ps", "-a", "--filter", `name=${id}`, "--format", "{{.Names}}"]).includes(id));
  assert.ok(docker(["network", "ls", "--filter", `name=${id}-net`, "--format", "{{.Name}}"]).includes(`${id}-net`));
  await s.stop();
  await s.stop();
  assert.equal(docker(["ps", "-a", "--filter", `name=${id}`, "--format", "{{.Names}}"]).trim(), "", "container gone");
  assert.equal(docker(["network", "ls", "--filter", `name=${id}-net`, "--format", "{{.Name}}"]).trim(), "", "network gone");
  const closed = await new Promise<boolean>((resolve) => { const c = net.connect({ host: url.hostname, port: Number(url.port) }); c.setTimeout(3000, () => { c.destroy(); resolve(true); }); c.once("connect", () => { c.destroy(); resolve(false); }); c.once("error", () => resolve(true)); });
  assert.equal(closed, true, "the proxy no longer listens");
  await assert.rejects(() => s.exec({ argv: ["true"] }), /stopped/);
});

// ---- bubblewrap -------------------------------------------------------------------------------------------------------------------------------------

const BWRAP = ["/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap"].find((p) => fs.existsSync(p)) ?? "bwrap";

/** A Sandbox over `bwrap`, to run the same self-test the Docker one gets. `proxyPort` absent means no network at all. */
function bwrapSandbox(spec: SandboxSpec, r: Roots, proxyPort?: number): Sandbox & { network: string } {
  const probe = bwrapCommand(spec, r, ["true"], proxyPort === undefined ? {} : { proxyPort });
  return {
    id: spec.id, kind: "bwrap", network: probe.enforcement.network,
    async exec(e: ExecSpec): Promise<ExecResult> {
      const w = bwrapCommand(spec, r, e.argv, proxyPort === undefined ? {} : { proxyPort });
      // bwrap itself is started with the environment the command asks for (none): a process inside can read pid 1's environment, which is bwrap's own.
      return runHost(BWRAP, w.args, { timeoutMs: e.timeoutMs ?? 30_000, env: w.env });
    },
    async putCredentials() {}, async wipeCredentials() {}, async stop() {}, env: () => ({}),
  };
}
const bwrapSpec = (): SandboxSpec => ({ ...danaSpec(`vyre-sbx-bw${suffix}`), kind: "bwrap" });

test("bwrap: it exists on this runner and can make the namespaces it needs", { skip }, async () => {
  const v = await runHost("bwrap", ["--version"]);
  assert.equal(v.exitCode, 0, `bwrap is not installed: ${ok(v)}`);
  const s = bwrapSandbox(bwrapSpec(), roots("dana", danaRoot));
  const r = await sh(s, "echo namespaces-ok");
  assert.equal(r.stdout.trim(), "namespaces-ok", `bwrap could not start (unprivileged user namespaces may be blocked on this runner): ${ok(r)}`);
});

test("bwrap: the agent process cannot read outside its folders, and sees no Vault value, no host process, no host home", { skip }, async () => {
  const s = bwrapSandbox(bwrapSpec(), roots("dana", danaRoot));
  for (const p of [OUTSIDE, RAVI_SECRET, "/etc/shadow", "/root/.bashrc", `/proc/${process.pid}/environ`, "/run/docker.sock", "/var/run/docker.sock"]) {
    const r = await sh(s, `cat ${JSON.stringify(p)} >/dev/null 2>&1; echo $?`);
    assert.notEqual(r.stdout.trim(), "0", `read ${p}: ${ok(r)}`);
  }
  // The folders are bound at their host paths, so the paths above them exist as empty directories: what is there is exactly the two folders and nothing else.
  assert.equal((await sh(s, `ls ${JSON.stringify(base)}`)).stdout.trim(), "people", "nothing else of the temp folder");
  assert.equal((await sh(s, `ls ${JSON.stringify(path.join(base, "people"))}`)).stdout.trim(), "dana", "no other person");
  assert.equal((await sh(s, `ls ${JSON.stringify(danaRoot)}`)).stdout.split("\n").filter(Boolean).sort().join(","), "reference,site");
  assert.equal(fs.readFileSync(path.join(site, "hello.txt"), "utf8"), "hello from the work folder\n");
  assert.equal((await sh(s, `cat ${JSON.stringify(path.join(site, "hello.txt"))}`)).stdout.trim(), "hello from the work folder", "its own folder is there at its host path");
  const home = os.homedir();
  assert.notEqual((await sh(s, `test -e ${JSON.stringify(home)}; echo $?`)).stdout.trim(), "0", "the runner's home is not there");
  const viaLink = await sh(s, `cat ${JSON.stringify(path.join(site, "to-ravi"))} 2>&1; echo $?`);
  assert.doesNotMatch(viaLink.stdout, new RegExp(TOKEN), "a link in the folder to another person's file leads nowhere");
  const env = await sh(s, "env; cat /proc/self/environ | tr '\\0' '\\n'; cat /proc/1/environ | tr '\\0' '\\n'");
  assert.doesNotMatch(env.stdout, new RegExp(VAULT_VALUE), "not in its environment, and not in pid 1's either");
  assert.doesNotMatch(env.stdout, new RegExp(VAULT_ENV));
  const procs = await sh(s, "ls /proc | grep -E '^[0-9]+$' | wc -l");
  assert.ok(Number(procs.stdout.trim()) <= 10, `only the sandbox's own processes: ${procs.stdout}`);
  if (process.pid > 1000) assert.notEqual((await sh(s, `test -d /proc/${process.pid}; echo $?`)).stdout.trim(), "0", "the runner's process is not in its view");
  const h = await sh(s, 'ls -A "$HOME" | wc -l; echo $HOME');
  assert.match(h.stdout, /^0\n\/home\/agent/, "an empty home");
  const caps = await sh(s, "grep -E '^(CapEff|NoNewPrivs):' /proc/self/status");
  assert.match(caps.stdout, /CapEff:\s*0000000000000000/);
});

test("bwrap: its own folder is writable and the read-only one is not; the host sees what was written", { skip }, async () => {
  const s = bwrapSandbox(bwrapSpec(), roots("dana", danaRoot));
  const w = await sh(s, `echo written-in-bwrap > ${JSON.stringify(path.join(site, "from-bwrap.txt"))}`);
  assert.equal(w.exitCode, 0, ok(w));
  assert.equal(fs.readFileSync(path.join(site, "from-bwrap.txt"), "utf8"), "written-in-bwrap\n");
  assert.notEqual((await sh(s, `touch ${JSON.stringify(path.join(reference, "x.txt"))}`)).exitCode, 0);
  assert.equal(fs.existsSync(path.join(reference, "x.txt")), false);
  assert.notEqual((await sh(s, "touch /usr/vyre-escape")).exitCode, 0, "the system is read-only");
});

test("bwrap: with no proxy port it has no network at all, and the whole self-test passes", { skip }, async () => {
  const s = bwrapSandbox(bwrapSpec(), roots("dana", danaRoot));
  assert.equal(s.network, "kernel");
  const loop = await sh(s, `curl -sS -m 3 -o /dev/null http://127.0.0.1:${hostPort}/; echo $?`, 15_000);
  assert.notEqual(loop.stdout.trim().split("\n").pop(), "0", "the host's loopback is not there");
  const mounts = validateSpec(bwrapSpec(), roots("dana", danaRoot)).mounts.map((m) => ({ guest: m.host, mode: m.mode }));
  const r = await confinementProbe(s, { outsidePaths: [OUTSIDE, RAVI_SECRET, "/etc/shadow"], mounts, deniedHost: "denied.test" });
  assert.deepEqual(r.failures, []);
});

test("bwrap with a proxy port: the proxy decides what the steered process reaches, but the wall is only the proxy variables", { skip }, async (t) => {
  const s = bwrapSandbox(bwrapSpec(), roots("dana", danaRoot), 0);
  assert.equal(s.network, "proxy-env", "bwrap says itself that the network is steered by variables, not walled off");
  const proxy = createEgressProxy({ allow: ["allowed.test"], ...egress });
  const { port } = await proxy.listen(0, "127.0.0.1");
  try {
    const withPort = bwrapSandbox(bwrapSpec(), roots("dana", danaRoot), port);
    events.length = 0;
    const good = await sh(withPort, "curl -sS -m 6 http://allowed.test/");
    assert.equal(good.stdout, "upstream-ok", ok(good));
    const denied = await sh(withPort, "curl -sS -m 6 -i http://denied.test/");
    assert.match(denied.stdout, /^HTTP\/1\.[01] 403/);
    assert.ok(events.some((e) => e.verdict === "deny" && e.host === "denied.test"));
    // The honest part: a process that unsets the variables is on the machine's own network.
    const around = await sh(withPort, `env -u HTTP_PROXY -u http_proxy -u HTTPS_PROXY -u https_proxy -u ALL_PROXY -u all_proxy curl -sS -m 4 http://127.0.0.1:${hostPort}/`, 15_000);
    const reached = around.stdout.includes("host-service-reached");
    t.diagnostic(`bwrap network is proxy-env: a process that unsets the proxy variables ${reached ? "REACHES the host's loopback services (weaker than the Docker sandbox, as ARCH 6.6 states)" : "could not reach the host's loopback"}`);
    assert.equal(reached, true, `expected the documented gap (proxy-env, not a wall) to show: ${ok(around)}`);
  } finally { await proxy.close(); }
});
