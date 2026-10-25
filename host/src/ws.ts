// The live socket (ARCH 5.9): one WebSocket per device per Space, authenticated by the device session. RFC 6455 on node:http, no dependency: text frames, ping/pong, close, fragmentation, a size cap.
// Frames are JSON `{t, ...}`; they carry `tr` (the trace text of ARCH 4.9) so a call made over the socket has one trace id from the client to the log row.
//   hello      client opens with its cursor; the hub answers hello_ok and replays every numbered event after the cursor (replay is what failover to another endpoint relies on)
//   hb         both ways every 15 s with the head seq; a peer silent for 40 s is dropped
//   ev         server to client, numbered by event seq, with the event's trace id; the client acks cumulatively (`ack`) and the hub keeps what is not acked
//   call/res   one capability call over the socket (the low-latency `op` path), through invoke with the frame's trace
//   pull_hint  the head moved
//   purge      a revoke or an epoch bump (ARCH 5.7): `{t:"purge", epoch}` then the socket closes (4003 for one device, 4004 for a person). sync's setLiveHub takes this hub: purge(person, epoch), purgeDevice(person, device, epoch)
// A second connection from the same device replaces the first (close code 4000): one socket per device.
import http from "node:http";
import crypto from "node:crypto";
import type { Duplex } from "node:stream";
import type { EventEnvelope } from "../../packages/contracts/src/envelope.ts";
import { HostError } from "./invoke.ts";
import type { CtxSeed, Invoke } from "./invoke.ts";
import { createTracer, formatTr, parseTr } from "./trace/index.ts";
import type { SpanSink } from "./trace/index.ts";
import type { LogSink } from "./logsink/index.ts";

export const HEARTBEAT_MS = 15_000;
export const HEARTBEAT_DEAD_MS = 40_000;
export const MAX_FRAME_BYTES = 1 << 20;
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// ---- RFC 6455 framing ----

export function encodeFrame(opcode: number, payload: Uint8Array): Buffer {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | opcode; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
  return Buffer.concat([head, payload]);
}

export interface WsMessage { opcode: number; data: Buffer }
/** Incremental frame reader: feed bytes, get whole messages (fragments joined). `error` is set when the peer broke the rules or sent too much. */
export class FrameReader {
  private buf: Buffer = Buffer.alloc(0);
  private parts: Buffer[] = [];
  private firstOpcode = 0;
  error: { code: number; why: string } | null = null;
  private max: number;
  constructor(max: number = MAX_FRAME_BYTES) { this.max = max; }

  push(chunk: Buffer): WsMessage[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: WsMessage[] = [];
    while (!this.error) {
      const b = this.buf;
      if (b.length < 2) break;
      const b0 = b[0]!, b1 = b[1]!;
      const fin = (b0 & 0x80) !== 0, opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) break; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) break; const big = b.readBigUInt64BE(2); if (big > BigInt(this.max)) { this.error = { code: 1009, why: "frame too big" }; break; } len = Number(big); off = 10; }
      if (len > this.max) { this.error = { code: 1009, why: "frame too big" }; break; }
      if (!masked) { this.error = { code: 1002, why: "client frames are masked" }; break; }
      if (b.length < off + 4 + len) break;
      const mask = b.subarray(off, off + 4);
      const data = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] = data[i]! ^ mask[i & 3]!;
      this.buf = b.subarray(off + 4 + len);
      if (opcode >= 0x8) { if (!fin || len > 125) { this.error = { code: 1002, why: "bad control frame" }; break; } out.push({ opcode, data }); continue; }
      if (opcode !== 0) { this.firstOpcode = opcode; this.parts = []; }
      else if (!this.parts.length && !this.firstOpcode) { this.error = { code: 1002, why: "stray continuation" }; break; }
      this.parts.push(data);
      if (this.parts.reduce((n, p) => n + p.length, 0) > this.max) { this.error = { code: 1009, why: "message too big" }; break; }
      if (fin) { out.push({ opcode: this.firstOpcode, data: Buffer.concat(this.parts) }); this.parts = []; this.firstOpcode = 0; }
    }
    return out;
  }
}

// ---- the hub ----

export interface LiveSession { space: string; principal: CtxSeed["principal"]; device: string; actingFor?: string | undefined }
export interface HelloFrame { t: "hello"; cursor?: number; epoch?: number }
export interface LiveOptions {
  /** Who is this upgrade request? null refuses it (401). */
  session(headers: http.IncomingHttpHeaders, url: URL): LiveSession | null | Promise<LiveSession | null>;
  invoke?: Invoke;
  /** The events after a cursor, oldest first: what a (re)connecting device is replayed. */
  eventsSince?(space: string, cursor: number): EventEnvelope[];
  head?(space: string): number;
  sink?: LogSink;
  spans?: SpanSink;
  hbMs?: number;
  deadMs?: number;
  now?: () => number;
}

interface Conn {
  id: string; session: LiveSession; socket: Duplex; reader: FrameReader; lastSeen: number; acked: number; pending: EventEnvelope[]; closed: boolean;
}

export interface LiveHub {
  server: http.Server;
  listen(port?: number): Promise<number>;
  /** Number the events, send them to every connected device of the Space and keep them until acked. */
  publish(space: string, events: EventEnvelope[]): void;
  connections(space?: string): { device: string; acked: number; pending: number }[];
  /** A person's epoch moved: every socket of theirs is told to purge and closed. Returns how many. (The sync module's LiveHub port.) */
  purge(person: string, epoch: number): number;
  /** One device was revoked: only its socket is told to purge and closed. Returns how many. */
  purgeDevice(person: string, device: string, epoch: number): number;
  close(): Promise<void>;
}

export function createLiveHub(o: LiveOptions): LiveHub {
  const hbMs = o.hbMs ?? HEARTBEAT_MS, deadMs = o.deadMs ?? HEARTBEAT_DEAD_MS, now = o.now ?? Date.now;
  const conns = new Map<string, Conn>();   // key: space + device
  const spans: SpanSink = o.spans ?? o.sink ?? { span: () => {} };
  const key = (s: LiveSession): string => `${s.space}\u0000${s.device}`;

  const server = http.createServer((_req, res) => { res.writeHead(426, { "content-type": "text/plain" }).end("upgrade required"); });

  const send = (c: Conn, frame: Record<string, unknown>): void => { if (!c.closed) c.socket.write(encodeFrame(0x1, Buffer.from(JSON.stringify(frame)))); };
  const close = (c: Conn, code: number, why: string): void => {
    if (c.closed) return;
    c.closed = true;
    const reason = Buffer.from(why).subarray(0, 100);
    const body = Buffer.alloc(2 + reason.length); body.writeUInt16BE(code, 0); reason.copy(body, 2);
    try { c.socket.write(encodeFrame(0x8, body)); c.socket.end(); } catch { /* already gone */ }
    if (conns.get(key(c.session)) === c) conns.delete(key(c.session));
    o.sink?.log({ space: c.session.space, level: 20, msg: "live.closed", device: c.session.device, actor: c.session.principal.id, result: String(code) });
  };
  const purgeWhere = (match: (c: Conn) => boolean, epoch: number, code: number, why: string): number => {
    let n = 0;
    for (const c of [...conns.values()]) {
      if (c.closed || !match(c)) continue;
      send(c, { t: "purge", epoch });
      close(c, code, why);
      n++;
    }
    return n;
  };
  const eventFrame = (e: EventEnvelope) => ({ t: "ev", seq: e.seq, items: [e], tr: e.traceId });

  async function onCall(c: Conn, f: { id?: unknown; cap?: unknown; input?: unknown; tr?: unknown; v?: unknown }): Promise<void> {
    const id = typeof f.id === "string" || typeof f.id === "number" ? f.id : null;
    if (!o.invoke || typeof f.cap !== "string") { send(c, { t: "res", id, ok: false, error: { code: "validation.bad_input", message: "a call names a capability" } }); return; }
    const from = parseTr(f.tr);
    const tracer = createTracer(spans, { ...(from ? { from } : {}), now });
    const log = o.sink?.logger({ space: c.session.space, trace_id: tracer.traceId, actor: c.session.principal.id, device: c.session.device, cap: f.cap });
    let rootSpan = "";
    try {
      const r = await tracer.span("ws.call", async (s) => {
        rootSpan = s.spanId;
        log?.info("ws.call", { cap: f.cap });
        const seed: CtxSeed = { space: c.session.space, principal: c.session.principal, trace: { traceId: tracer.traceId, spanId: s.spanId }, device: c.session.device, origin: "user", ...(c.session.actingFor ? { actingFor: c.session.actingFor } : {}), ...(typeof f.v === "number" ? { v: f.v } : {}) };
        return o.invoke!(f.cap as string, f.input, seed);
      });
      send(c, { t: "res", id, ok: true, data: r, tr: formatTr({ traceId: tracer.traceId, spanId: rootSpan }) });
    } catch (e) {
      const err = e instanceof HostError ? e.error : { code: "internal.unexpected", message: "the call failed", traceId: tracer.traceId };
      log?.warn("ws.call.failed", { code: err.code });
      send(c, { t: "res", id, ok: false, error: err, tr: tracer.traceId });
    }
  }

  function onFrame(c: Conn, text: string): void {
    c.lastSeen = now();
    let f: Record<string, unknown>;
    try { const j: unknown = JSON.parse(text); if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("not an object"); f = j as Record<string, unknown>; } catch { close(c, 1003, "frames are JSON objects"); return; }
    switch (f["t"]) {
      case "hello": {
        const cursor = typeof f["cursor"] === "number" && f["cursor"] >= 0 ? f["cursor"] : 0;
        send(c, { t: "hello_ok", head: o.head?.(c.session.space) ?? 0, mode: "live" });
        c.acked = cursor;
        const missed = o.eventsSince?.(c.session.space, cursor) ?? [];
        c.pending = missed.slice();
        for (const e of missed) send(c, eventFrame(e));
        return;
      }
      case "hb": return;   // lastSeen is the point
      case "ack": {
        const seq = typeof f["seq"] === "number" ? f["seq"] : -1;
        if (seq > c.acked) { c.acked = seq; c.pending = c.pending.filter((e) => e.seq > seq); }
        return;
      }
      case "call": void onCall(c, f); return;
      default: send(c, { t: "error", code: "validation.bad_input", message: "unknown frame" });
    }
  }

  server.on("upgrade", (req, socket: Duplex) => {
    void (async () => {
      const wsKey = req.headers["sec-websocket-key"];
      if (String(req.headers["upgrade"]).toLowerCase() !== "websocket" || typeof wsKey !== "string") { socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"); return; }
      let session: LiveSession | null = null;
      try { session = await o.session(req.headers, new URL(req.url ?? "/", "http://live")); } catch { session = null; }
      if (!session) { socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n"); return; }
      const accept = crypto.createHash("sha1").update(wsKey + GUID).digest("base64");
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      const old = conns.get(key(session));
      const c: Conn = { id: crypto.randomUUID(), session, socket, reader: new FrameReader(), lastSeen: now(), acked: 0, pending: [], closed: false };
      if (old) close(old, 4000, "replaced by a newer connection from this device");
      conns.set(key(session), c);
      o.sink?.log({ space: session.space, level: 20, msg: "live.opened", device: session.device, actor: session.principal.id });
      socket.on("data", (chunk: Buffer) => {
        for (const m of c.reader.push(chunk)) {
          if (m.opcode === 0x1) onFrame(c, m.data.toString("utf8"));
          else if (m.opcode === 0x9) socket.write(encodeFrame(0xa, m.data));
          else if (m.opcode === 0x8) { close(c, 1000, "bye"); return; }
        }
        if (c.reader.error) close(c, c.reader.error.code, c.reader.error.why);
      });
      socket.on("close", () => { c.closed = true; if (conns.get(key(session!)) === c) conns.delete(key(session!)); });
      socket.on("error", () => { c.closed = true; });
    })();
  });

  // heartbeat and dead-peer detection
  const timer = setInterval(() => {
    for (const c of [...conns.values()]) {
      if (now() - c.lastSeen > deadMs) { close(c, 4001, "heartbeat missed"); continue; }
      send(c, { t: "hb", seq: o.head?.(c.session.space) ?? 0 });
    }
  }, hbMs);
  timer.unref();

  return {
    server,
    listen: (port = 0) => new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve((server.address() as { port: number }).port))),
    publish(space, events) {
      for (const c of conns.values()) {
        if (c.session.space !== space) continue;
        for (const e of events) { c.pending.push(e); send(c, eventFrame(e)); }
      }
    },
    connections: (space) => [...conns.values()].filter((c) => !space || c.session.space === space).map((c) => ({ device: c.session.device, acked: c.acked, pending: c.pending.length })),
    purge: (person, epoch) => purgeWhere((c) => c.session.principal.id === person, epoch, 4004, "purged"),
    purgeDevice: (person, device, epoch) => purgeWhere((c) => c.session.principal.id === person && c.session.device === device, epoch, 4003, "auth.device_revoked"),
    close: () => new Promise((resolve) => {
      clearInterval(timer);
      for (const c of [...conns.values()]) close(c, 1001, "server stopping");
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}
