// The current MCP revision, 2026-07-28 (lane r42-mcp, 19 Nov 2026): no handshake and no session. Every request names its version and the client's capabilities in `_meta`, the HTTP headers repeat the method
// and the name so a proxy can route on them, and a request whose headers and body disagree is refused. A client of an older revision still opens with `initialize` and is served as before: both are checked here.
import test from "node:test";
import assert from "node:assert/strict";
import {
  createMcpServer,
  HEADER_MISMATCH,
  MODERN_VERSIONS,
  SUPPORTED_VERSIONS,
  UNSUPPORTED_PROTOCOL_VERSION,
  outsideAllows,
} from "../../../agent/src/mcp/index.ts";
import type { McpCaller } from "../../../agent/src/mcp/index.ts";
import { fakeInvoke, loadGenerated } from "../../../agent/src/tools/harness.ts";

const g = loadGenerated();
const V = "2026-07-28";
const outside: McpCaller = {
  kind: "outside",
  sessionId: "ses_out",
  space: "spc_1",
  principal: { kind: "agent", id: "agt_cc" },
  actingFor: "usr_imran",
};

function rig() {
  const fake = fakeInvoke(g.caps);
  const opened: Array<{ token: string; clientName: string | undefined }> = [];
  const server = createMcpServer({
    catalog: g.catalog,
    defaults: g.defaults,
    invoke: fake.invoke,
    info: { name: "vyre", version: "1.0.0" },
    open: async (token, clientName) => {
      opened.push({ token, clientName });
      return token === "out" ? outside : null;
    },
  });
  let n = 0;
  /** A request as a 2026-07-28 client sends it: the version and capabilities in `_meta`, and the headers that repeat the body. `over` changes or drops what is sent. */
  async function ask(
    method: string,
    params: Record<string, unknown> = {},
    over: { headers?: Record<string, string | undefined>; meta?: Record<string, unknown> | null; token?: string } = {},
  ) {
    const meta =
      over.meta === null
        ? undefined
        : {
            "io.modelcontextprotocol/protocolVersion": V,
            "io.modelcontextprotocol/clientInfo": { name: "Cursor", version: "3.0" },
            "io.modelcontextprotocol/clientCapabilities": {},
            ...over.meta,
          };
    const named = method === "resources/read" ? params["uri"] : params["name"];
    const headers: Record<string, string | undefined> = {
      authorization: `Bearer ${over.token ?? "out"}`,
      "mcp-protocol-version": V,
      "mcp-method": method,
      ...(["tools/call", "prompts/get", "resources/read"].includes(method) && typeof named === "string"
        ? { "mcp-name": named }
        : {}),
      ...over.headers,
    };
    const r = await server.handle({
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++n,
        method,
        params: { ...params, ...(meta ? { _meta: meta } : {}) },
      }),
    });
    return { ...r, json: r.body === "" ? null : (JSON.parse(r.body) as any) };
  }
  return { server, fake, ask, opened };
}

test("server/discover answers with no handshake before it: every version served, what the server can do, who it is, and how long to keep the answer", async () => {
  const r = rig();
  const d = await r.ask("server/discover");
  assert.equal(d.status, 200);
  assert.equal(d.headers["mcp-session-id"], undefined, "no session is minted");
  const res = d.json.result;
  assert.equal(res.resultType, "complete");
  assert.deepEqual(res.supportedVersions, SUPPORTED_VERSIONS);
  assert.equal(res.supportedVersions[0], V, "newest first");
  assert.ok(res.supportedVersions.includes("2025-06-18") && res.supportedVersions.includes("2025-11-25"));
  assert.ok(res.capabilities.tools);
  assert.deepEqual(res._meta["io.modelcontextprotocol/serverInfo"], { name: "vyre", version: "1.0.0" });
  assert.match(res.instructions, /tool_search/);
  assert.ok(Number.isInteger(res.ttlMs) && res.ttlMs >= 0);
  assert.ok(res.cacheScope === "private" || res.cacheScope === "public");
});

test("the first request of a client that never said hello works: tools/list and tools/call, each complete and signed by the server", async () => {
  const r = rig();
  const list = await r.ask("tools/list");
  assert.equal(list.status, 200);
  assert.equal(list.json.result.resultType, "complete");
  assert.equal(
    list.json.result.cacheScope,
    "private",
    "a list differs by who asks, so it is never shared between sign-ins",
  );
  assert.ok(list.json.result.ttlMs > 0);
  assert.ok(list.json.result._meta["io.modelcontextprotocol/serverInfo"].name);
  const names = (list.json.result.tools as Array<{ name: string }>).map((t) => t.name);
  assert.ok(names.includes("tool_search") && names.includes("use_tool") && names.includes("agents_next"));
  const call = await r.ask("tools/call", { name: "tool_search", arguments: { query: "record history" } });
  assert.equal(call.status, 200);
  assert.equal(call.json.result.resultType, "complete");
  assert.equal(call.json.result.isError, false);
  assert.ok(call.json.result.structuredContent.data.tools.length > 0);
  assert.ok(call.json.result._meta["io.modelcontextprotocol/serverInfo"]);
  assert.equal(
    r.opened[0]?.clientName,
    "Cursor",
    "the client names itself on the request, since there is no handshake to do it in",
  );
});

test("the list is in name order and does not change because of what the client did before: what tool_search found is called with use_tool", async () => {
  const r = rig();
  const before = ((await r.ask("tools/list")).json.result.tools as Array<{ name: string }>).map((t) => t.name);
  assert.deepEqual(before, [...before].sort(), "name order, so a client and a prompt cache can keep it");
  const found = (await r.ask("tools/call", { name: "tool_search", arguments: { query: "calendar event" } })).json.result
    .structuredContent.data.tools as Array<{ name: string }>;
  const deferred = found.find((t) => !before.includes(t.name) && outsideAllows(g.catalog.byName(t.name)!));
  assert.ok(deferred, "the search found a tool that is not in the list");
  const after = ((await r.ask("tools/list")).json.result.tools as Array<{ name: string }>).map((t) => t.name);
  assert.deepEqual(after, before);
  const used = await r.ask("tools/call", { name: "use_tool", arguments: { name: deferred.name, arguments: {} } });
  assert.equal(used.status, 200);
  assert.ok(used.json.result.content, "the found tool is reached through use_tool");
});

test("a request whose headers and body disagree is 400 HeaderMismatch: version, method and name, and a missing header counts", async () => {
  const r = rig();
  const cases: Array<[string, Parameters<typeof r.ask>]> = [
    ["version differs", ["tools/list", {}, { headers: { "mcp-protocol-version": "2025-06-18" } }]],
    ["version header missing", ["tools/list", {}, { headers: { "mcp-protocol-version": undefined } }]],
    ["method differs", ["tools/list", {}, { headers: { "mcp-method": "tools/call" } }]],
    ["method header missing", ["tools/list", {}, { headers: { "mcp-method": undefined } }]],
    [
      "name differs",
      ["tools/call", { name: "tool_search", arguments: { query: "x" } }, { headers: { "mcp-name": "records_query" } }],
    ],
    [
      "name header missing",
      ["tools/call", { name: "tool_search", arguments: { query: "x" } }, { headers: { "mcp-name": undefined } }],
    ],
    [
      "name wrapping broken",
      ["tools/call", { name: "tool_search", arguments: { query: "x" } }, { headers: { "mcp-name": "=?base64?!!!?=" } }],
    ],
  ];
  for (const [what, args] of cases) {
    const out = await r.ask(...args);
    assert.equal(out.status, 400, what);
    assert.equal(out.json.error.code, HEADER_MISMATCH, what);
    assert.equal(HEADER_MISMATCH, -32020);
  }
  assert.equal(r.fake.calls.length, 0, "nothing ran");
  // a name that is not plain ASCII travels wrapped, and is compared after unwrapping
  const wrapped = await r.ask(
    "tools/call",
    { name: "tool_search", arguments: { query: "record history" } },
    { headers: { "mcp-name": `=?base64?${Buffer.from("tool_search").toString("base64")}?=` } },
  );
  assert.equal(wrapped.status, 200);
});

test("a version this server does not serve is refused with the list it does; a request missing its version or its capabilities is 400 invalid params", async () => {
  const r = rig();
  const old = await r.ask(
    "tools/list",
    {},
    {
      meta: { "io.modelcontextprotocol/protocolVersion": "2099-01-01" },
      headers: { "mcp-protocol-version": "2099-01-01" },
    },
  );
  assert.equal(old.status, 400);
  assert.equal(old.json.error.code, UNSUPPORTED_PROTOCOL_VERSION);
  assert.equal(UNSUPPORTED_PROTOCOL_VERSION, -32022);
  assert.deepEqual(old.json.error.data, { supported: SUPPORTED_VERSIONS, requested: "2099-01-01" });
  const noMeta = await r.ask("tools/list", {}, { meta: null });
  assert.equal(noMeta.status, 400);
  assert.equal(noMeta.json.error.code, -32602);
  const noCaps = await r.ask("tools/list", {}, { meta: { "io.modelcontextprotocol/clientCapabilities": undefined } });
  assert.equal(noCaps.status, 400);
  assert.equal(noCaps.json.error.code, -32602);
});

test("a method this revision does not have is 404 with the JSON-RPC error in the body: ping went with the handshake", async () => {
  const r = rig();
  for (const method of ["ping", "no/such"]) {
    const out = await r.ask(method);
    assert.equal(out.status, 404, method);
    assert.equal(out.json.error.code, -32601, method);
  }
});

test("one request in each POST; a bad token is still 401 before anything else is said", async () => {
  const r = rig();
  const meta = { "io.modelcontextprotocol/protocolVersion": V, "io.modelcontextprotocol/clientCapabilities": {} };
  const batch = await r.server.handle({
    method: "POST",
    headers: { authorization: "Bearer out", "mcp-protocol-version": V, "mcp-method": "tools/list" },
    body: JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: meta } },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: meta } },
    ]),
  });
  assert.equal(batch.status, 400);
  const bad = await r.ask("tools/list", {}, { token: "nope" });
  assert.equal(bad.status, 401);
});

test("a client of an older revision still opens with initialize and is served as before, on the same endpoint and the same sign-in", async () => {
  const r = rig();
  const post = async (body: unknown, headers: Record<string, string> = {}) => {
    const out = await r.server.handle({
      method: "POST",
      headers: { authorization: "Bearer out", ...headers },
      body: JSON.stringify(body),
    });
    return { ...out, json: out.body === "" ? null : (JSON.parse(out.body) as any) };
  };
  for (const asked of ["2025-06-18", "2025-11-25"]) {
    const init = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: asked, capabilities: {}, clientInfo: { name: "claude-code", version: "2.1" } },
    });
    assert.equal(init.status, 200);
    assert.equal(init.json.result.protocolVersion, asked);
    assert.equal(init.json.result.resultType, undefined, "the older shape, untouched");
    assert.equal(init.headers["mcp-session-id"], "ses_out");
  }
  // a version nobody serves this way falls back to the one served before this change
  const unknown = await post({
    jsonrpc: "2.0",
    id: 2,
    method: "initialize",
    params: { protocolVersion: "1999-01-01", capabilities: {}, clientInfo: { name: "x", version: "1" } },
  });
  assert.equal(unknown.json.result.protocolVersion, "2025-06-18");
  const ping = await post({ jsonrpc: "2.0", id: 3, method: "ping" }, { "mcp-protocol-version": "2025-06-18" });
  assert.equal(ping.status, 200);
  assert.deepEqual(ping.json.result, {});
  const list = await post({ jsonrpc: "2.0", id: 4, method: "tools/list" }, { "mcp-protocol-version": "2025-06-18" });
  assert.equal(list.json.result.resultType, undefined);
  assert.equal(list.json.result.ttlMs, undefined);
  assert.ok(list.json.result.tools.length > 10);
  const nf = await post({ jsonrpc: "2.0", id: 5, method: "server/discover" });
  assert.equal(nf.status, 200, "an unknown method stays a 200 with an error for the older revisions");
  assert.equal(nf.json.error.code, -32601);
  assert.ok(MODERN_VERSIONS.includes(V));
});
