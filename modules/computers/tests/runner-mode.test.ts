// The Docker host behind the container runner (a Team server): a network of its own for each computer, only its profile volume (no host folder), the ingress joined to that network for the
// one route agentd posts to, the same cleanup on removal, and a runtime that cannot be used says why in words. A scripted Engine API records what the host asks for.
import test from "node:test";
import assert from "node:assert/strict";
import type { ContainerConfig, DockerApi, DockerHttp } from "../../../sandbox/src/docker.ts";
import { computerNetworkName, createDockerComputerHost, explainEngine, reviewComputerConfig } from "../impl.ts";

const A = "cmt_01a1b2c3-d4e5-4f60-8a7b-0123456789ab", B = "cmt_02b2c3d4-e5f6-4071-9b8c-123456789abc";

function world(o: { ingress?: string } = {}) {
  const reqs: string[] = [];
  const created = new Map<string, ContainerConfig>();
  const bodies: Array<{ path: string; json?: any }> = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  const http: DockerHttp = async (r) => {
    reqs.push(`${r.method} ${r.path}`);
    bodies.push({ path: r.path, json: r.json });
    const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
    if (r.method === "POST" && r.path === "/networks/create") return { status: 201, body: enc({ Id: "n1" }) };
    if (r.method === "POST" && /\/networks\/[^/]+\/(connect|disconnect)$/.test(r.path)) return { status: 200, body: enc({}) };
    const net = /^\/networks\/(vyre-compnet-[a-z0-9]+)$/.exec(r.path);
    if (net && r.method === "GET") return { status: 200, body: enc({ IPAM: { Config: [{ Subnet: net[1] === computerNetworkName(A) ? "172.30.1.0/24" : "172.30.2.0/24" }] } }) };
    if (r.method === "DELETE") return { status: 204, body: new Uint8Array() };
    return { status: 200, body: enc({}) };
  };
  const api = {
    async ping() { return true; }, async imageExists() { return true; },
    async containerCreate(name: string, c: ContainerConfig) { reqs.push(`create ${name}`); created.set(name, c); return name; },
    async containerRemove(id: string) { reqs.push(`remove ${id}`); },
    async containerRunning() { return true; },
  } as unknown as DockerApi;
  const host = createDockerComputerHost({ api, http, runner: { socket: "/run/vyre-sites/runner.sock", ...(o.ingress ? { ingress: o.ingress } : {}) }, filesRoot: () => "/data/computers/x/Vyre" });
  return { host, reqs, created, bodies };
}

test("each computer gets a network of its own and the ingress joins it; the container sits on that network and mounts only its profile volume", async () => {
  const w = world({ ingress: "vyred-container" });
  await w.host.create({ computerId: A, agentId: "agt_1", tabLimit: 8, idleSleepMinutes: 30 });
  await w.host.create({ computerId: B, agentId: "agt_2", tabLimit: 8, idleSleepMinutes: 30 });
  assert.notEqual(computerNetworkName(A), computerNetworkName(B), "two computers, two networks");
  const mine = w.created.get("vyre-comp-01a1b2c3-d4e5-4f60-8a7b-0123456789ab")!;
  assert.equal(mine.HostConfig.NetworkMode, computerNetworkName(A));
  assert.deepEqual(mine.HostConfig.Binds, ["vyre-comp-01a1b2c3-d4e5-4f60-8a7b-0123456789ab-profile:/home/agent/.profile-disk:rw"], "no host folder, even when the host keeps one for the agent");
  assert.deepEqual(reviewComputerConfig(mine), []);
  assert.equal(w.created.get("vyre-comp-02b2c3d4-e5f6-4071-9b8c-123456789abc")!.HostConfig.NetworkMode, computerNetworkName(B));
  const order = w.reqs.filter((r) => /networks|^create/.test(r));
  assert.deepEqual(order.slice(0, 4), ["POST /networks/create", `POST /networks/${computerNetworkName(A)}/connect`, `GET /networks/${computerNetworkName(A)}`, "create vyre-comp-01a1b2c3-d4e5-4f60-8a7b-0123456789ab"], "network first, then the ingress, then the container");
  assert.deepEqual(w.bodies.find((b) => b.path.endsWith("/connect"))!.json, { Container: "vyred-container", EndpointConfig: { Aliases: ["vyre-host"] } });
  assert.deepEqual((w.host as unknown as { subnets(): string[] }).subnets().sort(), ["172.30.1.0/24", "172.30.2.0/24"], "the daemon knows which addresses are computers'");
});

test("removing a computer removes its container, leaves its network and deletes its volume; a failed create takes its network back", async () => {
  const w = world({ ingress: "vyred-container" });
  await w.host.create({ computerId: A, agentId: "agt_1", tabLimit: 8, idleSleepMinutes: 30 });
  w.reqs.length = 0;
  await w.host.remove(A);
  assert.deepEqual(w.reqs, ["remove vyre-comp-01a1b2c3-d4e5-4f60-8a7b-0123456789ab", `POST /networks/${computerNetworkName(A)}/disconnect`, `DELETE /networks/${computerNetworkName(A)}`, "DELETE /volumes/vyre-comp-01a1b2c3-d4e5-4f60-8a7b-0123456789ab-profile"]);
  assert.deepEqual((w.host as unknown as { subnets(): string[] }).subnets(), []);
  const bad = world();
  (bad.host as unknown as { create: unknown }).create = undefined;
  const failing = createDockerComputerHost({ api: { ...({} as DockerApi), imageExists: async () => true, containerCreate: async () => { throw new Error("no space left"); } } as unknown as DockerApi, http: async () => ({ status: 201, body: new TextEncoder().encode("{}") }), runner: { socket: "/x" } });
  await assert.rejects(() => failing.create({ computerId: A, agentId: "agt_1", tabLimit: 8, idleSleepMinutes: 30 }), /no space left/);
});

test("a runtime that cannot be used says why and what to do, for the machine it is on; never 'try again'", async () => {
  const enoent = Object.assign(new Error("connect ENOENT"), { code: "ENOENT" });
  assert.match(explainEngine(0, enoent, "engine", "darwin"), /Start Docker Desktop or Colima/);
  assert.match(explainEngine(0, enoent, "engine", "linux"), /Install and start Docker/);
  assert.match(explainEngine(0, enoent, "engine", "win32"), /Start Docker Desktop/);
  assert.match(explainEngine(0, Object.assign(new Error("x"), { code: "EACCES" }), "engine", "linux"), /docker group/);
  assert.match(explainEngine(0, enoent, "runner"), /container runner is not running.*docker compose up -d sites-runner/);
  assert.match(explainEngine(401, null, "runner"), /did not accept Vyre's token/);
  assert.match(explainEngine(502, null, "runner"), /Docker behind it may be down/);
  for (const s of [explainEngine(0, enoent, "engine", "darwin"), explainEngine(0, enoent, "runner"), explainEngine(500, null, "engine"), explainEngine(0, null, "engine")]) assert.doesNotMatch(s, /try again/i);
  const down = createDockerComputerHost({ api: {} as DockerApi, http: async () => { throw enoent; }, runner: { socket: "/x" } });
  const h = await down.health();
  assert.deepEqual([h.ok, /container runner is not running/.test(h.detail ?? "")], [false, true]);
  const up = createDockerComputerHost({ api: {} as DockerApi, http: async () => ({ status: 200, body: new Uint8Array() }), runner: { socket: "/x" } });
  assert.equal((await up.health()).ok, true);
});
