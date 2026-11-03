// @heavy docker
// An agent deploys a site in a chat: a real turn on a booted daemon (the model is a scripted stand-in; the engine, the tools and the pipeline are real), the agent acting for the person who
// asked. It calls sites_plan, sites_create and sites_deploy with wait, through the same tools any model or an outside agent over MCP gets, and the deploy goes through the restricted sites
// runner (its own process) to Docker. The reply carries the address, and the address answers through the daemon's own door for the site's name.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { CODE_ROOT } from "../host/src/daemon/daemon.ts";
import { boot, call, connect, makeAgent, sayAuto, scriptedModel, seededDir } from "./support/live.ts";

const SKIP = process.env["VYRE_HEAVY_DOCKER"] === "1" ? false : "needs Docker: VYRE_HEAVY_DOCKER=1 on a box with a Docker engine";
const DOMAIN = "agent-sites.test";
const docker = (...a: string[]) => spawnSync("docker", a, { encoding: "utf8", timeout: 120_000 });

test("an agent in a chat plans, creates and deploys a site, and says where it is", { skip: SKIP, timeout: 600_000 }, async (t) => {
  if (docker("network", "inspect", "vyre-sites").status !== 0) assert.equal(docker("network", "create", "vyre-sites").status, 0);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sites-agent-"));
  const sock = path.join(work, "run", "runner.sock");
  const proc = spawn(process.execPath, [path.join(CODE_ROOT, "host", "src", "sites-runner", "main.ts")], { env: { ...process.env, VYRE_SITES_RUNNER_SOCKET: sock }, stdio: "ignore" });
  t.after(() => { proc.kill("SIGTERM"); fs.rmSync(work, { recursive: true, force: true }); });
  for (let i = 0; i < 50 && !fs.existsSync(path.join(work, "run", "token")); i++) await new Promise((r) => setTimeout(r, 200));
  process.env["VYRE_SITES_RUNNER"] = sock;
  process.env["VYRE_SITES_DOMAIN"] = DOMAIN;
  const fixture = path.join(CODE_ROOT, "fixtures", "sites", "static");
  const seen: Array<{ name: string; ok: boolean; content: unknown }> = [];
  const dir = seededDir();
  const d = await boot(dir, scriptedModel(async function* (_input: unknown, run) {
    // what a model does with "put this folder online for the team": read the plan, make the site, deploy it, say where it is
    const plan = yield* run("sites_plan", { source: { path: fixture } });
    seen.push({ name: "sites_plan", ...plan });
    const made = yield* run("sites_create", { name: "Team page", source: { path: fixture }, idempotencyKey: "agent-site-create" });
    seen.push({ name: "sites_create", ...made });
    const siteId = (made.content as { site?: { siteId?: string } })?.site?.siteId;
    const dep = yield* run("sites_deploy", { siteId, wait: true });
    seen.push({ name: "sites_deploy", ...dep });
    const got = yield* run("sites_get", { siteId });
    const url = (got.content as { site?: { url?: string } })?.site?.url;
    yield { type: "text", text: `It is live for the Space at ${url}.` };
  }));
  let siteId = "";
  t.after(async () => {
    await d.stop();
    delete process.env["VYRE_SITES_RUNNER"]; delete process.env["VYRE_SITES_DOMAIN"];
    fs.rmSync(dir, { recursive: true, force: true });
    if (siteId) {
      const ids = docker("ps", "-aq", "--filter", `label=vyre.site=${siteId}`).stdout.split("\n").filter(Boolean);
      if (ids.length) docker("rm", "-f", ...ids);
      const imgs = docker("images", "-q", "--filter", `label=vyre.site=${siteId}`).stdout.split("\n").filter(Boolean);
      if (imgs.length) docker("rmi", "-f", ...new Set(imgs));
    }
  });
  await connect(d);
  const agentId = await makeAgent(d, "Builder", "You build and deploy the team's sites.");
  const { reply } = await sayAuto(d, agentId, "Put the team page folder online for the Space.", "agent-deploy");
  process.stdout.write(`tools: ${JSON.stringify(seen).slice(0, 1500)}\nreply: ${reply}\n`);
  assert.ok(seen.every((s) => s.ok), JSON.stringify(seen).slice(0, 2000));
  const dep = (seen.find((s) => s.name === "sites_deploy")?.content as { deployment?: { state?: string; by?: string; problem?: string } })?.deployment;
  assert.equal(dep?.state, "ready", JSON.stringify(dep));
  const site = (seen.find((s) => s.name === "sites_create")?.content as { site: { siteId: string; slug: string; access: string } }).site;
  siteId = site.siteId;
  assert.equal(site.access, "space");
  assert.match(reply, new RegExp(`https://${site.slug}\\.${DOMAIN.replace(/\./g, "\\.")}`));
  const listed = (await call(d, "sites.list", {})).data.sites.find((s: { siteId: string }) => s.siteId === siteId);
  // the agent acted for the person who asked: the deploy is theirs, done by the agent
  assert.ok(listed.lastDeploy.by === agentId || /^usr_/.test(listed.lastDeploy.by), listed.lastDeploy.by);
  // the address, through the daemon's own door for the site's name: a visitor is sent to sign in
  const r = await new Promise<{ status: number; location: string }>((resolve, reject) => {
    const u = new URL(d.url);
    const q = http.request({ host: u.hostname, port: Number(u.port), path: "/", headers: { host: `${site.slug}.${DOMAIN}` } }, (res) => { res.resume(); resolve({ status: res.statusCode ?? 0, location: String(res.headers.location ?? "") }); });
    q.on("error", reject); q.end();
  });
  assert.ok(r.status === 302 || r.status === 401, `the site's own address answers for the Space only: ${r.status}`);
});
