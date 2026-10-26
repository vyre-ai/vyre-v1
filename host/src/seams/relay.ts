// The node side of the relay (P-L7b_16, ADR 0026, spec Networking): a Space on someone's own computer, behind NAT, keeps ONE outbound connection to a relay and answers the devices the relay hands it.
//
// Control socket  GET <relay>/v1/box?route=<id>: the relay sends a challenge, the node signs "vyre-relay-box-v1\n<route>\n<challenge>" with its Ed25519 route key (route id = first 26 base32
//                 characters of sha256 of the public key), the relay answers `ready` with a ticket and lists the device connections already waiting. A text "ping" every few seconds gets a
//                 "pong"; two unanswered pings end the socket. Reconnects back off from 1 s to 5 minutes.
// Data socket     for each `open` the relay sends, GET <relay>/v1/box?route=<id>&c=<conn>&t=<ticket>: the first binary message is the device's Noise IK handshake (Noise_IK_25519_AESGCM_SHA256,
//                 prologue "vyre-relay-v1\n<route>", the node's static X25519 key is the key a device pins), then every message is one AES-GCM frame [type u8][stream u32][payload]
//                 (1 head, 2 data, 3 end, 4 reset, 5 ping, 6 pong), the same framing as relay/client/channel.js.
// Streams         a head {method, path, headers} is one HTTP request to this daemon's own gateway on loopback; a head {ws: path, headers} is one WebSocket (the live socket). The node adds no
//                 authority of its own: every request carries the device's bearer token, and the gateway checks it exactly as it does for a direct connection.
// The relay learns the public route key, route id, timing and sizes. It never holds a key that opens a frame.
//
// Layer rules: host never imports relay/ (the relay client is a device-side package), and B3 keeps node:crypto out of the host. Key making, X25519 and the Ed25519 signature come from the kernel's seal
// primitives; the Noise composition (HKDF chain, symmetric state, counter nonces) and AES-GCM are here, on WebCrypto. test/relay.box.test.mjs checks the port against relay/client's own Initiator: same handshake hash, ciphers
// that open each other's frames.
import fs from "node:fs";
import path from "node:path";
import { ed25519Pair, ed25519Sign, x25519Pair, x25519Shared } from "../../../kernel/src/seal/index.ts";

const subtle = globalThis.crypto.subtle;
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const fromUtf8 = (b: Uint8Array): string => new TextDecoder().decode(b);
const EMPTY = new Uint8Array(0);
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const b64u = (b: Uint8Array): string => Buffer.from(b).toString("base64url");
const fromB64u = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64url"));
const isZero = (b: Uint8Array): boolean => b.every((x) => x === 0);

// ---- keys

const B32 = "abcdefghijklmnopqrstuvwxyz234567";

function base32(buf: Uint8Array): string {
  let out = "", value = 0, bits = 0;
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** The route id: the first 26 base32 characters (130 bits) of sha256 of the Ed25519 route key. */
export async function routeIdOf(pub: Uint8Array): Promise<string> {
  return base32(new Uint8Array(await subtle.digest("SHA-256", pub))).slice(0, 26);
}

/** Both keys come from the kernel's seal primitives (x25519Pair, ed25519Pair); this file only keeps them. Seeds are base64url, the public halves raw. */
export interface Keys { routeSeed: string; routePub: Uint8Array; boxPriv: string; boxPub: Uint8Array }

/** The route key (signs the relay's challenge) and the box key (the static Noise key devices pin), made once and kept beside the seal key, readable by this user only. */
export function loadRelayKeys(dir: string): Keys {
  const file = path.join(dir, "relay.key");
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as { routeSeed?: string; routePub?: string; boxPriv?: string; boxPub?: string };
    if (typeof j.routeSeed === "string" && typeof j.routePub === "string" && typeof j.boxPriv === "string" && typeof j.boxPub === "string") {
      return { routeSeed: j.routeSeed, routePub: fromB64u(j.routePub), boxPriv: j.boxPriv, boxPub: fromB64u(j.boxPub) };
    }
  } catch { /* none yet, or unreadable: make new ones */ }
  const route = ed25519Pair(), box = x25519Pair();
  fs.writeFileSync(file, JSON.stringify({ v: 2, routeSeed: route.seed, routePub: route.pub, boxPriv: box.priv, boxPub: box.pub }), { mode: 0o600 });
  return { routeSeed: route.seed, routePub: fromB64u(route.pub), boxPriv: box.priv, boxPub: fromB64u(box.pub) };
}

// ---- Noise_IK_25519_AESGCM_SHA256, responder side (revision 34)

const PROTOCOL = "Noise_IK_25519_AESGCM_SHA256";
const DHLEN = 32, TAGLEN = 16;
const MAX_NONCE = 2 ** 32;
const REKEY_NONCE = new Uint8Array([0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255]);

const sha256 = async (b: Uint8Array): Promise<Uint8Array> => new Uint8Array(await subtle.digest("SHA-256", b));
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, data));
}
async function hkdf2(ck: Uint8Array, ikm: Uint8Array): Promise<[Uint8Array, Uint8Array]> {
  const temp = await hmac(ck, ikm);
  const o1 = await hmac(temp, new Uint8Array([1]));
  const o2 = await hmac(temp, concat(o1, new Uint8Array([2])));
  return [o1, o2];
}
/** X25519 through the kernel's primitive; an all-zero result (a low-order key) is refused, as on the device. */
function dh(privB64: string, pub: Uint8Array): Uint8Array {
  if (pub.length !== DHLEN) throw new Error("an X25519 public key is 32 bytes");
  let out: Uint8Array;
  try { out = new Uint8Array(x25519Shared(privB64, b64u(pub))); } catch { throw new Error("invalid peer key"); }
  if (isZero(out)) throw new Error("invalid peer key");
  return out;
}
const nonceOf = (n: number): Uint8Array => {
  const iv = new Uint8Array(12);
  const v = new DataView(iv.buffer);
  v.setUint32(4, Math.floor(n / 2 ** 32));
  v.setUint32(8, n >>> 0);
  return iv;
};

class CipherState {
  n = 0;
  private k: CryptoKey | null;
  constructor(k: CryptoKey | null = null) { this.k = k; }
  static async of(raw: Uint8Array): Promise<CipherState> { return new CipherState(await subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])); }
  async encrypt(ad: Uint8Array, pt: Uint8Array): Promise<Uint8Array> {
    if (this.k === null) return pt.slice();
    if (this.n >= MAX_NONCE) throw new Error("channel exhausted");
    return new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonceOf(this.n++), additionalData: ad, tagLength: 128 }, this.k, pt));
  }
  async decrypt(ad: Uint8Array, ct: Uint8Array): Promise<Uint8Array> {
    if (this.k === null) return ct.slice();
    if (this.n >= MAX_NONCE || ct.length < TAGLEN) throw new Error("decrypt failed");
    let out: Uint8Array;
    try { out = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonceOf(this.n), additionalData: ad, tagLength: 128 }, this.k, ct)); } catch { throw new Error("decrypt failed"); }
    this.n++;
    return out;
  }
  /** REKEY (spec 11.3): the next key is the first 32 bytes of the encryption of 32 zeros under nonce 2^64-1. */
  async rekey(): Promise<void> {
    if (this.k === null) return;
    const out = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: REKEY_NONCE, additionalData: EMPTY, tagLength: 128 }, this.k, new Uint8Array(32)));
    this.k = await subtle.importKey("raw", out.slice(0, 32), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }
}

class SymmetricState {
  h: Uint8Array = EMPTY;
  ck: Uint8Array = EMPTY;
  cs = new CipherState();
  async init(): Promise<void> {
    const name = utf8(PROTOCOL);
    this.h = name.length <= 32 ? concat(name, new Uint8Array(32 - name.length)) : await sha256(name);
    this.ck = this.h.slice();
  }
  async mixKey(ikm: Uint8Array): Promise<void> { const [ck, k] = await hkdf2(this.ck, ikm); this.ck = ck; this.cs = await CipherState.of(k); }
  async mixHash(data: Uint8Array): Promise<void> { this.h = await sha256(concat(this.h, data)); }
  async encryptAndHash(pt: Uint8Array): Promise<Uint8Array> { const ct = await this.cs.encrypt(this.h, pt); await this.mixHash(ct); return ct; }
  async decryptAndHash(ct: Uint8Array): Promise<Uint8Array> { const pt = await this.cs.decrypt(this.h, ct); await this.mixHash(ct); return pt; }
  async split(): Promise<[CipherState, CipherState]> { const [k1, k2] = await hkdf2(this.ck, EMPTY); return [await CipherState.of(k1), await CipherState.of(k2)]; }
}

/** The box's half: -> e, es, s, ss  then  <- e, ee, se. */
export class Responder {
  private ss = new SymmetricState();
  private re: Uint8Array = EMPTY;
  rs: Uint8Array = EMPTY;
  send: CipherState | null = null;
  recv: CipherState | null = null;
  /** the Noise handshake hash after the second message: both ends hold the same value (the channel binding) */
  hash: Uint8Array = EMPTY;
  private s: { priv: string; pub: Uint8Array };
  private prologue: Uint8Array;
  constructor(s: { priv: string; pub: Uint8Array }, prologue: Uint8Array) { this.s = s; this.prologue = prologue; }
  async readMessage(message: Uint8Array): Promise<Uint8Array> {
    if (message.length < DHLEN + DHLEN + TAGLEN + TAGLEN) throw new Error("handshake message too short");
    const ss = this.ss;
    await ss.init();
    await ss.mixHash(this.prologue);
    await ss.mixHash(this.s.pub);
    this.re = message.slice(0, DHLEN);
    await ss.mixHash(this.re);
    await ss.mixKey(dh(this.s.priv, this.re));
    this.rs = await ss.decryptAndHash(message.subarray(DHLEN, DHLEN + DHLEN + TAGLEN));
    await ss.mixKey(dh(this.s.priv, this.rs));
    return ss.decryptAndHash(message.subarray(DHLEN + DHLEN + TAGLEN));
  }
  async writeMessage(payload: Uint8Array): Promise<Uint8Array> {
    const ss = this.ss;
    const e = x25519Pair();
    const epub = fromB64u(e.pub);
    await ss.mixHash(epub);
    await ss.mixKey(dh(e.priv, this.re));
    await ss.mixKey(dh(e.priv, this.rs));
    const out = concat(epub, await ss.encryptAndHash(payload));
    const [c1, c2] = await ss.split();
    this.recv = c1;
    this.send = c2;
    this.hash = ss.h;
    return out;
  }
}

// ---- the channel

const FRAME = { head: 1, data: 2, end: 3, reset: 4, ping: 5, pong: 6 } as const;
const CHUNK = 64 * 1024;
const REKEY_EVERY = 2 ** 20;
const MAX_AGE = 24 * 60 * 60 * 1000;
const MAX_STREAMS = 64;
const MAX_BODY = 32 * 1024 * 1024;
const MAX_WS_MESSAGE = 1 << 20;

interface Stream { id: number; head: Record<string, unknown>; body: Uint8Array[]; bodyBytes: number; ended: boolean; onData?: (c: Uint8Array) => void; onEnd?: () => void; onReset?: () => void; abort?: AbortController; ws?: WebSocket }

class Channel {
  private txq: Promise<void> = Promise.resolve();
  private rxq: Promise<void> = Promise.resolve();
  readonly streams = new Map<number, Stream>();
  closed = false;
  private opened = Date.now();
  private transport: { send(b: Uint8Array): void; close(code: number, reason: string): void };
  private tx: CipherState;
  private rx: CipherState;
  private onstream: (s: Stream, ch: Channel) => void;
  constructor(transport: { send(b: Uint8Array): void; close(code: number, reason: string): void }, tx: CipherState, rx: CipherState, onstream: (s: Stream, ch: Channel) => void) {
    this.transport = transport; this.tx = tx; this.rx = rx; this.onstream = onstream;
  }
  frame(type: number, id: number, payload: Uint8Array = EMPTY): void {
    if (this.closed) return;
    if (Date.now() - this.opened > MAX_AGE) { this.close(1000, "session too old"); return; }
    const pt = new Uint8Array(5 + payload.length);
    pt[0] = type;
    new DataView(pt.buffer).setUint32(1, id);
    pt.set(payload, 5);
    this.txq = this.txq.then(async () => {
      if (this.closed) return;
      const ct = await this.tx.encrypt(EMPTY, pt);
      if (this.tx.n % REKEY_EVERY === 0) await this.tx.rekey();
      if (!this.closed) this.transport.send(ct);
    }).catch((e: unknown) => this.close(1011, String((e as Error)?.message ?? e)));
  }
  receive(bytes: Uint8Array): void { const b = bytes.slice(); this.rxq = this.rxq.then(() => this.take(b), () => {}); }
  private async take(bytes: Uint8Array): Promise<void> {
    if (this.closed) return;
    let pt: Uint8Array;
    try { pt = await this.rx.decrypt(EMPTY, bytes); } catch { this.close(4400, "decrypt failed"); return; }
    if (this.rx.n % REKEY_EVERY === 0) await this.rx.rekey();
    if (this.closed) return;
    if (pt.length < 5) { this.close(4400, "short frame"); return; }
    const type = pt[0]!, id = new DataView(pt.buffer, pt.byteOffset).getUint32(1), payload = pt.subarray(5);
    if (id === 0) { if (type === FRAME.ping) this.frame(FRAME.pong, 0, payload.slice()); return; }
    let s = this.streams.get(id);
    if (!s) {
      if (type !== FRAME.head || id % 2 === 0 || this.streams.size >= MAX_STREAMS) { if (type === FRAME.head) this.frame(FRAME.reset, id, utf8("busy")); return; }
      let head: unknown;
      try { head = JSON.parse(fromUtf8(payload)); } catch { this.frame(FRAME.reset, id, utf8("bad head")); return; }
      if (typeof head !== "object" || head === null || Array.isArray(head)) { this.frame(FRAME.reset, id, utf8("bad head")); return; }
      s = { id, head: head as Record<string, unknown>, body: [], bodyBytes: 0, ended: false };
      this.streams.set(id, s);
      this.onstream(s, this);
      return;
    }
    if (type === FRAME.data) {
      if (s.onData) s.onData(payload.slice());
      else { s.bodyBytes += payload.length; if (s.bodyBytes > MAX_BODY) { this.reset(s, "too big"); return; } s.body.push(payload.slice()); }
    } else if (type === FRAME.end) { s.ended = true; s.onEnd?.(); }
    else if (type === FRAME.reset) { this.streams.delete(id); s.abort?.abort(); s.ws?.close(); s.onReset?.(); }
  }
  respond(s: Stream, head: Record<string, unknown>): void { this.frame(FRAME.head, s.id, utf8(JSON.stringify(head))); }
  write(s: Stream, bytes: Uint8Array): void { for (let i = 0; i < bytes.length; i += CHUNK) this.frame(FRAME.data, s.id, bytes.subarray(i, i + CHUNK)); }
  end(s: Stream): void { this.frame(FRAME.end, s.id); this.streams.delete(s.id); }
  reset(s: Stream, reason: string): void { this.frame(FRAME.reset, s.id, utf8(reason)); this.streams.delete(s.id); s.abort?.abort(); s.ws?.close(); }
  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const s of this.streams.values()) { s.abort?.abort(); try { s.ws?.close(); } catch { /* already closed */ } s.onReset?.(); }
    this.streams.clear();
    try { this.transport.close(code, reason); } catch { /* already closed */ }
  }
}

// ---- serving a stream from the local gateway

const HOP = new Set(["host", "connection", "content-length", "transfer-encoding", "upgrade", "keep-alive", "te", "trailer", "proxy-authorization", "proxy-connection"]);
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function cleanHeaders(h: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof h !== "object" || h === null) return out;
  for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
    const name = k.toLowerCase();
    if (typeof v === "string" && !HOP.has(name) && /^[a-z0-9-]{1,64}$/.test(name)) out[name] = v;
  }
  out["x-vyre-via"] = "relay";
  return out;
}

function serveStream(s: Stream, ch: Channel, localPort: number): void {
  const path0 = typeof s.head["ws"] === "string" ? s.head["ws"] : typeof s.head["path"] === "string" ? s.head["path"] : "";
  if (!path0.startsWith("/") || path0.startsWith("//") || path0.length > 4096) { ch.reset(s, "bad path"); return; }
  const headers = cleanHeaders(s.head["headers"]);
  if (typeof s.head["ws"] === "string") {
    // the live socket: data frames are [1 text | 2 binary][message], one message per frame
    const WS = globalThis.WebSocket as unknown as new (url: string, init?: unknown) => WebSocket;
    let ws: WebSocket;
    try { ws = new WS(`ws://127.0.0.1:${localPort}${path0}`, { headers }); } catch { ch.reset(s, "refused"); return; }
    ws.binaryType = "arraybuffer";
    s.ws = ws;
    ws.onopen = () => ch.respond(s, { status: 101 });
    ws.onmessage = (e: MessageEvent) => {
      const m = typeof e.data === "string" ? concat(new Uint8Array([1]), utf8(e.data)) : concat(new Uint8Array([2]), new Uint8Array(e.data as ArrayBuffer));
      if (m.length + 5 + TAGLEN > 1 << 20) { ws.close(1009, "too big"); return; }
      ch.frame(FRAME.data, s.id, m);
    };
    ws.onerror = () => { if (ws.readyState !== 1) { ch.respond(s, { status: 502 }); ch.end(s); } };
    ws.onclose = () => { if (ch.streams.has(s.id)) ch.end(s); };
    s.onData = (c) => { if (c.length < 1 || c.length > MAX_WS_MESSAGE || ws.readyState !== 1) return; ws.send(c[0] === 1 ? fromUtf8(c.subarray(1)) : c.subarray(1)); };
    s.onEnd = () => ws.close(1000);
    s.onReset = () => { try { ws.close(); } catch { /* closed */ } };
    return;
  }
  const method = String(s.head["method"] ?? "GET").toUpperCase();
  if (!METHODS.has(method)) { ch.reset(s, "bad method"); return; }
  const run = async (): Promise<void> => {
    s.abort = new AbortController();
    const body = method === "GET" || method === "HEAD" ? undefined : concat(...s.body);
    let res: Response;
    try { res = await fetch(`http://127.0.0.1:${localPort}${path0}`, { method, headers, ...(body && body.length ? { body } : {}), signal: s.abort.signal, redirect: "manual" }); }
    catch { if (ch.streams.has(s.id)) { ch.respond(s, { status: 502, headers: {} }); ch.end(s); } return; }
    const rh: Record<string, string> = {};
    res.headers.forEach((v, k) => { if (!HOP.has(k)) rh[k] = v; });
    ch.respond(s, { status: res.status, headers: rh });
    if (res.body) {
      const reader = res.body.getReader();
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; if (!ch.streams.has(s.id)) { await reader.cancel(); return; } ch.write(s, value); } } catch { /* the device went away or the gateway closed */ }
    }
    if (ch.streams.has(s.id)) ch.end(s);
  };
  if (s.ended) void run(); else s.onEnd = () => { void run(); };
}

// ---- the link

export type RelayState = "healthy" | "degraded" | "down";
export interface RelayBoxOptions {
  /** the relay's base URL, wss://relay.vyre.run (https:// is read as wss://) */
  relayUrl: string;
  /** the data directory; relay.key lives here */
  dataDir: string;
  /** the daemon's own gateway port on loopback */
  localPort: () => number;
  /** the link changed: connected (healthy), or not (down), with the last round trip */
  onState: (s: { state: RelayState; rttMs?: number; at: number }) => void;
  log?: (m: string) => void;
  pingMs?: number;
}
export interface RelayBox {
  /** the route id, once the keys are loaded */
  ready: Promise<{ route: string; deviceUrl: string; boxKey: string }>;
  stop(): void;
  readonly open: number;
}

const BACKOFF_MIN = 1000, BACKOFF_MAX = 5 * 60_000, DIAL_MS = 30_000;

export function startRelayBox(o: RelayBoxOptions): RelayBox {
  const log = o.log ?? (() => {});
  const base = o.relayUrl.replace(/^http/, "ws").replace(/\/+$/, "");
  const pingMs = o.pingMs ?? 20_000;
  let stopped = false;
  let control: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let pinger: ReturnType<typeof setInterval> | null = null;
  let backoff = BACKOFF_MIN;
  let ticket = "";
  let connected = false;
  let lastPingAt = 0, rtt: number | undefined;
  const data = new Map<string, WebSocket>();
  let keys: Keys | null = null;
  let route = "";
  const state = (s: RelayState): void => { connected = s === "healthy"; o.onState({ state: s, ...(rtt !== undefined ? { rttMs: rtt } : {}), at: Date.now() }); };

  function connect(): void {
    if (stopped || !keys) return;
    const k = keys;
    const ws = new WebSocket(`${base}/v1/box?route=${route}`);
    control = ws;
    let missed = 0, settled = false;
    const dial = setTimeout(() => gone(1006, "dial timed out"), DIAL_MS);
    const gone = (code: number, reason: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(dial);
      try { ws.close(); } catch { /* closed */ }
      if (control !== ws) return;
      control = null;
      if (pinger) clearInterval(pinger);
      for (const d of data.values()) { try { d.close(1000, "relay link ended"); } catch { /* closed */ } }
      data.clear();
      if (connected) log(`relay: control link closed (code ${code}${reason ? `, "${reason.slice(0, 80)}"` : ""})`);
      state("down");
      if (stopped) return;
      // 4409: another process holds this route key (a restored copy): wait the longest rather than take turns replacing each other
      if (code === 4409) backoff = BACKOFF_MAX;
      retry = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, BACKOFF_MAX);
    };
    ws.onmessage = (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      if (e.data === "pong") { missed = 0; rtt = Date.now() - lastPingAt; state("healthy"); return; }
      let m: { t?: string; n?: string; ticket?: string; waiting?: unknown; c?: string };
      try { m = JSON.parse(e.data) as typeof m; } catch { return; }
      if (m.t === "challenge") {
        const msg = concat(utf8(`vyre-relay-box-v1\n${route}\n`), fromB64u(String(m.n)));
        let sig: string;
        try { sig = ed25519Sign(k.routeSeed, msg); } catch (err) { log(`relay: could not sign the challenge: ${(err as Error).message}`); return; }
        if (ws === control) ws.send(JSON.stringify({ t: "auth", pub: b64u(k.routePub), sig }));
      } else if (m.t === "ready") {
        clearTimeout(dial);
        ticket = String(m.ticket ?? "");
        backoff = BACKOFF_MIN;
        state("healthy");
        if (pinger) clearInterval(pinger);
        pinger = setInterval(() => {
          if (++missed > 2) { log("relay: no answer to two pings; reconnecting"); try { ws.close(4000, "stale"); } catch { /* closed */ } return; }
          lastPingAt = Date.now();
          try { ws.send("ping"); } catch { /* closing */ }
        }, pingMs);
        pinger.unref?.();
        lastPingAt = Date.now();
        try { ws.send("ping"); } catch { /* closing */ }
        for (const c of Array.isArray(m.waiting) ? m.waiting : []) openData(String(c));
      } else if (m.t === "open") openData(String(m.c));
      else if (m.t === "close") { data.get(String(m.c))?.close(1000); data.delete(String(m.c)); }
    };
    ws.onclose = (e: CloseEvent) => gone(e.code, e.reason);
    ws.onerror = () => gone(1006, "could not reach the relay");
  }

  function openData(c: string): void {
    if (stopped || !keys || data.has(c) || !/^[A-Za-z0-9_-]{1,64}$/.test(c)) return;
    const k = keys;
    const ws = new WebSocket(`${base}/v1/box?route=${route}&c=${encodeURIComponent(c)}&t=${encodeURIComponent(ticket)}`);
    ws.binaryType = "arraybuffer";
    data.set(c, ws);
    const transport = {
      send: (b: Uint8Array): void => { try { ws.send(b); } catch { /* closing */ } },
      close: (code: number, reason: string): void => { try { ws.close(code === 1000 || (code >= 3000 && code <= 4999) ? code : 4000, reason.slice(0, 120)); } catch { /* closed */ } },
    };
    const hs = new Responder({ priv: k.boxPriv, pub: k.boxPub }, utf8(`vyre-relay-v1\n${route}`));
    let channel: Channel | null = null;
    let started = false;
    let q: Promise<void> = Promise.resolve();
    ws.onmessage = (e: MessageEvent) => {
      if (typeof e.data === "string") return;
      const bytes = new Uint8Array(e.data as ArrayBuffer).slice();
      q = q.then(async () => {
        if (channel) { channel.receive(bytes); return; }
        if (started) { transport.close(4400, "frame before the handshake finished"); return; }
        started = true;
        try {
          await hs.readMessage(bytes);   // the device's hello; who it is, is decided per request by the gateway's own token check
          const m2 = await hs.writeMessage(utf8(JSON.stringify({ ok: true, v: 1 })));
          transport.send(m2);
        } catch { transport.close(4401, "refused"); return; }
        channel = new Channel(transport, hs.send!, hs.recv!, (s, ch) => serveStream(s, ch, o.localPort()));
      }).catch(() => {});
    };
    const end = (): void => { if (data.get(c) === ws) data.delete(c); channel?.close(1000, "relay closed the connection"); };
    ws.onclose = end;
    ws.onerror = end;
  }

  const ready = (async () => {
    keys = loadRelayKeys(o.dataDir);
    route = await routeIdOf(keys.routePub);
    connect();
    const deviceUrl = `${base}/v1/device?route=${route}#box=${b64u(keys.boxPub)}`;
    return { route, deviceUrl, boxKey: b64u(keys.boxPub) };
  })();
  ready.catch((e: unknown) => log(`relay: could not start: ${(e as Error).message}`));

  return {
    ready,
    get open() { return data.size; },
    stop() {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (pinger) clearInterval(pinger);
      for (const d of data.values()) { try { d.close(1000, "node stopping"); } catch { /* closed */ } }
      data.clear();
      try { control?.close(1000, "node stopping"); } catch { /* closed */ }
      control = null;
    },
  };
}
