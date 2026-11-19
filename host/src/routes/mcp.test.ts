import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createMcpRoute, visitorOf } from "./mcp.ts";

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
          headers: { "x-vyre-visitor": "203.0.113.9" },
        })
      ).status,
      200,
    );
    assert.equal((await fetch(`${base}/oauth/authorize?client_id=x`)).status, 200);
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
    const asked = fetch(s.url, { method: "GET", headers: { accept: "text/event-stream" }, signal: ctl.signal }).catch(() => undefined);
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

test("the visitor header is believed only from the relay's loopback connection; from anywhere else the connection's own address stands", () => {
  assert.equal(visitorOf({ "x-vyre-visitor": "203.0.113.9" }, "127.0.0.1"), "203.0.113.9");
  assert.equal(visitorOf({ "x-vyre-visitor": "203.0.113.9" }, "::1"), "203.0.113.9");
  assert.equal(visitorOf({ "x-vyre-visitor": "203.0.113.9" }, "198.51.100.7"), "198.51.100.7", "a header written by a direct client is ignored");
  assert.equal(visitorOf({}, "198.51.100.7"), "198.51.100.7");
  assert.equal(visitorOf({ "x-vyre-visitor": "" }, "127.0.0.1"), "127.0.0.1");
  assert.equal(visitorOf({ "x-vyre-visitor": "x".repeat(300) }, "127.0.0.1").length, 64);
});
