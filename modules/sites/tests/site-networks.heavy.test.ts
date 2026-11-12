// @heavy docker
// Sixty sites on one host (12 Nov): before, each site's network came from Docker's default address pools, which hold about 31 networks for everything on the host, so the 30th or so site
// failed. Now each site's network is made through the real sites runner with a /28 of 10.213.0.0/16. The test makes 60 site networks, puts a stand-in app and database on each, and proves:
// every network is a /28 of the range and took nothing of Docker's pools; an app reaches its own database; no app reaches another site's app or database, by address.
// Runs only with VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE (any image with python3 and curl serves as the stand-in app and database).
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSitesRunner } from "../../../host/src/sites-runner/server.ts";
import { dockerRunner } from "../handlers/runner.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1" && process.env["VYRE_WORKSPACE_TEST_IMAGE"] !== undefined;
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE";
const IMAGE = process.env["VYRE_WORKSPACE_TEST_IMAGE"] ?? "";
const RUN = Math.random().toString(36).slice(2, 7);
const N = 60;
const sites = Array.from({ length: N }, (_, i) => `sit_t${RUN}${String(i).padStart(2, "0")}`);
const PORT = 8099;

const docker = (args: string[], ms = 120_000): Promise<{ code: number; out: string }> => new Promise((r) => { execFile("docker", args, { timeout: ms, maxBuffer: 16 * 1024 * 1024 }, (e, out, err) => r({ code: e ? 1 : 0, out: `${String(out)}${String(err)}` })); });
/** Networks on the host whose subnet is outside the site range: the ones Docker's default pools hand out (a module may not import another, so this is counted here). */
const poolCount = async (): Promise<number> => (await poolSubnets()).filter((x) => !x.startsWith("10.213.")).length;
const poolSubnets = async (): Promise<string[]> => {
  const ids = (await docker(["network", "ls", "-q"])).out.split("\n").filter(Boolean);
  return (await docker(["network", "inspect", "-f", "{{range .IPAM.Config}}{{.Subnet}} {{end}}", ...ids])).out.split(/\s+/).filter(Boolean);
};

test("60 sites on one host: each network a /28 of 10.213.0.0/16 taking nothing of Docker's pools; an app reaches its own database and nothing of another site", { skip, timeout: 1_200_000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sites60-"));
  const token = crypto.randomBytes(16).toString("hex");
  const runnerSrv = createSitesRunner({ dockerSocket: "/var/run/docker.sock", listen: path.join(dir, "runner.sock"), token });
  await runnerSrv.listening;
  const runner = dockerRunner({ socketPath: path.join(dir, "runner.sock"), token: () => token });
  const made: Array<{ site: string; net: string }> = [];
  t.after(async () => {
    for (const s of sites) await docker(["rm", "-f", `vyre-sitetest-${RUN}-${s}-app`, `vyre-sitetest-${RUN}-${s}-db`]);
    for (const m of made) await docker(["network", "rm", m.net]);
    await runnerSrv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const poolsBefore = await poolCount();

  // 60 site networks, ten at a time, through the runner
  for (let i = 0; i < N; i += 10) {
    const got = await Promise.all(sites.slice(i, i + 10).map((s) => runner.network(s)));
    got.forEach((g, k) => made.push({ site: sites[i + k]!, net: g.name }));
  }
  const subnets = await Promise.all(made.map(async (m) => (await docker(["network", "inspect", "-f", "{{(index .IPAM.Config 0).Subnet}}", m.net])).out.trim()));
  for (const s of subnets) assert.match(s, /^10\.213\.\d{1,3}\.\d{1,3}\/28$/, "a /28 of the site range");
  assert.equal(new Set(subnets).size, N, "each its own");
  assert.equal(await poolCount(), poolsBefore, "none took a subnet from Docker's default pools");

  // a stand-in app and database on each site's network
  for (let i = 0; i < N; i += 10) {
    await Promise.all(made.slice(i, i + 10).map(async (m) => {
      for (const role of ["app", "db"]) {
        const r = await docker(["run", "-d", "--name", `vyre-sitetest-${RUN}-${m.site}-${role}`, "--network", m.net, "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--user", "10001:10001", "--label", `vyre.sitetest=${RUN}`, "--entrypoint", "python3", IMAGE, "-m", "http.server", String(PORT)]);
        assert.equal(r.code, 0, r.out.slice(-300));
      }
    }));
  }
  await new Promise((r) => setTimeout(r, 3000));
  const ip = async (name: string, net: string): Promise<string> => (await docker(["inspect", "-f", `{{(index .NetworkSettings.Networks "${net}").IPAddress}}`, name])).out.trim();
  const apps = await Promise.all(made.map((m) => ip(`vyre-sitetest-${RUN}-${m.site}-app`, m.net)));
  const dbs = await Promise.all(made.map((m) => ip(`vyre-sitetest-${RUN}-${m.site}-db`, m.net)));
  const reach = async (from: number, to: string): Promise<boolean> => (await docker(["exec", `vyre-sitetest-${RUN}-${made[from]!.site}-app`, "sh", "-c", `curl -s -o /dev/null -m 2 http://${to}:${PORT}/ && echo yes || echo no`])).out.trim() === "yes";

  // every app reaches its own database; and no app reaches the next site's app or database
  const own = await Promise.all(made.map((_, i) => reach(i, dbs[i]!)));
  assert.deepEqual(own.filter((x) => !x).length, 0, "each app reaches its own database");
  const next = await Promise.all(made.map(async (_, i) => [await reach(i, apps[(i + 1) % N]!), await reach(i, dbs[(i + 1) % N]!)]));
  assert.equal(next.flat().filter(Boolean).length, 0, "no app reaches the next site's app or database");
  // and site 0 reaches none of the other 59
  const fromFirst = await Promise.all(made.slice(1).map((_, k) => reach(0, apps[k + 1]!)));
  assert.equal(fromFirst.filter(Boolean).length, 0, "site 0 reaches no other site");
  console.log(`SITES-NUMBERS ${JSON.stringify({ sites: N, poolSubnetsUsedByThem: (await poolCount()) - poolsBefore, firstSubnet: subnets[0], lastSubnet: subnets[N - 1] })}`);
});
