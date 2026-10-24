// @ts-check
// A device with no box of its own pairs a fresh server: the server's wink/2 code, the three comparison words, the owner proof, and the
// typed-code join. The server and the relay are the independent test box and fake fetch from box.js.

import test from "node:test";
import assert from "node:assert/strict";
import { parseServerPayload, pairServer } from "../serverpair.js";
import { finishJoin } from "../join.js";
import { nonceCommit, ticketTag, newNonce, pairWords } from "../pairwords.js";
import { pairToProofMessage, ownerIs } from "../finish.js";
import { memoryKeyStore } from "../webcrypto.js";
import { WORDS } from "../words.js";
import { base64url, hex, utf8, fromUtf8 } from "../bytes.js";
import { crypto, fakeFetch, memoryBox, ROUTE, serveWith, ticketRecord } from "./box.js";

const RELAY = "wss://relay.test";
const SEED = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
const PAYLOAD = `vyre://wink/2?t=${base64url(SEED)}&r=${encodeURIComponent(RELAY)}`;
const OWNER = { id: "per_aaaaaaaaaaaaaaaaaaaaaaaaaa", name: "Alex" };
const NB = "b".repeat(32);

async function sha256hex(/** @type {Uint8Array} */ b) { return hex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", b))); }

/** A server whose ticket is gated, and whose wink.server.adopt tool follows the commit, nonce, reveal sequence. */
async function server(opts = {}) {
  const box = await crypto.generateKeyPair();
  const rec = await ticketRecord(crypto, SEED, { v: 1, relay: RELAY, route: ROUTE, box: base64url(box.publicKey), name: "kitchen server", exp: Date.now() + 60_000 });
  const store = new Map([[rec.loc, { record: rec.record, mac: rec.mac }]]);
  /** @type {any[]} */
  const adopts = [];
  const state = { reveals: 0, ...opts };
  const relay = memoryBox({
    box,
    admit: async (_pub, hello) => (hello.pair ? { v: 1, box: { name: "kitchen server" }, pending: "dv7", gate: "server_adopt" } : { v: 1, box: { name: "kitchen server" }, device: "dv7" }),
    serve: serveWith((s, head, body) => {
      const input = JSON.parse(fromUtf8(body));
      adopts.push({ path: head.path, input });
      const say = (/** @type {number} */ status, /** @type {any} */ json) => { s.ch.respond(s, { status, headers: { "content-type": "application/json" } }); s.write(utf8(JSON.stringify(json))); s.end(); };
      const p = input.pairing || {};
      if (state.refuse) return say(403, { error: { code: state.refuse, message: "no" } });
      if (p.cancel) return say(200, { data: { cancelled: true } });
      if (!p.reveal) return say(200, { data: { pending: true, nb: NB } });
      state.reveals++;
      nonceCommit(p.reveal).then(c => {
        if (c !== p.commit) return say(403, { error: { code: "denied", message: "commit mismatch" } });
        if (state.reveals < (state.pollsBeforeYes ?? 2)) return say(200, { data: { pending: true } });
        return say(200, { data: { owner: state.wrongOwner ? { id: "per_bbbbbbbbbbbbbbbbbbbbbbbbbb" } : { id: input.owner.id, name: input.owner.name }, session: true } });
      });
    }),
  });
  return { box, rec, store, relay, adopts, state };
}

test("server payload: the server's wink/2 code parses, a phone's or a broken one does not", () => {
  const ok = parseServerPayload(PAYLOAD);
  assert.deepEqual(ok?.seed, SEED);
  assert.equal(ok?.relay, RELAY);
  assert.deepEqual(parseServerPayload(`  ${PAYLOAD}  `)?.seed, SEED);
  for (const bad of ["", "https://vyre.run/pair", `${PAYLOAD}&k=phone`, `vyre://wink/2?t=${base64url(new Uint8Array(15))}&r=${RELAY}`, "vyre://wink/2?t=!!&r=x", "vyre://wink/2"]) {
    assert.equal(parseServerPayload(bad), null, bad);
  }
});

test("pair words: three words from fresh material, committed before they are revealed", async () => {
  const a = newNonce(), b = newNonce();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
  const words = await pairWords("BOX", "dv1", { ticket: "T", nonceA: a, nonceB: b });
  assert.equal(words.split(" ").length, 3);
  for (const w of words.split(" ")) assert.ok(WORDS.includes(w), w);
  assert.equal(await pairWords("BOX", "dv1", { ticket: "T", nonceA: a, nonceB: b }), words, "the same material gives the same words on both sides");
  for (const other of [["BOX2", "dv1", "T", a, b], ["BOX", "dv2", "T", a, b], ["BOX", "dv1", "T2", a, b], ["BOX", "dv1", "T", b, a], ["BOX", "dv1", "T", a, newNonce()]]) {
    const [box, device, ticket, na, nb] = other;
    assert.notEqual(await pairWords(box, device, { ticket, nonceA: na, nonceB: nb }), words, "any changed part changes the words (a 2^-33 chance of a clash is far below this test's reach)");
  }
  await assert.rejects(pairWords("BOX", "dv1", { nonceA: a, nonceB: "" }), /own nonces/);
  assert.equal(await nonceCommit("abc"), await sha256hex(utf8("24:vyre-wink-pair-commit-v1\n3:abc")), "commit = sha256 of the length-prefixed frame");
  const tag = await ticketTag("ticket");
  assert.match(tag, /^[0-9a-f]{24}$/);
  assert.equal(tag, (await sha256hex(utf8("24:vyre-wink-pair-ticket-v1\n6:ticket"))).slice(0, 24));
});

test("owner proof: the bytes the identity signs are the pinned message the shells read", async () => {
  const m = await pairToProofMessage("BOXKEY", "dv7", "TICKET");
  assert.equal(fromUtf8(m), `vyre-wink-pair-to-v1\nBOXKEY\ndv7\n${await ticketTag("TICKET")}`);
  assert.equal(ownerIs({ owner: { id: "x" } }, "x"), true);
  for (const bad of [null, {}, { owner: {} }, { owner: { id: 5 } }, { owner: { id: "y" } }]) assert.equal(ownerIs(bad, "x"), false);
});

test("pair a server: the code, the words both sides derive, the owner proof, then the owner comes back", async () => {
  const s = await server();
  const keyStore = memoryKeyStore();
  /** @type {string[]} */
  const shown = [];
  /** @type {Uint8Array[]} */
  const signed = [];
  const r = await pairServer({
    payload: PAYLOAD, owner: OWNER, name: "Alex's iPhone", crypto, keyStore, WebSocket: s.relay.WebSocket, fetch: fakeFetch(s.store), pollMs: 1,
    onWords: w => shown.push(w),
    signIdentity: async m => { signed.push(m); return { eid: "eid_1", sig: "sig_1" }; },
  });
  assert.deepEqual({ ...r, owner: undefined }, { paired: true, relay: RELAY, route: ROUTE, box: base64url(s.box.publicKey), device: "dv7", name: "kitchen server", owner: undefined, session: true });
  assert.deepEqual(r.owner, { id: OWNER.id, name: "Alex" });
  const reveal = s.adopts.find(a => a.input.pairing.reveal)?.input.pairing.reveal;
  assert.ok(reveal);
  assert.deepEqual(shown, [await pairWords(base64url(s.box.publicKey), "dv7", { ticket: base64url(SEED), nonceA: reveal, nonceB: NB })], "the words the person compares at the server");
  assert.equal(fromUtf8(signed[0]), `vyre-wink-pair-to-v1\n${base64url(s.box.publicKey)}\ndv7\n${await ticketTag(base64url(SEED))}`);
  const first = s.adopts[0].input;
  assert.equal(s.adopts[0].path, "/v1/tools/wink.server.adopt");
  assert.deepEqual(first.proof, { eid: "eid_1", sig: "sig_1" });
  assert.equal(first.owner.id, OWNER.id);
  assert.equal(first.pairing.commit.length, 64);
  assert.equal(first.pairing.tag, await ticketTag(base64url(SEED)));
  assert.equal(first.pairing.reveal, undefined, "the first call commits and does not reveal");
  assert.ok(s.adopts.slice(1).every(a => a.input.pairing.reveal === reveal && a.input.pairing.commit === first.pairing.commit));
  assert.ok(s.adopts.length >= 3, "a first call and at least two reveals while the person picks");
});

test("pair a server: the server's refusals keep their reasons", async () => {
  const codeOf = async (/** @type {any} */ state, /** @type {any} */ extra = {}) => {
    const s = await server(state);
    try {
      await pairServer({ payload: PAYLOAD, owner: OWNER, crypto, keyStore: memoryKeyStore(), WebSocket: s.relay.WebSocket, fetch: fakeFetch(s.store), pollMs: 1, timeoutMs: 2000, ...extra });
    } catch (e) { return /** @type {any} */ (e).code; }
    return "none";
  };
  assert.equal(await codeOf({ refuse: "denied" }), "denied");
  assert.equal(await codeOf({ refuse: "busy" }), "busy");
  assert.equal(await codeOf({ refuse: "expired" }), "expired");
  assert.equal(await codeOf({ refuse: "owned_by_other" }), "owned_by_other");
  assert.equal(await codeOf({ refuse: "denied_no_proof" }), "denied_no_proof");
  assert.equal(await codeOf({ refuse: "not_hardware" }), "not_hardware");
  assert.equal(await codeOf({ refuse: "bad_input" }), "bad_owner");
  assert.equal(await codeOf({ refuse: "unavailable" }), "cannot_check");
  assert.equal(await codeOf({ refuse: "something_new" }), "unreachable");
  assert.equal(await codeOf({ wrongOwner: true }), "bad_owner", "a success that names someone else is not this pairing's");
  assert.equal(await codeOf({ pollsBeforeYes: 1e9 }, { timeoutMs: 30 }), "expired", "nobody answered at the server in time");
});

test("pair a server: a cancel reaches the server, and codes that are not servers' or are spent fail before any pairing", async () => {
  const s = await server({ pollsBeforeYes: 1e9 });
  const ac = new AbortController();
  const pending = pairServer({ payload: PAYLOAD, owner: OWNER, crypto, keyStore: memoryKeyStore(), WebSocket: s.relay.WebSocket, fetch: fakeFetch(s.store), pollMs: 1, signal: ac.signal, onWords: () => ac.abort() });
  await assert.rejects(pending, e => /** @type {any} */ (e).code === "cancelled");
  assert.ok(s.adopts.some(a => a.input.pairing.cancel === true));

  const none = { payload: PAYLOAD, owner: OWNER, crypto, keyStore: memoryKeyStore(), WebSocket: s.relay.WebSocket };
  await assert.rejects(pairServer({ ...none, payload: "nope" }), e => /** @type {any} */ (e).code === "bad_code");
  await assert.rejects(pairServer({ ...none, owner: /** @type {any} */ ({}) }), e => /** @type {any} */ (e).code === "bad_code");
  await assert.rejects(pairServer({ ...none, fetch: fakeFetch(new Map()) }), e => /** @type {any} */ (e).code === "taken");
  await assert.rejects(pairServer({ ...none, fetch: async () => ({ status: 429, ok: false, json: async () => ({}) }) }), e => /** @type {any} */ (e).code === "busy");
  await assert.rejects(pairServer({ ...none, fetch: async () => ({ status: 500, ok: false, json: async () => ({}) }) }), e => /** @type {any} */ (e).code === "unreachable");
});

test("pair a server: a ticket that was not gated is not a server asking who pairs", async () => {
  const s = await server();
  const open = memoryBox({ box: s.box, admit: async () => ({ v: 1, box: { name: "kitchen server" }, device: "dv7" }) });
  await assert.rejects(pairServer({ payload: PAYLOAD, owner: OWNER, crypto, keyStore: memoryKeyStore(), WebSocket: open.WebSocket, fetch: fakeFetch(s.store) }), e => /** @type {any} */ (e).code === "unreachable");
});

test("join a typed code: pairs when the ticket is at the relay, polls while it is not, and says why when it gives up", async () => {
  const s = await server();
  const sleeps = /** @type {number[]} */ ([]);
  const plain = memoryBox({ box: s.box, admit: async () => ({ v: 1, box: { name: "kitchen server" }, device: "dv8" }) });
  const base = { relay: RELAY, seed: SEED, name: "Alex's PC", sleep: async (/** @type {number} */ ms) => { sleeps.push(ms); }, pairOptions: { crypto, keyStore: memoryKeyStore(), WebSocket: plain.WebSocket } };
  // the ticket appears at the relay on the third look
  let looks = 0;
  const late = async (/** @type {string} */ url, /** @type {any} */ init) => (++looks < 3 ? { status: 404, ok: false, json: async () => ({}) } : fakeFetch(s.store)(url, init));
  const joined = await finishJoin({ ...base, fetch: late, pollMs: 5 });
  assert.equal(joined.ok, true);
  assert.equal(/** @type {any} */ (joined).paired.device, "dv8");
  assert.deepEqual(sleeps, [5, 5]);

  // a QR's ticket is already at the relay: gone means gone
  assert.deepEqual(await finishJoin({ ...base, fetch: fakeFetch(new Map()), once: true }), { ok: false, reason: "gone" });
  // a typed code that never appears expires with its life
  assert.deepEqual(await finishJoin({ ...base, fetch: fakeFetch(new Map()), waitMs: 0 }), { ok: false, reason: "expired" });
  const status = (/** @type {number} */ n) => async () => ({ status: n, ok: false, json: async () => ({}) });
  assert.deepEqual(await finishJoin({ ...base, fetch: status(409) }), { ok: false, reason: "refused" });
  assert.deepEqual(await finishJoin({ ...base, fetch: status(500) }), { ok: false, reason: "offline" });
  const calm = await finishJoin({ ...base, fetch: status(429), waitMs: 0 });
  assert.deepEqual(calm, { ok: false, reason: "expired" }, "a rate limit is waited out like a missing ticket");
});
