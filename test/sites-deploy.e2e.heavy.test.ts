// @heavy docker
// The whole path on a real server: a booted Vyre daemon with the real modules, the box's Docker engine for sites (VYRE_SITES_DOCKER), and a real Caddy on ports 80 and 443 that gets a real
// Let's Encrypt certificate for the site's own address. The sites domain is <the box's IP>.sslip.io, a public wildcard name for the box, so nothing touches vyre.run DNS.
// Over the HTTP API as a person would: a Vault key, a site from the Express fixture with Space-only access, its env from that key, its own Postgres, a deploy; then over HTTPS the visitor
// is sent to sign in, a member signs in with the link and gets the app, which reads the env and the database; the logs say so; a rollback serves the first build.
// Needs VYRE_SITES_E2E=1 and SITES_E2E_IP (this box's public address), ports 80 and 443 free, and Let's Encrypt reachable. Anywhere else it is skipped by name.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
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
const docker = (...a: string[]) => spawnSync("docker", a, { encoding: "utf8", timeout: 120_000 });
const curl = (...a: string[]) => spawnSync("curl", ["-sS", "--max-time", "20", ...a], { encoding: "utf8" });

test("a real daemon deploys the Express app from a folder with Space-only access, env from the Vault and its own Postgres, at an HTTPS address of its own", { skip: SKIP, timeout: 900_000 }, async (t) => {
  const conf = path.join(os.tmpdir(), `${CADDY}.json`);
  fs.writeFileSync(conf, JSON.stringify({ admin: { listen: `127.0.0.1:${ADMIN}` } }));
  const up = docker("run", "-d", "--rm", "--name", CADDY, "--network", "host", "-v", `${conf}:/etc/caddy/admin.json:ro`, "caddy:2-alpine", "caddy", "run", "--config", "/etc/caddy/admin.json");
  assert.equal(up.status, 0, up.stderr);
  t.after(() => { docker("rm", "-f", CADDY); fs.rmSync(conf, { force: true }); });
  for (let i = 0; i < 50 && !(await fetch(`http://127.0.0.1:${ADMIN}/config/`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 200));

  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sites-e2e-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  process.env["VYRE_SITES_DOMAIN"] = DOMAIN;
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", `https://space-${process.pid}.${DOMAIN}`], { VYRE_CADDY_ADMIN: `http://127.0.0.1:${ADMIN}` }, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "sites-e2e", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "29.1.3\n" } } }),
    session: (h) => { const tok = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1]; return tok === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "mac" } : tok === MEMBER ? { space: "spc_core", principal: { kind: "person", id: "usr_noah" }, device: "mac" } : null; },
    sitesDockerSocket: "/var/run/docker.sock",
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000, sitesPush: 3_600_000 },
  });
  let siteId = "";
  t.after(async () => {
    await d.stop();
    delete process.env["VYRE_SITES_DOMAIN"];
    if (siteId) {
      const ids = docker("ps", "-aq", "--filter", `label=vyre.site=${siteId}`).stdout.split("\n").filter(Boolean);
      if (ids.length) docker("rm", "-f", "-v", ...ids);
      const imgs = docker("images", "-q", "--filter", `label=vyre.site=${siteId}`).stdout.split("\n").filter(Boolean);
      if (imgs.length) docker("rmi", "-f", ...new Set(imgs));
      const hex = siteId.replace(/^sit_/, "");
      docker("volume", "rm", "-f", `vyre-site-${hex.slice(-12)}-postgres-data`);
      docker("network", "rm", `vyre-site-${hex.slice(-16)}`);
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

  // a shared Vault key for GREETING
  const folders = (await call("vault.folders.list", { scope: "shared" })).folders as Array<{ folderId?: string; id?: string }>;
  const folderId = folders[0]?.folderId ?? folders[0]?.id ?? (await call("vault.folders.create", { name: "Sites", scope: "shared" })).folder.id;
  const item = (await call("vault.item.put", { folderId, name: "CX_Greeting", kind: "env", fields: [{ key: "value", value: "hello-over-https", secret: true }], injectIntoDeployments: true })).item;

  const fixture = path.join(CODE_ROOT, "fixtures", "sites", "express");
  const site = (await call("sites.create", { name: `CX dashboard ${process.pid}`, source: { path: fixture } })).site;
  siteId = site.siteId;
  assert.equal(site.access, "space");
  assert.equal(site.url, `https://${site.slug}.${DOMAIN}`);
  await call("sites.env_set", { siteId, entries: [{ name: "GREETING", vaultHandle: item.handle }] });
  assert.equal((await call("sites.addon_add", { siteId, kind: "postgres" })).addon.state, "ready");
  const dep = (await call("sites.deploy", { siteId, wait: true })).deployment;
  const log = (await call("sites.logs", { siteId, build: true, tail: 1000 })).lines.join("\n") as string;
  assert.equal(dep.state, "ready", `${dep.problem ?? ""}\n${log}`);
  assert.doesNotMatch(log, /hello-over-https/);
  const url = `https://${site.slug}.${DOMAIN}`;

  // a real certificate: curl verifies it (no -k), retried while Caddy gets it
  let anon = curl("-o", "/dev/null", "-w", "%{http_code} %{redirect_url}", url);
  for (let i = 0; i < 40 && !/^302 /.test(anon.stdout); i++) { await new Promise((r) => setTimeout(r, 3000)); anon = curl("-o", "/dev/null", "-w", "%{http_code} %{redirect_url}", url); }
  process.stdout.write(`visitor at ${url}: ${anon.stdout} ${anon.stderr}\n`);
  assert.match(anon.stdout, /^302 .*\/sites\/signin\?site=/, `a visitor is sent to sign in: ${anon.stdout} ${anon.stderr}`);
  const cert = curl("-vI", url).stderr;
  assert.match(cert, /issuer: .*(Let's Encrypt|R1[0-9]|E[5-9])/i, cert.split("\n").filter((l) => /issuer|subject|expire/i.test(l)).join("\n"));

  // a member signs in with their own link and gets the app, which reads its env and its own database
  const link = (await call("sites.signin_link", { siteId, next: "/api/env" }, MEMBER)).url as string;
  assert.ok(link.startsWith(`${url}/__vyre/signin?t=`), link);
  const jar = path.join(os.tmpdir(), `e2e-jar-${process.pid}`);
  t.after(() => fs.rmSync(jar, { force: true }));
  const env = curl("-L", "-c", jar, "-b", jar, link);
  assert.deepEqual(JSON.parse(env.stdout), { greeting: "hello-over-https" }, env.stdout + env.stderr);
  assert.deepEqual(JSON.parse(curl("-b", jar, `${url}/api/whoami`).stdout), { user: "usr_noah" });
  const db = JSON.parse(curl("-b", jar, `${url}/api/db`).stdout);
  assert.equal(db.db, "ok", JSON.stringify(db));
  const running = (await call("sites.logs", { siteId, tail: 50 })).lines as string[];
  assert.ok(Array.isArray(running));
  const row = (await call("sites.list", {})).sites.find((s: { siteId: string }) => s.siteId === siteId);
  assert.equal(row.lastDeploy.by, "usr_olivia");
  assert.equal(row.state, "ready");
  process.stdout.write(`live: ${url}\n${log.split("\n").filter((l) => l.startsWith("==>")).join("\n")}\n`);
});
