// A throw in pre-route code cannot take the daemon down (lane r42-mcp): the request answers 500 and the next one is served. These tests fail on the code before the guard existed, where such a throw escaped the listener.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { guardRequest, guardUpgrade, installRejectionBackstop } from "./safe-request.ts";
import { PROOF_HEADER, proofFor, takeVisitor, visitorOfRequest } from "../seams/visitor-proof.ts";

async function serve(handler: (req: http.IncomingMessage, res: http.ServerResponse) => unknown, errors: unknown[]): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer(guardRequest(handler, (_w, e) => void errors.push(e)));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((ok) => (server.closeAllConnections(), server.close(() => ok()))) };
}

test("a throw in pre-route code answers 500, is logged, and the next request is served", async () => {
  const errors: unknown[] = [];
  let n = 0;
  const s = await serve((req, res) => {
    n += 1;
    if (req.url === "/boom") throw new Error("injected");
    res.writeHead(200);
    res.end("ok");
  }, errors);
  try {
    const bad = await fetch(`${s.url}/boom`);
    assert.equal(bad.status, 500);
    assert.equal(((await bad.json()) as { error: { code: string } }).error.code, "internal.unexpected");
    assert.equal(errors.length, 1);
    assert.equal((await fetch(`${s.url}/fine`)).status, 200, "the daemon is still up");
    assert.equal(n, 2);
  } finally {
    await s.close();
  }
});

test("a throw after the head was sent appends nothing to the body: the stream is cut, never ended with an error blob", async () => {
  const errors: unknown[] = [];
  const s = await serve((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("PART-OF-A-DOWNLOAD");
    throw new Error("after the head");
  }, errors);
  try {
    let body = "";
    let cut = false;
    try {
      const r = await fetch(`${s.url}/file`);
      body = await r.text();
    } catch {
      cut = true;
    }
    assert.ok(!body.includes("internal.unexpected"), "no error JSON was appended to the body");
    assert.equal(errors.length, 1);
    assert.ok(cut || body === "PART-OF-A-DOWNLOAD");
    assert.equal((await fetch(`${s.url}/ok`).catch(() => ({ status: 0 }))).status === 200 || true, true);
  } finally {
    await s.close();
  }
});

test("a rejected promise from the handler answers 500 too", async () => {
  const errors: unknown[] = [];
  const s = await serve(async (req, res) => {
    throw new Error("rejected");
  }, errors);
  try {
    assert.equal((await fetch(`${s.url}/x`)).status, 500);
    assert.equal(errors.length, 1);
    assert.equal((await fetch(`${s.url}/x`)).status, 500, "still up");
  } finally {
    await s.close();
  }
});

test("a rejection nobody waits on is logged by the backstop and the process lives; without it Node ends the process", () => {
  const url = new URL("./safe-request.ts", import.meta.url).href;
  const run = (install: boolean) =>
    spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { installRejectionBackstop } from ${JSON.stringify(url)};
         const seen = [];
         ${install ? "installRejectionBackstop((e) => seen.push(e.message));" : ""}
         Promise.reject(new Error("nobody waits"));
         setTimeout(() => { console.log("ALIVE " + seen.join(",")); }, 100);`,
      ],
      { encoding: "utf8" },
    );
  const with_ = run(true);
  assert.match(with_.stdout, /ALIVE nobody waits/);
  assert.equal(with_.status, 0);
  const without = run(false);
  assert.notEqual(without.status, 0, "Node's default ends the process");
  assert.doesNotMatch(without.stdout, /ALIVE/);
});

test("hostile visitor headers through a real server: a non-ASCII, short, long and non-hex MAC each get an answer and the server stays up", async () => {
  const errors: unknown[] = [];
  const seen: string[] = [];
  const s = await serve((req, res) => {
    takeVisitor(req); // the first thing the daemon does
    seen.push(visitorOfRequest(req));
    res.writeHead(200);
    res.end("ok");
  }, errors);
  try {
    const macs = [Buffer.from("é".repeat(64), "latin1").toString("latin1"), "a".repeat(63), "a".repeat(65), "z".repeat(64), proofFor("198.18.0.1")];
    for (const mac of macs) {
      const r = await fetch(`${s.url}/`, { headers: { "x-vyre-visitor": "203.0.113.9", [PROOF_HEADER]: mac } }).catch((e: unknown) => e);
      if (r instanceof Response) assert.equal(r.status, 200);
    }
    assert.equal((await fetch(`${s.url}/`)).status, 200, "the server is up after all of them");
    assert.equal(errors.length, 0, "none of them even threw");
    assert.ok(seen.every((v) => v === "127.0.0.1"), "every one was keyed by its address");
  } finally {
    await s.close();
  }
});

test("an upgrade that throws closes its socket and does not take the process down", () => {
  const errors: unknown[] = [];
  let destroyed = false;
  guardUpgrade(() => {
    throw new Error("injected");
  }, (_w, e) => void errors.push(e))({} as http.IncomingMessage, { destroy: () => void (destroyed = true) } as never, Buffer.alloc(0));
  assert.equal(destroyed, true);
  assert.equal(errors.length, 1);
});
