import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createMcpRoute } from "./mcp.ts";
import { PROOF_HEADER, proofFor, takeVisitor, visitorOfRequest, verifiedVisitor } from "../seams/visitor-proof.ts";

type Runtime = ReturnType<Parameters<typeof createMcpRoute>[0]["runtime"]>;
const SIGN_IN_NOTHING = { oauth: async () => null };
async function serve(
  runtime: () => (Omit<NonNullable<Runtime>, "oauth"> & Partial<Pick<NonNullable<Runtime>, "oauth">>) | null,
): Promise<{ url: string; close(): Promise<void> }> {
  const route = createMcpRoute({
    runtime: () => {
      const r = runtime();
      return r ? { ...SIGN_IN_NOTHING, ...r } : null;
    },
    origin: () => "https://acme.vyre.run",
  });
  const server = http.createServer((req, res) => {
    takeVisitor(req); // the daemon does this before any route runs
    if (!route.handle(req, res)) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/mcp`, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}

test("the daemon MCP route forwards protocol requests and response headers to the live module runtime", async () => {
  const seen: unknown[] = [];
  const s = await serve(() => ({
    async handle(req) {
      seen.push(req);
      return {
        status: 200,
        headers: { "content-type": "application/json", "mcp-session-id": "ses_1" },
        body: '{"jsonrpc":"2.0","id":1,"result":{}}',
      };
    },
  }));
  try {
    const r = await fetch(s.url, {
      method: "POST",
      headers: { authorization: "Bearer tok", "content-type": "application/json" },
      body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
    });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("mcp-session-id"), "ses_1");
    assert.deepEqual(JSON.parse(await r.text()), { jsonrpc: "2.0", id: 1, result: {} });
    assert.equal((seen[0] as { method: string }).method, "POST");
    assert.equal((seen[0] as { headers: Record<string, string> }).headers.authorization, "Bearer tok");
  } finally {
    await s.close();
  }
});

test("the daemon MCP route is closed when the live runtime is absent", async () => {
  const s = await serve(() => null);
  try {
    assert.equal((await fetch(s.url, { method: "POST", body: "{}" })).status, 503);
  } finally {
    await s.close();
  }
});

test("a request to the sign-in addresses reaches the module with the address this host trusts, not the Host header", async () => {
  const seen: Array<{ path: string; search: string; origin: string | null; visitor: string }> = [];
  const s = await serve(() => ({
    async handle() {
      return { status: 200, headers: {}, body: "" };
    },
    async oauth(req) {
      seen.push({ path: req.path, search: req.search, origin: req.origin, visitor: req.visitor });
      return { status: 200, headers: { "content-type": "application/json" }, body: "{}" };
    },
  }));
  try {
    const base = s.url.replace(/\/mcp$/, "");
    assert.equal(
      (
        await fetch(`${base}/.well-known/oauth-protected-resource/mcp`, {
          headers: { "x-vyre-visitor": "203.0.113.9", [PROOF_HEADER]: proofFor("203.0.113.9") },
        })
      ).status,
      200,
    );
    assert.equal((await fetch(`${base}/oauth/authorize?client_id=x`)).status, 200);
    // a loopback request that passes a forged visitor header through, as Caddy or any local proxy would, with no valid MAC: keyed by the connection's address
    assert.equal(
      (await fetch(`${base}/oauth/authorize?client_id=y`, { headers: { "x-vyre-visitor": "203.0.113.77" } })).status,
      200,
    );
    assert.equal(
      (
        await fetch(`${base}/oauth/authorize?client_id=z`, {
          headers: { "x-vyre-visitor": "203.0.113.77", [PROOF_HEADER]: proofFor("203.0.113.9") },
        })
      ).status,
      200,
      "a MAC for another value",
    );
    const forged = seen.filter((r) => r.search.endsWith("=y") || r.search.endsWith("=z"));
    assert.equal(forged.length, 2);
    assert.ok(
      forged.every((r) => r.visitor !== "203.0.113.77"),
      "the forged value never became the visitor",
    );
    seen.splice(seen.indexOf(forged[0]!), 1);
    seen.splice(seen.indexOf(forged[1]!), 1);
    assert.deepEqual(
      seen.map((r) => [r.path, r.search, r.origin]),
      [
        ["/.well-known/oauth-protected-resource/mcp", "", "https://acme.vyre.run"],
        ["/oauth/authorize", "?client_id=x", "https://acme.vyre.run"],
      ],
    );
    assert.equal(seen[0]?.visitor, "203.0.113.9");
    assert.equal((await fetch(`${base}/.well-known/other`)).status, 404, "nothing else under .well-known");
  } finally {
    await s.close();
  }
});

test("an app that goes away while the runtime is still answering does not hold its stream open", async () => {
  let ended = false;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const s = await serve(() => ({
    async handle() {
      await gate;
      return {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: "",
        stream: async ({ closed }) => {
          await closed;
          ended = true;
        },
      };
    },
  }));
  try {
    const ctl = new AbortController();
    const asked = fetch(s.url, { method: "GET", headers: { accept: "text/event-stream" }, signal: ctl.signal }).catch(
      () => undefined,
    );
    await new Promise((r) => setTimeout(r, 100));
    ctl.abort();
    await asked;
    await new Promise((r) => setTimeout(r, 100));
    release();
    for (let i = 0; i < 50 && !ended; i++) await new Promise((r) => setTimeout(r, 40));
    assert.equal(ended, true, "the stream ended although the app was gone before the response began");
  } finally {
    release();
    await s.close();
  }
});

type Req = Parameters<typeof takeVisitor>[0];
const reqOf = (headers: Record<string, string>, remote: string): Req => ({
  headers: { ...headers },
  socket: { remoteAddress: remote },
});

test("the visitor the relay vouched for is read once and both headers are gone: a relayed request carries no proof or visitor header onward", () => {
  const good = reqOf(
    { "x-vyre-visitor": "203.0.113.9", [PROOF_HEADER]: proofFor("203.0.113.9"), accept: "*/*" },
    "127.0.0.1",
  );
  takeVisitor(good);
  assert.equal(visitorOfRequest(good), "203.0.113.9");
  assert.equal(verifiedVisitor(good), true);
  assert.deepEqual(
    Object.keys(good.headers),
    ["accept"],
    "nothing a proxy, a site or an outbound fetch could copy is left",
  );
});

test("a visitor with no valid MAC is keyed by the connection's address, and the headers are removed either way", () => {
  for (const [label, headers, remote, want] of [
    [
      "forged header, no MAC (a local proxy that passes headers through)",
      { "x-vyre-visitor": "203.0.113.9" },
      "127.0.0.1",
      "127.0.0.1",
    ],
    [
      "a MAC made for another value",
      { "x-vyre-visitor": "198.18.0.1", [PROOF_HEADER]: proofFor("203.0.113.9") },
      "127.0.0.1",
      "127.0.0.1",
    ],
    ["a wrong MAC", { "x-vyre-visitor": "203.0.113.9", [PROOF_HEADER]: "x".repeat(64) }, "127.0.0.1", "127.0.0.1"],
    [
      "a good MAC from outside the loopback",
      { "x-vyre-visitor": "203.0.113.9", [PROOF_HEADER]: proofFor("203.0.113.9") },
      "198.51.100.7",
      "198.51.100.7",
    ],
    ["no visitor at all", {}, "198.51.100.7", "198.51.100.7"],
  ] as const) {
    const r = reqOf({ ...headers }, remote);
    takeVisitor(r);
    assert.equal(visitorOfRequest(r), want, label);
    assert.equal(verifiedVisitor(r), false, label);
    assert.equal(r.headers["x-vyre-visitor"], undefined, `${label}: header removed`);
    assert.equal(r.headers[PROOF_HEADER], undefined, `${label}: MAC removed`);
  }
});

test("forged visitor values from one outside address are one visitor, so a forged header cannot reset a count", () => {
  const keys = new Set(
    Array.from({ length: 50 }, (_, i) => {
      const r = reqOf({ "x-vyre-visitor": `10.0.0.${i}` }, "198.51.100.7");
      takeVisitor(r);
      return visitorOfRequest(r);
    }),
  );
  assert.deepEqual([...keys], ["198.51.100.7"]);
});

test("a visitor MAC that is not 43 base64url characters never throws and is never believed: non-ASCII, wrong length, upper case, with a header value the way Node decodes it", () => {
  for (const proof of [
    "\u00e9".repeat(64),
    "\u00e9".repeat(43),
    "a".repeat(42),
    "a".repeat(44),
    "+".repeat(43),
    "A".repeat(43),
    "",
    "00".repeat(32) + "0",
  ]) {
    const r = reqOf({ "x-vyre-visitor": "203.0.113.9", [PROOF_HEADER]: proof }, "127.0.0.1");
    assert.doesNotThrow(() => takeVisitor(r), JSON.stringify(proof).slice(0, 20));
    assert.equal(verifiedVisitor(r), false);
    assert.equal(visitorOfRequest(r), "127.0.0.1");
  }
  // the same through a real connection: a proxy that passes such a header through cannot stop the daemon
});
