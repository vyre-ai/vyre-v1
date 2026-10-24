// @heavy: the vyred image files and the health contract of the container (P-L7b_15, ARCH 7.13).
// Always checked: the Dockerfile and both compose units say what the spec needs, and the healthcheck verdict reads doctor reports correctly.
// Boot checks: the real daemon (the same host/src/daemon/main.ts the image runs) starts in a temp data directory in each role, the healthcheck reports ok, and it reports unhealthy once the daemon is gone.
// Docker checks (build the image, run it, wait for "healthy") run only on a runner with Docker when VYRE_HEAVY_DOCKER=1; everywhere else they are skipped by name.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, doctorRole, verdict } from "./healthcheck.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const read = (f: string): string => fs.readFileSync(path.join(HERE, f), "utf8");

const NODE_PIN = "node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205";
const CADDY_PIN = "caddy:2-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f";

const verdictOf = verdict;
const checkOf = check;
const roleOf = doctorRole;

test("Dockerfile: Node 24 base pinned by digest, git and tmux installed, tini as PID 1, non-root", () => {
  const d = read("Dockerfile");
  const froms = d.split("\n").filter((l) => /^FROM /.test(l));
  assert.deepEqual(froms, [`FROM ${NODE_PIN}`]);
  assert.match(d, /apt-get install -y --no-install-recommends[^\n]*\bgit\b/);
  assert.match(d, /apt-get install -y --no-install-recommends[^\n]*\btmux\b/);
  assert.match(d, /\btini\b/);
  assert.match(d, /ENTRYPOINT \["\/usr\/bin\/tini", "--"\]/);
  assert.match(d, /^USER node$/m);
  assert.match(d, /CMD \["node", "\/opt\/vyre\/host\/src\/daemon\/main\.ts"\]/);
  assert.match(d, /^HEALTHCHECK [^\n]*healthcheck\.mjs/m);
  assert.doesNotMatch(d, /:latest\b/);
  assert.doesNotMatch(d, /\bcurl\b[^\n]*\|\s*(ba)?sh/);
});

test("Dockerfile ignore file keeps secrets and local state out of the build context", () => {
  const ig = read("Dockerfile.dockerignore").split("\n");
  for (const must of [".git", "**/node_modules", "**/.env", "**/.env.*", "**/*.pem", "**/*.key"]) assert.ok(ig.includes(must), `${must} is ignored`);
});

test("bake file builds both architectures", () => {
  const b = read("docker-bake.hcl");
  assert.match(b, /platforms\s*=\s*\["linux\/amd64",\s*"linux\/arm64"\]/);
  assert.match(b, /dockerfile\s*=\s*"images\/vyred\/Dockerfile"/);
});

test("server unit: space role, Caddy pinned and sharing vyred's network, data on a volume, no secrets inline", () => {
  const c = read("compose.server.yml");
  assert.match(c, /VYRE_ROLE: space/);
  assert.ok(c.includes(CADDY_PIN), "caddy pinned by digest");
  assert.match(c, /network_mode: "service:vyred"/);
  assert.match(c, /- vyre-data:\/data/);
  assert.match(c, /VYRE_HEALTH_REQUIRE_CADDY: "1"/);
  assert.match(c, /condition: service_healthy/);
  assert.match(c, /cap_drop: \[ALL\]/g);
  assert.match(c, /127\.0\.0\.1:\$\{VYRE_PORT:-8420\}:8420/);
  assert.doesNotMatch(c, /(TOKEN|SECRET|PASSWORD|KEY)\s*[:=]\s*[A-Za-z0-9]{8,}/);
  assert.match(read("Caddyfile"), /admin 127\.0\.0\.1:2019/);
});

test("device unit: device role, no Caddy, no public port", () => {
  const c = read("compose.device.yml");
  const code = c.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.match(c, /VYRE_ROLE: device/);
  assert.doesNotMatch(code, /caddy/i);
  assert.doesNotMatch(c, /- "(80|443):/);
  assert.match(c, /127\.0\.0\.1:\$\{VYRE_PORT:-8420\}:8420/);
  assert.match(c, /- vyre-device-data:\/data/);
});

test("images carry the same host settings the daemon reads", () => {
  const d = read("Dockerfile");
  for (const v of ["VYRE_DATA_DIR=/data", "VYRE_ROLE=space", "VYRE_HOST=0.0.0.0", "VYRE_PORT=8420"]) assert.ok(d.includes(v), v);
  const cfg = fs.readFileSync(path.join(REPO, "host/src/daemon/config.ts"), "utf8");
  for (const v of ["VYRE_DATA_DIR", "VYRE_ROLE", "VYRE_HOST", "VYRE_PORT", "VYRE_CADDY_ADMIN", "VYRE_SPACE", "VYRE_ADDRESS", "VYRE_RELAY_URL"]) assert.ok(cfg.includes(v), `config.ts reads ${v}`);
});

const f = (key: string, state: string, detail = ""): { key: string; state: string; detail: string; next: string } => ({ key, state, detail, next: "" });
const report = (...findings: ReturnType<typeof f>[]): { findings: ReturnType<typeof f>[] } => ({ findings });

test("healthcheck verdict: process must be healthy, container-blind checks never fail it", () => {
  const good = report(f("daemon.process", "healthy"), f("kernel.events_db", "healthy"), f("host.disk_space", "healthy"));
  assert.equal(verdictOf(good).ok, true);
  assert.equal(verdictOf(report(f("daemon.process", "degraded", "vyred is not running."))).ok, false);
  assert.equal(verdictOf(report(f("daemon.process", "healthy"), f("kernel.events_db", "down", "chain broken"))).ok, false);
  const blind = report(f("daemon.process", "healthy"), f("host.disk_encrypted", "down"), f("host.docker", "down"), f("host.caddy", "down"));
  assert.equal(verdictOf(blind).ok, true);
  assert.equal(verdictOf(blind, { VYRE_HEALTH_REQUIRE_CADDY: "1" }).ok, false);
  assert.equal(verdictOf({}).ok, false);
  assert.equal(verdictOf(null).ok, false);
});

test("healthcheck checks the space doctor unless the role is device only", () => {
  assert.equal(roleOf({}), "space");
  assert.equal(roleOf({ VYRE_ROLE: "space" }), "space");
  assert.equal(roleOf({ VYRE_ROLE: "device,space" }), "space");
  assert.equal(roleOf({ VYRE_ROLE: "device" }), "device");
});

async function bootDaemon(role: "space" | "device"): Promise<{ dir: string; child: ChildProcess; stop: () => Promise<void> }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vyred-smoke-${role}-`));
  const args = [path.join(REPO, "host/src/daemon/main.ts"), "--role", role, "--data-dir", dir, "--port", "0", "--host", "127.0.0.1", ...(role === "space" ? ["--space", "spc_smoke"] : [])];
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, VYRE_PROGRAM: "vyre-server" } });
  let out = "";
  child.stdout?.on("data", (b: Buffer) => { out += b.toString(); });
  child.stderr?.on("data", (b: Buffer) => { out += b.toString(); });
  const t0 = Date.now();
  while (!fs.existsSync(path.join(dir, "vyred.json"))) {
    if (child.exitCode !== null) throw new Error(`vyred exited ${child.exitCode}: ${out}`);
    if (Date.now() - t0 > 12_000) { child.kill("SIGKILL"); throw new Error(`vyred did not start in 12 s: ${out}`); }
    await new Promise((r) => setTimeout(r, 50));
  }
  const stop = async (): Promise<void> => {
    if (child.exitCode !== null) return;
    const done = new Promise<void>((r) => child.once("exit", () => r()));
    child.kill("SIGTERM");
    await Promise.race([done, new Promise((r) => setTimeout(r, 8000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  };
  return { dir, child, stop };
}

async function bootAndCheck(role: "space" | "device"): Promise<void> {
  const d = await bootDaemon(role);
  try {
    const up = await checkOf({ ...process.env, VYRE_DATA_DIR: d.dir, VYRE_ROLE: role });
    assert.equal(up.ok, true, up.why);
    const cli = spawnSync(process.execPath, [path.join(HERE, "healthcheck.mjs")], { env: { ...process.env, VYRE_DATA_DIR: d.dir, VYRE_ROLE: role }, encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
  } finally { await d.stop(); }
  const down = await checkOf({ ...process.env, VYRE_DATA_DIR: d.dir, VYRE_ROLE: role });
  assert.equal(down.ok, false);
  const cliDown = spawnSync(process.execPath, [path.join(HERE, "healthcheck.mjs")], { env: { ...process.env, VYRE_DATA_DIR: d.dir, VYRE_ROLE: role }, encoding: "utf8" });
  assert.equal(cliDown.status, 1);
  assert.match(cliDown.stderr, /^unhealthy: /);
  fs.rmSync(d.dir, { recursive: true, force: true });
}

// both roles boot at once so the file stays well inside the 20 s cap
test("@heavy boot: vyred in the space and the device role starts and the container healthcheck reports ok, then unhealthy once it stops", async () => {
  await Promise.all([bootAndCheck("space"), bootAndCheck("device")]);
});

const dockerOn = process.env["VYRE_HEAVY_DOCKER"] === "1" && spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" }).status === 0;
test("@heavy docker: the image builds, boots in the device role and Docker reports it healthy", { skip: dockerOn ? false : "needs Docker and VYRE_HEAVY_DOCKER=1" }, async () => {
  const tag = `vyred-smoke:${process.pid}`;
  const name = `vyred-smoke-${process.pid}`;
  const sh = (args: string[]): ReturnType<typeof spawnSync> => spawnSync("docker", args, { cwd: REPO, encoding: "utf8" });
  try {
    const build = sh(["build", "-f", "images/vyred/Dockerfile", "-t", tag, "."]);
    assert.equal(build.status, 0, String(build.stderr));
    const run = sh(["run", "-d", "--name", name, "-e", "VYRE_ROLE=device", tag]);
    assert.equal(run.status, 0, String(run.stderr));
    let state = "";
    for (let i = 0; i < 40 && state !== "healthy"; i++) {
      state = String(sh(["inspect", "--format", "{{.State.Health.Status}}", name]).stdout).trim();
      if (state !== "healthy") await new Promise((r) => setTimeout(r, 2000));
    }
    assert.equal(state, "healthy");
  } finally { sh(["rm", "-f", name]); sh(["rmi", "-f", tag]); }
});
