// The Docker Engine API version (found by the real-Docker run on a Docker 29 runner): the engine refuses a client older than its MinAPIVersion, and Docker 29 starts at 1.44, so a pinned 1.43
// could not even ping. The version is now taken from what the daemon says it serves: the one this code was written against, moved into the daemon's range.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { WANTED_API_VERSION, createDockerApi, unixSocketHttp } from "../src/docker.ts";

interface Daemon { socket: string; paths: string[]; close(): Promise<void> }

/** A daemon on a unix socket that serves `min` to `max`, answers /version unversioned, and refuses any other version the way Docker does. */
async function daemon(range: { min: string; max: string } | "no-version-endpoint"): Promise<Daemon> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-dockerd-"));
  const socket = path.join(dir, "docker.sock");
  const paths: string[] = [];
  const num = (v: string): number => Number(v.split(".").reduce((a, p) => a * 1000 + Number(p), 0));
  const server = http.createServer((req, res) => {
    paths.push(req.url ?? "");
    const m = /^\/v(\d+\.\d+)(\/.*)$/.exec(req.url ?? "");
    if (!m) {
      if (req.url === "/version" && range !== "no-version-endpoint") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ApiVersion: range.max, MinAPIVersion: range.min })); return; }
      res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ message: "page not found" })); return;
    }
    const v = m[1] as string;
    if (range !== "no-version-endpoint" && num(v) < num(range.min)) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ message: `client version ${v} is too old. Minimum supported API version is ${range.min}` })); return; }
    if (range !== "no-version-endpoint" && num(v) > num(range.max)) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ message: `client version ${v} is too new. Maximum supported API version is ${range.max}` })); return; }
    if (m[2] === "/_ping") { res.writeHead(200); res.end("OK"); return; }
    if (m[2]?.startsWith("/images/") && m[2].endsWith("/json")) { res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); return; }
    res.writeHead(404); res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(socket, resolve));
  return { socket, paths, close: () => new Promise<void>((resolve) => { server.close(() => { fs.rmSync(dir, { recursive: true, force: true }); resolve(); }); server.closeAllConnections?.(); }) };
}

test("a daemon that starts at 1.44 (Docker 29) is spoken to at 1.44, once asked what it serves", async () => {
  const d = await daemon({ min: "1.44", max: "1.52" });
  try {
    const api = createDockerApi(unixSocketHttp(d.socket));
    assert.equal(await api.ping(), true);
    assert.equal(await api.imageExists("vyre/person-sandbox:1"), true);
    assert.deepEqual(d.paths, ["/version", "/v1.44/_ping", "/v1.44/images/vyre/person-sandbox:1/json"], "asked once, then every request carries the version");
  } finally { await d.close(); }
});

test("a daemon that serves the version this was written against is spoken to at that version", async () => {
  const d = await daemon({ min: "1.24", max: "1.47" });
  try {
    assert.equal(await createDockerApi(unixSocketHttp(d.socket)).ping(), true);
    assert.equal(d.paths[1], `/v${WANTED_API_VERSION}/_ping`);
  } finally { await d.close(); }
});

test("a daemon older than that is spoken to at its newest version, compared as numbers (1.9 is older than 1.43)", async () => {
  const d = await daemon({ min: "1.12", max: "1.41" });
  try {
    assert.equal(await createDockerApi(unixSocketHttp(d.socket)).ping(), true);
    assert.equal(d.paths[1], "/v1.41/_ping");
  } finally { await d.close(); }
  const e = await daemon({ min: "1.2", max: "1.9" });
  try {
    assert.equal(await createDockerApi(unixSocketHttp(e.socket)).ping(), true);
    assert.equal(e.paths[1], "/v1.9/_ping");
  } finally { await e.close(); }
});

test("a daemon with no /version endpoint gets the version this was written against; a pinned version is used as given", async () => {
  const d = await daemon("no-version-endpoint");
  try {
    assert.equal(await createDockerApi(unixSocketHttp(d.socket)).ping(), true);
    assert.equal(d.paths[1], `/v${WANTED_API_VERSION}/_ping`);
    assert.equal(await createDockerApi(unixSocketHttp(d.socket, "v1.40")).ping(), true);
    assert.equal(d.paths.at(-1), "/v1.40/_ping", "a pinned version is not negotiated");
  } finally { await d.close(); }
});

test("the negotiation is done once for many requests, even when they start together", async () => {
  const d = await daemon({ min: "1.44", max: "1.52" });
  try {
    const api = createDockerApi(unixSocketHttp(d.socket));
    const all = await Promise.all([api.ping(), api.ping(), api.imageExists("x:1"), api.ping()]);
    assert.deepEqual(all, [true, true, true, true]);
    assert.equal(d.paths.filter((p) => p === "/version").length, 1);
  } finally { await d.close(); }
});
