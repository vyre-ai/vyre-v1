// The runner and agent computers: what it refuses (privileged, a host folder, another computer's network, a capability, an exec or an archive anywhere but a computer's own home, a container that
// is not a computer's), and what it lets through reaches Docker with the drop of every capability and the log rotation written in. A fake Docker behind it records what arrives.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createSitesRunner } from "./server.ts";
import { HOME_RM_SCRIPT, computerName, computerNet } from "./computers-policy.ts";

const A = "cmt_01a1b2c3-d4e5-4f60-8a7b-0123456789ab", B = "cmt_02b2c3d4-e5f6-4071-9b8c-123456789abc";
const SECCOMP = JSON.stringify({ defaultAction: "SCMP_ACT_ERRNO", syscalls: [] });
const good = (id = A, over: Record<string, unknown> = {}, h: Record<string, unknown> = {}) => ({
  Image: "vyre/agent-computer:1", Hostname: computerName(id), User: "", WorkingDir: "/home/agent", Cmd: [], Env: [`VYRE_COMPUTER_ID=${id}`, `VYRE_AGENT_ID=agt_1`, "VYRE_TAB_LIMIT=8"],
  Labels: { "vyre.computer": id, "vyre.agent": "agt_1" }, StopTimeout: 10, ...over,
  HostConfig: {
    Binds: [`${computerName(id)}-profile:/home/agent/.profile-disk:rw`], ReadonlyRootfs: false, Tmpfs: { "/tmp": "rw,size=1g", "/dev/shm": "rw,size=1g" }, CapDrop: ["ALL"], CapAdd: [],
    SecurityOpt: ["no-new-privileges:true", `seccomp=${SECCOMP}`], Privileged: false, NetworkMode: computerNet(id), PidMode: "", IpcMode: "private", UsernsMode: "", Devices: [], PidsLimit: 1024,
    Memory: 4 * 1024 ** 3, MemorySwap: 4 * 1024 ** 3, NanoCpus: 2e9, Init: true, AutoRemove: false, Ulimits: [{ Name: "nofile", Soft: 8192, Hard: 16384 }], ExtraHosts: [], Dns: [], ...h,
  },
});

async function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-runner-comp-"));
  const seen: Array<{ method: string; url: string; body: string }> = [];
  const labels: Record<string, Record<string, string>> = {
    [computerName(A)]: { "vyre.computer": A, "vyre.agent": "agt_1" }, [computerName(B)]: { "vyre.computer": B, "vyre.agent": "agt_2" },
    helperA: { "vyre.computer": A, "vyre.helper": "home-rm" }, site1: { "vyre.site": "sit_01abc", "vyre.kind": "app" }, vyred: { "vyre.ingress": "1" }, other: {},
  };
  const fake = http.createServer((q, s) => {
    let b = "";
    q.on("data", (c) => (b += c));
    q.on("end", () => {
      seen.push({ method: q.method ?? "", url: q.url ?? "", body: b });
      const insp = /^\/containers\/([^/]+)\/json$/.exec(q.url ?? "");
      if (insp) { const l = labels[insp[1] as string]; s.writeHead(l ? 200 : 404); s.end(JSON.stringify({ Id: insp[1], Config: { Labels: l ?? {} } })); return; }
      if (/\/exec$/.test(q.url ?? "")) { s.writeHead(201); s.end(JSON.stringify({ Id: "e".repeat(64) })); return; }
      s.writeHead(q.url?.includes("/containers/create") ? 201 : 200); s.end(JSON.stringify({ Id: "c".repeat(64) }));
    });
  });
  await new Promise<void>((r) => fake.listen(path.join(dir, "docker.sock"), r));
  const runner = createSitesRunner({ dockerSocket: path.join(dir, "docker.sock"), listen: path.join(dir, "runner.sock"), token: "t0ken" });
  await runner.listening;
  const call = (method: string, p: string, body?: unknown) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const r = http.request({ socketPath: path.join(dir, "runner.sock"), method, path: p, headers: { authorization: "Bearer t0ken", ...(data ? { "content-type": "application/json", "content-length": data.length } : {}) } }, (res) => { let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => resolve({ status: res.statusCode ?? 0, body: t })); });
    r.on("error", reject); r.end(data);
  });
  return { call, seen, close: async () => { await runner.close(); fake.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test("a computer container is refused when it asks for anything an agent computer is never given, and nothing refused reaches Docker", async (t) => {
  const w = await world();
  t.after(w.close);
  const create = (body: unknown, name = computerName(A)) => w.call("POST", `/v1.47/containers/create?name=${name}`, body);
  const refused: Array<[string, unknown, string]> = [
    ["privileged", good(A, {}, { Privileged: true }), "privileged"],
    ["a host folder", good(A, {}, { Binds: ["/etc:/host-etc"] }), "host folders"],
    ["another computer's profile", good(A, {}, { Binds: [`${computerName(B)}-profile:/home/agent/.profile-disk:rw`] }), "host folders"],
    ["the Docker socket", good(A, {}, { Binds: ["/var/run/docker.sock:/var/run/docker.sock"] }), "host folders"],
    ["a mount by Mounts", good(A, {}, { Mounts: [{ Type: "bind", Source: "/", Target: "/h" }] }), "Mounts"],
    ["the host network", good(A, {}, { NetworkMode: "host" }), "own network"],
    ["the default bridge", good(A, {}, { NetworkMode: "bridge" }), "own network"],
    ["another computer's network", good(A, {}, { NetworkMode: computerNet(B) }), "own network"],
    ["the host pid namespace", good(A, {}, { PidMode: "host" }), "pid"],
    ["a shared ipc namespace", good(A, {}, { IpcMode: "host" }), "ipc"],
    ["a device", good(A, {}, { Devices: [{ PathOnHost: "/dev/sda" }] }), "evices"],
    ["a published port", good(A, {}, { PortBindings: { "80/tcp": [{ HostPort: "80" }] } }), "PortBindings"],
    ["SYS_ADMIN", good(A, {}, { CapAdd: ["SYS_ADMIN"] }), "capability"],
    ["capabilities not dropped", good(A, {}, { CapDrop: [] }), "capabilit"],
    ["new privileges allowed", good(A, {}, { SecurityOpt: [`seccomp=${SECCOMP}`] }), "privileges"],
    ["seccomp off", good(A, {}, { SecurityOpt: ["no-new-privileges:true", "seccomp=unconfined"] }), "seccomp"],
    ["a seccomp profile that allows all", good(A, {}, { SecurityOpt: ["no-new-privileges:true", `seccomp=${JSON.stringify({ defaultAction: "SCMP_ACT_ALLOW" })}`] }), "seccomp"],
    ["apparmor off", good(A, {}, { SecurityOpt: ["no-new-privileges:true", `seccomp=${SECCOMP}`, "apparmor=unconfined"] }), "security option"],
    ["no memory cap", good(A, {}, { Memory: 0 }), "memory"],
    ["too much memory", good(A, {}, { Memory: 64 * 1024 ** 3, MemorySwap: 64 * 1024 ** 3 }), "memory"],
    ["swap", good(A, {}, { MemorySwap: 8 * 1024 ** 3 }), "swap"],
    ["no process cap", good(A, {}, { PidsLimit: 0 }), "process"],
    ["too many CPUs", good(A, {}, { NanoCpus: 64e9 }), "CPU"],
    ["extra hosts", good(A, {}, { ExtraHosts: ["evil:10.0.0.1"] }), "extra hosts"],
    ["a tmpfs over /etc", good(A, {}, { Tmpfs: { "/etc": "rw" } }), "tmpfs"],
    ["a user namespace mode", good(A, {}, { UsernsMode: "host" }), "user namespace"],
    ["another image", good(A, { Image: "alpine:latest" }), "image"],
    ["another label", good(A, { Labels: { "vyre.computer": A, "com.docker.compose.service": "vyred" } }), "label"],
    ["the ingress label", good(A, { Labels: { "vyre.computer": A, "vyre.ingress": "1" } }), "label"],
    ["a site's label", good(A, { Labels: { "vyre.site": "sit_01abc", "vyre.kind": "app" } }), "vyre.computer"],
    ["no label", good(A, { Labels: {} }), "vyre.computer"],
    ["an environment variable of its own", good(A, { Env: ["SECRET=1"] }), "environment"],
    ["another entrypoint", good(A, { Entrypoint: ["/bin/sh"] }), "Entrypoint"],
  ];
  for (const [what, body, why] of refused) {
    const r = await create(body);
    assert.equal(r.status, 403, `${what}: ${r.body}`);
    assert.match(r.body, new RegExp(why, "i"), what);
  }
  assert.equal((await create(good(), "vyred")).status, 403, "a name that is not a computer's");
  assert.equal((await create(good(), computerName(B))).status, 403, "the name of another computer");
  assert.equal(w.seen.filter((s) => s.url.includes("/containers/create")).length, 0, "nothing refused reached Docker");
  const ok = await create(good());
  assert.equal(ok.status, 201, ok.body);
  const sent = JSON.parse(w.seen.at(-1)!.body) as { HostConfig: Record<string, unknown> };
  assert.deepEqual([sent.HostConfig["CapDrop"], sent.HostConfig["CapAdd"], sent.HostConfig["Privileged"], sent.HostConfig["LogConfig"]], [["ALL"], [], false, { Type: "json-file", Config: { "max-size": "10m", "max-file": "3" } }]);
});

test("a computer's network is its own, joined only by its own container and the ingress; nothing of another computer's", async (t) => {
  const w = await world();
  t.after(w.close);
  assert.equal((await w.call("POST", "/networks/create", { Name: computerNet(A), Driver: "bridge", Labels: { "vyre.computer": A } })).status, 200);
  assert.equal((await w.call("POST", "/networks/create", { Name: computerNet(B), Driver: "bridge", Labels: { "vyre.computer": A } })).status, 403, "a name that is not its computer's");
  assert.equal((await w.call("POST", "/networks/create", { Name: computerNet(A), Driver: "macvlan", Labels: { "vyre.computer": A } })).status, 403, "not a bridge");
  assert.equal((await w.call("POST", "/networks/create", { Name: computerNet(A), Labels: { "vyre.computer": A }, Options: { "com.docker.network.bridge.name": "eth0" } })).status, 403, "a driver option");
  assert.equal((await w.call("POST", "/networks/create", { Name: computerNet(A), Labels: { "vyre.computer": A }, IPAM: { Config: [{ Subnet: "10.0.0.0/8" }] } })).status, 403, "its own address range");
  const join = (net: string, who: string) => w.call("POST", `/networks/${net}/connect`, { Container: who });
  assert.equal((await join(computerNet(A), computerName(A))).status, 200, "its own container");
  assert.equal((await join(computerNet(A), "vyred")).status, 200, "the ingress");
  assert.equal((await join(computerNet(A), computerName(B))).status, 403, "another computer's container");
  assert.equal((await join(computerNet(A), "site1")).status, 403, "a site's container");
  assert.equal((await join(computerNet(A), "other")).status, 403, "a container that is not Vyre's");
  assert.equal((await join(computerNet(A), "helperA")).status, 403, "the removal helper stays off every network");
  assert.equal((await w.call("DELETE", `/networks/${computerNet(A)}`)).status, 200);
  assert.equal((await w.call("GET", "/networks/bridge")).status, 403);
});

test("a computer's container may be asked to run, to be read and written inside its own home, and nothing else; another container, never", async (t) => {
  const w = await world();
  t.after(w.close);
  const c = computerName(A);
  for (const [m, p] of [["POST", `/containers/${c}/start`], ["POST", `/containers/${c}/stop?t=10`], ["GET", `/containers/${c}/json`], ["DELETE", `/containers/${c}?force=true&v=true`], ["GET", `/containers/${c}/archive?path=${encodeURIComponent("/home/agent/.")}`], ["PUT", `/containers/${c}/archive?path=${encodeURIComponent("/home/agent")}`]] as const) {
    assert.equal((await w.call(m, p)).status, 200, `${m} ${p}`);
  }
  for (const [m, p] of [["GET", `/containers/${c}/archive?path=/etc`], ["PUT", `/containers/${c}/archive?path=/home/agent/../../etc`], ["PUT", `/containers/${c}/archive?path=/`], ["GET", `/containers/${c}/archive?path=/home/agentx`], ["POST", `/containers/${c}/wait`], ["POST", "/containers/vyred/exec"], ["POST", "/containers/vyred/stop"], ["DELETE", "/containers/vyred"], ["GET", "/containers/other/archive?path=/home/agent"]] as const) {
    assert.equal((await w.call(m, p, m === "POST" ? { Cmd: ["sh"] } : undefined)).status, 403, `${m} ${p}`);
  }
  assert.equal((await w.call("POST", `/containers/${c}/exec`, { Cmd: ["/opt/agentd/ctl", "status", "{}"], Privileged: true })).status, 403, "a privileged exec");
  assert.equal((await w.call("POST", `/containers/${c}/exec`, { Cmd: ["id"], User: "root" })).status, 403, "an exec as another user");
  const ex = await w.call("POST", `/containers/${c}/exec`, { Cmd: ["/opt/agentd/ctl", "status", "{}"], AttachStdout: true, Env: [] });
  assert.equal(ex.status, 201, ex.body);
  assert.equal((await w.call("POST", `/exec/${"e".repeat(64)}/start`, {})).status, 200);
  assert.equal((await w.call("POST", `/exec/${"f".repeat(64)}/start`, {})).status, 403, "an exec the runner did not make");
  // a site's container is still a site's: no archive read of its home, no wait
  assert.equal((await w.call("GET", "/containers/site1/archive?path=/home/agent")).status, 403);
  assert.equal((await w.call("POST", "/containers/site1/wait")).status, 403);
});

test("volumes, images and pulls: only an agent computer's profile volume may be removed, the agent computer image read or pulled", async (t) => {
  const w = await world();
  t.after(w.close);
  assert.equal((await w.call("DELETE", `/volumes/${computerName(A)}-profile?force=true`)).status, 200);
  assert.equal((await w.call("DELETE", "/volumes/vyre-data")).status, 403, "Vyre's own data volume");
  assert.equal((await w.call("DELETE", "/volumes/some-other-volume")).status, 403);
  assert.equal((await w.call("GET", "/images/vyre/agent-computer:1/json")).status, 200);
  assert.equal((await w.call("GET", "/images/alpine:latest/json")).status, 403);
  assert.equal((await w.call("POST", "/images/create?fromImage=vyre/agent-computer&tag=1")).status, 200);
  assert.equal((await w.call("POST", "/images/create?fromImage=alpine&tag=latest")).status, 403);
});

test("the removal helper: only the fixed script on no network, sharing only its own computer's volumes, removing only inside the computer's home", async (t) => {
  const w = await world();
  t.after(w.close);
  const name = `${computerName(A)}-home-rm`;
  const body = (over: Record<string, unknown> = {}, h: Record<string, unknown> = {}) => ({
    Image: "vyre/agent-computer:1", Entrypoint: [], Labels: { "vyre.computer": A, "vyre.helper": "home-rm" }, Cmd: ["sh", "-c", HOME_RM_SCRIPT, "sh", "/home/agent/Vyre/a.txt", "::", "/home/agent/Vyre/d"], User: "10001:10001", NetworkDisabled: true,
    HostConfig: { VolumesFrom: [computerName(A)], CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges:true"], NetworkMode: "none", Privileged: false, AutoRemove: false, ...h }, ...over,
  });
  const create = (b: unknown, n = name) => w.call("POST", `/containers/create?name=${n}`, b);
  assert.equal((await create(body())).status, 201);
  for (const [what, b] of [
    ["another script", body({ Cmd: ["sh", "-c", "cat /etc/shadow"] })],
    ["a path outside the home", body({ Cmd: ["sh", "-c", HOME_RM_SCRIPT, "sh", "/etc/passwd", "::"] })],
    ["a path that climbs out", body({ Cmd: ["sh", "-c", HOME_RM_SCRIPT, "sh", "/home/agent/../../etc/passwd", "::"] })],
    ["another computer's volumes", body({}, { VolumesFrom: [computerName(B)] })],
    ["a network", body({}, { NetworkMode: "bridge" })],
    ["a host folder", body({}, { Binds: ["/:/host"] })],
    ["no helper label", body({ Labels: { "vyre.computer": A } })],
  ] as const) assert.equal((await create(b)).status, 403, what);
  assert.equal((await w.call("POST", `/containers/${name}/start`)).status, 404, "a helper that was not made is not there");
  // the same script is the one home-fs.ts runs
  assert.ok(readFileSync(new URL("../../../modules/computers/handlers/home-fs.ts", import.meta.url), "utf8").includes(HOME_RM_SCRIPT.replace(/\\/g, "\\\\")) || readFileSync(new URL("../../../modules/computers/handlers/home-fs.ts", import.meta.url), "utf8").includes(HOME_RM_SCRIPT), "the policy and the module hold the same script");
});
