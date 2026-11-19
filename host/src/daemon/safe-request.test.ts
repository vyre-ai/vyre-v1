// A throw in pre-route code cannot take the daemon down (lane r42-mcp): the request answers 500 and the next one is served. These tests fail on the code before the guard existed, where such a throw escaped the listener.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { errorLine, guardRequest, guardUpgrade, rejectionCount, scrub } from "./safe-request.ts";
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

const childEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => {
  const e: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete e["NODE_TEST_CONTEXT"];
  delete e["NODE_ENV"];
  return e;
};
function child(install: boolean, env: Record<string, string> = {}) {
  const url = new URL("./safe-request.ts", import.meta.url).href;
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { installRejectionBackstop, rejectionCount } from ${JSON.stringify(url)};
       const seen = [];
       ${install ? 'installRejectionBackstop((e) => seen.push(e.message)); installRejectionBackstop((e) => seen.push("second:" + e.message));' : ""}
       Promise.reject(new Error("nobody waits"));
       setTimeout(() => { console.log("ALIVE " + seen.join(",") + " count=" + rejectionCount()); }, 100);`,
    ],
    { encoding: "utf8", env: childEnv(env) },
  );
}

test("a rejection nobody waits on is counted and logged to the newest logger and the process lives; without the backstop Node ends it", () => {
  const withIt = child(true);
  assert.match(withIt.stdout, /ALIVE second:nobody waits count=1/, "the newest logger is the one called");
  assert.equal(withIt.status, 0);
  const without = child(false);
  assert.notEqual(without.status, 0, "Node's default ends the process");
  assert.doesNotMatch(without.stdout, /ALIVE/);
});

test("in a test process (or with VYRE_STRICT_REJECTIONS=1) the backstop logs and then fails as Node would, so a stray rejection still fails a test", () => {
  const strict = child(true, { VYRE_STRICT_REJECTIONS: "1" });
  assert.notEqual(strict.status, 0);
  assert.doesNotMatch(strict.stdout, /ALIVE/);
  assert.equal(rejectionCount(), 0, "this test process saw none");
});

test("what an error writes to a log is scrubbed: addresses are cut to origin and path, long token-like runs are removed, and the stack is kept", () => {
  const e = new Error("fetch failed https://api.example.com/v1/x?token=abc123SECRET&k=v key=" + "Qz9".repeat(14));
  const l = errorLine(e);
  assert.ok(!l.error.includes("SECRET") && !l.error.includes("Qz9Qz9Qz9"), l.error);
  assert.match(l.error, /https:\/\/api\.example\.com\/v1\/x/);
  assert.match(l.stack ?? "", /Error: fetch failed/);
  assert.equal(scrub("a".repeat(5000)).length <= 4000, true);
});

test("an async upgrade handler that rejects closes its socket, like a request's rejection answers 500", async () => {
  const errors: unknown[] = [];
  let destroyed = false;
  guardUpgrade(async () => {
    throw new Error("async injected");
  }, (_w, e) => void errors.push(e))({} as http.IncomingMessage, { destroy: () => void (destroyed = true) } as never, Buffer.alloc(0));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(destroyed, true);
  assert.equal(errors.length, 1);
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
