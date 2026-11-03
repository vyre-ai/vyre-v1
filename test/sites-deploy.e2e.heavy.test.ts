// @heavy docker
// The whole path on a real server, the way a Vyre Server runs it: the sites runner as its own process (the only one holding the Docker socket), a booted Vyre daemon with the real modules
// that reaches Docker only through it, and a real Caddy on ports 80 and 443 that gets a real Let's Encrypt certificate for the site's own address. The sites domain is <the box's IP>.sslip.io,
// a public wildcard name for the box, so nothing touches vyre.run DNS.
// First the runner refuses what a site never needs (a privileged container, exec into a container that is not a site's). Then over the HTTP API as a person would: a Vault key, a site from
// a git repo served over HTTPS with Space-only access, its env from that key, its own Postgres, a deploy; over HTTPS a visitor is sent to sign in, a member signs in with the link and gets
// the app, which reads the env and the database, and the list shows who deployed it. Then a push to the repo deploys again by itself and the address serves the new commit.
// Needs VYRE_SITES_E2E=1 and SITES_E2E_IP (this box's public address), ports 80 and 443 free, and Let's Encrypt reachable. Anywhere else it is skipped by name.
import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { bootCore } from "../fixtures/seed/core/index.ts";
import { fakePlatform } from "../host/src/platform/index.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../host/src/daemon/daemon.ts";

const IP = process.env["SITES_E2E_IP"] ?? "";
const SKIP = process.env["VYRE_SITES_E2E"] === "1" && /^\d+\.\d+\.\d+\.\d+$/.test(IP) ? false : "needs VYRE_SITES_E2E=1, SITES_E2E_IP and ports 80/443 on a box with Docker";
const DOMAIN = `${IP.replaceAll(".", "-")}.sslip.io`;
const OWNER = "tok-owner", MEMBER = "tok-member";
const CADDY = `vyre-e2e-caddy-${process.pid}`;
const ADMIN = 12_000 + (process.pid % 900);
// SITES_E2E_ACME=le asks Let's Encrypt for a real certificate and curl checks it (green from box B on 3 Nov). By default Caddy's own CA issues it by the same automatic HTTPS path,
// so a box without a public address can run this too; curl then skips the trust check for that issuer only, and so does git for the repo
const LE = process.env["SITES_E2E_ACME"] === "le";
const docker = (...a: string[]) => spawnSync("docker", a, { encoding: "utf8", timeout: 120_000 });
const sh = (cmd: string, cwd: string) => spawnSync("sh", ["-c", cmd], { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid" } });
// curl runs asynchronously: the daemon answering it lives in this same process
const curl = (...a: string[]): Promise<{ stdout: string; stderr: string }> => new Promise((resolve) => execFile("curl", ["-sS", "--max-time", "20", ...(LE ? [] : ["-k"]), ...a], { encoding: "utf8" }, (_e, stdout, stderr) => resolve({ stdout: String(stdout), stderr: String(stderr) })));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One request straight to the runner's socket, as vyred would make it. */
function runner(sock: string, token: string, method: string, p: string, body?: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const r = http.request({ socketPath: sock, method, path: p, headers: { authorization: `Bearer ${token}`, ...(data ? { "content-type": "application/json", "content-length": data.length } : {}) } }, (res) => { let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => resolve({ status: res.statusCode ?? 0, body: t })); });
    r.on("error", reject); r.end(data);
  });
}

test("a real daemon behind the sites runner deploys a repo with Space-only access, env from the Vault and its own Postgres, at an HTTPS address of its own, and again on a push", { skip: SKIP, timeout: 1_200_000 }, async (t) => {
  // another web server on 443 (a Caddy left by an earlier run) would take half the connections: SO_REUSEPORT shares the port
  assert.doesNotMatch(spawnSync("ss", ["-ltn"], { encoding: "utf8" }).stdout, /:443\s/, "ports 80 and 443 must be free");
  if (docker("network", "inspect", "vyre-sites").status !== 0) assert.equal(docker("network", "create", "vyre-sites").status, 0);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sites-e2e-work-"));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));

  // the repo: the Express fixture, committed to a bare repo that Caddy serves as plain files (git's dumb HTTP)
  const repo = path.join(work, "git", "cx.git");
  const src = path.join(work, "src");
  fs.cpSync(path.join(CODE_ROOT, "fixtures", "sites", "express"), src, { recursive: true });
  assert.equal(sh(`git init -q -b main && git add -A && git commit -qm "First version" && git init -q --bare "${repo}" && git push -q "${repo}" main && git --git-dir="${repo}" update-server-info`, src).status, 0);

  const conf = path.join(work, "caddy.json");
  fs.writeFileSync(conf, JSON.stringify({ admin: { listen: `127.0.0.1:${ADMIN}` } }));
  const up = docker("run", "-d", "--rm", "--name", CADDY, "--network", "host", "-v", `${conf}:/etc/caddy/admin.json:ro`, "-v", `${path.join(work, "git")}:/srv/git:ro`, "caddy:2-alpine", "caddy", "run", "--config", "/etc/caddy/admin.json");
  assert.equal(up.status, 0, up.stderr);
  t.after(() => { docker("rm", "-f", CADDY); });
  for (let i = 0; i < 50 && !(await fetch(`http://127.0.0.1:${ADMIN}/config/`, { headers: { origin: `http://127.0.0.1:${ADMIN}` } }).then((r) => r.ok, () => false)); i++) await wait(200);

  // the sites runner, its own process, the only one given the Docker socket
  const sock = path.join(work, "run", "runner.sock");
  const proc = spawn(process.execPath, [path.join(CODE_ROOT, "host", "src", "sites-runner", "main.ts")], { env: { ...process.env, VYRE_SITES_RUNNER_SOCKET: sock, VYRE_DOCKER_SOCKET: "/var/run/docker.sock" }, stdio: ["ignore", "pipe", "pipe"] });
  let runnerLog = "";
  proc.stdout.on("data", (c) => (runnerLog += String(c)));
  proc.stderr.on("data", (c) => (runnerLog += String(c)));
  t.after(() => { proc.kill("SIGTERM"); });
  for (let i = 0; i < 50 && !fs.existsSync(path.join(work, "run", "token")); i++) await wait(200);
  const token = fs.readFileSync(path.join(work, "run", "token"), "utf8").trim();

  // what it refuses on the real engine: a privileged container, a host folder, exec into a container that is not a site's (Caddy's)
  const priv = await runner(sock, token, "POST", "/containers/create?name=vyre-site-000000000001-x", { Image: "alpine:3.20", Labels: { "vyre.site": "sit_000000000001", "vyre.kind": "app" }, HostConfig: { Privileged: true, NetworkMode: "vyre-sites" } });
  assert.equal(priv.status, 403, priv.body);
  const mount = await runner(sock, token, "POST", "/containers/create?name=vyre-site-000000000001-x", { Image: "vyre-site/000000000001:x", Labels: { "vyre.site": "sit_000000000001", "vyre.kind": "app" }, HostConfig: { NetworkMode: "vyre-sites", NanoCpus: 1e9, Memory: 1e8, MemorySwap: 1e8, PidsLimit: 10, Binds: ["/:/host"] } });
  assert.equal(mount.status, 403, mount.body);
  const exec = await runner(sock, token, "POST", `/containers/${CADDY}/exec`, { Cmd: ["id"] });
  assert.equal(exec.status, 403, exec.body);
  assert.equal((await runner(sock, "not-the-token", "GET", "/_ping")).status, 401);
  assert.match(runnerLog, /refused/);

  const core = bootCore();
  const dir = path.join(work, "space");
  fs.mkdirSync(dir);
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  process.env["VYRE_SITES_DOMAIN"] = DOMAIN;
  process.env["VYRE_SITES_RUNNER"] = sock;
  if (!LE) { process.env["VYRE_CADDY_CA"] = "internal"; process.env["GIT_SSL_NO_VERIFY"] = "1"; }
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "http://space.e2e.invalid"], { VYRE_CADDY_ADMIN: `http://127.0.0.1:${ADMIN}` }, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "sites-e2e", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "29.1.3\n" } } }),
    session: (h) => { const tok = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1]; return tok === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "mac" } : tok === MEMBER ? { space: "spc_core", principal: { kind: "person", id: "usr_noah" }, device: "mac" } : null; },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000, sitesPush: 5_000 },
  });
  let siteId = "";
  t.after(async () => {
    await d.stop();
    for (const k of ["VYRE_SITES_DOMAIN", "VYRE_SITES_RUNNER", "VYRE_CADDY_CA", "GIT_SSL_NO_VERIFY"]) delete process.env[k];
    if (siteId) {
      const ids = docker("ps", "-aq", "--filter", `label=vyre.site=${siteId}`).stdout.split("\n").filter(Boolean);
      if (ids.length) docker("rm", "-f", "-v", ...ids);
      const imgs = docker("images", "-q", "--filter", `label=vyre.site=${siteId}`).stdout.split("\n").filter(Boolean);
      if (imgs.length) docker("rmi", "-f", ...new Set(imgs));
      docker("volume", "rm", "-f", `vyre-site-${siteId.replace(/^sit_/, "").slice(-12)}-postgres-data`);
    }
  });
  let n = 0;
  const call = async (cap: string, input: Record<string, unknown>, tok = OWNER): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify({ idempotencyKey: `e2e-${process.pid}-${++n}`, ...input }) });
    const body = (await r.json()) as { data?: unknown; error?: { message?: string } };
    if (r.status !== 200) throw new Error(`${cap} ${r.status}: ${JSON.stringify(body.error ?? body).slice(0, 400)}`);
    return body.data;
  };

  const host = await call("sites.host", {});
  assert.equal(host.deploy, true, JSON.stringify(host));
  assert.equal(host.sitesDomain, DOMAIN);

  // the repo on its own HTTPS name, a route of the same Caddy
  const gitHost = `git-${process.pid}.${DOMAIN}`;
  await fetch(`http://127.0.0.1:${ADMIN}/config/apps/http/servers/vyre/routes`, { method: "POST", headers: { "content-type": "application/json", origin: `http://127.0.0.1:${ADMIN}` }, body: JSON.stringify({ match: [{ host: [gitHost] }], handle: [{ handler: "file_server", root: "/srv/git" }], terminal: true }) }).then(async (r) => { if (!r.ok) {
    // the vyre server is made with the first route Vyre writes: make it now with the Space's own nothing-route, then add the repo's
    const base = { apps: { http: { servers: { vyre: { listen: [":443"], routes: [{ match: [{ host: [gitHost] }], handle: [{ handler: "file_server", root: "/srv/git" }], terminal: true }] } } }, ...(LE ? {} : { tls: { automation: { policies: [{ issuers: [{ module: "internal" }] }] } } }) } };
    const cfg = await fetch(`http://127.0.0.1:${ADMIN}/config/`, { headers: { origin: `http://127.0.0.1:${ADMIN}` } }).then((x) => x.json()) as Record<string, unknown>;
    const loaded = await fetch(`http://127.0.0.1:${ADMIN}/load`, { method: "POST", headers: { "content-type": "application/json", origin: `http://127.0.0.1:${ADMIN}` }, body: JSON.stringify({ ...cfg, ...base }) });
    assert.ok(loaded.ok, await loaded.text());
  } });
  const repoUrl = `https://${gitHost}/cx.git`;
  let ls = sh(`git ls-remote ${repoUrl}`, work);
  for (let i = 0; i < 30 && ls.status !== 0; i++) { await wait(3000); ls = sh(`git ls-remote ${repoUrl}`, work); }
  assert.equal(ls.status, 0, `the repo answers over HTTPS: ${ls.stderr}`);

  // a shared Vault key for GREETING
  const folders = (await call("vault.folders.list", { scope: "shared" })).folders as Array<{ id: string }>;
  const folderId = folders[0]?.id ?? (await call("vault.folders.create", { name: "Sites", scope: "shared" })).folder.id;
  const item = (await call("vault.item.put", { folderId, name: "CX_Greeting", kind: "env", fields: [{ key: "value", value: "hello-over-https", secret: true }], injectIntoDeployments: true })).item;

  const site = (await call("sites.create", { name: `CX dashboard ${process.pid}`, source: { repo: repoUrl, branch: "main" } })).site;
  siteId = site.siteId;
  assert.equal(site.access, "space");
  assert.equal(site.autoDeploy, true);
  assert.equal(site.url, `https://${site.slug}.${DOMAIN}`);
  await call("sites.env_set", { siteId, entries: [{ name: "GREETING", vaultHandle: item.handle }] });
  assert.equal((await call("sites.addon_add", { siteId, kind: "postgres" })).addon.state, "ready");
  const dep = (await call("sites.deploy", { siteId, wait: true })).deployment;
  const log = (await call("sites.logs", { siteId, build: true, tail: 1000 })).lines.join("\n") as string;
  assert.equal(dep.state, "ready", `${dep.problem ?? ""}\n${log}\n${runnerLog.slice(-2000)}`);
  assert.match(log, /Commit [0-9a-f]{7}: First version/);
  assert.doesNotMatch(log, /hello-over-https/);
  const url = `https://${site.slug}.${DOMAIN}`;

  // the certificate, and a visitor sent to sign in
  let anon = await curl("-o", "/dev/null", "-w", "%{http_code} %{redirect_url}", url);
  for (let i = 0; i < 40 && !/^302 /.test(anon.stdout); i++) { await wait(3000); anon = await curl("-o", "/dev/null", "-w", "%{http_code} %{redirect_url}", url); }
  process.stdout.write(`visitor at ${url}: ${anon.stdout} ${anon.stderr}\n`);
  assert.match(anon.stdout, /^302 .*\/sites\/signin\?site=/, `a visitor is sent to sign in: ${anon.stdout} ${anon.stderr}`);
  let cert = (await curl("-vI", url)).stderr;
  for (let i = 0; i < 10 && !/issuer:/.test(cert); i++) { await wait(2000); cert = (await curl("-vI", url)).stderr; }
  process.stdout.write(`${cert.split("\n").filter((l) => /issuer|subject:|expire/i.test(l)).join("\n")}\n`);
  assert.match(cert, LE ? /issuer: .*(Let's Encrypt|R1[0-9]|E[5-9])/i : /issuer: .*Caddy Local Authority/i);

  // a member signs in with their own link and gets the app, which reads its env and its own database
  const link = (await call("sites.signin_link", { siteId, next: "/api/env" }, MEMBER)).url as string;
  assert.ok(link.startsWith(`${url}/__vyre/signin?t=`), link);
  const jar = path.join(work, "jar");
  const parse = (r: { stdout: string; stderr: string }, what: string): unknown => { try { return JSON.parse(r.stdout); } catch { return assert.fail(`${what}: ${r.stdout.slice(0, 300)} ${r.stderr.slice(0, 300)}`); } };
  assert.deepEqual(parse(await curl("-L", "-c", jar, "-b", jar, link), "env"), { greeting: "hello-over-https" });
  assert.deepEqual(parse(await curl("-b", jar, `${url}/api/whoami`), "whoami"), { user: "usr_noah" });
  assert.equal((parse(await curl("-b", jar, `${url}/api/db`), "db") as { db: string }).db, "ok");
  assert.equal((await curl("-b", jar, `${url}/`)).stdout, "express-fixture-ok");
  const row = (await call("sites.list", {})).sites.find((s: { siteId: string }) => s.siteId === siteId);
  assert.equal(row.lastDeploy.by, "usr_olivia");
  assert.equal(row.state, "ready");

  // a push: the next check sees the new commit and deploys it, and the address serves it
  fs.writeFileSync(path.join(src, "server.js"), fs.readFileSync(path.join(src, "server.js"), "utf8").replace('res.send("express-fixture-ok")', 'res.send("express-fixture-pushed")'));
  assert.equal(sh(`git commit -qam "Second version" && git push -q "${repo}" main && git --git-dir="${repo}" update-server-info`, src).status, 0);
  let second: { state: string; commit?: string; by?: string } | undefined;
  for (let i = 0; i < 120; i++) {
    const deps = (await call("sites.deployments", { siteId })).deployments as Array<{ state: string; commit?: string; current?: boolean; by?: string }>;
    second = deps.find((x) => x.current && x.state === "ready" && x.commit !== dep.commit);
    if (second) break;
    await wait(3000);
  }
  assert.ok(second, `a push deploys again: ${JSON.stringify((await call("sites.deployments", { siteId })).deployments)}`);
  assert.equal(second.by, "usr_olivia", "the push deploy runs as whoever deployed it last");
  assert.equal((await curl("-b", jar, `${url}/`)).stdout, "express-fixture-pushed");
  process.stdout.write(`live: ${url}\npush redeploy: ${dep.commit?.slice(0, 7)} -> ${second.commit?.slice(0, 7)}\n${log.split("\n").filter((l) => l.startsWith("==>")).join("\n")}\n`);
});
