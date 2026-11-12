// @heavy docker
// What a workspace on the one shared network can and cannot reach, on a real Docker engine (12 Nov, the lead's design point 2). Two workspaces, A and B, on vyre-workspaces with traffic between
// containers off; stand-ins for a site and its database (on a network of the site's own), the Space browser and an old desktop (each on its own network). From A:
//   - B is not reached on any port, by address or by name (Docker's own DNS does answer B's name with its address: that is printed, and the traffic is still refused);
//   - the stand-ins are not reached at all (Docker keeps bridge networks apart);
//   - A cannot make raw packets (every capability is dropped), so it cannot answer ARP for B or send it anything below IP; it has no IPv6 address, so no link-local path;
//   - A does reach the host's gateway address: what keeps it from the daemon's routes there is the daemon's guard, which refuses the workspaces' subnet (printed, so the report shows it).
// No outside service is reached. Runs only with VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { buildWorkspaceManager, workspaceName } from "../workspace.ts";
import { unixSocketHttp } from "../../../sandbox/src/docker.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1" && process.env["VYRE_WORKSPACE_TEST_IMAGE"] !== undefined;
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE";
const IMAGE = process.env["VYRE_WORKSPACE_TEST_IMAGE"] ?? "";
const RUN = Math.random().toString(36).slice(2, 7);
const A = `agt_iso${RUN}_a`, B = `agt_iso${RUN}_b`;
const STANDINS = [
  { name: `vyre-isotest-${RUN}-site`, net: `vyre-isotest-${RUN}-sitenet`, what: "a site" },
  { name: `vyre-isotest-${RUN}-db`, net: `vyre-isotest-${RUN}-sitenet`, what: "a site's database" },
  { name: `vyre-isotest-${RUN}-sbrowser`, net: `vyre-isotest-${RUN}-sbnet`, what: "the Space browser" },
  { name: `vyre-isotest-${RUN}-desktop`, net: `vyre-isotest-${RUN}-compnet`, what: "an old desktop" },
];
const PORT = 8099;

const docker = (args: string[], ms = 120_000): Promise<string> => new Promise((r) => { execFile("docker", args, { timeout: ms, maxBuffer: 16 * 1024 * 1024 }, (_e, out, err) => r(`${String(out)}${String(err)}`)); });
const ipOn = async (name: string, net: string): Promise<string> => (await docker(["inspect", "-f", `{{(index .NetworkSettings.Networks "${net}").IPAddress}}`, name])).trim();
const serve = `nohup python3 -m http.server ${PORT} >/dev/null 2>&1 &`;

test("a workspace on the shared network reaches no other workspace, site, database, Space browser or desktop; it cannot make raw packets and has no IPv6 address", { skip, timeout: 600_000 }, async (t) => {
  const m = buildWorkspaceManager({ http: unixSocketHttp(), image: IMAGE, idleMs: 3_600_000, owner: `spc_iso${RUN}` });
  t.after(async () => {
    m.close();
    for (const id of [A, B]) { await docker(["rm", "-f", workspaceName(id)]); await docker(["volume", "rm", "-f", `${workspaceName(id)}-home`, `${workspaceName(id)}-files`]); }
    for (const s of STANDINS) await docker(["rm", "-f", s.name]);
    for (const n of new Set(STANDINS.map((s) => s.net))) await docker(["network", "rm", n]);
  });
  const facts: Record<string, string> = {};
  const inA = async (cmd: string): Promise<string> => (await m.exec(A, ["sh", "-c", cmd])).stdout.trim();
  const reach = async (host: string): Promise<boolean> => (await inA(`curl -s -o /dev/null -m 3 http://${host}:${PORT}/ && echo yes || echo no`)) === "yes";

  await m.ensure(A); await m.ensure(B);
  assert.equal((await docker(["inspect", "-f", "{{.HostConfig.NetworkMode}}", workspaceName(A)])).trim(), "vyre-workspaces");
  assert.equal((await docker(["network", "inspect", "-f", "{{index .Options \"com.docker.network.bridge.enable_icc\"}}", "vyre-workspaces"])).trim(), "false");
  await m.exec(B, ["sh", "-c", serve]);
  // the stand-ins: each serves on PORT on a network that is not the workspaces'
  for (const n of new Set(STANDINS.map((s) => s.net))) await docker(["network", "create", "--label", `vyre.isotest=${RUN}`, n]);
  for (const s of STANDINS) await docker(["run", "-d", "--name", s.name, "--network", s.net, "--label", `vyre.isotest=${RUN}`, "--entrypoint", "python3", IMAGE, "-m", "http.server", String(PORT)]);
  await new Promise((r) => setTimeout(r, 2000));

  // B: a control from B itself shows it serves; from A, not by address, not by name, on no port
  assert.equal((await m.exec(B, ["sh", "-c", `curl -s -o /dev/null -m 3 http://127.0.0.1:${PORT}/ && echo yes || echo no`])).stdout.trim(), "yes", "B serves (control)");
  const ipB = await ipOn(workspaceName(B), "vyre-workspaces");
  assert.equal(await reach(ipB), false, "A does not reach B's port by address");
  assert.equal(await reach(workspaceName(B)), false, "A does not reach B's port by name");
  facts["Docker's DNS answers B's name inside A with"] = (await inA(`getent hosts ${workspaceName(B)} | cut -d' ' -f1 || true`)) || "(nothing)";
  facts["ping B from A"] = await inA(`ping -c1 -W2 ${ipB} >/dev/null 2>&1 && echo answered || echo "no answer"`);
  // any port: a scan of B's first 1024 ports finds none open
  assert.equal(await inA(`n=0; for p in $(seq 1 1024) ${PORT}; do (exec 3<>/dev/tcp/${ipB}/$p) 2>/dev/null && n=$((n+1)); done; echo $n`), "0", "no port of B answers A");

  for (const s of STANDINS) {
    const ip = await ipOn(s.name, s.net);
    assert.ok(ip, `${s.what} has an address`);
    assert.equal(await reach(ip), false, `A does not reach ${s.what} (${ip})`);
    assert.equal(await reach(s.name), false, `A does not reach ${s.what} by name`);
  }

  // below IP: no raw sockets (ARP answers or forged frames need CAP_NET_RAW), and no IPv6 address
  assert.equal(await inA(`python3 -c "import socket; socket.socket(socket.AF_PACKET, socket.SOCK_RAW)" 2>/dev/null && echo raw || echo refused`), "refused", "no raw packets");
  assert.equal(await inA("grep -c eth0 /proc/net/if_inet6 || true"), "0", "no IPv6 address on eth0");
  facts["ARP entry for B in A after the tries"] = (await inA(`ip neigh show ${ipB} 2>/dev/null || cat /proc/net/arp | grep ${ipB} || true`)) || "(none)";

  // the host's gateway address on the shared network: reached at the network level; the daemon's guard refuses the workspaces' subnet
  const gw = (await docker(["network", "inspect", "-f", "{{(index .IPAM.Config 0).Gateway}}", "vyre-workspaces"])).trim();
  facts["the shared network's gateway"] = gw;
  facts["the shared network's subnet (registered with the daemon's guard)"] = (await docker(["network", "inspect", "-f", "{{(index .IPAM.Config 0).Subnet}}", "vyre-workspaces"])).trim();
  facts["subnets the module reports to the guard"] = m.subnets().join(", ") || "(none yet: read at the next sweep)";
  t.diagnostic(JSON.stringify(facts, null, 1));
  console.log(`ISOLATION-FACTS ${JSON.stringify(facts)}`);
});
