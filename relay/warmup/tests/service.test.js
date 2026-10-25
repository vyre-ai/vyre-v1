// The warmup pool service (spec 2.19, ARCH R19): the contract of POST /v1/pool/join and /v1/pool/exchange, signed by the Space key, with the rules the pool keeps.
// @reads /relay/warmup/service.js
// Spaces here are real Ed25519 keys; requests are signed the way wire.js documents; the clock is a variable so replay windows and expiry are exact.
import test from "node:test";
import assert from "node:assert/strict";
import { createPoolService } from "../service.js";
import { b64url, base32, keyId, signedMessage, MAX_SKEW_MS } from "../wire.js";

const T0 = 1_760_000_000_000;
const DAY = 86_400_000;
const subtle = globalThis.crypto.subtle;

async function space() {
  const pair = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  return {
    pub,
    id: await keyId(pub),
    /** a signed request; `over` replaces headers, `at` sets the signed time, `body` is the JSON text sent (and signed) */
    async req(path, body, over = {}, at = T0) {
      const text = typeof body === "string" ? body : JSON.stringify(body);
      const ts = String(at), nonce = over.nonce ?? b64url(globalThis.crypto.getRandomValues(new Uint8Array(16)));
      const sig = new Uint8Array(await subtle.sign({ name: "Ed25519" }, pair.privateKey, signedMessage("POST", path, ts, nonce, text)));
      return { method: "POST", path, body: text, headers: { "x-vyre-key": b64url(pub), "x-vyre-ts": ts, "x-vyre-nonce": nonce, "x-vyre-sig": b64url(sig), ...over.headers } };
    },
  };
}

const join = (s, addresses, at) => s.req("/v1/pool/join", { v: 1, mailboxes: addresses.map(address => ({ address })) }, {}, at);
const exchange = (s, mailboxes, at) => s.req("/v1/pool/exchange", { v: 1, mailboxes }, {}, at);
const code = r => r.json.error?.code;

function rig(opts = {}) {
  const clock = { now: T0 };
  const svc = createPoolService({ now: () => clock.now, ...opts });
  return { svc, clock, handle: r => svc.handle(r) };
}

test("the signed message is the documented bytes, and a key id is the first 26 base32 characters of sha256 of the public key", async () => {
  assert.equal(new TextDecoder().decode(signedMessage("POST", "/v1/pool/join", "1760000000000", "AAAAAAAAAAAAAAAAAAAAAA", '{"v":1}')), 'vyre-warmup-v1\nPOST\n/v1/pool/join\n1760000000000\nAAAAAAAAAAAAAAAAAAAAAA\n{"v":1}');
  const pub = new Uint8Array(32).fill(7);
  const want = base32(new Uint8Array(await subtle.digest("SHA-256", pub))).slice(0, 26);
  assert.equal(await keyId(pub), want);
  assert.match(want, /^[a-z2-7]{26}$/);
});

test("join: a signed request registers the mailboxes the key offers; they are stored lowercase and counted; GET /health needs no signature", async () => {
  const { handle } = rig();
  const a = await space();
  const r = await handle(await join(a, ["Sales@Harbor.example", "hello@harbor.example", "sales@harbor.example"]));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.data, { joined: 2, left: false, pool: { spaces: 1, mailboxes: 2 } });
  const h = await handle({ method: "GET", path: "/health", headers: {}, body: "" });
  assert.deepEqual(h.json.data, { ok: true, spaces: 1, mailboxes: 2 });
});

test("join: a second join replaces the list; an empty list leaves the pool and frees the addresses", async () => {
  const { handle } = rig();
  const a = await space(), b = await space();
  await handle(await join(a, ["one@a.example", "two@a.example"]));
  assert.deepEqual((await handle(await join(a, ["two@a.example", "three@a.example"]))).json.data.pool, { spaces: 1, mailboxes: 2 });
  assert.equal(code(await handle(await join(b, ["one@a.example"]))), undefined, "one@a.example was dropped by the replacement, so another key may offer it now");
  const left = await handle(await join(a, []));
  assert.deepEqual(left.json.data, { joined: 0, left: true, pool: { spaces: 1, mailboxes: 1 } });
  assert.equal((await handle(await join(b, ["two@a.example"]))).status, 200, "freed by leaving");
  assert.equal((await handle(await join(a, []))).json.data.left, false, "leaving twice is a no-op");
});

test("join: an address one key offers is refused to another key; bad addresses and shapes are refused", async () => {
  const { handle } = rig();
  const a = await space(), b = await space();
  await handle(await join(a, ["sales@harbor.example"]));
  const dup = await handle(await join(b, ["SALES@harbor.example"]));
  assert.equal(dup.status, 409);
  assert.equal(code(dup), "validation.duplicate");
  for (const bad of ["not-an-address", "a b@c.example", "a@b", "<x@y.example>", ""]) {
    assert.equal(code(await handle(await join(b, [bad]))), "validation.bad_input", bad);
  }
  assert.equal(code(await handle(await b.req("/v1/pool/join", { v: 2, mailboxes: [] }))), "validation.bad_input");
  assert.equal(code(await handle(await b.req("/v1/pool/join", { v: 1 }))), "validation.bad_input");
  assert.equal(code(await handle(await b.req("/v1/pool/join", "{not json"))), "validation.bad_input");
  assert.equal(code(await handle(await b.req("/v1/pool/join", { v: 1, mailboxes: Array.from({ length: 51 }, (_, i) => ({ address: `m${i}@x.example` })) }))), "validation.bad_input");
});

test("signature: a missing, malformed, foreign or altered signature is refused with 401 and changes nothing", async () => {
  const { handle, svc } = rig();
  const a = await space(), b = await space();
  const good = await join(a, ["sales@harbor.example"]);
  for (const [what, headers] of Object.entries({
    "no key": { "x-vyre-key": undefined },
    "no signature": { "x-vyre-sig": undefined },
    "no nonce": { "x-vyre-nonce": undefined },
    "no time": { "x-vyre-ts": undefined },
    "short key": { "x-vyre-key": "AAAA" },
    "junk signature": { "x-vyre-sig": "!!!" },
    "another Space's key": { "x-vyre-key": b64url(b.pub) },
  })) {
    const r = await handle({ ...good, headers: { ...good.headers, ...headers } });
    assert.equal(r.status, 401, what);
    assert.equal(code(r), "auth.invalid_signature", what);
  }
  const altered = await handle({ ...good, body: JSON.stringify({ v: 1, mailboxes: [{ address: "other@harbor.example" }] }) });
  assert.equal(code(altered), "auth.invalid_signature", "the body is signed");
  const otherPath = await handle({ ...good, path: "/v1/pool/exchange" });
  assert.equal(code(otherPath), "auth.invalid_signature", "the path is signed");
  assert.deepEqual(svc.size(), { spaces: 0, mailboxes: 0 });
  assert.equal((await handle(good)).status, 200, "the untouched request is fine");
});

test("signature: a request outside the five minute window is stale, a reused nonce is a replay, and a nonce is free again only after it can no longer be replayed", async () => {
  const { handle, clock } = rig();
  const a = await space();
  assert.equal(code(await handle(await join(a, ["s@h.example"], T0 - MAX_SKEW_MS - 1))), "auth.stale");
  assert.equal(code(await handle(await join(a, ["s@h.example"], T0 + MAX_SKEW_MS + 1))), "auth.stale");
  const once = await join(a, ["s@h.example"], T0 - MAX_SKEW_MS);
  assert.equal((await handle(once)).status, 200);
  const again = await handle(once);
  assert.equal(again.status, 401);
  assert.equal(code(again), "auth.replayed");
  clock.now += 3 * MAX_SKEW_MS;
  assert.equal(code(await handle(once)), "auth.stale", "after the window the old request is stale, not accepted again");
});

test("exchange: needs a joined key, only for mailboxes it joined with, with want from 0 to 20", async () => {
  const { handle } = rig();
  const a = await space(), b = await space();
  const stranger = await handle(await exchange(b, [{ address: "x@y.example", want: 1 }]));
  assert.equal(stranger.status, 401);
  assert.equal(code(stranger), "auth.not_joined");
  await handle(await join(a, ["sales@harbor.example"]));
  assert.equal(code(await handle(await exchange(a, [{ address: "other@harbor.example", want: 1 }]))), "validation.bad_input", "not a mailbox it joined with");
  for (const want of [-1, 21, 1.5, "3"]) assert.equal(code(await handle(await exchange(a, [{ address: "sales@harbor.example", want }]))), "validation.bad_input", String(want));
  assert.equal(code(await handle(await exchange(a, [{ address: "sales@harbor.example", want: 1, seen: [{ from: "x@y.example", outcome: "lost" }] }]))), "validation.bad_input");
});

test("exchange: peers come from other Spaces only, least loaded first, and a peer takes at most the daily cap", async () => {
  const { handle, clock } = rig({ inboundCap: 2, minIntervalMs: 1000 });
  const a = await space(), b = await space(), c = await space();
  await handle(await join(a, ["a1@a.example", "a2@a.example"]));
  await handle(await join(b, ["b1@b.example"]));
  await handle(await join(c, ["c1@c.example"]));
  const first = await handle(await exchange(a, [{ address: "a1@a.example", want: 2 }, { address: "a2@a.example", want: 1 }]));
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.deepEqual(first.json.data.assignments, [{ address: "a1@a.example", peers: ["b1@b.example", "c1@c.example"] }, { address: "a2@a.example", peers: ["b1@b.example"] }]);
  assert.ok(first.json.data.assignments.every(x => x.peers.every(p => !p.endsWith("@a.example"))), "never the asker's own mailboxes");
  clock.now += 2000;
  const second = await handle(await exchange(a, [{ address: "a1@a.example", want: 5 }], clock.now));
  assert.deepEqual(second.json.data.assignments[0].peers, ["c1@c.example"], "b1 is at its cap of 2 for the day, c1 has room for one more");
  clock.now += DAY;
  const next = await handle(await exchange(a, [{ address: "a1@a.example", want: 5 }], clock.now));
  assert.deepEqual(next.json.data.assignments[0].peers, ["b1@b.example", "c1@c.example"], "a new day, a new count");
});

test("exchange: a lone Space gets no peers and is told so, never its own mailboxes; want 0 asks only for health", async () => {
  const { handle } = rig();
  const a = await space();
  await handle(await join(a, ["only@a.example"]));
  const r = await handle(await exchange(a, [{ address: "only@a.example", want: 3 }]));
  assert.deepEqual(r.json.data.assignments, [{ address: "only@a.example", peers: [] }]);
  assert.equal(r.json.data.health[0].reports, 0);
});

test("exchange: one per key per interval; the answer says how long to wait", async () => {
  const { handle, clock } = rig({ minIntervalMs: 60_000 });
  const a = await space();
  await handle(await join(a, ["s@a.example"]));
  assert.equal((await handle(await exchange(a, [{ address: "s@a.example", want: 1 }]))).status, 200);
  clock.now += 20_000;
  const r = await handle(await exchange(a, [{ address: "s@a.example", want: 1 }], clock.now));
  assert.equal(r.status, 429);
  assert.equal(code(r), "rate_limit.exceeded");
  assert.equal(r.json.error.retryAfterMs, 40_000);
  clock.now += 40_000;
  assert.equal((await handle(await exchange(a, [{ address: "s@a.example", want: 1 }], clock.now))).status, 200);
});

test("health: what peers report about a mailbox comes back as spam, reply and missing rates once there are enough reports; a Space cannot vouch for itself", async () => {
  const { handle, clock } = rig({ minReports: 4, minIntervalMs: 1000 });
  const a = await space(), b = await space();
  await handle(await join(a, ["a1@a.example"]));
  await handle(await join(b, ["b1@b.example"]));
  const seen = [
    { from: "a1@a.example", outcome: "inbox", replied: true }, { from: "a1@a.example", outcome: "inbox" }, { from: "a1@a.example", outcome: "spam" },
    { from: "a1@a.example", outcome: "missing" }, { from: "b1@b.example", outcome: "spam" },
  ];
  // b reports four things about a1, and one about its own b1 (ignored)
  await handle(await exchange(b, [{ address: "b1@b.example", want: 0, seen }], clock.now));
  clock.now += 2000;
  const r = await handle(await exchange(a, [{ address: "a1@a.example", want: 0 }], clock.now));
  assert.deepEqual(r.json.data.health, [{ address: "a1@a.example", reports: 4, spamRate: 0.3333, replyRate: 0.25, missingRate: 0.25, slow: true }]);
  const mine = await handle(await exchange(b, [{ address: "b1@b.example", want: 0 }], clock.now));
  assert.equal(mine.json.data.health[0].reports, 0, "the report about its own mailbox was not counted");
});

test("health: a mailbox with spam placement over the limit is told to slow and is not handed out as a peer; enough good reports release it", async () => {
  const { handle, clock } = rig({ minReports: 3, spamLimit: 0.3, minIntervalMs: 1000 });
  const a = await space(), b = await space(), c = await space();
  await handle(await join(a, ["a1@a.example"]));
  await handle(await join(b, ["b1@b.example"]));
  await handle(await join(c, ["c1@c.example"]));
  const spammy = ["inbox", "spam", "spam"].map(outcome => ({ from: "a1@a.example", outcome }));
  await handle(await exchange(b, [{ address: "b1@b.example", want: 0, seen: spammy }], clock.now));
  clock.now += 2000;
  const forC = await handle(await exchange(c, [{ address: "c1@c.example", want: 5 }], clock.now));
  assert.deepEqual(forC.json.data.assignments[0].peers, ["b1@b.example"], "a1 is flagged, so c is not sent to it");
  clock.now += 2000;
  const forA = await handle(await exchange(a, [{ address: "a1@a.example", want: 1 }], clock.now));
  assert.equal(forA.json.data.health[0].slow, true);
  // a week later the reports are gone and a1 is a peer again
  clock.now += 8 * DAY;
  await handle(await join(a, ["a1@a.example"], clock.now));
  await handle(await join(b, ["b1@b.example"], clock.now));
  await handle(await join(c, ["c1@c.example"], clock.now));
  const later = await handle(await exchange(c, [{ address: "c1@c.example", want: 5 }], clock.now));
  assert.deepEqual(later.json.data.assignments[0].peers, ["a1@a.example", "b1@b.example"]);
});

test("a key that stops exchanging drops out of the pool after the time to live, and its addresses are free again", async () => {
  const { handle, clock, svc } = rig({ ttlMs: 2 * DAY });
  const a = await space(), b = await space();
  await handle(await join(a, ["a1@a.example"]));
  clock.now += 2 * DAY - 1;
  await handle(await join(b, ["b1@b.example"], clock.now));
  assert.deepEqual(svc.size(), { spaces: 2, mailboxes: 2 });
  clock.now += 2;
  await handle({ method: "GET", path: "/health", headers: {}, body: "" });
  assert.deepEqual(svc.size(), { spaces: 1, mailboxes: 1 });
  assert.equal((await handle(await join(b, ["a1@a.example"], clock.now))).status, 200, "a1@a.example is free");
});

test("routing: unknown paths are 404, the wrong method 405, an oversized body 413; the answers are { data } or { error }", async () => {
  const { handle } = rig();
  const a = await space();
  assert.equal((await handle({ method: "POST", path: "/v1/pool/other", headers: {}, body: "{}" })).status, 404);
  assert.equal((await handle({ method: "GET", path: "/v1/pool/join", headers: {}, body: "" })).status, 405);
  assert.equal((await handle({ method: "POST", path: "/health", headers: {}, body: "" })).status, 405);
  const big = await handle(await a.req("/v1/pool/join", JSON.stringify({ v: 1, mailboxes: [], pad: "x".repeat(70_000) })));
  assert.equal(big.status, 413);
  assert.equal(code(big), "validation.too_large");
  const ok = await handle(await join(a, ["s@h.example"]));
  assert.ok("data" in ok.json && !("error" in ok.json));
});
