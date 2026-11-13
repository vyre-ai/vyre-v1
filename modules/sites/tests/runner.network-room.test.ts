// A site whose network Docker cannot make because its address pools are used up (12 Nov: each site has a network of its own, and a host holds about 30 networks) says so in plain words, with Docker's
// own answer kept for Copy details, instead of a raw Docker error. The runner's socket is a stand-in that answers as Docker does.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { dockerRunner, NO_ROOM_FOR_SITE_NETWORK } from "../handlers/runner.ts";

test("a site that cannot get a network because the server's address pools are used up gets the plain line, Docker's words after it", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-site-net-"));
  const sock = path.join(dir, "runner.sock");
  const server = http.createServer((q, s) => {
    q.resume();
    q.on("end", () => {
      if (q.method === "GET" && /\/networks\//.test(q.url ?? "")) {
        s.writeHead(404);
        s.end(JSON.stringify({ message: "network not found" }));
        return;
      }
      if (q.method === "POST" && /\/networks\/create/.test(q.url ?? "")) {
        s.writeHead(400);
        s.end(JSON.stringify({ message: "all predefined address pools have been fully subnetted" }));
        return;
      }
      s.writeHead(500);
      s.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(sock, r));
  t.after(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const runner = dockerRunner({ socketPath: sock, token: () => "t" });
  let err: unknown;
  try {
    await runner.network("sit_01abc");
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Error);
  const [first, ...rest] = (err as Error).message.split("\n");
  assert.equal(first, NO_ROOM_FOR_SITE_NETWORK);
  assert.match(first!, /^This server has no room for another site's network yet\./);
  assert.match(rest.join("\n"), /fully subnetted/, "Docker's answer stays for Copy details");
});
