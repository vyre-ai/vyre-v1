// @heavy docker
// What a CLI engine may touch, on real bubblewrap through spawnCli (owner rulings 3 Nov). On the person's own computer: an added folder reads and writes; Vyre's data folder and the private SSH key
// stay closed even when the whole home is added; known_hosts and ~/.gitconfig read; a folder not added stays closed; `npm install -g` lands in the person's own prefix and is there the next turn;
// git pushes over SSH to a real sshd, signing through the person's ssh-agent, whose key the engine never reads; `sudo` says how to hand the command to the person. On a Space server: the person's
// folders are not there, and what an agent installs goes into the Space's toolbox and is there the next turn. Names resolve through a fake resolver to local servers (an npm registry, sshd).
// Runs only with VYRE_HEAVY_DOCKER=1 on a Linux box with bwrap, sshd, ssh-agent and npm; with it on, a missing tool fails the test.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { ACCESS_ENV, RULE_ENV, startNetWall } from "../../../sandbox/src/index.ts";
import type { EgressEvent, NetWall } from "../../../sandbox/src/index.ts";
import { wallEgress } from "../sandbox-default.ts";
import type { WallEgress } from "../sandbox-default.ts";
import { scratchFolder, workFolder } from "../sandbox.ts";
import type { SandboxPlan } from "../sandbox.ts";
import { spawnCli } from "../session.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1";

// under /tmp, not the box's TMPDIR under /root: a folder under /root is a system folder no engine is given
const root = fs.realpathSync(fs.mkdtempSync("/tmp/vyre-access-"));
fs.chmodSync(root, 0o755);
const home = path.join(root, "home", "dana");
const data = path.join(home, ".local", "share", "vyre");   // Vyre's data folder inside the home, as on a desktop
const remote = path.join(root, "srv", "remote.git");
const walls: NetWall[] = [];
let shared: NetWall;
let web: http.Server;
let webPort = 0;
let sshdPort = 0;
let sshd: ChildProcess | undefined;
let agentSock = "";
let agentPid = 0;
const saved = { HOME: process.env["HOME"], SSH_AUTH_SOCK: process.env["SSH_AUTH_SOCK"] };

const freePort = (): Promise<number> => new Promise((r) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });

before(async () => {
  if (!ON) return;
  for (const t of ["bwrap", "sshd", "ssh-agent", "ssh-keygen", "npm", "git"]) assert.equal(spawnSync("sh", ["-c", `command -v ${t} || test -x /usr/sbin/${t}`]).status, 0, `${t} is not installed`);
  fs.mkdirSync(path.join(home, "code", "proj"), { recursive: true });
  fs.mkdirSync(path.join(home, "other"), { recursive: true });
  fs.mkdirSync(path.join(home, ".ssh"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(home, ".npm-global"), { recursive: true });
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(home, "code", "proj", "notes.txt"), "added-folder-notes\n");
  fs.writeFileSync(path.join(home, "other", "secret.txt"), "not-added-secret\n");
  fs.writeFileSync(path.join(data, "vault.sqlite"), "VAULT-SECRET\n");
  fs.writeFileSync(path.join(home, ".gitconfig"), "[user]\n\tname = Dana Wall\n\temail = dana@example.com\n");
  fs.writeFileSync(path.join(home, ".npmrc"), `prefix=${path.join(home, ".npm-global")}\n`);
  // the person's key: in the agent, and on disk where the engine must never read it
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", path.join(home, ".ssh", "id_ed25519")]);
  fs.writeFileSync(path.join(home, ".ssh", "known_hosts"), "# the person's known hosts\n");
  agentSock = path.join(root, "agent.sock");
  const ag = execFileSync("ssh-agent", ["-a", agentSock, "-s"], { encoding: "utf8" });
  agentPid = Number(/SSH_AGENT_PID=(\d+)/.exec(ag)?.[1] ?? 0);
  execFileSync("ssh-add", ["-q", path.join(home, ".ssh", "id_ed25519")], { env: { ...process.env, SSH_AUTH_SOCK: agentSock } });
  // a real sshd on loopback that takes that key, and a bare repository to push to
  const srv = path.join(root, "srv");
  fs.mkdirSync(srv, { recursive: true });
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", path.join(srv, "host_key")]);
  fs.copyFileSync(path.join(home, ".ssh", "id_ed25519.pub"), path.join(srv, "authorized_keys"));
  sshdPort = await freePort();
  fs.writeFileSync(path.join(srv, "sshd_config"), [`Port ${sshdPort}`, "ListenAddress 127.0.0.1", `HostKey ${path.join(srv, "host_key")}`, `AuthorizedKeysFile ${path.join(srv, "authorized_keys")}`,
    "PermitRootLogin yes", "StrictModes no", "PasswordAuthentication no", "KbdInteractiveAuthentication no", "PubkeyAuthentication yes", "UsePAM no", `PidFile ${path.join(srv, "sshd.pid")}`].join("\n") + "\n");
  fs.mkdirSync("/run/sshd", { recursive: true });
  sshd = spawn("/usr/sbin/sshd", ["-D", "-e", "-f", path.join(srv, "sshd_config")], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) { if (await new Promise<boolean>((r) => { const s = net.connect(sshdPort, "127.0.0.1", () => { s.destroy(); r(true); }); s.on("error", () => r(false)); })) break; await new Promise((r) => setTimeout(r, 100)); }
  // an npm registry with one small package
  const pkg = path.join(srv, "pkg", "package");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "left-pad", version: "1.3.0", bin: { "left-pad": "cli.js" } }));
  fs.writeFileSync(path.join(pkg, "cli.js"), "#!/usr/bin/env node\nconsole.log('padded');\n", { mode: 0o755 });
  execFileSync("tar", ["czf", path.join(srv, "lp.tgz"), "-C", path.dirname(pkg), "package"]);
  const tgz = fs.readFileSync(path.join(srv, "lp.tgz"));
  const packument = { name: "left-pad", "dist-tags": { latest: "1.3.0" }, versions: { "1.3.0": { name: "left-pad", version: "1.3.0", bin: { "left-pad": "cli.js" }, dist: { tarball: "http://registry.example.com/left-pad/-/left-pad-1.3.0.tgz", integrity: `sha512-${createHash("sha512").update(tgz).digest("base64")}` } } } };
  web = http.createServer((q, r) => { if ((q.url ?? "").endsWith(".tgz")) { r.writeHead(200); r.end(tgz); } else if ((q.url ?? "").startsWith("/left-pad")) { r.writeHead(200, { "content-type": "application/json" }); r.end(JSON.stringify(packument)); } else r.writeHead(404).end(); });
  await new Promise<void>((r) => web.listen(0, "127.0.0.1", r));
  webPort = (web.address() as net.AddressInfo).port;
  shared = await startNetWall({ ...wallEgress(), egress: fakes() });
  process.env["HOME"] = home;
  process.env["SSH_AUTH_SOCK"] = agentSock;
  for (const d of [path.join(root, "home"), home]) fs.chmodSync(d, 0o755);
});

after(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  for (const w of walls) await w.close().catch(() => undefined);
  await shared?.close();
  sshd?.kill();
  if (agentPid) try { process.kill(agentPid); } catch { /* gone */ }
  if (web) await new Promise((r) => web.close(r));
  fs.rmSync(root, { recursive: true, force: true });
});

function fakes(onEvent?: (e: EgressEvent) => void) {
  const lookup = async (h: string): Promise<string[]> => ({ "registry.example.com": ["203.0.113.12"], "ssh.example.com": ["203.0.113.13"] } as Record<string, string[]>)[h] ?? [];
  return { lookup, ...(onEvent ? { onEvent } : {}), connect: async (_h: string, port: number) => net.connect(port === 22 ? sshdPort : webPort, "127.0.0.1") };
}

function plan(): SandboxPlan {
  return {
    sandbox: { kind: "bwrap", wallDir: shared.dir, node: process.execPath }, dataDir: data, egressHosts: [],
    openWall: async (e: WallEgress) => { const w = await startNetWall({ ...e, egress: fakes() }); walls.push(w); return { sandbox: { kind: "bwrap", wallDir: w.dir, node: process.execPath }, close: () => w.close() }; },
  };
}

async function run(script: string, access: { where: "own" | "server"; folders: string[] }, thread = "thr_1"): Promise<string> {
  const cwd = workFolder(data, "usr_dana", thread);
  scratchFolder(data, "usr_dana");
  const env = { [RULE_ENV]: JSON.stringify({ egress: "public" }), [ACCESS_ENV]: JSON.stringify(access) };
  const proc = await spawnCli(plan(), { argv: ["/bin/sh", "-c", script], cwd, env }, ["/bin/sh", "-c", script]);
  let out = "";
  for await (const c of proc.stdout) out += typeof c === "string" ? c : Buffer.from(c).toString("utf8");
  await proc.exited;
  return out + proc.stderrTail();
}

test("own computer, the whole home added: the folders read and write; Vyre's data folder and the private key stay closed; known_hosts and .gitconfig read; sudo says how to ask", { skip }, async () => {
  const out = await run([
    `echo "added=$(cat ${home}/code/proj/notes.txt)"`,
    `echo written > ${home}/code/proj/new.txt && echo "write=ok"`,
    `echo "vault=$(cat '${data}/vault.sqlite' 2>&1 | head -1)"`,
    `echo "key=$(cat ${home}/.ssh/id_ed25519 2>&1 | head -1)"`,
    `echo "known=$(head -1 ${home}/.ssh/known_hosts 2>&1)"`,
    'echo "gituser=$(git config --global user.name)"',
    'echo "work=$(echo here > in-work.txt && cat in-work.txt)"',
    "sudo apt-get install -y cowsay; echo \"sudo=$?\"",
  ].join("\n"), { where: "own", folders: [home] });
  assert.match(out, /added=added-folder-notes/);
  assert.match(out, /write=ok/);
  assert.equal(fs.readFileSync(path.join(home, "code", "proj", "new.txt"), "utf8"), "written\n");
  assert.doesNotMatch(out, /VAULT-SECRET/, "Vyre's data folder is closed inside an added folder");
  assert.doesNotMatch(out, /BEGIN OPENSSH PRIVATE KEY/, "the private key is never read");
  assert.match(out, /known=# the person's known hosts/);
  assert.match(out, /gituser=Dana Wall/);
  assert.match(out, /work=here/, "the turn's own folder inside the data folder is open again");
  assert.match(out, /sudo=126/);
  assert.match(out, /terminal_request tool with command "sudo apt-get install -y cowsay"/);
});

test("own computer, one folder added: the rest of the home stays closed", { skip }, async () => {
  const out = await run([`echo "added=$(cat ${home}/code/proj/notes.txt)"`, `echo "other=$(cat ${home}/other/secret.txt 2>&1)"`].join("\n"), { where: "own", folders: [path.join(home, "code")] });
  assert.match(out, /added=added-folder-notes/);
  assert.doesNotMatch(out, /not-added-secret/);
});

test("own computer: npm install -g lands in the person's own prefix and is there the next turn", { skip }, async () => {
  const first = await run("npm install -g --no-audit --no-fund --registry=http://registry.example.com/ left-pad >/dev/null 2>&1; echo \"install=$?\"", { where: "own", folders: [] }, "thr_npm1");
  assert.match(first, /install=0/, first);
  assert.ok(fs.existsSync(path.join(home, ".npm-global", "lib", "node_modules", "left-pad", "package.json")), "installed on the computer, in the person's prefix");
  const next = await run('echo "run=$(left-pad)"', { where: "own", folders: [] }, "thr_npm2");
  assert.match(next, /run=padded/, "the next turn finds it on its PATH");
});

test("own computer: git push over SSH to a real sshd, signed through the person's ssh-agent", { skip }, async () => {
  const out = await run([
    "git init -q -b main w && cd w && echo hi > f && git add f && git commit -qm one",
    `GIT_TERMINAL_PROMPT=0 git push -q ssh://root@ssh.example.com${remote} main 2>&1; echo "push=$?"`,
    'echo "agent=$(ssh-add -l 2>&1 | grep -c ED25519)"',
  ].join("\n"), { where: "own", folders: [] }, "thr_ssh");
  assert.match(out, /push=0/, out);
  assert.match(out, /agent=1/, "the agent's key is listed inside, the key file never");
  assert.equal(execFileSync("git", ["--git-dir", remote, "log", "--format=%an %s", "main"], { encoding: "utf8" }).trim(), "Dana Wall one");
});

test("Space server: the person's folders are not there, and an install goes into the Space's toolbox and is there the next turn", { skip }, async () => {
  const first = await run([`echo "added=$(cat ${home}/code/proj/notes.txt 2>&1)"`, "npm install -g --no-audit --no-fund --registry=http://registry.example.com/ left-pad >/dev/null 2>&1; echo \"install=$?\""].join("\n"), { where: "server", folders: [path.join(home, "code")] }, "thr_srv1");
  assert.doesNotMatch(first, /added-folder-notes/);
  assert.match(first, /install=0/, first);
  assert.ok(fs.existsSync(path.join(data, "toolbox", "npm", "lib", "node_modules", "left-pad")));
  const next = await run('echo "run=$(left-pad)"', { where: "server", folders: [] }, "thr_srv2");
  assert.match(next, /run=padded/);
});
