// The Docker probe asks Docker's socket and starts no process: the daemon holds gigabytes, and a fork from it every minute cost a quarter of a second of the event loop on a firm's Mac mini (Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { nodePlatform } from "../src/platform/index.ts";
import type { Platform } from "../src/platform/index.ts";
import { docker } from "../src/platform/probes.ts";

async function serve(handler: http.RequestListener): Promise<{ sock: string; close(): Promise<void> }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-dsock-"));
  const sock = path.join(dir, "docker.sock");
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(sock, r));
  return {
    sock,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
const withHost = async <T>(host: string | undefined, f: () => Promise<T>): Promise<T> => {
  const was = process.env["DOCKER_HOST"];
  if (host === undefined) delete process.env["DOCKER_HOST"];
  else process.env["DOCKER_HOST"] = host;
  try {
    return await f();
  } finally {
    if (was === undefined) delete process.env["DOCKER_HOST"];
    else process.env["DOCKER_HOST"] = was;
  }
};
/** The real platform, except that a started process fails the test. */
const noSpawn = (): Platform => ({
  ...nodePlatform(),
  run: () => Promise.reject(new Error("a process was started for the Docker probe")),
});

test("a Docker that answers on its socket is healthy and no process is started", async () => {
  const s = await serve((req, res) => {
    assert.equal(req.url, "/version");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ Version: "27.1.1", ApiVersion: "1.46" }));
  });
  try {
    const r = await withHost(`unix://${s.sock}`, () => docker(noSpawn()));
    assert.equal(r.state, "healthy");
    assert.match(r.detail ?? "", /Docker 27\.1\.1 answers/);
  } finally {
    await s.close();
  }
});

test("a socket nobody listens on is down, a socket that never answers times out, and a TCP host falls back to the CLI", async () => {
  const dead = await serve((_q, res) => res.end("{}"));
  await dead.close(); // the file stays, nobody listens
  const down = await withHost(`unix://${dead.sock}`, () => nodePlatform().dockerVersion!(500));
  assert.deepEqual(down, { error: "down" });
  const hang = await serve(() => {
    /* never answers */
  });
  try {
    const t0 = Date.now();
    const slow = await withHost(`unix://${hang.sock}`, () => nodePlatform().dockerVersion!(150));
    assert.deepEqual(slow, { error: "timeout" });
    assert.ok(Date.now() - t0 < 2_000);
  } finally {
    await hang.close();
  }
  assert.equal(
    await withHost("tcp://127.0.0.1:2375", () => nodePlatform().dockerVersion!(500)),
    null,
    "no socket to ask: the CLI answers",
  );
});
