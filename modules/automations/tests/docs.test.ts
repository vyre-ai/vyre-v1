// The allowlist loader never reads a URL the person typed. Tests pass a fake fetch.
import test from "node:test";
import assert from "node:assert/strict";
import { DOC_CAP, KNOWN_DOCS, NO_MATCH, draftKnown, loadKnownDocument, narrowDocument } from "../docs.ts";

const STRIPE = KNOWN_DOCS.stripe!;
const SECRET = "sk-live-do-not-keep";

function responseOf(status: number, body: string, headers: Record<string, string> = {}, url = ""): Response {
  const response = new Response(body, { status, headers });
  if (url) Object.defineProperty(response, "url", { value: url });
  return response;
}

test("Stripe matches and a longer name does not call fetch", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return responseOf(200, JSON.stringify({ openapi: "3.0.3" }));
  }) as typeof fetch;
  const hit = await loadKnownDocument("Stripe", fetchImpl);
  assert.equal(hit.ok, true);
  if (!hit.ok) return;
  assert.equal(hit.docsUrl, STRIPE);
  assert.equal(calls, 1);
  const miss = await loadKnownDocument("stripe api", fetchImpl);
  assert.equal(miss.ok, false);
  if (miss.ok) return;
  assert.match(miss.reason, /not opened/);
  assert.equal(calls, 1);
  assert.equal(miss.reason.includes("https://"), false);
});

test("a redirect is refused before the body is read", async () => {
  let read = false;
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    assert.equal(init?.redirect, "manual");
    return {
      status: 302,
      url: "",
      headers: { get: () => null },
      text: async () => { read = true; return "{}"; },
    } as Response;
  }) as typeof fetch;
  const out = await loadKnownDocument("stripe", fetchImpl);
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.match(out.reason, /redirected/);
  assert.equal(read, false);
  assert.equal(out.reason.includes("https://"), false);
});

test("a final host that is not the allowlist is a redirect", async () => {
  const fetchImpl = (async () => responseOf(200, "{}", {}, "https://evil.example/spec.json")) as typeof fetch;
  const out = await loadKnownDocument("stripe", fetchImpl);
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.match(out.reason, /redirected/);
  assert.equal(out.reason.includes("evil.example"), false);
});

test("a body over the cap is refused and a declared length is not read", async () => {
  let read = false;
  const declared = (async () => ({
    status: 200,
    url: STRIPE,
    headers: { get: (name: string) => name === "content-length" ? String(DOC_CAP + 1) : null },
    text: async () => { read = true; return "{}"; },
  })) as typeof fetch;
  const over = await loadKnownDocument("stripe", declared);
  assert.equal(over.ok, false);
  if (over.ok) return;
  assert.match(over.reason, /too large/);
  assert.equal(read, false);
  const huge = (async () => responseOf(200, `{${" ".repeat(DOC_CAP)}}`)) as typeof fetch;
  const body = await loadKnownDocument("stripe", huge);
  assert.equal(body.ok, false);
  if (body.ok) return;
  assert.match(body.reason, /too large/);
});

test("HTML and invalid JSON are refused", async () => {
  const html = await loadKnownDocument("stripe", (async () => responseOf(200, " <html></html>")) as typeof fetch);
  const bad = await loadKnownDocument("stripe", (async () => responseOf(200, "not-json")) as typeof fetch);
  assert.equal(html.ok, false);
  assert.equal(bad.ok, false);
  if (html.ok || bad.ok) return;
  assert.equal(html.reason, "The official document was not JSON.");
  assert.equal(bad.reason, html.reason);
});

test("a thrown fetch says the document did not load", async () => {
  const out = await loadKnownDocument("stripe", (async () => { throw new Error(`down ${SECRET}`); }) as typeof fetch);
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.match(out.reason, /did not load/);
  assert.equal(out.reason.includes(SECRET), false);
  assert.equal(out.reason.includes("https://"), false);
});

test("an intent keeps the matching read and drops the other path", () => {
  const doc = {
    openapi: "3.0.3",
    info: { title: "Notes" },
    servers: [{ url: "https://api.notes.test" }],
    paths: {
      "/customers": { get: { operationId: "listCustomers", summary: "List customers", responses: { "200": { description: "ok" } } } },
      "/charges": { post: { operationId: "createCharge", responses: { "201": { description: "ok" } } } },
    },
    components: { examples: { leak: { value: SECRET } }, securitySchemes: { key: { type: "apiKey" } } },
  };
  const narrowed = narrowDocument(doc, "list customers") as { paths: Record<string, Record<string, unknown>>; components?: Record<string, unknown> };
  assert.ok(narrowed.paths["/customers"]?.get);
  assert.equal(narrowed.paths["/charges"], undefined);
  assert.equal(JSON.stringify(narrowed).includes(SECRET), false);
  assert.ok(narrowed.components?.securitySchemes);
  assert.equal(narrowed.components?.examples, undefined);
});

test("no intent keeps a read and drops a post", () => {
  const doc = {
    openapi: "3.0.3",
    paths: {
      "/customers": { get: { operationId: "listCustomers" }, post: { operationId: "createCustomer" } },
    },
  };
  const narrowed = narrowDocument(doc, "") as { paths: Record<string, Record<string, unknown>> };
  assert.ok(narrowed.paths["/customers"]?.get);
  assert.equal(narrowed.paths["/customers"]?.post, undefined);
});

test("a document with no matching path is refused and the secret stays out", async () => {
  const fetchImpl = (async () => responseOf(200, JSON.stringify({
    openapi: "3.0.3",
    paths: { "/charges": { post: { operationId: "createCharge", example: SECRET } } },
  }))) as typeof fetch;
  const out = await draftKnown("stripe", "zzzz", fetchImpl);
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.reason, NO_MATCH);
  assert.equal(out.reason.includes(SECRET), false);
});
