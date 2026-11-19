// Client metadata documents (lane r42-mcp): an app names itself by an https address; what its page says is checked, read once with every failure a refusal, and kept as an ordinary client.
import test from "node:test";
import assert from "node:assert/strict";
import { EVICT_GRACE_MS, fetchDoc, isDocId, keepDoc, readDoc, registeredDomain, MAX_DOC_BYTES, MAX_DOCS_PER_HOST } from "../client-doc.ts";
import { beginAuthorize, challengeOf, clientBy, serverMetadata, CODE_MS, MAX_CLIENTS, REQUEST_MS, UNUSED_CLIENT_MS } from "../oauth.ts";
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

test("a full table makes room by dropping the oldest page nobody has used, never an app in use; it refuses only when every place is in use", () => {
  const h = harness();
  ensure(h.db);
  const now = 10 * UNUSED_CLIENT_MS;
  const fill = (used: boolean) => {
    h.db.run("DELETE FROM mcp_oauth_clients");
    for (let i = 0; i < MAX_CLIENTS; i++)
      h.db.run(
        "INSERT INTO mcp_oauth_clients (client_id, name, redirect_uris, created_at, used_at) VALUES (?, ?, ?, ?, ?)",
        `https://a.d${i}.com/c.json`,
        "x",
        "[]",
        now - 1000 + i,
        used ? now - 500 : null,
      );
  };
  const fresh = { clientId: "https://new.fresh.org/c.json", name: "New", redirectUris: ["https://new.fresh.org/cb"] };
  fill(true);
  assert.equal(keepDoc(h.db, fresh, now), false, "every place is an app in use");
  assert.equal(clientBy(h.db, fresh.clientId), null);
  fill(false);
  h.db.run("UPDATE mcp_oauth_clients SET created_at = ?", now - 1000); // all just made: inside the grace
  assert.equal(keepDoc(h.db, fresh, now), false, "an app between its Allow page and its token exchange is never the one given up");
  h.db.run("UPDATE mcp_oauth_clients SET created_at = ? + rowid", now - 2 * EVICT_GRACE_MS);
  assert.equal(keepDoc(h.db, fresh, now), true, "a table full of unused pages gives the oldest up");
  assert.ok(clientBy(h.db, fresh.clientId));
  assert.equal(clientBy(h.db, "https://a.d0.com/c.json"), null, "the oldest was dropped");
  assert.ok(clientBy(h.db, "https://a.d1.com/c.json"), "the next oldest stays");
  assert.equal(keepDoc(h.db, { ...fresh, clientId: "https://a.d1.com/c.json" }, now), true, "a known one still refreshes");
});

test("one host cannot fill the table: past its few pages a new address on it is refused, others are not", () => {
  const h = harness();
  ensure(h.db);
  for (let i = 0; i < MAX_DOCS_PER_HOST; i++)
    assert.equal(keepDoc(h.db, { clientId: `https://one.example.com/${i}.json`, name: "x", redirectUris: ["https://one.example.com/cb"] }, 1000), true);
  assert.equal(keepDoc(h.db, { clientId: "https://one.example.com/extra.json", name: "x", redirectUris: ["https://one.example.com/cb"] }, 1000), false);
  assert.equal(keepDoc(h.db, { clientId: "https://two.other.org/a.json", name: "x", redirectUris: ["https://two.other.org/cb"] }, 1000), true);
});

test("a wildcard of subdomains is one source: the domain's few pages are shared by every subdomain of it", () => {
  const h = harness();
  ensure(h.db);
  for (let i = 0; i < MAX_DOCS_PER_HOST; i++)
    assert.equal(keepDoc(h.db, { clientId: `https://s${i}.evil.example/c.json`, name: "x", redirectUris: ["https://s0.evil.example/cb"] }, 1000), true);
  assert.equal(keepDoc(h.db, { clientId: "https://s99.evil.example/c.json", name: "x", redirectUris: ["https://s0.evil.example/cb"] }, 1000), false);
  assert.equal(keepDoc(h.db, { clientId: "https://app.fine.example/c.json", name: "x", redirectUris: ["https://app.fine.example/cb"] }, 1000), true);
});

test("the registered domain keeps one more label under a shared host or a country suffix, so one user of a shared host cannot take every place", () => {
  assert.equal(registeredDomain("a.b.evil.example"), "evil.example");
  assert.equal(registeredDomain("alice.github.io"), "alice.github.io");
  assert.equal(registeredDomain("x.alice.github.io"), "alice.github.io");
  assert.equal(registeredDomain("shop.example.co.uk"), "example.co.uk");
  const h = harness();
  ensure(h.db);
  for (let i = 0; i < MAX_DOCS_PER_HOST; i++)
    assert.equal(keepDoc(h.db, { clientId: `https://alice.github.io/${i}.json`, name: "x", redirectUris: ["https://alice.github.io/cb"] }, 1000), true);
  assert.equal(keepDoc(h.db, { clientId: "https://alice.github.io/extra.json", name: "x", redirectUris: ["https://alice.github.io/cb"] }, 1000), false);
  assert.equal(keepDoc(h.db, { clientId: "https://bob.github.io/app.json", name: "x", redirectUris: ["https://bob.github.io/cb"] }, 1000), true, "another user of the same shared host is not refused");
});

test("two sites under the same country suffix are two sources: example.co.uk and other.co.uk do not share ten places", () => {
  assert.notEqual(registeredDomain("www.example.co.uk"), registeredDomain("other.co.uk"));
  const h = harness();
  ensure(h.db);
  for (let i = 0; i < MAX_DOCS_PER_HOST; i++)
    assert.equal(keepDoc(h.db, { clientId: `https://www.example.co.uk/${i}.json`, name: "x", redirectUris: ["https://www.example.co.uk/cb"] }, 1000), true);
  assert.equal(keepDoc(h.db, { clientId: "https://www.example.co.uk/x.json", name: "x", redirectUris: ["https://www.example.co.uk/cb"] }, 1000), false);
  assert.equal(keepDoc(h.db, { clientId: "https://other.co.uk/app.json", name: "x", redirectUris: ["https://other.co.uk/cb"] }, 1000), true);
});

test("the cap is counted on the parsed host: a path that names another domain, or a port, does not move a page between sources", () => {
  const h = harness();
  ensure(h.db);
  for (let i = 0; i < MAX_DOCS_PER_HOST; i++)
    assert.equal(keepDoc(h.db, { clientId: `https://attacker.example/victim.test/${i}.json`, name: "x", redirectUris: ["https://attacker.example/cb"] }, 1000), true);
  assert.equal(keepDoc(h.db, { clientId: "https://victim.test/app.json", name: "x", redirectUris: ["https://victim.test/cb"] }, 1000), true, "the attacker's paths do not count against victim.test");
  for (let i = 0; i < MAX_DOCS_PER_HOST - 1; i++)
    assert.equal(keepDoc(h.db, { clientId: `https://port.example:8443/${i}.json`, name: "x", redirectUris: ["https://port.example/cb"] }, 1000), true);
  assert.equal(keepDoc(h.db, { clientId: "https://port.example/x.json", name: "x", redirectUris: ["https://port.example/cb"] }, 1000), true);
  assert.equal(keepDoc(h.db, { clientId: "https://port.example:9000/y.json", name: "x", redirectUris: ["https://port.example/cb"] }, 1000), false, "a port does not dodge the cap");
});

test("a flood of new pages while one app is mid-authorize cannot evict it: the app still completes its sign-in", () => {
  const h = harness();
  ensure(h.db);
  const now = 10 * UNUSED_CLIENT_MS;
  const mid = "https://a.d0.com/c.json";
  for (let i = 0; i < MAX_CLIENTS; i++)
    h.db.run(
      "INSERT INTO mcp_oauth_clients (client_id, name, redirect_uris, created_at, used_at) VALUES (?, ?, ?, ?, NULL)",
      `https://a.d${i}.com/c.json`,
      "App",
      JSON.stringify([`https://a.d${i}.com/cb`]),
      now - 2 * EVICT_GRACE_MS + i, // the oldest, and long past the grace
    );
  const begun = beginAuthorize(
    h.db,
    { client_id: mid, redirect_uri: "https://a.d0.com/cb", response_type: "code", code_challenge: challengeOf("v".repeat(60)), code_challenge_method: "S256" },
    "https://acme.vyre.run",
    now,
  );
  assert.equal(begun.kind, "page", "the app is mid-authorize");
  for (let i = 0; i < 300; i++)
    keepDoc(h.db, { clientId: `https://flood${i}.spam${i}.org/c.json`, name: "x", redirectUris: [`https://flood${i}.spam${i}.org/cb`] }, now + i);
  assert.ok(clientBy(h.db, mid), "the app in flight is still known: its token exchange will find it");
  assert.equal(clientBy(h.db, "https://a.d1.com/c.json") === null, true, "others, the oldest unused and not in flight, were given up for the flood");
});

test("the eviction grace is longer than a sign-in request and an authorization code live, so no page is given up between its Allow page and its token exchange", () => {
  assert.ok(EVICT_GRACE_MS > REQUEST_MS + CODE_MS, `${EVICT_GRACE_MS} must exceed ${REQUEST_MS + CODE_MS}`);
});
