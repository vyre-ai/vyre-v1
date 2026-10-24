// @ts-check
// The calling side of the peer wire over a relay stream: frames of [type][flags][id u32][length u32][payload], calls sliced at 16 KB,
// server-opened streams, and the refusals a home gives. The server here is a minimal reader of the same frames, written from the wire description.

import test from "node:test";
import assert from "node:assert/strict";
import { peerClient, openServerPeer } from "../peerclient.js";
import { crypto, link, settle, settleUntil } from "./box.js";

const HEAD = 10;
const T = { call: 1, result: 2, more: 3, ping: 4, pong: 5, stream: 9, streamEnd: 10 };
const enc = new TextEncoder(), dec = new TextDecoder();
const SLICE = 16 * 1024;

/** @param {number} type @param {number} flags @param {number} id @param {Uint8Array} payload */
function frame(type, flags, id, payload) {
  const out = new Uint8Array(HEAD + payload.length);
  const v = new DataView(out.buffer);
  out[0] = type; out[1] = flags; v.setUint32(2, id); v.setUint32(6, payload.length);
  out.set(payload, HEAD);
  return out;
}
const cat = (/** @type {Uint8Array[]} */ ...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let at = 0; for (const x of p) { o.set(x, at); at += x.length; } return o; };

/** The home's side of a peer stream. `send` carries bytes to the client; `serve(tool, input, zone)` answers calls. */
function server(/** @type {(b: Uint8Array) => void} */ send, /** @type {(tool: string, input: any, zone?: string) => any} */ serve) {
  let buf = new Uint8Array(0);
  /** @type {Map<number, Uint8Array[]>} */
  const parts = new Map();
  const log = { frames: /** @type {{ type: number, id: number, text: string }[]} */ ([]), zones: /** @type {any[]} */ ([]) };
  const result = (/** @type {number} */ id, /** @type {any} */ body) => {
    const bytes = enc.encode(JSON.stringify(body));
    for (let off = 0; off === 0 || off < bytes.length; off += SLICE) {
      const end = Math.min(off + SLICE, bytes.length);
      send(frame(off === 0 ? T.result : T.more, end < bytes.length ? 1 : 0, id, bytes.subarray(off, end)));
      if (end >= bytes.length) break;
    }
  };
  return {
    log, result,
    push(/** @type {number} */ type, /** @type {any} */ body) { send(frame(type, 0, 0, enc.encode(JSON.stringify(body)))); },
    ping(/** @type {Uint8Array} */ payload) { send(frame(T.ping, 0, 0, payload)); },
    receive(/** @type {Uint8Array} */ chunk) {
      buf = cat(buf, chunk);
      while (buf.length >= HEAD) {
        const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        const len = v.getUint32(6);
        if (buf.length < HEAD + len) break;
        const type = buf[0], more = (buf[1] & 1) === 1, id = v.getUint32(2), payload = buf.slice(HEAD, HEAD + len);
        buf = buf.slice(HEAD + len);
        log.frames.push({ type, id, text: type === T.pong ? Array.from(payload).join(",") : dec.decode(payload) });
        if (type === T.pong || type === T.streamEnd) continue;
        const list = type === T.more ? parts.get(id) ?? [] : [];
        list.push(payload);
        if (more) { parts.set(id, list); continue; }
        parts.delete(id);
        if (type !== T.call && !(type === T.more)) continue;
        const call = JSON.parse(dec.decode(cat(...list)));
        log.zones.push(call.zone);
        Promise.resolve().then(() => serve(call.tool, call.input, call.zone)).then(
          data => result(id, { ok: true, data }),
          err => result(id, { ok: false, error: { code: err.code || "internal", message: err.message, ...(err.detail ? { detail: err.detail } : {}) } }),
        );
      }
    },
  };
}

function pair(/** @type {Parameters<typeof server>[1]} */ serve, o = {}) {
  /** @type {any} */
  const stream = { ondata() {}, onend() {}, onreset() {}, ended: 0, resets: /** @type {string[]} */ ([]), write(/** @type {Uint8Array} */ b) { queueMicrotask(() => srv.receive(b)); }, end() { stream.ended++; }, reset(/** @type {string} */ why) { stream.resets.push(why); } };
  const srv = server(b => queueMicrotask(() => stream.ondata(b)), serve);
  return { client: peerClient(stream, o), stream, srv };
}

test("peerclient: a call, an error with its detail, and a message larger than a slice both ways", async () => {
  const { client, srv } = pair(async (tool, input) => {
    if (tool === "boom") throw Object.assign(new Error("no"), { code: "denied", detail: { why: "policy" } });
    if (tool === "weird") throw Object.assign(new Error("x"), {});
    return { tool, echo: input };
  });
  assert.deepEqual(await client.call("a.b", { x: 1 }), { tool: "a.b", echo: { x: 1 } });
  await assert.rejects(() => client.call("boom"), e => e.code === "denied" && e.message === "no" && e.detail.why === "policy");
  await assert.rejects(() => client.call("weird"), e => e.code === "internal");
  const big = "é".repeat(100_000);
  assert.equal((await client.call("big", { big })).echo.big, big);
  assert.ok(srv.log.frames.filter(f => f.type === T.more).length >= 10, "a big call goes out as continuation frames");
  assert.ok(srv.log.zones.every(z => z === undefined || typeof z === "string"), "the device zone rides with the call when the runtime has one");
  client.close();
  assert.equal(client.closed, true);
  await assert.rejects(() => client.call("a"), e => e.code === "unreachable");
});

test("peerclient: calls overlap, answers find their own call, and a slow server times out", async () => {
  /** @type {Array<() => void>} */
  const releases = [];
  const { client } = pair((tool) => new Promise(resolve => { releases.push(() => resolve(tool)); if (tool === "never") releases.pop(); }));
  const a = client.call("first"), b = client.call("second");
  await settle();
  releases.reverse().forEach(r => r());
  assert.deepEqual([await a, await b], ["first", "second"]);
  await assert.rejects(() => client.call("never", {}, { timeoutMs: 20 }), e => e.code === "timeout");
});

test("peerclient: an invite the home will not admit is a refusal, not an unreachable server", async () => {
  const mk = () => pair(() => null);
  const a = mk();
  const pending = a.client.call("kernel.call", {});
  a.stream.onreset("not admitted");
  await assert.rejects(() => pending, e => e.code === "denied" && e.message === "This invite cannot be used.");
  const b = mk();
  const dropped = b.client.call("kernel.call", {});
  b.stream.onreset("reset");
  await assert.rejects(() => dropped, e => e.code === "unreachable");
  const c = mk();
  const ended = c.client.call("kernel.call", {});
  c.stream.onend();
  await assert.rejects(() => ended, e => e.code === "unreachable");
});

test("peerclient: a frame longer than 64 KB, or a continuation with no start, closes the connection", async () => {
  const big = pair(() => null);
  const pending = big.client.call("x");
  const oversize = new Uint8Array(HEAD);
  new DataView(oversize.buffer).setUint32(6, 65 * 1024);
  big.stream.ondata(oversize);
  await assert.rejects(() => pending, e => e.code === "unreachable" && /frame too big/.test(e.message));
  assert.deepEqual(big.stream.resets, ["bad frame"]);
  const orphan = pair(() => null);
  const p2 = orphan.client.call("x");
  orphan.stream.ondata(frame(T.more, 0, 99, new Uint8Array(3)));
  await assert.rejects(() => p2, e => /continuation without a start/.test(e.message));
});

test("peerclient: the server's ping is answered with the same bytes", async () => {
  const { srv } = pair(() => null);
  srv.ping(Uint8Array.from([1, 2, 3]));
  await settle();
  assert.deepEqual(srv.log.frames.filter(f => f.type === T.pong).map(f => f.text), ["1,2,3"], "a pong came back with the same bytes");
});

test("peerclient: a stream the server opens delivers frames in order, including those that beat the answer, and ends", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });   // frames that beat their answer are held for 5 s; do not wait that out
  const settle = settleUntil;
  const { client, srv, stream } = pair(tool => (tool === "watch" ? { stream: "s1" } : null));
  /** @type {Array<[any, number]>} */
  const got = [];
  /** @type {string[]} */
  const ended = [];
  // the server sends frames for s1 right behind the answer, before the caller has had a turn to attach
  const origWrite = stream.write;
  stream.write = (/** @type {Uint8Array} */ b) => { origWrite(b); queueMicrotask(() => { srv.push(T.stream, { id: "s1", seq: 1, data: "one" }); srv.push(T.stream, { id: "s1", seq: 2, data: "two" }); }); };
  const s = await client.openStream("watch", {}, { onframe: (data, seq) => got.push([data, seq]), onend: why => ended.push(why) });
  await settle();
  srv.push(T.stream, { id: "s1", seq: 3, data: "three" });
  srv.push(T.stream, { id: "other", seq: 1, data: "not ours" });
  srv.push(T.streamEnd, { id: "s1", why: "server done" });
  await settle();
  assert.equal(s.id, "s1");
  assert.deepEqual(got, [["one", 1], ["two", 2], ["three", 3]]);
  assert.deepEqual(ended, ["server done"]);
  // closing a stream that already ended says nothing; one still open tells the server
  s.close();
  const t = await client.openStream("watch", {}, { onframe: () => {} });
  t.close();
  await settle();
  const closes = srv.log.frames.filter(f => f.type === T.streamEnd).map(f => JSON.parse(f.text));
  assert.deepEqual(closes, [{ id: "s1", why: "client" }]);
  await assert.rejects(() => pair(() => ({ nothing: true })).client.openStream("x", {}, { onframe: () => {} }), e => e.code === "bad_input");
});

test("peerclient: a dropped connection ends every open stream with 'closed'; attachStream listens to a stream the server already opened", async () => {
  const { client, stream, srv } = pair(() => ({}));
  /** @type {string[]} */
  const ended = [];
  /** @type {any[]} */
  const got = [];
  const a = client.attachStream("pre", { onframe: d => got.push(d), onend: why => ended.push(why) }, { hello: 1 });
  assert.deepEqual(a.result, { hello: 1 });
  srv.push(T.stream, { id: "pre", seq: 1, data: "x" });
  await settle();
  assert.deepEqual(got, ["x"]);
  stream.onend();
  assert.deepEqual(ended, ["closed"]);
  assert.throws(() => client.attachStream("", { onframe: () => {} }), /stream id is missing/);
});

test("openServerPeer: the home answers 200 and the peer wire runs on the relay stream; refusals keep their reasons", async () => {
  const keys = { box: await crypto.generateKeyPair(), device: await crypto.generateKeyPair() };
  const { dch, bch } = await link(crypto, keys);
  /** @type {any[]} */
  const heads = [];
  bch.onstream = s => {
    heads.push(s.head);
    bch.respond(s, { status: s.head.space === "denied" ? 403 : s.head.space === "busy" ? 429 : 200, headers: {} });
    if (s.head.space !== "home" && s.head.space !== "invited") return;
    const srv = server(b => s.write(b), (tool, input) => ({ tool, input }));
    s.ondata = chunk => srv.receive(chunk);
  };
  const conn = { ready: async () => dch };
  const peer = await openServerPeer(conn);
  assert.deepEqual(await peer.call("records.me", { a: 1 }), { tool: "records.me", input: { a: 1 } });
  peer.close();
  await openServerPeer(conn, { space: "invited", invitee: { sig: "s" } });
  assert.deepEqual(heads[0], { peer: "wink", space: "home" });
  assert.deepEqual(heads[1], { peer: "wink", space: "invited", invitee: { sig: "s" } });
  await assert.rejects(() => openServerPeer(conn, { space: "denied" }), e => e.code === "denied");
  await assert.rejects(() => openServerPeer(conn, { space: "busy" }), e => e.code === "rate_limited");
  const quiet = await link(crypto, keys);
  quiet.bch.onstream = () => {};
  await assert.rejects(() => openServerPeer({ ready: async () => quiet.dch }, { timeoutMs: 30 }), e => e.code === "unreachable");
});
