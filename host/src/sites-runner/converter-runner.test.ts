// The runner and the Word converter (lane r42-docs): what it refuses, rule by rule, and what it lets through. A fake Docker behind the runner records what arrives; nothing refused reaches it.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createSitesRunner } from "./server.ts";
import { CONV_MAX, converterAllows } from "./converter-policy.ts";
import { createDocConverter, socketEngine } from "../seams/doc-converter.ts";

const DIGEST = `ghcr.io/vyre-ai/doc-converter@sha256:${"ab".repeat(32)}`;
const NAME = "vyre-conv-0123456789abcdef";
const good = (over: Record<string, unknown> = {}, h: Record<string, unknown> = {}) => ({
  Image: DIGEST,
  User: "10002:10002",
  NetworkDisabled: true,
  Labels: { "vyre.conv": "1" },
  ...over,
  HostConfig: {
    NetworkMode: "none",
    CapDrop: ["ALL"],
    SecurityOpt: ["no-new-privileges"],
    Memory: 1024 ** 3,
    PidsLimit: 256,
    Tmpfs: { "/tmp": "rw,size=256m,uid=10002,gid=10002" },
    ...h,
  },
});

async function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "convrun-"));
  const seen: { method: string; url: string; body: string }[] = [];
  const labels: Record<string, Record<string, string>> = {
    conv: { "vyre.conv": "1" },
    [`${"c".repeat(64)}`]: { "vyre.conv": "1" },
    site: { "vyre.site": "sit_x" },
    ws: { "vyre.workspace": "agt_dex" },
  };
  const fake = http.createServer((q, s) => {
    const chunks: Buffer[] = [];
    q.on("data", (c: Buffer) => chunks.push(c));
    q.on("end", () => {
      seen.push({ method: q.method ?? "", url: q.url ?? "", body: Buffer.concat(chunks).toString() });
      const insp = /^\/containers\/([^/]+)\/json$/.exec(q.url ?? "");
      if (insp) {
        const l = labels[insp[1] as string];
        s.writeHead(l ? 200 : 404);
        s.end(JSON.stringify({ Id: insp[1], Config: { Labels: l ?? {} } }));
        return;
      }
      s.writeHead(/\/containers\/create/.test(q.url ?? "") ? 201 : /\/start$/.test(q.url ?? "") ? 204 : 200);
      s.end(JSON.stringify({ Id: "c".repeat(64) }));
    });
  });
  await new Promise<void>((r) => fake.listen(path.join(dir, "docker.sock"), r));
  const runner = createSitesRunner({
    dockerSocket: path.join(dir, "docker.sock"),
    listen: path.join(dir, "runner.sock"),
    token: "t0ken",
  });
  await runner.listening;
  const call = (method: string, p: string, body?: unknown) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const r = http.request(
        {
          socketPath: path.join(dir, "runner.sock"),
          method,
          path: p,
          headers: {
            authorization: "Bearer t0ken",
            ...(data ? { "content-type": "application/json", "content-length": data.length } : {}),
          },
        },
        (res) => {
          let t = "";
          res.on("data", (c) => (t += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: t }));
        },
      );
      r.on("error", reject);
      r.end(data);
    });
  return {
    call,
    seen,
    socket: path.join(dir, "runner.sock"),
    close: async () => {
      await runner.close();
      fake.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("a converter container is refused when it asks for anything a converter is never given, and nothing refused reaches Docker", async (t) => {
  const w = await world();
  t.after(w.close);
  const create = (body: unknown, n = NAME) => w.call("POST", `/v1.47/containers/create?name=${n}`, body);
  const refused: Array<[string, unknown, string, string?]> = [
    ["a tag instead of a digest", good({ Image: "ghcr.io/vyre-ai/doc-converter:1.0.0" }), "pinned by digest"],
    ["a local name", good({ Image: "vyre/doc-converter:1" }), "pinned by digest"],
    [
      "another repository by digest",
      good({ Image: `ghcr.io/evil/doc-converter@sha256:${"ab".repeat(32)}` }),
      "pinned by digest",
    ],
    [
      "another vyre image by digest",
      good({ Image: `ghcr.io/vyre-ai/vyre-browser@sha256:${"ab".repeat(32)}` }),
      "pinned by digest",
    ],
    ["a name that is not vyre-conv-<hex>", good(), "converter's vyre-conv-", "vyre-conv-x"],
    ["root", good({ User: "0:0" }), "runs as 10002"],
    ["a network", good({ NetworkDisabled: false }), "no network"],
    ["the bridge network", good({}, { NetworkMode: "bridge" }), "no network"],
    ["the host network", good({}, { NetworkMode: "host" }), "no network"],
    ["privileged", good({}, { Privileged: true }), "privileged"],
    ["a host folder", good({}, { Binds: ["/etc:/host-etc"] }), "HostConfig.Binds"],
    ["a volume", good({}, { Binds: ["vyre-ws-agt_dex-home:/home/agent:rw"] }), "HostConfig.Binds"],
    ["a mount by Mounts", good({}, { Mounts: [{ Type: "bind", Source: "/", Target: "/h" }] }), "HostConfig.Mounts"],
    ["a device", good({}, { Devices: [{ PathOnHost: "/dev/sda" }] }), "HostConfig.Devices"],
    ["a published port", good({}, { PortBindings: { "80/tcp": [{ HostPort: "80" }] } }), "HostConfig.PortBindings"],
    ["the host pid namespace", good({}, { PidMode: "host" }), "HostConfig.PidMode"],
    ["a shared ipc namespace", good({}, { IpcMode: "host" }), "HostConfig.IpcMode"],
    ["a capability added", good({}, { CapAdd: ["SYS_ADMIN"] }), "HostConfig.CapAdd"],
    ["capabilities not dropped", good({}, { CapDrop: [] }), "capability"],
    ["new privileges allowed", good({}, { SecurityOpt: [] }), "privileges"],
    ["seccomp off", good({}, { SecurityOpt: ["no-new-privileges", "seccomp=unconfined"] }), "security option"],
    ["no memory cap", good({}, { Memory: 0 }), "memory cap"],
    ["too much memory", good({}, { Memory: CONV_MAX.memory + 1 }), "memory cap"],
    ["no process cap", good({}, { PidsLimit: 0 }), "process cap"],
    ["too many processes", good({}, { PidsLimit: CONV_MAX.pids + 1 }), "process cap"],
    ["a tmpfs somewhere else", good({}, { Tmpfs: { "/etc": "rw,size=1m" } }), "/tmp"],
    ["a tmpfs that is too big", good({}, { Tmpfs: { "/tmp": "rw,size=4096m" } }), "/tmp"],
    ["a tmpfs with exec options", good({}, { Tmpfs: { "/tmp": "rw,size=64m,exec,suid" } }), "/tmp"],
    ["a command of its own", good({ Cmd: ["sh", "-c", "id"] }), "may not set Cmd"],
    ["an entrypoint of its own", good({ Entrypoint: ["sh"] }), "may not set Entrypoint"],
    ["environment", good({ Env: ["X=1"] }), "may not set Env"],
    ["a working directory", good({ WorkingDir: "/" }), "may not set WorkingDir"],
    ["another label", good({ Labels: { "vyre.conv": "1", "vyre.site": "sit_x" } }), "label vyre.site"],
    ["no converter label", good({ Labels: {} }), "vyre.conv=1"],
    ["no limits", { ...good(), HostConfig: undefined }, "needs its limits"],
  ];
  for (const [what, body, why, n] of refused) {
    const before = w.seen.length;
    const r = await create(body, n ?? NAME);
    assert.equal(r.status, 403, `${what}: ${r.body}`);
    assert.match(r.body, new RegExp(why.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), what);
    assert.equal(w.seen.length, before, `${what}: refused before Docker`);
  }
  // a good one goes through, with every hardening written in, whatever the caller sent
  const ok = await create(good({}, {}));
  assert.equal(ok.status, 201, ok.body);
  const sent = JSON.parse(w.seen.at(-1)!.body) as { HostConfig: Record<string, unknown>; NetworkDisabled: boolean };
  assert.equal(sent.NetworkDisabled, true);
  assert.equal(sent.HostConfig["NetworkMode"], "none");
  assert.equal(sent.HostConfig["Privileged"], false);
  assert.deepEqual(sent.HostConfig["CapDrop"], ["ALL"]);
  assert.equal(sent.HostConfig["MemorySwap"], sent.HostConfig["Memory"], "no swap");
});

test("the converter image may be fetched and read by digest only, never by tag, local name or any other repository", async (t) => {
  const w = await world();
  t.after(w.close);
  const pull = (q: string) => w.call("POST", `/images/create?${q}`);
  assert.equal((await pull(`fromImage=${encodeURIComponent(DIGEST)}`)).status, 200);
  for (const bad of [
    "fromImage=ghcr.io/vyre-ai/doc-converter&tag=1.0.0",
    "fromImage=ghcr.io/vyre-ai/doc-converter&tag=latest",
    "fromImage=vyre/doc-converter&tag=1",
    `fromImage=${encodeURIComponent(`ghcr.io/evil/doc-converter@sha256:${"ab".repeat(32)}`)}`,
    `fromImage=${encodeURIComponent(DIGEST)}&platform=linux/amd64`,
  ])
    assert.equal((await pull(bad)).status, 403, bad);
  assert.equal((await w.call("GET", `/images/${encodeURIComponent(DIGEST)}/json`)).status, 200);
  assert.equal(
    (await w.call("GET", `/images/${encodeURIComponent("ghcr.io/vyre-ai/doc-converter:1")}/json`)).status,
    403,
  );
  assert.equal(
    (await w.call("DELETE", `/images/${encodeURIComponent(DIGEST)}`)).status,
    403,
    "an image is never removed",
  );
});

test("a converter container may be started, waited for, read, removed, and have one file copied in and one out; nothing else, and no other container is reachable this way", async (t) => {
  const w = await world();
  t.after(w.close);
  const ok: Array<[string, string]> = [
    ["POST", "/containers/conv/start"],
    ["POST", "/containers/conv/wait"],
    ["GET", "/containers/conv/json"],
    ["DELETE", "/containers/conv?force=true&v=true"],
    ["PUT", "/containers/conv/archive?path=%2Fin"],
    ["GET", "/containers/conv/archive?path=%2Fout%2Fin.pdf"],
  ];
  for (const [m, p] of ok) assert.ok([200, 204].includes((await w.call(m, p)).status), `${m} ${p}`);
  const no: Array<[string, string]> = [
    ["POST", "/containers/conv/exec"],
    ["GET", "/containers/conv/logs?stdout=1"],
    ["POST", "/containers/conv/stop"],
    ["POST", "/containers/conv/restart"],
    ["POST", "/containers/conv/start?detachKeys=x"],
    ["DELETE", "/containers/conv?link=true"],
    ["PUT", "/containers/conv/archive?path=%2F"],
    ["PUT", "/containers/conv/archive?path=%2Fetc"],
    ["PUT", "/containers/conv/archive?path=%2Fin&noOverwriteDirNonDir=1"],
    ["GET", "/containers/conv/archive?path=%2Fetc%2Fshadow"],
    ["GET", "/containers/conv/archive?path=%2Fout"],
    ["GET", "/containers/conv/archive?path=%2Fin"],
    ["PUT", "/containers/conv/archive?path=%2Fout%2Fin.pdf"],
  ];
  for (const [m, p] of no) {
    const before = w.seen.length;
    const r = await w.call(m, p);
    assert.equal(r.status, 403, `${m} ${p}: ${r.body}`);
    assert.equal(w.seen.length, before + 1, "only the label lookup reached Docker");
    assert.match(w.seen.at(-1)!.url, /\/json$/);
  }
  // a site's or workspace's container does not get the converter's permissions, and a converter's does not get theirs
  assert.equal((await w.call("PUT", "/containers/ws/archive?path=%2Fin")).status, 403);
  assert.equal(converterAllows("exec", "POST"), false);
  assert.equal(converterAllows("archive", "PUT", new URLSearchParams("path=/in")), true);
});

test("the converter name pattern is the only way to create one: a vyre-conv name with the wrong shape, or one that is a workspace's or computer's, is judged by its own rules", async (t) => {
  const w = await world();
  t.after(w.close);
  for (const n of ["vyre-conv-", "vyre-conv-XYZ", "vyre-conv-0123456789abcdef0", "vyre-conv-0123456789ABCDEF"]) {
    const r = await w.call("POST", `/containers/create?name=${n}`, good());
    assert.equal(r.status, 403, n);
  }
});

test("what the real converter seam sends is what this policy lets through: every call it makes reaches Docker, none is refused", async (t) => {
  const w = await world();
  t.after(w.close);
  const conv = createDocConverter({
    engine: socketEngine(w.socket, () => ({ authorization: "Bearer t0ken" })),
    image: DIGEST,
  });
  // the fake Docker has no PDF to hand back, so the conversion ends there; what matters is that no step before it was refused
  await assert.rejects(
    conv.pdf(new Uint8Array([1, 2, 3])),
    (e: Error) => !/Refused by the sites runner|\(403\)/.test(e.message),
  );
  const calls = w.seen.map(
    (s) => `${s.method} ${s.url.split("?")[0]!.replace(/[0-9a-f]{64}|vyre-conv-[0-9a-f]{16}/g, "ID")}`,
  );
  for (const want of [
    "POST /containers/create",
    "PUT /containers/ID/archive",
    "POST /containers/ID/start",
    "POST /containers/ID/wait",
  ])
    assert.ok(calls.includes(want), `${want} in ${calls.join(" | ")}`);
  assert.ok(
    calls.some((c) => c.startsWith("DELETE /containers/")),
    "the container is removed after a failed conversion too",
  );
});
