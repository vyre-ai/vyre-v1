// @heavy docker
// Open web on real bubblewrap (owner ruling 3 Nov): a CLI-shaped process started through spawnCli, the engine's own spawn path, gets a wall of its own with the rule its turn carries. Under "public"
// it fetches a public URL with curl, clones a repository over HTTP with git, asks an npm registry with npm view and installs from it, and reaches an SSH host on port 22 through git's ssh command;
// it cannot reach 127.0.0.1, 10.x, 169.254.169.254 or the daemon's port through the proxy, and with no proxy it has no network at all (an error at once, not a hang). Under "Only the AI providers"
// the same public host is blocked again. Where the process went is reported per host. Names resolve through a fake resolver to TEST-NET addresses and connect to local servers, so no test depends on
// the internet, except the last, a real `git clone https://github.com/...`, which runs only with VYRE_LIVE_NET=1. Runs only with VYRE_HEAVY_DOCKER=1; with it on, a missing bwrap fails the test.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { RULE_ENV, startNetWall } from "../../../sandbox/src/index.ts";
import type { EgressEvent, NetWall } from "../../../sandbox/src/index.ts";
import { defaultSandbox, wallEgress } from "../sandbox-default.ts";
import type { DefaultSandbox, WallEgress } from "../sandbox-default.ts";
import { scratchFolder, workFolder } from "../sandbox.ts";
import type { SandboxPlan } from "../sandbox.ts";
import { spawnCli } from "../session.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1";
const liveSkip: string | false = ON && process.env["VYRE_LIVE_NET"] === "1" ? false : "needs VYRE_HEAVY_DOCKER=1 and VYRE_LIVE_NET=1 (reaches github.com)";

const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-openweb-")));
fs.chmodSync(data, 0o755);
const NAMES: Record<string, string> = { "pkg.example.com": "203.0.113.10", "git.example.com": "203.0.113.11", "registry.example.com": "203.0.113.12", "ssh.example.com": "203.0.113.13", "api.anthropic.com": "203.0.113.14", "metadata.example.com": "169.254.169.254" };
const lookup = async (h: string): Promise<string[]> => { const a = NAMES[h]; if (!a) throw new Error("ENOTFOUND"); return [a]; };

let web: http.Server;
let webPort = 0;
let sshd: net.Server;
let sshPort = 0;
const sshSaw: string[] = [];
const repo = path.join(data, "srv", "repo.git");
let tgz: Buffer;
const walls: NetWall[] = [];
let shared: NetWall;
let real: DefaultSandbox | undefined;

before(async () => {
  if (!ON) return;
  // a bare repository served the "dumb" way (static files), and a package tarball for the registry
  const src = path.join(data, "srv", "src");
  fs.mkdirSync(src, { recursive: true });
  const git = (cwd: string, ...a: string[]): void => { execFileSync("git", a, { cwd, stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } }); };
  git(src, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(src, "README.md"), "cloned through the wall\n");
  git(src, "add", "README.md");
  git(src, "commit", "-q", "-m", "first");
  git(path.join(data, "srv"), "clone", "-q", "--bare", src, repo);
  git(repo, "update-server-info");
  const pkg = path.join(data, "srv", "pkg", "package");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "left-pad", version: "1.3.0", main: "index.js" }));
  fs.writeFileSync(path.join(pkg, "index.js"), "module.exports = (s) => ' ' + s;\n");
  execFileSync("tar", ["czf", path.join(data, "srv", "left-pad-1.3.0.tgz"), "-C", path.dirname(pkg), "package"]);
  tgz = fs.readFileSync(path.join(data, "srv", "left-pad-1.3.0.tgz"));
  const integrity = `sha512-${createHash("sha512").update(tgz).digest("base64")}`;
  const packument = { name: "left-pad", "dist-tags": { latest: "1.3.0" }, versions: { "1.3.0": { name: "left-pad", version: "1.3.0", dist: { tarball: "http://registry.example.com/left-pad/-/left-pad-1.3.0.tgz", integrity } } } };
  web = http.createServer((q, r) => {
    const host = (q.headers.host ?? "").split(":")[0];
    const url = (q.url ?? "/").split("?")[0] as string;
    if (host === "pkg.example.com") { r.writeHead(200, { "content-type": "text/plain" }); r.end("hello-public\n"); return; }
    if (host === "registry.example.com" && url === "/left-pad") { r.writeHead(200, { "content-type": "application/json" }); r.end(JSON.stringify(packument)); return; }
    if (host === "registry.example.com" && url.endsWith(".tgz")) { r.writeHead(200, { "content-type": "application/octet-stream" }); r.end(tgz); return; }
    if (host === "git.example.com" && url.startsWith("/repo.git/")) {
      const f = path.join(repo, url.slice("/repo.git/".length));
      if (f.startsWith(repo) && fs.existsSync(f) && fs.statSync(f).isFile()) { r.writeHead(200, { "content-type": "text/plain" }); r.end(fs.readFileSync(f)); return; }
    }
    r.writeHead(404).end();
  });
  await new Promise<void>((r) => web.listen(0, "127.0.0.1", r));
  webPort = (web.address() as net.AddressInfo).port;
  // an SSH host that only says who it is and keeps what the client said first: enough to show that git's ssh reached it through the proxy
  sshd = net.createServer((s) => { s.write("SSH-2.0-OpenSSH_9.6 fake\r\n"); s.once("data", (d) => { sshSaw.push(d.toString("latin1").split("\r\n")[0] as string); s.end(); }); s.on("error", () => undefined); });
  await new Promise<void>((r) => sshd.listen(0, "127.0.0.1", r));
  sshPort = (sshd.address() as net.AddressInfo).port;
  shared = await startNetWall({ ...wallEgress({ mode: "providers", hosts: [] }), egress: fakes() });
});

after(async () => {
  for (const w of walls) await w.close().catch(() => undefined);
  await shared?.close();
  await real?.close();
  if (web) await new Promise((r) => web.close(r));
  if (sshd) await new Promise((r) => sshd.close(r));
  fs.rmSync(data, { recursive: true, force: true });
});

function fakes(onEvent?: (e: EgressEvent) => void) {
  return { lookup, ...(onEvent ? { onEvent } : {}), connect: async (_h: string, port: number) => net.connect(port === 22 ? sshPort : webPort, "127.0.0.1") };
}

/** The plan a Linux daemon builds (bwrap, the wall), with each process's own wall on the fake resolver. */
function plan(): SandboxPlan {
  return {
    sandbox: { kind: "bwrap", wallDir: shared.dir, node: process.execPath }, dataDir: data, egressHosts: [],
    openWall: async (e: WallEgress, onEvent?: (ev: EgressEvent) => void) => {
      const w = await startNetWall({ ...e, egress: fakes(onEvent) });
      walls.push(w);
      return { sandbox: { kind: "bwrap", wallDir: w.dir, node: process.execPath }, close: () => w.close() };
    },
  };
}

async function run(p: SandboxPlan, script: string, rule: unknown, thread: string, seen: Array<{ where: string; e: EgressEvent }> = []): Promise<{ out: string; code: number | null; ms: number }> {
  assert.equal(spawnSync("bwrap", ["--version"]).status, 0, "bwrap is not installed");
  const cwd = workFolder(data, "usr_dana", thread);
  scratchFolder(data, "usr_dana");
  for (const d of [path.join(data, "work"), path.join(data, "work", "usr_dana"), cwd, path.join(data, "scratch"), path.join(data, "scratch", "usr_dana")]) fs.chmodSync(d, 0o777);
  const env: Record<string, string> = rule === undefined ? {} : { [RULE_ENV]: JSON.stringify(rule) };
  const t0 = Date.now();
  const proc = await spawnCli(p, { argv: ["/bin/sh", "-c", script], cwd, env }, ["/bin/sh", "-c", script], { onEgress: (w, e) => seen.push({ where: `${w.person}/${w.threadId}`, e }) });
  let out = "";
  for await (const c of proc.stdout) out += typeof c === "string" ? c : Buffer.from(c).toString("utf8");
  const { code } = await proc.exited;
  return { out, code, ms: Date.now() - t0 };
}

test("public: curl fetches a public URL, git clones over HTTP, npm views and installs, and git's ssh reaches port 22, all through the proxy; the rule never reaches the process", { skip }, async () => {
  const seen: Array<{ where: string; e: EgressEvent }> = [];
  const script = [
    'echo "fetch=$(curl -s --max-time 10 http://pkg.example.com/hello)"',
    'echo "tunnel=$(curl -s -p --max-time 10 http://pkg.example.com:8443/hello)"',
    "git clone -q http://git.example.com/repo.git cloned 2>&1 && echo \"clone=$(cat cloned/README.md)\"",
    'echo "npmview=$(npm view left-pad version --registry=http://registry.example.com/ 2>&1 | tail -1)"',
    "npm install --no-audit --no-fund --registry=http://registry.example.com/ left-pad >/dev/null 2>&1; echo \"npminstall=$(cat node_modules/left-pad/package.json 2>&1)\"",
    'GIT_TERMINAL_PROMPT=0 git ls-remote ssh://git@ssh.example.com/repo.git >/dev/null 2>&1; echo "ssh=$?"',
    'echo "rule=${VYRE_EGRESS_RULE:-none} node_proxy=$NODE_USE_ENV_PROXY"',
  ].join("\n");
  const r = await run(plan(), script, { egress: "public" }, "thr_pub", seen);
  assert.match(r.out, /fetch=hello-public/);
  assert.match(r.out, /tunnel=hello-public/, "CONNECT to a port that is not 443 or 80");
  assert.match(r.out, /clone=cloned through the wall/);
  assert.match(r.out, /npmview=1\.3\.0/);
  assert.match(r.out, /npminstall=\{"name":"left-pad","version":"1\.3\.0"/);
  assert.match(sshSaw.join("\n"), /^SSH-2\.0-OpenSSH/m, "git's ssh spoke to the SSH host through the CONNECT helper");
  assert.match(r.out, /rule=none node_proxy=1/, "the rule is the launcher's, not the engine's");
  const reached = [...new Set(seen.filter((s) => s.e.verdict === "allow").map((s) => s.e.host))].sort();
  assert.deepEqual(reached, ["git.example.com", "pkg.example.com", "registry.example.com", "ssh.example.com"]);
  assert.ok(seen.every((s) => s.where === "usr_dana/thr_pub"));
  assert.ok(seen.filter((s) => s.e.host === "registry.example.com" && s.e.verdict === "allow").length === 1, "one report per host, port and verdict per process");
});

test("public: loopback, private, metadata and the daemon's port are refused at the proxy, and with no proxy there is no network, at once", { skip }, async () => {
  const seen: Array<{ where: string; e: EgressEvent }> = [];
  const via = (url: string): string => `curl -s -o /dev/null -w '%{http_code}' --noproxy '' -x http://127.0.0.1:3128 --max-time 5 ${url}`;
  const script = [
    `echo "loop=$(${via("http://127.0.0.1:9/")})"`,
    `echo "ten=$(${via("http://10.0.0.5/")})"`,
    `echo "meta=$(${via("http://169.254.169.254/latest/meta-data/")})"`,
    `echo "metaname=$(${via("http://metadata.example.com/")})"`,
    `echo "daemon=$(${via("http://pkg.example.com:8420/")})"`,
    "curl -s --noproxy '*' --max-time 20 http://203.0.113.10/ >/dev/null 2>&1; echo \"direct=$?\"",
  ].join("\n");
  const r = await run(plan(), script, { egress: "public" }, "thr_inside", seen);
  for (const k of ["loop", "ten", "meta", "metaname", "daemon"]) assert.match(r.out, new RegExp(`${k}=403`), k);
  assert.match(r.out, /direct=7/, "no route: curl cannot connect (7)");
  assert.ok(r.ms < 15_000, `refusals are immediate (took ${r.ms} ms)`);
  const reasons = Object.fromEntries(seen.filter((s) => s.e.verdict === "deny").map((s) => [`${s.e.host}:${s.e.port}`, s.e.reason]));
  assert.deepEqual(reasons, { "127.0.0.1:9": "private_address", "10.0.0.5:80": "private_address", "169.254.169.254:80": "private_address", "metadata.example.com:80": "private_address", "pkg.example.com:8420": "bad_port" });
});

test("Only the AI providers: the same public host is blocked again, the providers still answer, and ssh fails with a line that says why", { skip }, async () => {
  const seen: Array<{ where: string; e: EgressEvent }> = [];
  const script = [
    "echo \"fetch=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://pkg.example.com/hello)\"",
    "echo \"provider=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://api.anthropic.com/v1)\"",
    "GIT_TERMINAL_PROMPT=0 git ls-remote ssh://git@ssh.example.com/repo.git 2>&1 | grep -c 'cannot be reached from here'",
  ].join("\n");
  const r = await run(plan(), script, wallEgress({ mode: "providers", hosts: [] }).rule, "thr_prov", seen);
  assert.match(r.out, /fetch=403/);
  assert.match(r.out, /provider=404/, "a provider host passes the proxy (the fake answers 404)");
  assert.match(r.out, /^1$/m);
  assert.ok(seen.some((s) => s.e.verdict === "deny" && s.e.host === "pkg.example.com" && s.e.reason === "not_listed"));
});

test("a rule the launcher did not write is refused before anything starts", { skip }, async () => {
  await assert.rejects(() => run(plan(), "echo hi", { egress: "list", allow: ["*"] }, "thr_bad"), /not one Vyre writes/);
});

test("live: git clone over HTTPS from github.com through the default plan's wall", { skip: liveSkip }, async () => {
  real ??= await defaultSandbox({ dataDir: data });
  const r = await run(real.plan, "git clone -q --depth 1 https://github.com/octocat/Hello-World.git hw 2>&1; echo \"code=$?\"; ls hw", { egress: "public" }, "thr_live");
  assert.match(r.out, /code=0/);
  assert.match(r.out, /README/);
});
