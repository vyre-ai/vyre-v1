// The HTTP request step's two capabilities. No real network: the installed fetch and lookup are fakes, and the Vault fill is a function.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { setDocumentNetwork } from "../document-network.ts";
import { httpRead, httpSend, setHttpStepHost } from "../handlers/http-step.ts";
import type { AutoCtx } from "../projections.ts";
import type { FetchDeps } from "../public-fetch.ts";

const ctx = { trace: { traceId: "trc_1" } } as AutoCtx;
const SECRET = "sk-live-0123456789abcdef";

interface Seen { url: string; method: string; headers: Record<string, string>; body?: string }
function network(answer: (req: Seen) => Response, seen: Seen[]): FetchDeps {
  return {
    lookup: async () => ["93.184.216.34"],
    fetch: (async () => { throw new Error("connect is used"); }) as typeof fetch,
    connect: async (r) => {
      const s: Seen = { url: r.url.href, method: r.method ?? "GET", headers: { ...(r.headers ?? {}) }, ...(r.body !== undefined ? { body: r.body } : {}) };
      seen.push(s);
      return answer(s);
    },
  };
}
const code = async (p: Promise<unknown>): Promise<string> => { try { await p; return "none"; } catch (e) { return (e as { error?: { code?: string } }).error?.code ?? "other"; } };
const message = async (p: Promise<unknown>): Promise<string> => { try { await p; return ""; } catch (e) { return (e as { error?: { message?: string } }).error?.message ?? String(e); } };

afterEach(() => { setDocumentNetwork(null); setHttpStepHost(null); });

test("a GET returns the status, the lower-cased headers and the parsed JSON", async () => {
  const seen: Seen[] = [];
  setDocumentNetwork(network(() => new Response('{"items":[1,2]}', { status: 200, headers: { "Content-Type": "application/json", "X-Count": "2" } }), seen));
  const out = await httpRead(ctx, { method: "GET", url: "https://api.example.com/v1/items", query: { page: 2, tag: ["a", "b"] } }) as Record<string, unknown>;
  assert.equal(out["status"], 200);
  assert.equal(out["ok"], true);
  assert.deepEqual(out["body"], { items: [1, 2] });
  assert.equal((out["headers"] as Record<string, string>)["x-count"], "2");
  assert.equal(seen[0]?.url, "https://api.example.com/v1/items?page=2&tag=a&tag=b");
  assert.equal(seen[0]?.method, "GET");
});

test("a non-2xx status is a result, not a failure", async () => {
  setDocumentNetwork(network(() => new Response("nope", { status: 404 }), []));
  const out = await httpRead(ctx, { method: "GET", url: "https://api.example.com/missing" }) as Record<string, unknown>;
  assert.deepEqual([out["status"], out["ok"], out["body"]], [404, false, "nope"]);
});

test("a private, loopback, link-local or non-https address is refused before any request", async () => {
  const seen: Seen[] = [];
  setDocumentNetwork(network(() => new Response("x"), seen));
  for (const url of ["https://127.0.0.1/", "https://10.1.2.3/v1", "https://169.254.169.254/latest/meta-data", "https://localhost/", "http://api.example.com/", "https://[::1]/", "https://user:pw@api.example.com/"]) {
    assert.equal(await code(httpRead(ctx, { method: "GET", url })), "validation.bad_input", url);
  }
  assert.equal(seen.length, 0);
});

test("a name that resolves to a private address is refused", async () => {
  const seen: Seen[] = [];
  const deps = network(() => new Response("x"), seen);
  setDocumentNetwork({ ...deps, lookup: async () => ["93.184.216.34", "10.0.0.5"] });
  assert.equal(await code(httpRead(ctx, { method: "GET", url: "https://rebind.example.com/" })), "validation.bad_input");
  assert.equal(seen.length, 0);
});

test("a redirect to a private address is refused and the second request is never made", async () => {
  const seen: Seen[] = [];
  setDocumentNetwork(network(() => new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest" } }), seen));
  assert.equal(await code(httpRead(ctx, { method: "GET", url: "https://api.example.com/go" })), "validation.bad_input");
  assert.equal(seen.length, 1);
});

test("a GET follows a public redirect, and a header with a login is dropped when the redirect leaves the origin", async () => {
  const seen: Seen[] = [];
  setHttpStepHost({ fill: async () => SECRET });
  setDocumentNetwork(network((r) => (r.url.startsWith("https://api.example.com/") ? new Response(null, { status: 302, headers: { location: "https://cdn.other.example/file" } }) : new Response("done")), seen));
  const out = await httpRead(ctx, { method: "GET", url: "https://api.example.com/go", auth: { kind: "bearer", handle: "#Acme_API" } }) as Record<string, unknown>;
  assert.equal(out["body"], "done");
  assert.equal(seen[0]?.headers["authorization"], `Bearer ${SECRET}`);
  assert.equal(seen[1]?.headers["authorization"], undefined);
});

test("a POST is not redirected: the 3xx comes back as the result", async () => {
  const seen: Seen[] = [];
  setDocumentNetwork(network(() => new Response(null, { status: 307, headers: { location: "https://evil.example/collect" } }), seen));
  const out = await httpSend(ctx, { method: "POST", url: "https://api.example.com/orders", json: { n: 1 }, idempotencyKey: "in:run_1:charge:1" }) as Record<string, unknown>;
  assert.equal(out["status"], 307);
  assert.equal(seen.length, 1);
});

test("a send carries the idempotency key, the JSON body and its content type; a read never does", async () => {
  const seen: Seen[] = [];
  setDocumentNetwork(network(() => new Response("{}", { headers: { "content-type": "application/json" } }), seen));
  await httpSend(ctx, { method: "POST", url: "https://api.example.com/orders", json: { n: 1 }, idempotencyKey: "in:run_1:charge:1" });
  assert.equal(seen[0]?.headers["idempotency-key"], "in:run_1:charge:1");
  assert.equal(seen[0]?.headers["content-type"], "application/json");
  assert.equal(seen[0]?.body, '{"n":1}');
  await httpRead(ctx, { method: "GET", url: "https://api.example.com/orders", idempotencyKey: "in:run_1:look:1" });
  assert.equal(seen[1]?.headers["idempotency-key"], undefined);
});

test("each capability takes only its own methods", async () => {
  setDocumentNetwork(network(() => new Response("x"), []));
  assert.equal(await code(httpRead(ctx, { method: "POST", url: "https://api.example.com/" })), "validation.bad_input");
  assert.equal(await code(httpSend(ctx, { method: "GET", url: "https://api.example.com/", idempotencyKey: "k" })), "validation.bad_input");
  assert.equal(await code(httpRead(ctx, { method: "GET", url: "https://api.example.com/", json: { a: 1 } })), "validation.bad_input", "a read cannot carry a body");
});

test("bearer, basic and named-header auth put the filled value in one header", async () => {
  const seen: Seen[] = [];
  const asked: string[] = [];
  setHttpStepHost({ fill: async (_c, handle) => { asked.push(handle); return SECRET; } });
  setDocumentNetwork(network(() => new Response("ok"), seen));
  await httpRead(ctx, { method: "GET", url: "https://api.example.com/a", auth: { kind: "bearer", handle: "#Acme_API" } });
  await httpRead(ctx, { method: "GET", url: "https://api.example.com/b", auth: { kind: "basic", handle: "#Acme_API.password", username: "dana" } });
  await httpRead(ctx, { method: "GET", url: "https://api.example.com/c", auth: { kind: "header", handle: "#Acme_API", header: "X-Api-Key" } });
  assert.equal(seen[0]?.headers["authorization"], `Bearer ${SECRET}`);
  assert.equal(seen[1]?.headers["authorization"], `Basic ${Buffer.from(`dana:${SECRET}`).toString("base64")}`);
  assert.equal(seen[2]?.headers["x-api-key"], SECRET);
  assert.deepEqual(asked, ["#Acme_API", "#Acme_API.password", "#Acme_API"]);
});

test("a secret never comes back: a response that echoes it is scrubbed in the body and the headers, and login headers are dropped", async () => {
  setHttpStepHost({ fill: async () => SECRET });
  setDocumentNetwork(network((r) => new Response(JSON.stringify({ seen: r.headers["authorization"], note: `key ${SECRET}` }), {
    headers: { "content-type": "application/json", "x-echo": SECRET, "set-cookie": "sid=abc", "www-authenticate": "Bearer" },
  }), []));
  const out = await httpRead(ctx, { method: "GET", url: "https://api.example.com/echo", auth: { kind: "bearer", handle: "#Acme_API" } });
  const text = JSON.stringify(out);
  assert.equal(text.includes(SECRET), false, text);
  assert.equal(text.includes("sid=abc"), false);
  assert.deepEqual((out as { body: unknown }).body, { seen: "Bearer [hidden]", note: "key [hidden]" });
  assert.equal((out as { headers: Record<string, string> }).headers["x-echo"], "[hidden]");
  assert.equal("set-cookie" in (out as { headers: Record<string, string> }).headers, false);
});

test("a failed request never carries the secret in its error", async () => {
  setHttpStepHost({ fill: async () => SECRET });
  setDocumentNetwork({ ...network(() => new Response("x"), []), connect: async () => { throw new Error(`boom ${SECRET}`); } });
  const m = await message(httpRead(ctx, { method: "GET", url: "https://api.example.com/x", auth: { kind: "bearer", handle: "#Acme_API" } }));
  assert.equal(m.includes(SECRET), false);
  assert.ok(m.length > 0);
});

test("auth with no Vault, a bad handle, a missing user name or an empty value is refused with a reason", async () => {
  setDocumentNetwork(network(() => new Response("x"), []));
  const base = { method: "GET", url: "https://api.example.com/" };
  assert.equal(await code(httpRead(ctx, { ...base, auth: { kind: "bearer", handle: "#Acme_API" } })), "validation.precondition_failed", "the host cannot fill");
  setHttpStepHost({ fill: async () => SECRET });
  assert.equal(await code(httpRead(ctx, { ...base, auth: { kind: "bearer", handle: SECRET } })), "validation.bad_input", "a pasted value is not a handle");
  assert.equal(await code(httpRead(ctx, { ...base, auth: { kind: "basic", handle: "#Acme_API" } })), "validation.bad_input");
  assert.equal(await code(httpRead(ctx, { ...base, auth: { kind: "header", handle: "#Acme_API", header: "host" } })), "validation.bad_input");
  setHttpStepHost({ fill: async () => "" });
  assert.equal(await code(httpRead(ctx, { ...base, auth: { kind: "bearer", handle: "#Acme_API" } })), "validation.precondition_failed");
});

test("the Vault's own refusal passes through unchanged", async () => {
  const refusal = Object.assign(new Error("no"), { error: { code: "permission.no_grant", message: "You cannot use that item." } });
  setHttpStepHost({ fill: async () => { throw refusal; } });
  setDocumentNetwork(network(() => new Response("x"), []));
  assert.equal(await code(httpRead(ctx, { method: "GET", url: "https://api.example.com/", auth: { kind: "bearer", handle: "#Acme_API" } })), "permission.no_grant");
});

test("headers: step-owned and malformed ones are refused, line breaks too", async () => {
  setDocumentNetwork(network(() => new Response("x"), []));
  const base = { method: "GET", url: "https://api.example.com/" };
  assert.equal(await code(httpRead(ctx, { ...base, headers: { Host: "evil.example" } })), "validation.bad_input");
  assert.equal(await code(httpRead(ctx, { ...base, headers: { "Content-Length": "1" } })), "validation.bad_input");
  assert.equal(await code(httpRead(ctx, { ...base, headers: { "bad name": "x" } })), "validation.bad_input");
  assert.equal(await code(httpRead(ctx, { ...base, headers: { "x-a": "one\r\nx-b: two" } })), "validation.bad_input");
  assert.equal(await code(httpRead(ctx, { ...base, headers: { "x-a": "fine" } })), "none");
});

test("a response over 1 MB is refused", async () => {
  setDocumentNetwork(network(() => new Response("a".repeat(1_000_001)), []));
  assert.equal(await code(httpRead(ctx, { method: "GET", url: "https://api.example.com/big" })), "validation.too_large");
});

test("a request that does not finish in 30 seconds is refused as a network failure", async () => {
  const deps = network(() => new Response("x"), []);
  setDocumentNetwork({ ...deps, connect: (r) => new Promise((_resolve, reject) => { r.signal.addEventListener("abort", () => reject(new Error("aborted"))); }) });
  const real = AbortSignal.timeout;
  AbortSignal.timeout = ((ms: number) => real.call(AbortSignal, Math.min(ms, 50))) as typeof AbortSignal.timeout;
  // AbortSignal.timeout's timer is unref'd, so with the request pending the event loop would be empty and the run would end; a live host keeps the loop running, so the test does too.
  const alive = setInterval(() => undefined, 1_000);
  try {
    assert.equal(await code(httpRead(ctx, { method: "GET", url: "https://api.example.com/slow" })), "provider.network");
  } finally { AbortSignal.timeout = real; clearInterval(alive); }
});

test("HEAD returns the status and headers and no body", async () => {
  setDocumentNetwork(network(() => new Response(null, { status: 200, headers: { etag: "abc" } }), []));
  const out = await httpRead(ctx, { method: "HEAD", url: "https://api.example.com/a" }) as Record<string, unknown>;
  assert.deepEqual([out["status"], out["body"], (out["headers"] as Record<string, string>)["etag"]], [200, null, "abc"]);
});
