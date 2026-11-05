// @heavy docker
// Agent computers on a Team server that has the runner and no Docker socket for vyred: the owner's "Set up its computer" on rc.20 said only "Could not set up its computer. Try again." because vyred
// looked for /var/run/docker.sock, which a vyred container does not have; computers.hosts said the Space had no Docker and provision was refused. Now the runner (host/src/sites-runner, the one process
// that holds the socket) makes the computers too, behind policy. Here the runner is its own process on the real engine and the daemon reaches Docker only through it:
//   - computers.hosts says the Space can run one; an agent made in the Team Space gets a computer, it wakes, and it runs commands (files written and read by agentd inside the container);
//   - the computers are on networks of their own, with only their profile volume mounted and every capability dropped, as the runner's policy writes them;
//   - a second agent's computer cannot see the first's files and cannot connect to it, while the first can reach itself (so the probe can fail only by isolation);
//   - the runner refuses a privileged container, a host folder and a container that is not a computer's, on the real engine;
//   - with the runner stopped, hosts and provision say why, in words, and never "try again".
// Runs only with VYRE_HEAVY_DOCKER=1 and the agent computer image on the box (VYRE_AGENT_COMPUTER_IMAGE, default vyre/agent-computer:1).
import test from "node:test";
import { agentComputerImage } from "../../test/support/heavy-images.ts";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the computers are real containers)";
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function docker(args: string[], timeoutMs = 60_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile("docker", args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code as number | undefined) ?? 1 : 0, out: `${stdout}\n${stderr}` }));
  });
}

/** One request straight to the runner's socket, as vyred would make it. */
function runner(sock: string, token: string, method: string, p: string, body?: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const r = http.request({ socketPath: sock, method, path: p, headers: { authorization: `Bearer ${token}`, ...(data ? { "content-type": "application/json", "content-length": data.length } : {}) } }, (res) => { let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => resolve({ status: res.statusCode ?? 0, body: t })); });
    r.on("error", reject); r.end(data);
  });
}

async function call(d: Daemon, cap: string, input: unknown): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input) });
  const body = (await r.json().catch(() => ({}))) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}

test("computers behind the runner: set up, wake, run a command, two agents isolated, the runner's refusals, and the reason in words when it is not there", { skip, timeout: 900_000 }, async (t) => {
  const IMAGE = agentComputerImage();
  assert.equal((await docker(["image", "inspect", IMAGE])).code, 0, `${IMAGE} is on this box`);
  const work = tmp("vyre-computers-runner-");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));

  // the runner: its own process, the only one given the Docker socket
  const sock = path.join(work, "run", "runner.sock");
  const proc = spawn(process.execPath, [path.join(CODE_ROOT, "host", "src", "sites-runner", "main.ts")], { env: { ...process.env, VYRE_SITES_RUNNER_SOCKET: sock, VYRE_DOCKER_SOCKET: "/var/run/docker.sock" }, stdio: ["ignore", "pipe", "pipe"] });
  let runnerLog = "";
  proc.stdout.on("data", (c) => (runnerLog += String(c)));
  proc.stderr.on("data", (c) => (runnerLog += String(c)));
  t.after(() => { proc.kill("SIGTERM"); });
  for (let i = 0; i < 50 && !fs.existsSync(path.join(work, "run", "token")); i++) await wait(200);
  const token = fs.readFileSync(path.join(work, "run", "token"), "utf8").trim();

  // the daemon: a Team Space that holds no Docker socket of its own; the runner is all it knows
  const core = bootCore();
  const dir = path.join(work, "space");
  fs.mkdirSync(dir);
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  process.env["VYRE_SITES_RUNNER"] = sock;
  process.env["VYRE_AGENT_COMPUTER_IMAGE"] = IMAGE;
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "runner-live", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" } } }),
    fetch: caddyFetch, computersHomeIntervalMs: 20_000,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const ids: string[] = [];
  t.after(async () => {
    await d.stop();
    delete process.env["VYRE_SITES_RUNNER"];
    const left = (await docker(["ps", "-aq", "--filter", "label=vyre.computer"])).out.split("\n").filter((x) => /^[0-9a-f]{12}/.test(x));
    if (left.length) await docker(["rm", "-f", "-v", ...left]);
    for (const id of ids) {
      const n = `vyre-comp-${id.replace(/^cmt_/, "")}`;
      await docker(["volume", "rm", "-f", `${n}-profile`]);
      await docker(["network", "rm", `vyre-compnet-${id.replace(/^cmt_/, "").replace(/-/g, "").slice(-16)}`]);
    }
  });

  // the Space can run one, and says so
  const hosts = await call(d, "computers.hosts", {});
  assert.equal(hosts.status, 200, JSON.stringify(hosts.data));
  assert.equal(hosts.data.available, true, JSON.stringify(hosts.data));
  assert.equal(hosts.data.hosts[0].canRun, true);

  const agent = async (name: string): Promise<string> => { const r = await call(d, "agents.create", { name, role: "You work at a computer.", idempotencyKey: `runner-live-${name}` }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.agent.agentId as string; };
  const dex = await agent("Dex"), quill = await agent("Quill");
  const setUp = async (agentId: string): Promise<string> => {
    const prov = await call(d, "computers.provision", { agentId, idempotencyKey: `runner-live-prov-${agentId}` });
    assert.equal(prov.status, 200, JSON.stringify(prov.data));
    assert.equal(prov.data.computer.state, "asleep", "a computer is asleep until someone presses it");
    ids.push(prov.data.computer.computerId);
    const woke = await call(d, "computers.wake", { computerId: prov.data.computer.computerId });
    assert.equal(woke.status, 200, JSON.stringify(woke.data));
    assert.equal(woke.data.computer.state, "working");
    return prov.data.computer.computerId as string;
  };
  const dexPc = await setUp(dex);
  const quillPc = await setUp(quill);
  const box = (id: string) => `vyre-comp-${id.replace(/^cmt_/, "")}`;

  // what the runner made: each on its own network, the profile volume only, every capability dropped, no host folder
  const inspect = async (id: string) => JSON.parse((await docker(["inspect", box(id)])).out.trim().split("\n\n")[0] ?? "[]")[0] as { HostConfig: { Binds: string[]; CapDrop: string[]; Privileged: boolean; NetworkMode: string; Memory: number; PidsLimit: number; LogConfig: { Type: string } }; NetworkSettings: { Networks: Record<string, { IPAddress: string }> } };
  const a = await inspect(dexPc), b = await inspect(quillPc);
  assert.match(a.HostConfig.NetworkMode, /^vyre-compnet-/);
  assert.notEqual(a.HostConfig.NetworkMode, b.HostConfig.NetworkMode, "two computers, two networks");
  assert.deepEqual(a.HostConfig.Binds, [`${box(dexPc)}-profile:/home/agent/.profile-disk:rw`], "no host folder");
  assert.deepEqual([a.HostConfig.CapDrop, a.HostConfig.Privileged, a.HostConfig.LogConfig.Type], [["ALL"], false, "json-file"]);
  assert.ok(a.HostConfig.Memory > 0 && a.HostConfig.PidsLimit > 0);
  assert.deepEqual(Object.keys(a.NetworkSettings.Networks), [a.HostConfig.NetworkMode], "on its own network only");

  // it runs commands: agentd inside the container writes and reads a file in the agent's own folder
  const wr = await call(d, "computers.files.write", { computerId: dexPc, path: "dex-was-here.txt", content: "from-dex", mode: "create" });
  assert.equal(wr.status, 200, JSON.stringify(wr.data));
  const rd = await call(d, "computers.files.read", { computerId: dexPc, path: "dex-was-here.txt" });
  assert.equal(rd.status, 200, JSON.stringify(rd.data));
  assert.match(JSON.stringify(rd.data), /from-dex/);
  const ran = await docker(["exec", box(dexPc), "sh", "-c", "echo ran-in-$(hostname | cut -c1-9)"]);
  assert.match(ran.out, /ran-in-vyre-comp/);

  // isolation: the second agent's computer cannot read the first's files, and cannot connect to it
  const others = await call(d, "computers.files.list", { computerId: quillPc });
  assert.equal(others.status, 200, JSON.stringify(others.data));
  assert.doesNotMatch(JSON.stringify(others.data), /dex-was-here/, "another agent's files are not in this computer");
  const dexIp = Object.values(a.NetworkSettings.Networks)[0]!.IPAddress;
  assert.match(dexIp, /^\d+\.\d+\.\d+\.\d+$/);
  await docker(["exec", "-d", box(dexPc), "python3", "-m", "http.server", "8099", "--bind", "0.0.0.0"]);
  const probe = (from: string, ip: string) => docker(["exec", box(from), "timeout", "4", "bash", "-c", `echo > /dev/tcp/${ip}/8099`], 30_000);
  let own = { code: 1, out: "" };
  for (let i = 0; i < 20 && own.code !== 0; i++) { own = await probe(dexPc, dexIp); if (own.code !== 0) await wait(500); }
  assert.equal(own.code, 0, `the first computer reaches its own listener (so a failure below is isolation, not a dead probe): ${own.out}`);
  const across = await probe(quillPc, dexIp);
  assert.notEqual(across.code, 0, "the second computer cannot connect to the first");

  // what the runner refuses on the real engine
  const priv = await runner(sock, token, "POST", `/containers/create?name=${box(dexPc)}-x`, { Image: IMAGE, Labels: { "vyre.computer": dexPc }, HostConfig: { Privileged: true } });
  assert.equal(priv.status, 403, priv.body);
  const mount = await runner(sock, token, "POST", `/containers/create?name=${box(dexPc)}`, { Image: IMAGE, Labels: { "vyre.computer": dexPc }, HostConfig: { Binds: ["/:/host"], NetworkMode: "bridge" } });
  assert.equal(mount.status, 403, mount.body);
  const alien = (await docker(["run", "-d", "--rm", "--name", `vyre-runner-live-alien-${process.pid}`, "alpine:3.20", "sleep", "60"])).code === 0 ? `vyre-runner-live-alien-${process.pid}` : "";
  if (alien) {
    t.after(() => { void docker(["rm", "-f", alien]); });
    assert.equal((await runner(sock, token, "POST", `/containers/${alien}/exec`, { Cmd: ["id"] })).status, 403, "exec into a container that is not Vyre's");
    assert.equal((await runner(sock, token, "DELETE", `/containers/${alien}?force=true`)).status, 403, "removing a container that is not Vyre's");
  }
  assert.equal((await runner(sock, token, "GET", "/_ping", undefined)).status, 200);
  assert.equal((await runner(sock, "not-the-token", "GET", "/_ping")).status, 401);
  assert.match(runnerLog, /refused/);

  // put to sleep and removed: the container, its network and its volume go
  assert.equal((await call(d, "computers.sleep", { computerId: quillPc })).status, 200);
  assert.equal((await call(d, "computers.remove", { computerId: quillPc })).status, 200);
  assert.notEqual((await docker(["network", "inspect", b.HostConfig.NetworkMode])).code, 0, "its network is gone");
  assert.notEqual((await docker(["volume", "inspect", `${box(quillPc)}-profile`])).code, 0, "its volume is gone");

  // the runner is not there: the Space says why, in words, and provision refuses with the same reason, with nothing left behind
  proc.kill("SIGTERM");
  await wait(1500);
  const down = await call(d, "computers.hosts", {});
  assert.equal(down.data.available, false);
  assert.match(down.data.hosts[0].reason, /container runner is not running/);
  assert.match(down.data.hosts[0].reason, /docker compose up -d sites-runner/);
  const third = await agent("Rook");
  const refused = await call(d, "computers.provision", { agentId: third, idempotencyKey: "runner-live-prov-rook" });
  assert.notEqual(refused.status, 200);
  const said = String(refused.data.error?.message ?? "");
  assert.match(said, /container runner is not running/);
  assert.doesNotMatch(said, /try again/i);
  const listed = await call(d, "computers.list", {});
  assert.deepEqual(listed.data.computers.map((c: { agentId: string }) => c.agentId), [dex], "no row for the computer that could not be made");
});
