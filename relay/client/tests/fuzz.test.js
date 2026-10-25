// @ts-check
// Relay fuzz tests, ported to the device side (0.6 core/relay/fuzz.test.js fuzzed the box's channel). The device reads
// bytes from the relay and frames from a box; whatever arrives, the client closes or ignores it and never throws.
// Every run is seeded, so a failure repeats.

import test from "node:test";
import assert from "node:assert/strict";
import { dial, FRAME, Channel } from "../channel.js";
import { parsePairUrl, resolveTicket, PAIR_BASE } from "../client.js";
import { base64url, utf8 } from "../bytes.js";
import { crypto, link, offerUrl, settle, ROUTE, ticketRecord, fakeFetch } from "./box.js";

/** A small seeded generator (xorshift32). */
function rng(seed) {
  let x = seed >>> 0 || 1;
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
  return {
    int: (/** @type {number} */ n) => next() % n,
    pick: (/** @type {any[]} */ list) => list[next() % list.length],
    bytes: (/** @type {number} */ n) => Uint8Array.from({ length: n }, () => next() & 255),
  };
}

/** Hostile JSON-ish values. */
function junk(r, depth = 0) {
  const leaf = [null, true, false, 0, -1, 1.5, 2 ** 53, "", "x".repeat(300), "\u0000", "../etc/passwd", "__proto__", [], {}];
  if (depth > 2) return r.pick(leaf);
  const kind = r.int(4);
  if (kind === 0) return r.pick(leaf);
  if (kind === 1) return Array.from({ length: r.int(4) }, () => junk(r, depth + 1));
  const o = {};
  for (let i = r.int(5); i > 0; i--) o[r.pick(["status", "headers", "method", "path", "ws", "reason", "code", "a", "__proto__", "constructor"])] = junk(r, depth + 1);
  return o;
}

const keys = async () => ({ box: await crypto.generateKeyPair(), device: await crypto.generateKeyPair() });

test("relay fuzz: garbage bytes never throw in the device's channel and close it", async () => {
  const r = rng(11);
  const k = await keys();
  for (let i = 0; i < 100; i++) {
    const { dch, closes } = await link(crypto, k);
    assert.doesNotThrow(() => dch.receive(r.bytes(r.int(200))));
    await dch.rxq;
    assert.equal(dch.closed, true);
    assert.equal(closes.filter(c => c.from === "device").at(-1)?.code, 4400);
  }
});

test("relay fuzz: authentic frames with hostile types, ids, heads and data never throw", async () => {
  const r = rng(12);
  const { dch, bch } = await link(crypto, await keys());
  /** @type {Error[]} */
  const errors = [];
  const guard = (/** @type {() => void} */ fn) => () => { try { fn(); } catch (e) { errors.push(/** @type {Error} */ (e)); } };
  const open = [1, 3, 5].map(() => {
    const s = dch.open({ method: "GET", path: "/v1/health", headers: {} });
    s.onhead = guard(() => {});
    s.ondata = guard(() => {});
    s.onend = guard(() => {});
    s.onreset = guard(() => {});
    return s;
  });
  const ids = [0, 1, 2, 3, 5, 7, 4294967295, ...open.map(s => s.id)];
  const types = [...Object.values(FRAME), 0, 7, 255];
  for (let i = 0; i < 1500 && !dch.closed; i++) {
    const payload = r.pick([new Uint8Array(0), r.bytes(r.int(64)), utf8(JSON.stringify(junk(r))), utf8("{"), utf8("null"), utf8("[1")]);
    bch.frame(r.pick(types), r.pick([...ids, r.int(2 ** 32)]), payload);
    if (i % 100 === 0) await settle();
  }
  await settle();
  await dch.rxq;
  assert.deepEqual(errors, [], "a handler never saw a throw from the channel");
  assert.ok(dch.streams.size <= open.length, "a hostile box cannot open streams on the device");
});

test("relay fuzz: junk where the box's handshake reply belongs fails the dial and closes 4400", async () => {
  const r = rng(13);
  const k = await keys();
  for (let i = 0; i < 60; i++) {
    /** @type {{ code?: number, reason?: string }[]} */
    const closes = [];
    const sent = [];
    const side = dial({ send: b => sent.push(b), close: (code, reason) => closes.push({ code, reason }) }, { crypto, s: k.device, box: k.box.publicKey, route: ROUTE, hello: { v: 1 } });
    side.ready.catch(() => {});
    await settle();
    // dial() sends asynchronously: wait for the first handshake message instead of trusting one settle
    for (let waited = 0; sent.length < 1 && waited < 2000; waited += 20) await new Promise(res => setTimeout(res, 20));
    assert.equal(sent.length, 1, "the first handshake message goes out");
    assert.doesNotThrow(() => side.receive(r.bytes(r.pick([0, 1, 31, 32, 47, 48, 49, 100, 200]))));
    await assert.rejects(side.ready, /not the box in the QR code/);
    assert.equal(closes.at(-1)?.code, 4400);
  }
});

test("relay fuzz: the transport dying mid-handshake rejects the dial, never throws", async () => {
  const k = await keys();
  const side = dial({ send() {}, close() {} }, { crypto, s: k.device, box: k.box.publicKey, route: ROUTE, hello: { v: 1 } });
  await settle();
  side.gone("socket closed");
  await assert.rejects(side.ready, /socket closed/);
  assert.doesNotThrow(() => side.receive(new Uint8Array(10)));
  assert.doesNotThrow(() => side.gone("again"));
});

test("relay fuzz: a frame that cannot decrypt (replayed, reordered, truncated) closes the channel", async () => {
  const { dch, bch, closes } = await link(crypto, await keys());
  /** @type {Uint8Array[]} */
  const wire = [];
  const realSend = bch.transport.send;
  bch.transport.send = b => { wire.push(b.slice()); realSend.call(bch.transport, b); };
  bch.frame(FRAME.head, 2, utf8("{}"));
  await settle();
  assert.equal(wire.length, 1);
  assert.equal(dch.closed, false);
  dch.receive(wire[0]);                      // the same ciphertext again: the counter has moved on
  await dch.rxq;
  assert.equal(dch.closed, true);
  assert.equal(closes.filter(c => c.from === "device").at(-1)?.reason, "decrypt failed");
  const second = await link(crypto, await keys());
  second.dch.receive(new Uint8Array(4));     // shorter than a tag
  await second.dch.rxq;
  assert.equal(second.dch.closed, true);
  assert.ok(second.dch instanceof Channel);
});

test("relay fuzz: parsePairUrl never throws and only returns well-formed offers", () => {
  const r = rng(14);
  const box = new Uint8Array(32).fill(9);
  const good = offerUrl({ relay: "wss://relay.vyre.run", box, secret: "s3cret", name: "juno" });
  assert.equal(parsePairUrl(good)?.route, ROUTE);
  const mutate = (/** @type {string} */ s) => {
    const a = s.split("");
    for (let i = r.int(4) + 1; i > 0; i--) a[r.int(a.length)] = r.pick(["", "!", "=", "A", "#", "/", "\u0000", "é"]);
    return a.join("");
  };
  for (let i = 0; i < 1500; i++) {
    const input = r.pick([mutate(good), mutate(good).slice(0, r.int(good.length)), `${PAIR_BASE}#${base64url(r.bytes(r.int(120)))}`, `${PAIR_BASE}#${base64url(utf8(JSON.stringify(junk(r))))}`, String(r.int(1e6)), "", "#"]);
    let out;
    assert.doesNotThrow(() => { out = parsePairUrl(input); });
    if (out) {
      assert.equal(out.box.length, 32);
      assert.match(out.route, /^[a-z2-7]{26}$/);
      assert.match(out.relay, /^wss?:\/\//);
      assert.ok(out.name.length <= 64);
    }
  }
  assert.equal(parsePairUrl(null), null);
  assert.equal(parsePairUrl(undefined), null);
});

test("relay fuzz: a relay that answers a pairing code with junk is refused with a coded error, never a throw", async () => {
  const r = rng(15);
  const ticket = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const rec = await ticketRecord(crypto, ticket, { v: 1, relay: "wss://relay.test", route: ROUTE, box: base64url(new Uint8Array(32).fill(3)), name: "juno", exp: Date.now() + 60_000 });
  /** @type {any[]} */
  const answers = [
    null, "x", 5, [], {}, { record: 5, mac: 5 }, { record: "!!", mac: "!!" }, { record: rec.record, mac: "!!" }, { record: rec.record, mac: base64url(new Uint8Array(32)) },
    { record: "AAAA", mac: rec.mac }, { record: rec.record + "A", mac: rec.mac },
  ];
  for (let i = 0; i < 40; i++) answers.push({ record: junk(r), mac: junk(r) });
  const codes = new Set(["bad_record", "ticket_gone", "pair_failed"]);
  for (const answer of answers) {
    const fetch = async () => ({ status: 200, ok: true, json: async () => answer });
    await assert.rejects(resolveTicket(ticket, { relay: "wss://relay.test", crypto, fetch }), e => codes.has(/** @type {any} */ (e).code));
  }
  const notJson = async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError("Unexpected token"); } });
  await assert.rejects(resolveTicket(ticket, { relay: "wss://relay.test", crypto, fetch: notJson }), e => /** @type {any} */ (e).code === "bad_record");
  // the honest answer still resolves
  const store = new Map([[rec.loc, { record: rec.record, mac: rec.mac }]]);
  const ok = await resolveTicket(ticket, { relay: "wss://relay.test", crypto, fetch: fakeFetch(store) });
  assert.equal(ok.name, "juno");
});
