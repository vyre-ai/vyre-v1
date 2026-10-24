// One connection: Noise session, length-prefixed frames, 15s heartbeat, numbered events.
import { utf8, utf8Decode } from "./bytes.js";
import { createInitiator } from "./noise.js";

export const HEARTBEAT_MS = 15000;

export class RelayError extends Error {
  constructor(message) {
    super(message);
    this.name = "RelayError";
  }
}

export class RelaySocket {
  constructor() {
    this.buf = new Uint8Array(0);
    this.frames = [];
  }

  static encode(type, payload) {
    const body = payload instanceof Uint8Array ? payload : new Uint8Array(0);
    const len = 1 + body.length;
    if (len > 65535) throw new RelayError("frame");
    const out = new Uint8Array(2 + len);
    out[0] = (len >> 8) & 0xff;
    out[1] = len & 0xff;
    out[2] = type & 0xff;
    out.set(body, 3);
    return out;
  }

  push(chunk) {
    if (!(chunk instanceof Uint8Array)) throw new RelayError("frame");
    if (chunk.length === 0) return;
    const next = new Uint8Array(this.buf.length + chunk.length);
    next.set(this.buf, 0);
    next.set(chunk, this.buf.length);
    this.buf = next;
    while (this.buf.length >= 3) {
      const len = (this.buf[0] << 8) | this.buf[1];
      if (len < 1) throw new RelayError("frame");
      if (this.buf.length < 2 + len) return;
      const type = this.buf[2];
      const payload = this.buf.slice(3, 2 + len);
      this.buf = this.buf.slice(2 + len);
      this.frames.push({ type, payload });
    }
  }

  drain() {
    const frames = this.frames;
    this.frames = [];
    return frames;
  }
}

export class Connection {
  constructor(session) {
    this.session = session;
    this.heartbeatMs = HEARTBEAT_MS;
    this.events = [];
    this.seq = 0;
    this.lastBeat = null;
    this.deliver = null;
  }

  pushEvent(type, body) {
    this.seq += 1;
    const ev = { n: this.seq, type, body };
    this.events.push(ev);
    return ev;
  }

  catchUp(after) {
    const n = typeof after === "number" ? after : 0;
    return this.events.filter((ev) => ev.n > n);
  }

  tick(now) {
    if (this.lastBeat !== null && now - this.lastBeat < this.heartbeatMs) return null;
    this.lastBeat = now;
    return RelaySocket.encode(3, utf8(JSON.stringify({ n: this.seq, t: now })));
  }

  async request(method, path, body) {
    const outbound = utf8(JSON.stringify({ method, path, body: body ?? null }));
    const ct = await this.session.send(outbound);
    if (typeof this.deliver !== "function") return { ciphertext: ct };
    const reply = await this.deliver(ct);
    const plain = await this.session.recv(reply);
    return JSON.parse(utf8Decode(plain));
  }
}

export async function connect(opts) {
  if (opts && opts.session) return new Connection(opts.session);
  if (!opts || typeof opts.exchange !== "function") {
    throw new TypeError("connect needs a session or an exchange function");
  }
  const initiator = await createInitiator(opts);
  const message2 = await opts.exchange(initiator.message1);
  const session = await initiator.finish(message2);
  return new Connection(session);
}
