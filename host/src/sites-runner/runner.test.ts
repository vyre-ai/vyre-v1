// The sites runner refuses everything a site does not need, with a fake Docker behind it that records what reaches it: a privileged container, a host folder, a host network, another
// label, a capability, an image that is not the site's, exec into a container that is not a site's, an exec it did not make, a network, a pull of anything but the two databases, and
// a call without its token. What it lets through reaches Docker with the caps and the log rotation written in.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createSitesRunner } from "./server.ts";

const SITE = "sit_01abc", HEX = "01abc";
const good = (o: Record<string, unknown> = {}, h: Record<string, unknown> = {}) => ({
  Image: `vyre-site/${HEX}:dpl1`, Env: ["PORT=3000"], Labels: { "vyre.site": SITE, "vyre.kind": "app" }, ...o,
  HostConfig: { NetworkMode: `vyre-site-${HEX}`, NanoCpus: 1e9, Memory: 512 * 1024 * 1024, MemorySwap: 512 * 1024 * 1024, PidsLimit: 512, CapDrop: ["ALL"], CapAdd: ["NET_BIND_SERVICE"], SecurityOpt: ["no-new-privileges"], ...h },
});

async function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-runner-test-"));
  const seen: Array<{ method: string; url: string; body: string }> = [];
  const labels: Record<string, Record<string, string>> = { site1: { "vyre.site": SITE, "vyre.kind": "postgres" }, site2: { "vyre.site": "sit_02zzz", "vyre.kind": "app" }, vyred: { "com.docker.compose.service": "vyred", "vyre.ingress": "1" }, other: { "com.docker.compose.service": "postgres" } };
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
  const call = (method: string, p: string, body?: unknown, token = "t0ken") => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const r = http.request({ socketPath: path.join(dir, "runner.sock"), method, path: p, headers: { authorization: `Bearer ${token}`, ...(data ? { "content-type": "application/json", "content-length": data.length } : {}) } }, (res) => { let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => resolve({ status: res.statusCode ?? 0, body: t })); });
    r.on("error", reject); r.end(data);
  });
  const close = async (): Promise<void> => { await runner.close(); fake.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return { call, seen, close };
}

test("refusals: privileged, host folders, host network, other labels, capabilities, other images, namespaces, ports", async (t) => {
  const w = await world();
  t.after(w.close);
  const create = (body: unknown, name = `vyre-site-${HEX}-dpl1`) => w.call("POST", `/v1.47/containers/create?name=${name}`, body);
  const refused: Array<[string, unknown, string?]> = [
    ["privileged", good({}, { Privileged: true }), "privileged"],
    ["a host folder", good({}, { Binds: ["/etc:/host-etc"] }), "host folders"],
    ["a host folder by Mounts", good({}, { Mounts: [{ Type: "bind", Source: "/", Target: "/h" }] }), "Mounts"],
    ["another site's volume", good({ Labels: { "vyre.site": SITE, "vyre.kind": "postgres" }, Image: "postgres:16-alpine" }, { Binds: ["vyre-site-zzz-postgres-data:/var/lib/postgresql/data"] }), "host folders"],
    ["the host network", good({}, { NetworkMode: "host" }), "network"],
    ["another site's network", good({}, { NetworkMode: "vyre-site-zzz" }), "network"],
    ["the ingress label", good({ Labels: { "vyre.site": SITE, "vyre.kind": "app", "vyre.ingress": "1" } }), "ingress"],
    ["the host pid namespace", good({}, { PidMode: "host" }), "PidMode"],
    ["a device", good({}, { Devices: [{ PathOnHost: "/dev/sda" }] }), "Devices"],
    ["a published port", good({}, { PortBindings: { "3000/tcp": [{ HostPort: "80" }] } }), "PortBindings"],
    ["SYS_ADMIN", good({}, { CapAdd: ["SYS_ADMIN"] }), "capability"],
    ["seccomp off", good({}, { SecurityOpt: ["seccomp=unconfined"] }), "security option"],
    ["no memory cap", good({}, { Memory: 0 }), "memory"],
    ["no process cap", good({}, { PidsLimit: 0 }), "process"],
    ["no label", good({ Labels: {} }), "vyre.site"],
    ["another label", good({ Labels: { "com.docker.compose.service": "vyred" } }), "vyre.site"],
    ["another site's image", good({ Image: "vyre-site/zzz:dpl1" }), "image"],
    ["any image", good({ Image: "alpine:latest" }), "image"],
  ];
  for (const [what, body, why] of refused) {
    const r = await create(body);
    assert.equal(r.status, 403, `${what}: ${r.body}`);
    if (why) assert.match(r.body, new RegExp(why, "i"), what);
  }
  assert.equal((await create(good(), "vyred")).status, 403, "a name that is not a site container's");
  assert.equal((await create(good(), `vyre-site-zzz-dpl1`)).status, 403, "a name of another site");
  assert.equal(w.seen.filter((s) => s.url.includes("/containers/create")).length, 0, "nothing refused reached Docker");
  const ok = await create(good());
  assert.equal(ok.status, 201, ok.body);
  const sent = JSON.parse(w.seen.at(-1)!.body) as { HostConfig: Record<string, unknown> };
  assert.deepEqual(sent.HostConfig["CapDrop"], ["ALL"]);
  assert.deepEqual(sent.HostConfig["LogConfig"], { Type: "json-file", Config: { "max-size": "10m", "max-file": "3" } });
  assert.equal(sent.HostConfig["Privileged"], false);
});

test("refusals: containers that are not a site's, execs, networks, volumes, pulls, builds, and the token", async (t) => {
  const w = await world();
  t.after(w.close);
  assert.equal((await w.call("GET", "/_ping", undefined, "wrong")).status, 401);
  assert.equal((await w.call("GET", "/_ping")).status, 200);
  for (const [m, p] of [["POST", "/containers/vyred/exec"], ["POST", "/containers/vyred/stop"], ["DELETE", "/containers/vyred"], ["GET", "/containers/vyred/logs"]] as const) {
    const r = await w.call(m, p, m === "POST" ? { Cmd: ["sh"] } : undefined);
    assert.equal(r.status, 403, `${m} ${p}: ${r.body}`);
  }
  assert.equal((await w.call("POST", "/containers/site1/exec", { Cmd: ["sh"], Privileged: true })).status, 403, "a privileged exec");
  assert.equal((await w.call("POST", "/containers/site1/exec", { Cmd: ["sh"], User: "root" })).status, 403, "an exec as another user");
  const ex = await w.call("POST", "/containers/site1/exec", { Cmd: ["pg_isready"], AttachStdout: true });
  assert.equal(ex.status, 201, ex.body);
  assert.equal((await w.call("POST", `/exec/${"f".repeat(64)}/start`, {})).status, 403, "an exec the runner did not make");
  assert.equal((await w.call("POST", `/exec/${"e".repeat(64)}/start`, {})).status, 200);
  assert.equal((await w.call("PUT", "/containers/site1/archive?path=/etc")).status, 403, "a file anywhere but /tmp");
  // networks: a site's own, joined only by its containers and the ingress
  assert.equal((await w.call("POST", "/networks/create", { Name: `vyre-site-${HEX}`, Driver: "bridge", Labels: { "vyre.site": SITE } })).status, 200);
  assert.equal((await w.call("POST", "/networks/create", { Name: "vyre-site-zzz", Driver: "bridge", Labels: { "vyre.site": SITE } })).status, 403, "a network named for another site");
  assert.equal((await w.call("POST", "/networks/create", { Name: `vyre-site-${HEX}`, Driver: "macvlan", Labels: { "vyre.site": SITE } })).status, 403, "not a bridge");
  assert.equal((await w.call("POST", "/networks/create", { Name: `vyre-site-${HEX}`, Labels: { "vyre.site": SITE }, Options: { "com.docker.network.bridge.name": "eth0" } })).status, 403, "driver options");
  assert.equal((await w.call("POST", `/networks/vyre-site-${HEX}/connect`, { Container: "site1" })).status, 200, "the site's own container");
  assert.equal((await w.call("POST", `/networks/vyre-site-${HEX}/connect`, { Container: "vyred" })).status, 200, "the ingress");
  assert.equal((await w.call("POST", `/networks/vyre-site-${HEX}/connect`, { Container: "site2" })).status, 403, "another site's container");
  assert.equal((await w.call("POST", `/networks/vyre-site-${HEX}/connect`, { Container: "other" })).status, 403, "a container that is not a site's");
  for (const [m, p] of [["POST", "/networks/vyre-sites/connect"], ["GET", "/networks/bridge"], ["POST", "/networks/bridge/connect"], ["POST", `/networks/vyre-site-${HEX}/disconnect`], ["DELETE", "/volumes/mydata"], ["POST", "/images/create?fromImage=alpine&tag=latest"], ["DELETE", "/images/alpine:latest"], ["POST", "/containers/prune"], ["GET", "/containers/json"], ["POST", "/swarm/init"], ["GET", "/info"], ["POST", "/build?t=evil:1"], ["POST", `/build?t=vyre-site/${HEX}:d1&labels=${encodeURIComponent(JSON.stringify({ "vyre.site": SITE }))}&networkmode=host`], ["POST", `/build?t=vyre-site/zzz:d1&labels=${encodeURIComponent(JSON.stringify({ "vyre.site": SITE }))}`]] as const) {
    assert.equal((await w.call(m, p)).status, 403, `${m} ${p}`);
  }
  assert.equal((await w.call("POST", "/images/create?fromImage=postgres&tag=16-alpine")).status, 200, "the database images may be fetched");
  const b = await w.call("POST", `/build?t=vyre-site/${HEX}:d1&labels=${encodeURIComponent(JSON.stringify({ "vyre.site": SITE }))}&memory=999999999999`);
  assert.equal(b.status, 200, b.body);
  const q = new URL(`http://x${w.seen.at(-1)!.url}`).searchParams;
  assert.equal(q.get("memory"), String(4 * 1024 ** 3), "the build's memory is capped");
});
