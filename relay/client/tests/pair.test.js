// @ts-check
// Pairing a device with a box, both ways: by invite code (the offer URL a box shows as a QR code) and by pair code (the compact
// ticket a person types or scans, resolved through the relay and verified before anything is paired). The box is the independent
// responder in box.js; the relay is a fake WebSocket and a fake fetch. No network, no real waits.

import test from "node:test";
import assert from "node:assert/strict";
import { pair, pairOffer, pairTicket, resolveTicket, parsePairUrl, keyFingerprint, connect, PAIR_BASE } from "../client.js";
import { memoryKeyStore } from "../webcrypto.js";
import { base32, base64url, fromBase64url, utf8 } from "../bytes.js";
import { crypto, fakeFetch, fakeRelay, offerUrl, ROUTE, settle, ticketRecord } from "./box.js";

const RELAY = "wss://relay.test";
const TICKET = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]);

/** A box that admits one pairing secret once and names itself juno. */
async function world(extra = {}) {
  const box = await crypto.generateKeyPair();
  const used = new Set();
  const secret = "s3cret-" + base64url(crypto.randomBytes(9));
  const relay = fakeRelay(crypto, {
    box, ...extra,
    admit: async (pub, hello) => {
      if (hello.pair !== (/** @type {any} */ (extra).secret ?? secret)) throw new Error("not a pairing code this box minted");
      if (used.has(hello.pair)) throw new Error("this pairing code was already used");
      used.add(hello.pair);
      return { v: 1, box: { name: "juno" }, device: "d2x4q6", presence: null };
    },
  });
  return { box, secret, ...relay };
}

const url = (/** @type {Awaited<ReturnType<typeof world>>} */ w, o = {}) => offerUrl({ relay: RELAY, box: w.box.publicKey, secret: w.secret, name: "juno's box", ...o });

test("pair by invite code: the QR offer pairs this device, and the result holds no secret", async () => {
  const w = await world();
  const keyStore = memoryKeyStore();
  const paired = await pair(url(w), { name: "alex's phone", keyStore, crypto, WebSocket: w.WebSocket });
  assert.deepEqual(paired, { relay: RELAY, route: ROUTE, box: base64url(w.box.publicKey), name: "juno", device: "d2x4q6", presence: null, enroll: null });
  assert.equal(JSON.stringify(paired).includes(w.secret), false, "the one-time secret is not kept");
  assert.equal(w.world.dials, 1);
  assert.equal(w.world.urls[0], `${RELAY}/v1/device?route=${ROUTE}`);
  assert.deepEqual(w.world.hellos, [{ v: 1, pair: w.secret, name: "alex's phone" }]);
  assert.deepEqual(w.world.closed.at(-1), { code: 1000, reason: "paired" }, "the pairing channel closes when done");
});

test("pair by invite code: the device key is made once, non-extractable, and reused by the next pairing", async () => {
  const a = await world(), b = await world();
  const keyStore = memoryKeyStore();
  assert.equal(await keyStore.get(), null);
  await pair(url(a), { keyStore, crypto, WebSocket: a.WebSocket });
  const key = await keyStore.get();
  assert.ok(key);
  assert.equal(key.publicKey.length, 32);
  assert.equal(key.privateKey.extractable, false, "page code can use the key but never read it");
  await assert.rejects(globalThis.crypto.subtle.exportKey("raw", key.privateKey));
  await pair(url(b), { keyStore, crypto, WebSocket: b.WebSocket });
  assert.deepEqual((await keyStore.get())?.publicKey, key.publicKey);
  assert.deepEqual(/** @type {any} */ (b.world.channels[0]).peer, key.publicKey, "the second box sees the same device key");
});

test("pair by invite code: a used, wrong or foreign code is refused with pair_failed", async () => {
  const w = await world();
  const o = { keyStore: memoryKeyStore(), crypto, WebSocket: w.WebSocket, timeout: 2000 };
  await pair(url(w), o);
  await assert.rejects(pair(url(w), o), e => /** @type {any} */ (e).code === "pair_failed" && /already used/.test(/** @type {Error} */ (e).message));
  await assert.rejects(pair(url(w, { secret: "wrong" }), o), e => /** @type {any} */ (e).code === "pair_failed");
  // a QR for a different box: the handshake cannot complete, and the person is told it is not the box in the code
  const stranger = await crypto.generateKeyPair();
  await assert.rejects(pair(url(w, { box: stranger.publicKey }), o), e => /** @type {any} */ (e).code === "pair_failed");
  w.world.down = true;
  await assert.rejects(pair(url(w, { secret: "x" }), o), e => /** @type {any} */ (e).code === "pair_failed" && /reach the relay/.test(/** @type {Error} */ (e).message));
});

test("pair by invite code: not a Vyre code is bad_input before any connection", async () => {
  const w = await world();
  for (const bad of ["", "not a url", `${PAIR_BASE}#!!`, `${PAIR_BASE}`, "https://example.com/pair#" + url(w).split("#")[1], url(w).slice(0, -6)]) {
    await assert.rejects(pair(bad, { keyStore: memoryKeyStore(), crypto, WebSocket: w.WebSocket }), e => /** @type {any} */ (e).code === "bad_input", bad);
  }
  assert.equal(w.world.dials, 0);
});

test("pair by invite code: the pairing page is the Space's to choose (PAIR_BASE is only a default)", async () => {
  const w = await world();
  const own = "https://pair.example.org/p";
  const mine = url(w, { base: own });
  assert.equal(PAIR_BASE, "https://vyre.run/pair");
  assert.equal(parsePairUrl(mine), null, "not the default page");
  assert.equal(parsePairUrl(mine, own)?.route, ROUTE);
  assert.equal(parsePairUrl(url(w), own), null);
  assert.equal(parsePairUrl(url(w), "")?.route ?? null, null, "an empty base matches nothing");
  await assert.rejects(pair(mine, { keyStore: memoryKeyStore(), crypto, WebSocket: w.WebSocket }), e => /** @type {any} */ (e).code === "bad_input");
  const paired = await pair(mine, { pairBase: own, keyStore: memoryKeyStore(), crypto, WebSocket: w.WebSocket });
  assert.equal(paired.name, "juno");
});

test("pair: the box's name is made safe to show, and a gated pairing is marked pending", async () => {
  const w = await world();
  const mk = async (/** @type {any} */ reply) => {
    const box = await crypto.generateKeyPair();
    const r = fakeRelay(crypto, { box, admit: async () => reply });
    return pair(offerUrl({ relay: RELAY, box: box.publicKey, secret: "s" }), { keyStore: memoryKeyStore(), crypto, WebSocket: r.WebSocket });
  };
  assert.equal((await mk({ box: { name: "ju‮no\n\u0000box" }, device: "d1" })).name, "ju no box");
  assert.equal((await mk({ box: { name: "‮\n" }, device: "d1" })).name, "a Vyre box", "nothing left to show");
  assert.equal((await mk({ box: { name: "x".repeat(200) }, device: "d1" })).name.length, 64);
  const gated = await mk({ box: { name: "juno" }, pending: "d9", gate: "g".repeat(40) });
  assert.equal(gated.device, "d9");
  assert.equal(/** @type {any} */ (gated).pending, true);
  assert.equal(/** @type {any} */ (gated).gate.length, 16);
  void w;
});

test("pair by pair code: the ticket resolves to who the box says it is, before anything is paired", async () => {
  const w = await world();
  const record = { v: 1, relay: RELAY, route: ROUTE, box: base64url(w.box.publicKey), name: "juno", handle: "juno", identity: base64url(new Uint8Array(8).fill(4)), address: "https://juno.example.com", exp: Date.now() + 60_000 };
  const rec = await ticketRecord(crypto, TICKET, record);
  const store = new Map([[rec.loc, { record: rec.record, mac: rec.mac }]]);
  const fetch = fakeFetch(store);
  const found = await resolveTicket(TICKET, { relay: RELAY, crypto, fetch });
  assert.equal(w.world.dials, 0, "resolving a ticket connects to no box");
  assert.deepEqual(found.offer, { relay: RELAY, route: ROUTE, box: w.box.publicKey, secret: rec.secret });
  assert.equal(found.name, "juno");
  assert.equal(found.handle, "juno");
  assert.equal(found.address, "https://juno.example.com");
  assert.equal(found.identity, record.identity);
  assert.equal(found.invite, null);
  const want = base32(await crypto.sha256(w.box.publicKey)).slice(0, 8);
  assert.equal(found.fingerprint, `${want.slice(0, 4)} ${want.slice(4)}`, "the fingerprint the box's own prompt shows");
  assert.equal(found.fingerprint, await keyFingerprint(w.box.publicKey, crypto));
  // the ticket never leaves the device: the relay is asked for a locator only, over POST, never in the URL
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, "https://relay.test/v1/pair");
  assert.equal(fetch.calls[0].method, "POST");
  assert.deepEqual(JSON.parse(fetch.calls[0].body ?? ""), { loc: rec.loc });
  assert.equal(fetch.calls[0].body?.includes(base64url(TICKET)), false);
  assert.notEqual(rec.loc, base64url(TICKET));
  assert.notEqual(rec.secret, rec.loc);
});

test("pair by pair code: confirm, then pairOffer pairs with the secret the ticket derives", async () => {
  const w = await world({ secret: undefined });
  const rec = await ticketRecord(crypto, TICKET, { v: 1, relay: RELAY, route: ROUTE, box: base64url(w.box.publicKey), name: "juno", exp: Date.now() + 60_000 });
  // this box admits the ticket's own secret
  const relay = fakeRelay(crypto, { box: w.box, admit: async (_pub, hello) => { assert.equal(hello.pair, rec.secret); return { v: 1, box: { name: "juno" }, device: "dv3" }; } });
  const { offer, name, fingerprint } = await resolveTicket(TICKET, { relay: RELAY, crypto, fetch: fakeFetch(new Map([[rec.loc, { record: rec.record, mac: rec.mac }]])) });
  assert.match(fingerprint, /^[a-z2-7]{4} [a-z2-7]{4}$/);
  assert.equal(name, "juno");
  let shown = "";
  const keyStore = memoryKeyStore();
  const paired = await pairOffer(offer, { name: "alex's phone", keyStore, crypto, WebSocket: relay.WebSocket, onFingerprint: f => { shown = f; } });
  assert.equal(paired.device, "dv3");
  assert.equal(paired.name, "juno");
  assert.equal(paired.box, base64url(w.box.publicKey));
  const key = await keyStore.get();
  assert.equal(shown, await keyFingerprint(/** @type {any} */ (key).publicKey, crypto), "this phone shows the same fingerprint the box shows beside Confirm");
});

test("pair by pair code: pairTicket does both, and returns the box's address and handle when it gave them", async () => {
  const w = await world();
  const record = { v: 1, relay: RELAY, route: ROUTE, box: base64url(w.box.publicKey), name: "juno", handle: "juno", address: "https://juno.example.com", exp: Date.now() + 60_000 };
  const rec = await ticketRecord(crypto, TICKET, record);
  const relay = fakeRelay(crypto, { box: w.box, admit: async (_p, hello) => (hello.pair === rec.secret ? { v: 1, box: { name: "juno" }, device: "dv4" } : Promise.reject(new Error("no"))) });
  const paired = await pairTicket(TICKET, { relay: RELAY, name: "alex's phone", keyStore: memoryKeyStore(), crypto, WebSocket: relay.WebSocket, fetch: fakeFetch(new Map([[rec.loc, { record: rec.record, mac: rec.mac }]])) });
  assert.equal(paired.device, "dv4");
  assert.equal(/** @type {any} */ (paired).address, "https://juno.example.com");
  assert.equal(/** @type {any} */ (paired).handle, "juno");
});

test("pair by pair code: a code is single use, and the relay's refusals keep their reasons", async () => {
  const w = await world();
  const rec = await ticketRecord(crypto, TICKET, { v: 1, relay: RELAY, route: ROUTE, box: base64url(w.box.publicKey), name: "juno", exp: Date.now() + 60_000 });
  const fetch = fakeFetch(new Map([[rec.loc, { record: rec.record, mac: rec.mac }]]));
  await resolveTicket(TICKET, { relay: RELAY, crypto, fetch });
  const code = async (/** @type {() => Promise<unknown>} */ fn) => { try { await fn(); } catch (e) { return /** @type {any} */ (e).code; } return "none"; };
  assert.equal(await code(() => resolveTicket(TICKET, { relay: RELAY, crypto, fetch })), "ticket_gone");
  const status = (/** @type {number} */ s) => async () => ({ status: s, ok: s < 300, json: async () => ({}) });
  assert.equal(await code(() => resolveTicket(TICKET, { relay: RELAY, crypto, fetch: status(429) })), "rate_limited");
  assert.equal(await code(() => resolveTicket(TICKET, { relay: RELAY, crypto, fetch: status(409) })), "contested");
  assert.equal(await code(() => resolveTicket(TICKET, { relay: RELAY, crypto, fetch: status(500) })), "pair_failed");
  assert.equal(await code(() => resolveTicket(TICKET, { relay: "https://nope", crypto, fetch })), "bad_input");
});

test("pair by pair code: a relay that tampers, or a record that lies, is refused before anything is offered", async () => {
  const w = await world();
  const code = async (/** @type {() => Promise<unknown>} */ fn) => { try { await fn(); } catch (e) { return /** @type {any} */ (e).code; } return "none"; };
  const base = { v: 1, relay: RELAY, route: ROUTE, box: base64url(w.box.publicKey), name: "juno", exp: Date.now() + 60_000 };
  const resolveWith = async (/** @type {any} */ record, tweak = (/** @type {any} */ r) => r) => {
    const rec = await ticketRecord(crypto, TICKET, record);
    return resolveTicket(TICKET, { relay: RELAY, crypto, fetch: fakeFetch(new Map([[rec.loc, tweak({ record: rec.record, mac: rec.mac })]])) });
  };
  // the relay swaps the sealed bytes, or keeps them and forges the MAC
  assert.equal(await code(() => resolveWith(base, r => ({ ...r, record: base64url(utf8("swapped by the relay")) }))), "bad_record");
  assert.equal(await code(() => resolveWith(base, r => ({ ...r, mac: base64url(new Uint8Array(32)) }))), "bad_record");
  // a record the box did not make for this ticket cannot be opened
  const other = await ticketRecord(crypto, Uint8Array.from([9, 9, 9, 9, 9, 9, 9, 9]), base);
  assert.equal(await code(() => resolveWith(base, () => ({ record: other.record, mac: other.mac }))), "bad_record");
  // MAC-valid records that are wrong in themselves
  assert.equal(await code(() => resolveWith({ ...base, exp: Date.now() - 1 })), "ticket_gone");
  assert.equal(await code(() => resolveWith({ ...base, relay: "wss://evil.example" })), "bad_record");
  assert.equal(await code(() => resolveWith({ ...base, relay: "wss://relay.test/path?x=1" })), "bad_record");
  assert.equal(await code(() => resolveWith({ ...base, v: 2 })), "bad_record");
  assert.equal(await code(() => resolveWith({ ...base, route: "short" })), "bad_record");
  assert.equal(await code(() => resolveWith({ ...base, box: base64url(new Uint8Array(31)) })), "bad_record");
  assert.equal(await code(() => resolveWith({ ...base, box: "!!" })), "bad_record");
  assert.equal(await code(() => resolveWith(null)), "bad_record");
  // odd but valid fields are cleaned, not trusted
  const clean = await resolveWith({ ...base, name: "ju‮no", handle: "not a handle!", address: "http://insecure.example", identity: "short", offer: { big: "x".repeat(3000) } });
  assert.equal(clean.name, "ju no");
  assert.equal(clean.handle, null);
  assert.equal(clean.address, null);
  assert.equal(clean.identity, null);
  assert.equal(clean.invite, null);
  assert.deepEqual((await resolveWith({ ...base, offer: { hello: 1 } })).invite, { hello: 1 });
});

test("connect after pairing: requests and the keepalive text ride the paired channel", async t => {
  const w = await world();
  const keyStore = memoryKeyStore();
  const paired = await pair(url(w), { keyStore, crypto, WebSocket: w.WebSocket });
  const served = fakeRelay(crypto, {
    box: w.box, admit: async () => ({ v: 1, box: { name: "juno" } }),
    serve: channel => {
      channel.onstream = s => {
        let body = "";
        s.ondata = c => { body += new TextDecoder().decode(c); };
        s.onend = () => {
          channel.respond(s, { status: 200, headers: { "content-type": "application/json" } });
          s.write(utf8(JSON.stringify({ path: s.head.path, method: s.head.method, body, key: s.head.headers["idempotency-key"] ?? null })));
          s.end();
        };
      };
    },
  });
  const conn = connect({ ...paired, keyStore, crypto, WebSocket: served.WebSocket });
  t.after(() => conn.close());
  const res = await conn.fetch("/v1/health");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { path: "/v1/health", method: "GET", body: "", key: null });
  const post = await (await conn.fetch("/v1/tools/notes.add", { method: "POST", body: JSON.stringify({ text: "hi" }) })).json();
  assert.equal(post.method, "POST");
  assert.equal(post.body, '{"text":"hi"}');
  assert.match(post.key, /^[0-9a-f-]{36}$/, "every non-GET carries an Idempotency-Key");
  assert.equal(conn.state, "open");
  assert.equal(served.world.dials, 1);
  await settle();
  assert.equal(fromBase64url(paired.box).length, 32);
});
