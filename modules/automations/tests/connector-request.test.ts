// One request from a stored action: the key goes on at the last moment, the reply is scrubbed of it, and a writer sees the shape of a reply, not its data.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeConnector } from "../connector-def.ts";
import type { ConnectorDef } from "../connector-def.ts";
import { buildRequest, missingParams, readReply, scrubValues, shapeOf } from "../connector-request.ts";

function def(auth: Record<string, unknown>): ConnectorDef {
  const r = normalizeConnector({
    app: "acme", title: "Acme", domains: ["api.acme.test", "files.acme.test"], auth,
    actions: [
      { key: "get_order", title: "Get an order", method: "GET", path: "/v1/orders/{id}", output: "/order", params: [{ name: "id", in: "path", type: "string" }, { name: "expand", in: "query", type: "array" }, { name: "x-trace", in: "header", type: "string" }] },
      { key: "create_order", title: "Create an order", method: "POST", path: "/v1/orders", host: "files.acme.test", params: [{ name: "email", in: "body", required: true, type: "string" }, { name: "qty", in: "body", type: "integer" }] },
    ],
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as { def: ConnectorDef }).def;
}

test("a bearer key goes in the header, a path value is encoded, a query list repeats", () => {
  const d = def({ type: "bearer", field: "token" });
  const r = buildRequest(d, d.actions[0]!, { id: "a/b c", expand: ["x", "y"], "x-trace": "t1" }, { secret: "tok_12345678" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.request.url, "https://api.acme.test/v1/orders/a%2Fb%20c?expand=x&expand=y");
  assert.equal(r.request.headers["authorization"] ?? r.request.headers["Authorization"], "Bearer tok_12345678");
  assert.equal(r.request.headers["x-trace"], "t1");
});

test("api_key travels in the named header or the named query value", () => {
  const h = def({ type: "api_key", field: "api_key", header: "X-Acme-Key" });
  const a = buildRequest(h, h.actions[0]!, { id: "1" }, { secret: "key_abcdef" });
  assert.equal(a.ok && a.request.headers["X-Acme-Key"], "key_abcdef");
  const q = def({ type: "api_key", query: "key" });
  const b = buildRequest(q, q.actions[0]!, { id: "1" }, { secret: "key_abcdef" });
  assert.equal(b.ok && b.request.url, "https://api.acme.test/v1/orders/1?key=key_abcdef");
});

test("basic sends the user and the password as one encoded value", () => {
  const d = def({ type: "basic", field: "password", userField: "username" });
  const r = buildRequest(d, d.actions[0]!, { id: "1" }, { secret: "pw", user: "ann" });
  assert.equal(r.ok && r.request.headers["Authorization"], `Basic ${Buffer.from("ann:pw").toString("base64")}`);
});

test("a body is JSON from the body parameters, the action's own host is used, and a missing required value is named", () => {
  const d = def({ type: "none" });
  const r = buildRequest(d, d.actions[1]!, { email: "a@b.test", qty: 2 }, {});
  assert.equal(r.ok && r.request.url, "https://files.acme.test/v1/orders");
  assert.equal(r.ok && r.request.body, JSON.stringify({ email: "a@b.test", qty: 2 }));
  assert.deepEqual(missingParams(d.actions[1]!, {}), ["email"]);
  const m = buildRequest(d, d.actions[1]!, {}, {});
  assert.equal(m.ok, false);
});

test("an unknown input, a wrong type and a header injection are refused", () => {
  const d = def({ type: "none" });
  assert.equal(buildRequest(d, d.actions[0]!, { id: "1", nope: 1 }, {}).ok, false);
  assert.equal(buildRequest(d, d.actions[1]!, { email: 5 }, {}).ok, false);
  assert.equal(buildRequest(d, d.actions[0]!, { id: "1", "x-trace": "a\r\nx: y" }, {}).ok, false);
  const k = def({ type: "bearer" });
  assert.equal(buildRequest(k, k.actions[0]!, { id: "1" }, { secret: "a\nb" }).ok, false);
});

test("the key is scrubbed from a reply in every spelling the app might echo", () => {
  const key = "tok_a+b/c=12345";
  const text = JSON.stringify({ echo: key, enc: encodeURIComponent(key), b64: Buffer.from(key).toString("base64") });
  const out = scrubValues(text, [key]);
  assert.equal(out.includes(key), false);
  assert.equal(out.includes(encodeURIComponent(key)), false);
  assert.equal(out.includes(Buffer.from(key).toString("base64")), false);
  assert.equal(scrubValues("short x", ["x"]), "short x");
});

test("a reply is read as JSON and narrowed by the output pointer", () => {
  const d = def({ type: "none" });
  assert.deepEqual(readReply(JSON.stringify({ order: { id: 1 } }), d.actions[0]!), { id: 1 });
  assert.equal(readReply(JSON.stringify({ other: 1 }), d.actions[0]!), null);
  assert.equal(readReply("plain text", d.actions[1]!), "plain text");
});

test("the shape of a reply keeps keys and types and drops every value", () => {
  const shape = shapeOf({ data: [{ id: 7, email: "ann@example.com", tags: ["a"], meta: null }], next: "abc" });
  assert.deepEqual(shape, { data: [{ id: "number", email: "string", tags: ["string"], meta: "null" }], next: "string" });
  assert.equal(JSON.stringify(shape).includes("ann@example.com"), false);
});
