// @ts-check
// A box for the client's tests (not shipped): the responder side of Noise IK and of the relay channel, built on the same
// async crypto provider as the client, so the device side is checked against an independent reading of the protocol.
// In-memory duplex links and a fake WebSocket let pair() and connect() run without a network.
// The responder follows Noise_IK_25519_AESGCM_SHA256 (revision 34): <- s ... -> e, es, s, ss  <- e, ee, se.

import { SymmetricState, dh } from "../noise.js";
import { Channel, Stream, FRAME, prologue, dial } from "../channel.js";
import { EMPTY, concat, utf8, fromUtf8, toBytes, base64url } from "../bytes.js";
import { webCrypto } from "../webcrypto.js";

export const ROUTE = "abcdefghijklmnopqrstuvwxyz";
const DHLEN = 32;
const TAGLEN = 16;
export const settle = () => new Promise(resolve => setTimeout(resolve, 20));

/** The box's half of the handshake. */
export class Responder {
  /** @param {import("../noise.js").CryptoProvider} c @param {{ s: import("../noise.js").KeyPair, prologue: Uint8Array }} o */
  constructor(c, o) {
    this.c = c;
    this.s = o.s;
    this.prologue = o.prologue;
    this.ss = new SymmetricState(c);
    /** @type {Uint8Array|null} */ this.re = null;
    /** @type {Uint8Array|null} the device's static key, learned from the first message */ this.rs = null;
    /** @type {import("../noise.js").CipherState|null} */ this.send = null;
    /** @type {import("../noise.js").CipherState|null} */ this.recv = null;
    /** @type {Uint8Array|null} */ this.hash = null;
  }

  /** -> e, es, s, ss  @param {Uint8Array} message @returns {Promise<Uint8Array>} the device's hello payload */
  async readMessage(message) {
    if (message.length < DHLEN + DHLEN + TAGLEN + TAGLEN) throw new Error("handshake message too short");
    const ss = this.ss;
    await ss.init();
    await ss.mixHash(this.prologue);
    await ss.mixHash(this.s.publicKey);
    this.re = message.slice(0, DHLEN);
    await ss.mixHash(this.re);
    await ss.mixKey(await dh(this.c, this.s.privateKey, this.re));
    this.rs = await ss.decryptAndHash(message.subarray(DHLEN, DHLEN + DHLEN + TAGLEN));
    await ss.mixKey(await dh(this.c, this.s.privateKey, this.rs));
    return ss.decryptAndHash(message.subarray(DHLEN + DHLEN + TAGLEN));
  }

  /** <- e, ee, se  @param {Uint8Array} payload */
  async writeMessage(payload) {
    const ss = this.ss;
    const e = await this.c.generateKeyPair();
    await ss.mixHash(e.publicKey);
    await ss.mixKey(await dh(this.c, e.privateKey, /** @type {Uint8Array} */ (this.re)));
    await ss.mixKey(await dh(this.c, e.privateKey, /** @type {Uint8Array} */ (this.rs)));
    const out = concat(e.publicKey, await ss.encryptAndHash(payload));
    const [c1, c2] = await ss.split();
    this.recv = c1;
    this.send = c2;
    this.hash = ss.h;
    return out;
  }
}

/** The box's end of an open channel: a device opens streams, the box answers them. */
export class BoxChannel extends Channel {
  /** @param {ConstructorParameters<typeof Channel>} args */
  constructor(...args) {
    super(...args);
    /** @type {(s: Stream) => void} */ this.onstream = () => {};
    /** @type {(payload: Uint8Array) => void} */ this.onpong = () => {};
    /** Every frame that decrypted, for assertions. @type {{ type: number, id: number, size: number }[]} */
    this.seen = [];
  }

  /** @param {Uint8Array} bytes */
  async take(bytes) {
    if (this.closed) return;
    let pt;
    try { pt = await this.rx.decrypt(EMPTY, bytes); } catch { this.close(4400, "decrypt failed"); return; }
    if (this.rx.n % this.rekeyEvery === 0) await this.rx.rekey();
    if (this.closed) return;
    if (pt.length < 5) { this.close(4400, "short frame"); return; }
    const type = pt[0], id = new DataView(pt.buffer, pt.byteOffset).getUint32(1), payload = pt.subarray(5);
    this.seen.push({ type, id, size: payload.length });
    if (id === 0) {
      if (type === FRAME.ping) this.frame(FRAME.pong, 0, payload.slice());
      else if (type === FRAME.pong) this.onpong(payload.slice());
      return;
    }
    let s = this.streams.get(id);
    if (!s) {
      if (type !== FRAME.head) return;
      s = new Stream(this, id);
      this.streams.set(id, s);
      try { s.head = JSON.parse(fromUtf8(payload)); } catch { s.reset("bad head"); return; }
      this.onstream(s);
      return;
    }
    if (type === FRAME.head) {
      try { s.onhead(JSON.parse(fromUtf8(payload))); } catch { s.reset("bad head"); }
    } else if (type === FRAME.data) s.ondata(payload.slice());
    else if (type === FRAME.end) { s.remoteEnded = true; s.onend(); s.gc(); }
    else if (type === FRAME.reset) { this.streams.delete(id); s.onreset(fromUtf8(payload)); }
  }

  /** Answer a stream with a head (a response, or 101 for a WebSocket). @param {Stream} s @param {any} head */
  respond(s, head) { this.frame(FRAME.head, s.id, utf8(JSON.stringify(head))); }
}

/**
 * The box over any transport. `admit` sees the device's static key and hello and returns the reply payload, or throws to
 * refuse (the connection closes with 4401 and the message).
 * @param {import("../noise.js").CryptoProvider} c
 * @param {import("../channel.js").Transport} transport
 * @param {{ s: import("../noise.js").KeyPair, route: string, admit: (devicePub: Uint8Array, hello: any) => Promise<any> | any, rekeyEvery?: number }} o
 * @returns {{ receive: (bytes: Uint8Array) => void, gone: (reason: string) => void, ready: Promise<{ channel: BoxChannel, hello: any, reply: any }> }}
 */
export function boxSide(c, transport, o) {
  const hs = new Responder(c, { s: o.s, prologue: prologue(o.route) });
  /** @type {BoxChannel|null} */
  let channel = null;
  let started = false;
  /** @type {{ resolve: (v: any) => void, reject: (e: any) => void }} */
  let settleReady = /** @type {any} */ (null);
  const ready = new Promise((resolve, reject) => { settleReady = { resolve, reject }; });
  ready.catch(() => {});
  let q = Promise.resolve();
  return {
    ready,
    gone(reason) { if (channel) channel.close(1000, reason); else settleReady.reject(new Error(reason || "connection closed")); },
    receive(bytes) {
      const b = bytes.slice();
      q = q.then(async () => {
        if (channel) { channel.receive(b); return; }
        if (started) { transport.close(4400, "frame before the handshake finished"); return; }
        started = true;
        let hello, reply;
        try {
          hello = JSON.parse(fromUtf8(await hs.readMessage(b)));
          reply = await o.admit(/** @type {Uint8Array} */ (hs.rs), hello);
        } catch (e) {
          const reason = String(/** @type {any} */ (e)?.message || "refused").slice(0, 120);
          transport.close(4401, reason);
          settleReady.reject(new Error(reason));
          return;
        }
        const m2 = await hs.writeMessage(utf8(JSON.stringify(reply)));
        transport.send(m2);
        channel = new BoxChannel(transport, /** @type {any} */ (hs.send), /** @type {any} */ (hs.recv), { peer: /** @type {Uint8Array} */ (hs.rs), hash: /** @type {Uint8Array} */ (hs.hash), rekeyEvery: o.rekeyEvery });
        settleReady.resolve({ channel, hello, reply });
      }).catch(() => {});
    },
  };
}

/**
 * A device and a box wired back to back in memory. Resolves once both channels are open.
 * @param {import("../noise.js").CryptoProvider} c
 * @param {{ box: import("../noise.js").KeyPair, device: import("../noise.js").KeyPair, route?: string, hello?: any, admit?: (pub: Uint8Array, hello: any) => any, rekeyEvery?: number }} o
 */
export async function link(c, o) {
  const route = o.route || ROUTE;
  /** @type {{ device: { receive: (b: Uint8Array) => void }, box: { receive: (b: Uint8Array) => void } }} */
  const ends = /** @type {any} */ ({});
  /** @type {{ from: string, code?: number, reason?: string }[]} */
  const closes = [];
  const mk = (/** @type {string} */ from, /** @type {"device"|"box"} */ to) => ({
    send(/** @type {Uint8Array} */ bytes) { const b = bytes.slice(); setImmediate(() => ends[to].receive(b)); },
    close(/** @type {number|undefined} */ code, /** @type {string|undefined} */ reason) { closes.push({ from, code, reason }); },
  });
  const box = boxSide(c, mk("box", "device"), { s: o.box, route, admit: o.admit || (async () => ({ ok: true })), rekeyEvery: o.rekeyEvery });
  ends.box = box;
  const device = dial(mk("device", "box"), { crypto: c, s: o.device, box: o.box.publicKey, route, hello: o.hello || { v: 1, name: "a test device" }, rekeyEvery: o.rekeyEvery });
  ends.device = device;
  const [{ channel: dch, reply }, { channel: bch, hello }] = await Promise.all([device.ready, box.ready]);
  return { dch, bch, closes, reply, hello };
}

/**
 * An in-memory relay plus box, for pair() and connect(). `WebSocket` is a class the client can take; each instance runs the box's
 * side of the handshake with `admit` and hands the channel to `serve`. The relay answers the text "ping" with "pong" while
 * `pong` is true; `down` refuses new sockets; `sockets[i].drop(code)` ends one from the network.
 * @param {{ box: import("../noise.js").KeyPair, route?: string, admit?: (pub: Uint8Array, hello: any) => any, serve?: (channel: BoxChannel) => void, crypto?: import("../noise.js").CryptoProvider }} o
 */
export function memoryBox(o) {
  const c = o.crypto || crypto;
  const route = o.route || ROUTE;
  const world = {
    box: o.box, route,
    /** @type {any[]} */ sockets: [],
    pong: true,
    /** @type {any[]} */ hellos: [],
    dials: 0,
    down: false,
    /** @type {string[]} */ urls: [],
    /** @type {{ code?: number, reason?: string }[]} what the client or the box closed with */ closed: [],
    /** @type {BoxChannel[]} */ channels: [],
    WebSocket: /** @type {any} */ (null),
  };
  const admit = o.admit || (async () => ({ v: 1, box: { name: "juno" }, device: "kitdevice00000000" }));
  class FakeWebSocket {
    /** @param {string} url */
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.binaryType = "blob";
      this.pings = 0;
      /** @type {any} */ this.onopen = null;
      /** @type {any} */ this.onmessage = null;
      /** @type {any} */ this.onclose = null;
      /** @type {any} */ this.onerror = null;
      world.dials++;
      world.urls.push(url);
      world.sockets.push(this);
      const wrongRoute = new URL(url.replace(/^ws/, "http")).searchParams.get("route") !== route;
      this.side = boxSide(c, { send: b => this.deliver(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), close: (code, reason) => this.drop(code, reason) },
        { s: o.box, route, admit: async (pub, hello) => { world.hellos.push(hello); return admit(pub, hello); } });
      this.side.ready.then(({ channel }) => { this.boxChannel = channel; world.channels.push(channel); o.serve?.(channel); }, () => {});
      queueMicrotask(() => {
        if (world.down || wrongRoute) { this.readyState = 3; this.onerror?.({}); this.side.gone("unreachable"); queueMicrotask(() => this.onclose?.({ code: 1006, reason: "" })); return; }
        if (this.readyState !== 0) return;
        this.readyState = 1;
        this.onopen?.({});
      });
    }
    /** @param {Uint8Array|string} d */
    send(d) {
      if (this.readyState !== 1) throw new Error("not open");
      if (typeof d === "string") {
        this.pings++;
        if (d === "ping" && world.pong) this.deliver("pong");
        return;
      }
      const b = d.slice();
      queueMicrotask(() => { if (this.readyState === 1) this.side.receive(b); });
    }
    /** @param {ArrayBuffer|string} data */
    deliver(data) { queueMicrotask(() => { if (this.readyState === 1) this.onmessage?.({ data }); }); }
    /** @param {number} [code] @param {string} [reason] */
    close(code = 1000, reason = "") { this.drop(code, reason); }
    /** The connection ends, from either side or the network. @param {number} [code] @param {string} [reason] */
    drop(code = 1006, reason = "") {
      if (this.readyState >= 2) return;
      this.readyState = 3;
      world.closed.push({ code, reason });
      this.side.gone(reason || "dropped");
      queueMicrotask(() => this.onclose?.({ code, reason }));
    }
  }
  world.WebSocket = FakeWebSocket;
  return world;
}

/** memoryBox with the shape pair.test.js reads: `{ WebSocket, world }`. @param {import("../noise.js").CryptoProvider} c @param {Parameters<typeof memoryBox>[0]} o */
export function fakeRelay(c, o) {
  const world = memoryBox({ ...o, crypto: c });
  return { WebSocket: world.WebSocket, world };
}

/** Collect a box-side stream's request body, then call `handle(stream, head, body)`. @param {(s: import("../channel.js").Stream, head: any, body: Buffer) => void} handle */
export function serveWith(handle) {
  return (/** @type {BoxChannel} */ channel) => {
    channel.onstream = s => {
      /** @type {Uint8Array[]} */
      const parts = [];
      s.ondata = ch => parts.push(ch);
      s.onend = () => handle(s, s.head, Buffer.from(concat(...parts)));
    };
  };
}

/** Answer a box-side stream with JSON. @param {any} s @param {number} status @param {any} body @param {Record<string, string>} [headers] */
export function reply(s, status, body, headers = {}) {
  s.ch.respond(s, { status, headers: { "content-type": "application/json", ...headers } });
  s.write(utf8(JSON.stringify(body)));
  s.end();
}

/**
 * Let promises, microtasks and WebCrypto's thread pool run (never advances mocked timers): until `until()` holds, for at most `ms`
 * of real time, and always at least a few turns of the loop.
 * @param {() => boolean} [until] @param {number} [ms]
 */
export async function settleUntil(until = () => true, ms = 10_000) {
  const end = Date.now() + ms;
  for (let i = 0; ; i++) {
    if (i >= 20 && until()) return;
    if (Date.now() > end) throw new Error("settle: condition never held");
    await new Promise(r => setImmediate(r));
  }
}

/** The offer URL a box shows as a QR code. @param {{ base?: string, relay: string, route?: string, box: Uint8Array, secret: string, name?: string }} o */
export function offerUrl(o) {
  const offer = { v: 1, r: o.relay, i: o.route || ROUTE, k: base64url(o.box), s: o.secret, ...(o.name ? { n: o.name } : {}) };
  return `${o.base || "https://vyre.run/pair"}#${base64url(utf8(JSON.stringify(offer)))}`;
}

const TAGS = { loc: "vyre-pair-loc", sec: "vyre-pair-sec", mac: "vyre-pair-mac", enc: "vyre-pair-enc" };

/**
 * What a box and a relay hold for a compact ticket: the locator the relay is asked for, the secret the box admits, and the
 * sealed record with its MAC. Derived independently of client.js from the wire description in its README.
 * @param {import("../noise.js").CryptoProvider} c @param {Uint8Array} ticket @param {object} record
 */
export async function ticketRecord(c, ticket, record) {
  const derive = (/** @type {keyof typeof TAGS} */ which) => c.sha256(concat(utf8(`${TAGS[which]}\n`), ticket));
  const [loc, secret, macKey, encKey] = await Promise.all([derive("loc"), derive("sec"), derive("mac"), derive("enc")]);
  const nonce = new Uint8Array(12).fill(5);
  const key = c.aesKey ? await c.aesKey(encKey) : encKey;
  const sealed = concat(nonce, await c.aesGcmEncrypt(key, nonce, utf8("vyre-pair-record\n1"), utf8(JSON.stringify(record))));
  const recordText = base64url(sealed);
  const mac = base64url(await c.hmacSha256(macKey, utf8(recordText)));
  return { loc: base64url(loc), secret: base64url(secret), record: recordText, mac };
}

/**
 * A relay's HTTP side for tickets: POST /v1/pair with { loc } answers { record, mac } once, then 404 (single use).
 * @param {Map<string, { record: string, mac: string }>} store keyed by locator
 */
export function fakeFetch(store) {
  const calls = /** @type {{ url: string, method?: string, body?: string }[]} */ ([]);
  /** @type {(url: string, init?: any) => Promise<any>} */
  const fn = async (url, init = {}) => {
    calls.push({ url, method: init.method, body: init.body });
    const path = new URL(url).pathname;
    const loc = init.body ? JSON.parse(init.body).loc : "";
    const hit = path === "/v1/pair" && init.method === "POST" ? store.get(loc) : undefined;
    if (!hit) return { status: 404, ok: false, json: async () => ({}) };
    store.delete(loc);
    return { status: 200, ok: true, json: async () => hit };
  };
  return Object.assign(fn, { calls });
}

export const crypto = webCrypto();
