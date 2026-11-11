// The runner and the Space browser (images/space-browser): the one container `vyre-sbrowser` with its own volume and network, and what the runner refuses for it (privileged, a host folder, a computer's or a
// site's network, a capability, another image or label or name, an archive, a wait). What it lets through reaches Docker with the drop of every capability and the log rotation written in. A fake Docker
// behind the runner records what arrives, as in computers-runner.test.ts.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createSitesRunner } from "./server.ts";
import { SBROWSER_NAME, SBROWSER_NET, SBROWSER_VOLUME, computerName, computerNet, isSbrowserImage, sbrowserAllows } from "./computers-policy.ts";

const A = "cmt_01a1b2c3-d4e5-4f60-8a7b-0123456789ab";
const SECCOMP = JSON.stringify({ defaultAction: "SCMP_ACT_ERRNO", syscalls: [] });
const good = (over: Record<string, unknown> = {}, h: Record<string, unknown> = {}) => ({
  Image: "vyre/space-browser:1", Hostname: SBROWSER_NAME, User: "", WorkingDir: "/home/browser", Cmd: [], Env: ["VYRE_BROWSER_MAX_RUNNING=6", "VYRE_BROWSER_IDLE_MINUTES=10"],
  Labels: { "vyre.sbrowser": "1" }, StopTimeout: 10, ...over,
  HostConfig: {
    Binds: [`${SBROWSER_VOLUME}:/data:rw`], ReadonlyRootfs: false, Tmpfs: { "/tmp": "rw,size=512m", "/dev/shm": "rw,size=1g" }, CapDrop: ["ALL"], CapAdd: [],
    SecurityOpt: ["no-new-privileges:true", `seccomp=${SECCOMP}`], Privileged: false, NetworkMode: SBROWSER_NET, PidMode: "", IpcMode: "private", UsernsMode: "", Devices: [], PidsLimit: 2048,
    Memory: 3 * 1024 ** 3, MemorySwap: 3 * 1024 ** 3, NanoCpus: 2e9, Init: true, AutoRemove: false, Ulimits: [{ Name: "nofile", Soft: 16384, Hard: 32768 }], ExtraHosts: [], Dns: [], ...h,
  },
});

async function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-runner-sbr-"));
  const seen: Array<{ method: string; url: string; body: string }> = [];
  const labels: Record<string, Record<string, string>> = {
    [SBROWSER_NAME]: { "vyre.sbrowser": "1" }, [computerName(A)]: { "vyre.computer": A, "vyre.agent": "agt_1" }, site1: { "vyre.site": "sit_01abc", "vyre.kind": "app" }, vyred: { "vyre.ingress": "1" }, other: {},
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

test("the Space browser container is refused when it asks for anything it is never given, and nothing refused reaches Docker", async (t) => {
  const w = await world();
  t.after(w.close);
  const create = (body: unknown, name = SBROWSER_NAME) => w.call("POST", `/v1.47/containers/create?name=${name}`, body);
  const refused: Array<[string, unknown, string]> = [
    ["privileged", good({}, { Privileged: true }), "privileged"],
    ["a host folder", good({}, { Binds: ["/etc:/host-etc"] }), "host folders"],
    ["a computer's profile volume", good({}, { Binds: [`${computerName(A)}-profile:/data:rw`] }), "host folders"],
    ["the Docker socket", good({}, { Binds: ["/var/run/docker.sock:/var/run/docker.sock"] }), "host folders"],
    ["the host network", good({}, { NetworkMode: "host" }), "own network"],
    ["the default bridge", good({}, { NetworkMode: "bridge" }), "own network"],
    ["a computer's network", good({}, { NetworkMode: computerNet(A) }), "own network"],
    ["the host pid namespace", good({}, { PidMode: "host" }), "pid"],
    ["a shared ipc namespace", good({}, { IpcMode: "host" }), "ipc"],
    ["a device", good({}, { Devices: [{ PathOnHost: "/dev/sda" }] }), "evices"],
    ["a published port", good({}, { PortBindings: { "7002/tcp": [{ HostPort: "7002" }] } }), "PortBindings"],
    ["SYS_ADMIN", good({}, { CapAdd: ["SYS_ADMIN"] }), "capability"],
    ["capabilities not dropped", good({}, { CapDrop: [] }), "capabilit"],
    ["new privileges allowed", good({}, { SecurityOpt: [`seccomp=${SECCOMP}`] }), "privileges"],
    ["seccomp off", good({}, { SecurityOpt: ["no-new-privileges:true", "seccomp=unconfined"] }), "seccomp"],
    ["a seccomp profile that allows all", good({}, { SecurityOpt: ["no-new-privileges:true", `seccomp=${JSON.stringify({ defaultAction: "SCMP_ACT_ALLOW" })}`] }), "seccomp"],
    ["no memory cap", good({}, { Memory: 0 }), "memory"],
    ["too much memory", good({}, { Memory: 64 * 1024 ** 3, MemorySwap: 64 * 1024 ** 3 }), "memory"],
    ["swap", good({}, { MemorySwap: 8 * 1024 ** 3 }), "swap"],
    ["no process cap", good({}, { PidsLimit: 0 }), "process"],
    ["too many CPUs", good({}, { NanoCpus: 64e9 }), "CPU"],
    ["extra hosts", good({}, { ExtraHosts: ["evil:10.0.0.1"] }), "extra hosts"],
    ["a tmpfs over /etc", good({}, { Tmpfs: { "/etc": "rw" } }), "tmpfs"],
    ["the agent computer image", good({ Image: "vyre/agent-computer:1" }), "image"],
    ["another image", good({ Image: "alpine:latest" }), "image"],
    ["another label", good({ Labels: { "vyre.sbrowser": "1", "com.docker.compose.service": "vyred" } }), "label"],
    ["the ingress label", good({ Labels: { "vyre.sbrowser": "1", "vyre.ingress": "1" } }), "label"],
    ["a computer's label", good({ Labels: { "vyre.computer": A } }), "vyre.sbrowser"],
    ["no label", good({ Labels: {} }), "vyre.sbrowser"],
    ["an environment variable of its own", good({ Env: ["SECRET=1"] }), "environment"],
    ["a token in the environment", good({ Env: ["VYRE_BROWSER_MAX_RUNNING=6", "VYRE_FILL_TOKEN=abc"] }), "environment"],
    ["another entrypoint", good({ Entrypoint: ["/bin/sh"] }), "Entrypoint"],
  ];
  for (const [what, body, why] of refused) {
    const r = await create(body);
    assert.equal(r.status, 403, `${what}: ${r.body}`);
    assert.match(r.body, new RegExp(why, "i"), what);
  }
  assert.equal((await create(good(), "vyre-sbrowser2")).status, 403, "another name");
  assert.equal((await create(good(), "vyred")).status, 403, "the ingress's name");
  assert.equal((await create(good(), computerName(A))).status, 403, "a computer's name with the Space browser's config");
  assert.equal(w.seen.filter((s) => s.url.includes("/containers/create")).length, 0, "nothing refused reached Docker");
  const ok = await create(good());
  assert.equal(ok.status, 201, ok.body);
  const sent = JSON.parse(w.seen.at(-1)!.body) as { HostConfig: Record<string, unknown> };
  assert.deepEqual([sent.HostConfig["CapDrop"], sent.HostConfig["CapAdd"], sent.HostConfig["Privileged"], sent.HostConfig["LogConfig"]], [["ALL"], [], false, { Type: "json-file", Config: { "max-size": "10m", "max-file": "3" } }]);
  const withDigest = await create(good({ Image: `ghcr.io/vyre-ai/space-browser@sha256:${"a".repeat(64)}` }));
  assert.equal(withDigest.status, 201, "the registry copy by digest");
  const released = await create(good({ Image: `ghcr.io/vyre-ai/vyre-browser@sha256:${"c".repeat(64)}` }));
  assert.equal(released.status, 201, "the release's registry copy (vyre-browser) by digest");
});

test("the Space browser's network is its own, joined only by its container and the ingress", async (t) => {
  const w = await world();
  t.after(w.close);
  assert.equal((await w.call("POST", "/networks/create", { Name: SBROWSER_NET, Driver: "bridge", Labels: { "vyre.sbrowser": "1" } })).status, 200);
  assert.equal((await w.call("POST", "/networks/create", { Name: SBROWSER_NET, Driver: "bridge", Labels: {} })).status, 403, "no label");
  assert.equal((await w.call("POST", "/networks/create", { Name: "vyre-sbrowsernet2", Driver: "bridge", Labels: { "vyre.sbrowser": "1" } })).status, 403, "another name");
  assert.equal((await w.call("POST", "/networks/create", { Name: SBROWSER_NET, Driver: "host", Labels: { "vyre.sbrowser": "1" } })).status, 403, "not a bridge");
  assert.equal((await w.call("POST", `/networks/${SBROWSER_NET}/connect`, { Container: SBROWSER_NAME })).status, 200, "its own container");
  assert.equal((await w.call("POST", `/networks/${SBROWSER_NET}/connect`, { Container: "vyred", EndpointConfig: { Aliases: ["vyre-host"] } })).status, 200, "the ingress");
  assert.equal((await w.call("POST", `/networks/${SBROWSER_NET}/connect`, { Container: computerName(A) })).status, 403, "an agent computer");
  assert.equal((await w.call("POST", `/networks/${SBROWSER_NET}/connect`, { Container: "site1" })).status, 403, "a site's container");
  assert.equal((await w.call("POST", `/networks/${SBROWSER_NET}/connect`, { Container: "other" })).status, 403, "anything else");
  assert.equal((await w.call("POST", `/networks/${computerNet(A)}/connect`, { Container: SBROWSER_NAME })).status, 403, "the Space browser does not join a computer's network");
  assert.equal((await w.call("GET", `/networks/${SBROWSER_NET}`)).status, 200);
  assert.equal((await w.call("DELETE", `/networks/${SBROWSER_NET}`)).status, 200);
});

test("the Space browser's container may be read, started, stopped, removed and run browserd in, and take Chrome's data into one profile's folder; never read out or waited on", async (t) => {
  const w = await world();
  t.after(w.close);
  for (const [m, p] of [["GET", `/containers/${SBROWSER_NAME}/json`], ["POST", `/containers/${SBROWSER_NAME}/start`], ["POST", `/containers/${SBROWSER_NAME}/stop?t=10`], ["DELETE", `/containers/${SBROWSER_NAME}`], ["GET", `/containers/${SBROWSER_NAME}/logs?stdout=1&tail=50`]] as const) {
    assert.equal((await w.call(m, p)).status, 200, `${m} ${p}`);
  }
  assert.equal((await w.call("POST", `/containers/${SBROWSER_NAME}/exec`, { Cmd: ["/opt/browserd/ctl", "status", "{}"], Env: [], AttachStdout: true, Privileged: true })).status, 403, "an exec is never privileged");
  assert.equal((await w.call("POST", `/containers/${SBROWSER_NAME}/exec`, { Cmd: ["/opt/browserd/ctl", "status", "{}"], Env: [], AttachStdout: true, Tty: true })).status, 403, "and never a TTY");
  const exec = await w.call("POST", `/containers/${SBROWSER_NAME}/exec`, { Cmd: ["/opt/browserd/ctl", "status", "{}"], Env: [], AttachStdout: true, AttachStderr: true });
  assert.equal(exec.status, 201, exec.body);
  const sent = JSON.parse(w.seen.filter((s) => s.url.endsWith("/exec")).at(-1)!.body) as { Tty: boolean; Privileged: boolean };
  assert.deepEqual([sent.Tty, sent.Privileged], [false, false]);
  assert.equal((await w.call("PUT", `/containers/${SBROWSER_NAME}/archive?path=/data`, {})).status, 403, "no archive over the whole volume");
  assert.equal((await w.call("PUT", `/containers/${SBROWSER_NAME}/archive?path=/data/profiles/../x`, {})).status, 403);
  assert.equal((await w.call("PUT", `/containers/${SBROWSER_NAME}/archive?path=/etc`, {})).status, 403);
  assert.equal((await w.call("GET", `/containers/${SBROWSER_NAME}/archive?path=/data/profiles/agt_dex`)).status, 403, "nothing is read out");
  assert.equal((await w.call("PUT", `/containers/${SBROWSER_NAME}/archive?path=/data/profiles/agt_dex`, {})).status, 200, "Chrome's data goes into one profile's folder");
  assert.equal((await w.call("POST", `/containers/${SBROWSER_NAME}/wait`)).status, 403, "no wait");
  assert.equal((await w.call("POST", `/containers/other/start`)).status, 403, "a container that is not Vyre's");
  assert.equal(sbrowserAllows("exec", "POST", new URLSearchParams()), true);
  assert.equal(sbrowserAllows("archive", "GET", new URLSearchParams("path=/data/profiles/agt_dex")), false);
  assert.equal(sbrowserAllows("archive", "PUT", new URLSearchParams("path=/data/profiles/agt_dex")), true);
});

test("the Space browser image may be fetched and read, by tag or by digest, and no other; its volume may be removed and no other", async (t) => {
  const w = await world();
  t.after(w.close);
  assert.equal((await w.call("POST", "/images/create?fromImage=vyre/space-browser&tag=1")).status, 403, "a bare vyre/... name would be looked for on Docker Hub, which is not Vyre's: never fetched");
  assert.equal((await w.call("POST", "/images/create?fromImage=ghcr.io/vyre-ai/space-browser&tag=1.0.0-rc.23")).status, 200);
  assert.equal((await w.call("POST", `/images/create?fromImage=${encodeURIComponent(`ghcr.io/vyre-ai/space-browser@sha256:${"b".repeat(64)}`)}`)).status, 200, "by digest");
  assert.equal((await w.call("POST", "/images/create?fromImage=evil/space-browser&tag=1")).status, 403);
  assert.equal((await w.call("POST", "/images/create?fromImage=ghcr.io/vyre-ai/space-browser-evil&tag=1")).status, 403);
  assert.equal((await w.call("POST", "/images/create?fromImage=ghcr.io/vyre-ai/vyre-browser&tag=1.0.0-rc.23")).status, 200, "the release's registry copy");
  assert.equal((await w.call("POST", `/images/create?fromImage=${encodeURIComponent(`ghcr.io/vyre-ai/vyre-browser@sha256:${"d".repeat(64)}`)}`)).status, 200, "the release's copy by digest");
  assert.equal((await w.call("POST", "/images/create?fromImage=ghcr.io/vyre-ai/vyre-browser-evil&tag=1")).status, 403);
  assert.equal((await w.call("GET", `/images/${encodeURIComponent("vyre/space-browser:1")}/json`)).status, 200);
  assert.equal((await w.call("GET", `/images/${encodeURIComponent("alpine:latest")}/json`)).status, 403);
  assert.equal((await w.call("DELETE", `/volumes/${SBROWSER_VOLUME}?force=true`)).status, 200);
  assert.equal((await w.call("DELETE", `/volumes/${SBROWSER_VOLUME}2`)).status, 403);
  assert.equal((await w.call("DELETE", `/volumes/vyre-comp-${A.replace(/^cmt_/, "")}-profile`)).status, 200, "a computer's profile volume still goes by its own rule");
  assert.equal(isSbrowserImage("vyre/space-browser:1"), true);
  assert.equal(isSbrowserImage("vyre/agent-computer:1"), false);
});
