// One computer of a Space reaching another computer of the same Space through the relay (lane l-multidevice). The relay pipes bytes between a device socket and the other computer's data socket;
// this side runs the Noise IK initiator pinned to the other computer's box key, so the relay sees ciphertext only, then speaks the box channel's framing (seams/relay.ts): one stream per request,
// [type u8][stream u32][payload] frames, odd stream ids from this side. The other computer serves each stream from its own gateway on loopback, exactly as it serves a phone.
// host may not import relay/ (the relay client is a device package), so the initiator and the framing are the host's own; test/peers.link.test.mjs checks them against relay/client.
import { x25519Pair } from "../../../kernel/src/seal/index.ts";
import { CipherState, Initiator } from "../seams/relay.ts";

const FRAME = { head: 1, data: 2, end: 3, reset: 4, ping: 5, pong: 6 } as const;
const CHUNK = 64 * 1024;
const REKEY_EVERY = 2 ** 20;
const EMPTY = new Uint8Array(0);
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const fromUtf8 = (b: Uint8Array): string => new TextDecoder().decode(b);
const fromB64u = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64url"));

/** Where another computer of the Space answers: its relay, its route id, and the box key it proves. */
export interface PeerTarget { relay: string; route: string; box: Uint8Array }

export interface PeerResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  text(): string;
  json<T = unknown>(): T;
}

export interface PeerRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: Uint8Array | string;
  /** Large answers (a snapshot file): each chunk goes here instead of into `body`. */
  sink?: (chunk: Uint8Array) => void | Promise<void>;
  timeoutMs?: number;
}

export interface PeerChannel {
  request(r: PeerRequest): Promise<PeerResponse>;
  close(): void;
  readonly closed: boolean;
}

interface Pending {
  head: { status: number; headers: Record<string, string> } | null;
  chunks: Uint8Array[];
  sink?: PeerRequest["sink"];
  sinkQ: Promise<void>;
  resolve: (r: PeerResponse) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const relayBase = (relay: string): string => relay.replace(/^http/, "ws").replace(/\/+$/, "");

/** Open a channel to another computer. Rejects when the relay or the computer does not answer, or when the computer does not hold the pinned box key. */
export function openPeerChannel(t: PeerTarget, o: { WebSocket?: typeof WebSocket; timeoutMs?: number; hello?: Record<string, unknown> } = {}): Promise<PeerChannel> {
  const WS = o.WebSocket ?? WebSocket;
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try { ws = new WS(`${relayBase(t.relay)}/v1/device?route=${encodeURIComponent(t.route)}`); } catch (e) { reject(e as Error); return; }
    ws.binaryType = "arraybuffer";
    const mine = x25519Pair();
    const hs = new Initiator({ priv: mine.priv, pub: fromB64u(mine.pub) }, t.box, utf8(`vyre-relay-v1\n${t.route}`));
    let settled = false;
    let tx: CipherState | null = null, rx: CipherState | null = null;
    let txq: Promise<void> = Promise.resolve(), rxq: Promise<void> = Promise.resolve();
    let nextId = 1;
    let closed = false;
    const pending = new Map<number, Pending>();
    const fail = (msg: string): void => { if (settled) return; settled = true; clearTimeout(timer); try { ws.close(); } catch { /* closed */ } reject(new Error(msg)); };
    const timer = setTimeout(() => fail("the other computer did not answer"), o.timeoutMs ?? 15_000);

    const shut = (why: string): void => {
      if (closed) return;
      closed = true;
      for (const [, p] of pending) { clearTimeout(p.timer); p.reject(Object.assign(new Error(`connection lost: ${why}`), { lost: true })); }
      pending.clear();
      try { ws.close(1000, why.slice(0, 120)); } catch { /* closed */ }
    };
    const frame = (type: number, id: number, payload: Uint8Array = EMPTY): void => {
      if (closed || !tx) return;
      const pt = new Uint8Array(5 + payload.length);
      pt[0] = type;
      new DataView(pt.buffer).setUint32(1, id);
      pt.set(payload, 5);
      const c = tx;
      txq = txq.then(async () => {
        if (closed) return;
        const ct = await c.encrypt(EMPTY, pt);
        if (c.n % REKEY_EVERY === 0) await c.rekey();
        if (!closed) ws.send(ct);
      }).catch((e: unknown) => shut(String((e as Error)?.message ?? e)));
    };
    const finish = (id: number, p: Pending): void => {
      pending.delete(id);
      clearTimeout(p.timer);
      void p.sinkQ.then(() => {
        if (!p.head) { p.reject(new Error("the other computer ended the stream without an answer")); return; }
        const body = p.chunks.length === 1 ? p.chunks[0]! : Buffer.concat(p.chunks);
        const u8 = new Uint8Array(body);
        p.resolve({ status: p.head.status, headers: p.head.headers, body: u8, text: () => fromUtf8(u8), json: <T,>() => JSON.parse(fromUtf8(u8)) as T });
      }, (e: unknown) => p.reject(e as Error));
    };
    const take = async (bytes: Uint8Array): Promise<void> => {
      if (closed || !rx) return;
      let pt: Uint8Array;
      try { pt = await rx.decrypt(EMPTY, bytes); } catch { shut("decrypt failed"); return; }
      if (rx.n % REKEY_EVERY === 0) await rx.rekey();
      if (pt.length < 5) { shut("short frame"); return; }
      const type = pt[0]!, id = new DataView(pt.buffer, pt.byteOffset).getUint32(1), payload = pt.subarray(5);
      if (id === 0) { if (type === FRAME.ping) frame(FRAME.pong, 0, payload.slice()); return; }
      const p = pending.get(id);
      if (!p) return;
      if (type === FRAME.head) {
        let h: { status?: unknown; headers?: unknown };
        try { h = JSON.parse(fromUtf8(payload)) as typeof h; } catch { h = {}; }
        const headers: Record<string, string> = {};
        if (h.headers && typeof h.headers === "object") for (const [k, v] of Object.entries(h.headers as Record<string, unknown>)) if (typeof v === "string") headers[k.toLowerCase()] = v;
        p.head = { status: Number(h.status) || 0, headers };
      } else if (type === FRAME.data) {
        const c = payload.slice();
        if (p.sink) { const sink = p.sink; p.sinkQ = p.sinkQ.then(() => sink(c)); } else p.chunks.push(c);
      } else if (type === FRAME.end) finish(id, p);
      else if (type === FRAME.reset) { pending.delete(id); clearTimeout(p.timer); p.reject(new Error(`the other computer refused the request: ${fromUtf8(payload).slice(0, 80)}`)); }
    };

    const channel: PeerChannel = {
      get closed() { return closed; },
      close: () => shut("done"),
      request(r) {
        return new Promise((res, rej) => {
          if (closed) { rej(Object.assign(new Error("connection lost"), { lost: true })); return; }
          const id = nextId;
          nextId += 2;
          const ms = r.timeoutMs ?? 60_000;
          const p: Pending = { head: null, chunks: [], ...(r.sink ? { sink: r.sink } : {}), sinkQ: Promise.resolve(), resolve: res, reject: rej, timer: setTimeout(() => { pending.delete(id); frame(FRAME.reset, id, utf8("timeout")); rej(new Error("the other computer took too long to answer")); }, ms) };
          pending.set(id, p);
          frame(FRAME.head, id, utf8(JSON.stringify({ method: r.method.toUpperCase(), path: r.path, headers: r.headers ?? {} })));
          const body = typeof r.body === "string" ? utf8(r.body) : r.body ?? EMPTY;
          for (let i = 0; i < body.length; i += CHUNK) frame(FRAME.data, id, body.subarray(i, i + CHUNK));
          frame(FRAME.end, id);
        });
      },
    };

    ws.onopen = () => {
      void hs.writeMessage(utf8(JSON.stringify({ v: 1, ...(o.hello ?? {}) }))).then((m1) => { try { ws.send(m1); } catch { fail("could not reach the relay"); } }, () => fail("handshake failed"));
    };
    ws.onmessage = (e: MessageEvent) => {
      if (typeof e.data === "string") return;
      const bytes = new Uint8Array(e.data as ArrayBuffer).slice();
      if (tx) { rxq = rxq.then(() => take(bytes), () => {}); return; }
      rxq = rxq.then(async () => {
        if (settled) return;
        try { await hs.readMessage(bytes); } catch { fail("handshake failed: that computer does not hold this Space's key"); return; }
        tx = hs.send; rx = hs.recv;
        settled = true;
        clearTimeout(timer);
        resolve(channel);
      }, () => {});
    };
    ws.onclose = (e: CloseEvent) => { if (!settled) fail(e.reason || "the other computer is not online"); else shut(e.reason || "closed"); };
    ws.onerror = () => { if (!settled) fail("could not reach the relay"); };
  });
}

/** One request on a fresh channel, closed after. */
export async function peerRequest(t: PeerTarget, r: PeerRequest, o: { WebSocket?: typeof WebSocket; timeoutMs?: number } = {}): Promise<PeerResponse> {
  const ch = await openPeerChannel(t, o);
  try { return await ch.request(r); } finally { ch.close(); }
}
