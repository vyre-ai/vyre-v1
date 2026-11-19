// Client metadata documents (lane r42-mcp): an app names itself by an https address; what its page says is checked, read once with every failure a refusal, and kept as an ordinary client.
import test from "node:test";
import assert from "node:assert/strict";
import { fetchDoc, isDocId, keepDoc, readDoc, MAX_DOC_BYTES } from "../client-doc.ts";
import { clientBy, serverMetadata } from "../oauth.ts";
import { ensure } from "../projections.ts";
import { harness } from "../fixtures/harness.ts";

const ID = "https://app.example.com/oauth/client.json";
const page = (o: Record<string, unknown> = {}): string =>
  JSON.stringify({ client_id: ID, client_name: "Example app", redirect_uris: ["https://app.example.com/cb"], ...o });

test("which client_ids are addresses: https, a real path, no user name, no fragment, a dotted host", () => {
  assert.equal(isDocId(ID), true);
  for (const bad of ["mcl_abc", "http://app.example.com/x", "https://app.example.com", "https://u:p@app.example.com/x", "https://app.example.com/x#f", "https://localhost/x", "x".repeat(600)])
    assert.equal(isDocId(bad), false, bad);
});

test("the page must name the address it was read from, with one to five good redirects and no secret", () => {
  assert.deepEqual(readDoc(ID, page()), { clientId: ID, name: "Example app", redirectUris: ["https://app.example.com/cb"] });
  assert.ok("refused" in readDoc(ID, page({ client_id: "https://evil.example.com/x" })), "another address");
  assert.ok("refused" in readDoc(ID, page({ redirect_uris: [] })));
  assert.ok("refused" in readDoc(ID, page({ redirect_uris: ["http://app.example.com/cb"] })), "plain http, not loopback");
  assert.ok("refused" in readDoc(ID, page({ redirect_uris: Array(6).fill("https://a.example.com/cb") })));
  assert.ok("refused" in readDoc(ID, page({ token_endpoint_auth_method: "client_secret_basic" })));
  assert.ok("refused" in readDoc(ID, "not json"));
  assert.ok("refused" in readDoc(ID, "[]"));
  assert.ok("refused" in readDoc(ID, page({ client_name: "x".repeat(MAX_DOC_BYTES) })), "too large");
  assert.deepEqual(readDoc(ID, page({ redirect_uris: ["http://127.0.0.1:5000/cb"] })), {
    clientId: ID,
    name: "Example app",
    redirectUris: ["http://127.0.0.1:5000/cb"],
  });
});

const body = (s: string): AsyncIterable<Uint8Array> => ({
  async *[Symbol.asyncIterator]() {
    yield new TextEncoder().encode(s);
  },
});

test("a read that fails in any way is a refusal with words and never a throw: refused address, bad status, no body, huge body, a hang", async () => {
  const ok = await fetchDoc(ID, async () => ({ ok: true, status: 200, body: body(page()) }));
  assert.ok(!("refused" in ok));
  for (const get of [
    async () => {
      throw new Error("address refused");
    },
    async () => ({ ok: false, status: 404, body: null }),
    async () => ({ ok: true, status: 200, body: null }),
    async () => ({ ok: true, status: 200, body: body("x".repeat(MAX_DOC_BYTES + 10)) }),
  ])
    assert.ok("refused" in (await fetchDoc(ID, get as never)));
  const hang = fetchDoc(ID, ((_u: string, init: { signal: AbortSignal }) =>
    new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))))) as never);
  assert.ok("refused" in (await hang), "a page that never answers is given up on");
});

test("what the page said is kept as an ordinary client, and read again replaces it; the server says it accepts such ids", async () => {
  const h = harness();
  ensure(h.db);
  keepDoc(h.db, { clientId: ID, name: "Example app", redirectUris: ["https://app.example.com/cb"] }, 1000);
  assert.deepEqual(clientBy(h.db, ID), { clientId: ID, name: "Example app", redirectUris: ["https://app.example.com/cb"] });
  keepDoc(h.db, { clientId: ID, name: "Renamed", redirectUris: ["https://app.example.com/cb2"] }, 2000);
  assert.equal(clientBy(h.db, ID)?.name, "Renamed");
  assert.equal(serverMetadata("https://x.example")["client_id_metadata_document_supported"], true);
});
