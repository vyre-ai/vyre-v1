// @heavy docker
// Sixty Space browser networks in a row (rc.44): each Space's own network takes a small block of Vyre's range (10.213.0.0/16, a /28), so Docker's default address pools (about 30 networks, then "all predefined address
// pools have been fully subnetted") are never what a server with many Spaces runs out of. All sixty are made, each has a distinct /28 inside the range, they are removed the way a Space's purge removes them (docker
// network rm of its own name), and none is left. Only what this test makes is removed, by the exact names it recorded. Runs only with VYRE_HEAVY_DOCKER=1.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { unixSocketHttp } from "../sandbox/src/docker.ts";
import { makeSpaceBrowserNetwork } from "../modules/computers/sbrowser/docker.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1";
const suffix = `${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const http = unixSocketHttp();

function docker(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) =>
    execFile("docker", args, { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ code: err ? ((err as unknown as { code?: number }).code ?? 1) : 0, out: `${stdout}\n${stderr}` }),
    ),
  );
}

test(
  "sixty Space browser networks in a row all succeed, take distinct /28 blocks of Vyre's range, and are all removed with their Spaces",
  { skip, timeout: 600_000 },
  async (t) => {
    const made: string[] = [];
    t.after(async () => {
      for (const n of made) await docker(["network", "rm", n]);
    });
    const N = 60;
    for (let i = 0; i < N; i++) {
      const name = `vyre-sbrowser-test-n${suffix}x${i}net`;
      made.push(name);
      await makeSpaceBrowserNetwork(http, name);
    }
    const subnets = new Set<string>();
    for (const name of made) {
      const r = await docker([
        "network",
        "inspect",
        "-f",
        "{{range .IPAM.Config}}{{.Subnet}} {{.Gateway}}{{end}}",
        name,
      ]);
      assert.equal(r.code, 0, `${name}: ${r.out}`);
      const [subnet, gateway] = r.out.trim().split(/\s+/);
      assert.match(subnet!, /^10\.213\.\d+\.\d+\/28$/, name);
      assert.match(gateway!, /^10\.213\.\d+\.\d+$/, name);
      subnets.add(subnet!);
    }
    assert.equal(subnets.size, N, "every network has a block of its own");
    // a second call for a name that exists is a no-op (the daemon asks again at every start)
    await makeSpaceBrowserNetwork(http, made[0]!);
    // the purge of each Space removes its own network
    for (const name of made) {
      const r = await docker(["network", "rm", name]);
      assert.equal(r.code, 0, `${name}: ${r.out}`);
    }
    const left = await docker(["network", "ls", "--format", "{{.Name}}"]);
    for (const name of made) assert.ok(!left.out.split("\n").includes(name), `${name} is gone`);
    made.length = 0;
  },
);
