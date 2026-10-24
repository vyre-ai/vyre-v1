// @heavy docker
// Real Docker: node, static and python sample repos build with the standard images, start on a private network and answer over HTTP;
// the repo's own Dockerfile is honoured; the layer cache is reused until a lockfile changes; env values reach the container; the container is hardened.
// Without a Docker daemon (or without the base images already on the host: nothing is pulled here, ARCH 10.2) every test here is skipped with its reason,
// so a skip is visible in the run and never reported as a pass of the real thing.
// S10 (public hostname through the relay passthrough) needs relay/worker from P-L10_02; its test is skipped until that package exists.
// @reads /images/site-builders/Dockerfile.node

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BuildRequest } from "../handlers/deploy.ts";
import { dockerRuntime, dockerfilePort, exposedPort, processExec } from "../handlers/builders.ts";
import type { FetchSource } from "../handlers/builders.ts";

const BASES = ["node:24-alpine", "python:3.13-slim", "caddy:2-alpine"];

function docker(args: string[]): string | null {
  try {
    return execFileSync("docker", args, { encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

const haveDocker = docker(["info", "--format", "{{.ServerVersion}}"]) !== null;
const missingBases = haveDocker ? BASES.filter((b) => docker(["image", "inspect", b]) === null) : BASES;
const skip = process.env["VYRE_HEAVY_DOCKER"] !== "1" ? "needs VYRE_HEAVY_DOCKER=1 (the 20 s shard never builds images)" : !haveDocker ? "no Docker daemon on this host" : missingBases.length > 0 ? `base images not on this host: ${missingBases.join(", ")}` : false;

const run = `${process.pid}${Math.random().toString(36).slice(2, 8)}`;
const NETWORK = `vyre-sites-test-${run}`;
const roots: string[] = [];
const containers: string[] = [];
const images = new Set<string>();

function repo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-builders-heavy-"));
  roots.push(dir);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

const NODE_SERVER = `const http = require("node:http");
http.createServer((req, res) => {
  if (req.url === "/env") { res.end(process.env.GREETING ?? "unset"); return; }
  res.end("node-sample " + process.env.PORT);
}).listen(Number(process.env.PORT));
`;
const PY_SERVER = `import os
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b"python-sample " + os.environ["PORT"].encode())
HTTPServer(("0.0.0.0", int(os.environ["PORT"])), H).serve_forever()
`;

const SAMPLES: Record<string, { files: Record<string, string>; expect: RegExp; port: number }> = {
  node: { files: { "package.json": JSON.stringify({ name: "n", scripts: { start: "node server.js" } }), "server.js": NODE_SERVER }, expect: /node-sample 3000/, port: 3000 },
  static: { files: { "index.html": "<h1>static-sample</h1>" }, expect: /static-sample/, port: 3000 },
  python: { files: { "requirements.txt": "", "app.py": PY_SERVER }, expect: /python-sample 3000/, port: 3000 },
  multistage: {
    files: { Dockerfile: 'FROM caddy:2-alpine AS first\nEXPOSE 9999\nFROM caddy:2-alpine\nCOPY index.html /srv/index.html\nEXPOSE 8081/tcp\nCMD ["caddy","file-server","--root","/srv","--listen",":8081"]\n', "index.html": "<h1>multi-stage</h1>" },
    expect: /multi-stage/, port: 8081,
  },
  dockerfile: {
    files: { Dockerfile: 'FROM caddy:2-alpine\nCOPY index.html /srv/index.html\nEXPOSE 8080\nCMD ["caddy","file-server","--root","/srv","--listen",":8080"]\n', "index.html": "<h1>own-dockerfile</h1>" },
    expect: /own-dockerfile/, port: 8080,
  },
};

function fetchFrom(dirs: Record<string, string>): FetchSource {
  return async (req) => {
    const from = dirs[req.siteId];
    if (from === undefined) throw new Error(`no sample for ${req.siteId}`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-builders-heavy-src-"));
    fs.cpSync(from, dir, { recursive: true });
    return { dir, commit: "e".repeat(40), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
  };
}

const sampleDirs: Record<string, string> = {};
const siteId = (k: string): string => `sit_${k}${run}`.toLowerCase();
const rt = dockerRuntime({
  exec: processExec(),
  fetchSource: async (req) => fetchFrom(sampleDirs)(req),
  envValue: async (ref) => (ref === "dpl:GREETING" ? "hello-from-vault" : ""),
});

function req(k: string, dep: string): BuildRequest {
  return { siteId: siteId(k), deploymentId: `dpl_${k}${dep}${run}`.toLowerCase(), kind: "site", repoUrl: "https://example.invalid/r.git", folderId: null, branch: "main" };
}

async function get(ip: string, port: number, urlPath = "/"): Promise<string> {
  let last = "";
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://${ip}:${port}${urlPath}`, { signal: AbortSignal.timeout(1000) });
      return await r.text();
    } catch (e) {
      last = String(e);
      await new Promise((r2) => setTimeout(r2, 250));
    }
  }
  throw new Error(`no answer from ${ip}:${port}: ${last}`);
}

function ipOf(containerId: string): string {
  const out = docker(["inspect", "--format", `{{(index .NetworkSettings.Networks "${NETWORK}").IPAddress}}`, containerId]);
  const why = (): string => `${docker(["inspect", "--format", "{{.Name}} {{.State.Status}} exit={{.State.ExitCode}}", containerId]) ?? "?"} ${(docker(["logs", "--tail", "15", containerId]) ?? "").slice(-600)}`;
  assert.ok(out && /^\d+\.\d+\.\d+\.\d+$/.test(out.trim()), `container has an address on ${NETWORK}: ${why()}`);
  return out.trim();
}

async function buildAndStart(k: string, dep: string, envRefs: { name: string; ref: string }[] = []) {
  const r = req(k, dep);
  const built = await rt.build(r);
  assert.equal(built.ok, true, built.log.slice(-15).join("\n"));
  assert.ok(built.image);
  images.add(built.image);
  const started = await rt.start({
    siteId: r.siteId, deploymentId: r.deploymentId, env: "staging", image: built.image, network: NETWORK,
    name: `site-${k}-${run}-${dep}`.toLowerCase(), envRefs, servicePrincipal: `svc_site_${k}`,
  });
  containers.push(started.containerId);
  return { built, started };
}

test("the port comes from the built Dockerfile, not from a base image's own EXPOSE lines", () => {
  assert.equal(dockerfilePort("FROM caddy:2-alpine\nEXPOSE 3000\n"), 3000);
  assert.equal(dockerfilePort("FROM a AS x\nEXPOSE 9999\nFROM caddy:2-alpine\nEXPOSE 8081/tcp 8082\n"), 8081, "the last stage decides");
  assert.equal(dockerfilePort("FROM a\nEXPOSE 53/udp\n"), null);
  assert.equal(dockerfilePort("FROM a\nEXPOSE $PORT\n"), null);
  assert.equal(dockerfilePort("FROM a\nCMD x\n"), null);
  assert.equal(exposedPort('{"ports":{"80/tcp":{},"443/tcp":{},"3000/tcp":{}},"label":"3000"}'), 3000, "the label beats the inherited 80");
  assert.equal(exposedPort('{"ports":{"80/tcp":{},"443/tcp":{}},"label":""}'), 80, "no label: the lowest exposed port");
  assert.equal(exposedPort('{"ports":null,"label":""}'), 3000);
  assert.equal(exposedPort('{"8080/tcp":{},"80/tcp":{}}'), 80, "a plain ExposedPorts map still reads");
});

test("setup", { skip }, () => {
  for (const [k, s] of Object.entries(SAMPLES)) sampleDirs[siteId(k)] = repo(s.files);
});

test("@heavy node, static, python and own-Dockerfile samples build and serve over the vyre-sites-style network", { skip }, async (t) => {
  const kinds = Object.keys(SAMPLES);
  // One at a time: the legacy builder on a host without buildx fails to restore its cache image when several builds share a base image at once.
  const results: Awaited<ReturnType<typeof buildAndStart>>[] = [];
  for (const k of kinds) results.push(await buildAndStart(k, "a"));
  for (const [i, k] of kinds.entries()) {
    const sample = SAMPLES[k]!;
    const { built, started } = results[i]!;
    assert.match(built.log[0] ?? "", /Detected/, `${k}: build log opens with what was detected`);
    assert.match(started.upstream, new RegExp(`:${sample.port}$`), `${k}: upstream port comes from the image`);
    const body = await get(ipOf(started.containerId), sample.port);
    assert.match(body, sample.expect, k);
  }
  t.diagnostic(`built and served ${kinds.length} samples`);
});

test("@heavy a started container is hardened: capabilities dropped, no new privileges, memory and process caps, no published ports", { skip }, async () => {
  const id = containers[0];
  assert.ok(id, "a container from the previous test");
  const info = JSON.parse(docker(["inspect", id]) ?? "[]")[0].HostConfig as { CapDrop: string[]; CapAdd: string[] | null; SecurityOpt: string[]; Memory: number; PidsLimit: number; PortBindings: Record<string, unknown>; Privileged: boolean };
  assert.deepEqual(info.CapDrop, ["ALL"]);
  // Caddy images carry a file capability for low ports; with every capability dropped such a binary cannot start (exit 255), so only that one comes back.
  assert.deepEqual((info.CapAdd ?? []).map((c) => c.replace(/^CAP_/, "")), ["NET_BIND_SERVICE"]);
  assert.ok(info.SecurityOpt.includes("no-new-privileges"));
  assert.equal(info.Memory, 512 * 1024 * 1024);
  assert.equal(info.PidsLimit, 256);
  assert.deepEqual(info.PortBindings ?? {}, {});
  assert.equal(info.Privileged, false);
});

test("@heavy the layer cache is reused until a lockfile changes", { skip }, async () => {
  const k = "node";
  const first = await rt.build(req(k, "b"));
  assert.equal(first.ok, true);
  assert.ok(first.image);
  images.add(first.image);
  // same lockfile and manifest, edited source: the install layer comes from cache
  const dir = sampleDirs[siteId(k)]!;
  fs.writeFileSync(path.join(dir, "server.js"), `${NODE_SERVER}// edited\n`);
  const second = await rt.build(req(k, "c"));
  assert.equal(second.ok, true);
  assert.ok(second.image);
  images.add(second.image);
  const keyOf = (log: string[]) => log.find((l) => l.startsWith("Lockfiles:"));
  assert.equal(keyOf(second.log), keyOf(first.log), "same cache key");
  assert.ok(second.log.some((l) => /CACHED|Using cache/.test(l)), `a layer is reported as cached:\n${second.log.slice(-25).join("\n")}`);
  // a changed manifest changes the key
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "n", description: "changed", scripts: { start: "node server.js" } }));
  const third = await rt.build(req(k, "d"));
  assert.equal(third.ok, true);
  if (third.image) images.add(third.image);
  assert.notEqual(keyOf(third.log), keyOf(first.log), "new manifest, new cache key");
});

test("@heavy environment values reach the container from the Vault reference and are not in docker's own record of the command line", { skip }, async () => {
  const { started } = await buildAndStart("static", "e", [{ name: "GREETING", ref: "dpl:GREETING" }]);
  const inspected = JSON.parse(docker(["inspect", started.containerId]) ?? "[]")[0] as { Config: { Env: string[] } };
  assert.ok(inspected.Config.Env.includes("GREETING=hello-from-vault"), "the container has the variable");
  const history = docker(["ps", "-a", "--no-trunc", "--format", "{{.Command}} {{.Names}}"]) ?? "";
  assert.ok(!history.includes("hello-from-vault"), "the value is not in any command line");
});

test("@heavy stop removes the container and logs read what it printed", { skip }, async () => {
  const id = containers[0]!;
  const lines = await rt.logs(id, 20);
  assert.ok(Array.isArray(lines));
  await rt.stop(id);
  assert.equal(docker(["inspect", id]), null, "container is gone");
  await rt.stop(id);
});

test("@heavy a repo that cannot be built fails with the reason and starts nothing", { skip }, async () => {
  const k = "broken";
  sampleDirs[siteId(k)] = repo({ Dockerfile: "FROM caddy:2-alpine\nRUN exit 3\n" });
  const res = await rt.build(req(k, "f"));
  assert.equal(res.ok, false);
  assert.equal(res.image, undefined);
  assert.match(res.log[res.log.length - 1] ?? "", /The build failed/);
});

test("S10 public hostname through the relay passthrough reaches the container", { skip: "needs relay/worker SNI passthrough from P-L10_02; not on main yet" }, () => {
  // Pair with relay/worker once it lands: dial the relay with the site's public hostname as SNI and assert the container answers.
});

test("cleanup", { skip }, () => {
  for (const c of containers) docker(["rm", "--force", c]);
  for (const i of images) docker(["rmi", "--force", i]);
  docker(["network", "rm", NETWORK]);
  for (const k of Object.keys(sampleDirs)) {
    const tags = docker(["image", "ls", `vyre-site-cache/${k}`, "--format", "{{.Repository}}:{{.Tag}}"]) ?? "";
    for (const tag of tags.split("\n").filter((l) => l !== "")) docker(["rmi", "--force", tag]);
  }
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});
