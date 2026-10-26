// The live link of the open Space (ARCH 5.9), in the form the shell needs today: one WebSocket to the Space's server, authenticated by the session token in the query (host/src/ws.ts
// accepts `?token=`), hello with the last seq seen, an ack for every numbered `ev` batch, a heartbeat, and a reconnect with backoff. Each batch tells the session "something changed"
// and the session re-reads the queries on screen. The full connection manager (client/src/connection) is not used here: it expects a richer hello_ok than ws.ts sends today
// (epoch, serverHlc, entityVersions), so it cannot complete a hello against the daemon yet. When both ends agree, this file is replaced by the manager and nothing else changes.
export type LiveStatus = "connecting" | "live" | "offline";

export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}
export type SocketFactory = (url: string) => SocketLike;

export interface LiveLinkOptions {
  /** The Space's address (http or https); the socket URL is derived from it. */
  baseUrl: string;
  token(): string | null;
  /** A numbered batch arrived: something in the Space changed. */
  onChange(seq: number): void;
  onStatus?(s: LiveStatus): void;
  socket?: SocketFactory;
  /** Injectable timers for tests. */
  setTimer?(fn: () => void, ms: number): () => void;
  heartbeatMs?: number;
  backoffBaseMs?: number;
  backoffCapMs?: number;
}

export interface LiveLink { start(): void; stop(): void; status(): LiveStatus }

export function socketUrl(baseUrl: string, token: string): string {
  const u = new URL(baseUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/live";
  u.search = `?token=${encodeURIComponent(token)}`;
  return u.toString();
}

const platformSocket: SocketFactory = (url) => {
  const WS = (globalThis as { WebSocket?: new (u: string) => SocketLike }).WebSocket;
  if (!WS) throw new Error("no WebSocket on this platform");
  return new WS(url);
};

const defaultTimer = (fn: () => void, ms: number): (() => void) => { const h = setTimeout(fn, ms); return () => clearTimeout(h); };

export function createLiveLink(o: LiveLinkOptions): LiveLink {
  const timer = o.setTimer ?? defaultTimer;
  const hbMs = o.heartbeatMs ?? 15_000;
  const base = o.backoffBaseMs ?? 500;
  const cap = o.backoffCapMs ?? 30_000;
  let status: LiveStatus = "offline";
  let wanted = false;
  let sock: SocketLike | null = null;
  let cursor = 0;
  let attempts = 0;
  let cancelRetry: (() => void) | null = null;
  let cancelBeat: (() => void) | null = null;

  const set = (s: LiveStatus): void => { if (s !== status) { status = s; o.onStatus?.(s); } };

  const beat = (): void => {
    cancelBeat?.();
    cancelBeat = timer(() => { try { sock?.send(JSON.stringify({ t: "hb" })); } catch { /* the close handler retries */ } beat(); }, hbMs);
  };

  const retry = (): void => {
    cancelBeat?.();
    cancelBeat = null;
    sock = null;
    set("offline");
    if (!wanted) return;
    const wait = Math.min(cap, base * 2 ** Math.min(attempts, 10));
    attempts++;
    cancelRetry = timer(open, wait);
  };

  function open(): void {
    cancelRetry = null;
    const token = o.token();
    if (!wanted || !token) return;
    set("connecting");
    let s: SocketLike;
    try { s = (o.socket ?? platformSocket)(socketUrl(o.baseUrl, token)); } catch { retry(); return; }
    sock = s;
    s.onopen = () => { s.send(JSON.stringify({ t: "hello", cursor })); };
    s.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      let f: unknown;
      try { f = JSON.parse(e.data); } catch { return; }
      if (f === null || typeof f !== "object") return;
      const t = (f as { t?: unknown }).t;
      if (t === "hello_ok") { attempts = 0; set("live"); beat(); return; }
      if (t === "ev") {
        const seq = (f as { seq?: unknown }).seq;
        if (typeof seq === "number") {
          if (seq > cursor) cursor = seq;
          try { s.send(JSON.stringify({ t: "ack", seq })); } catch { /* the close handler retries */ }
          o.onChange(seq);
        }
      }
    };
    s.onclose = () => { if (sock === s) retry(); };
    s.onerror = () => { /* onclose follows */ };
  }

  return {
    start() { if (wanted) return; wanted = true; attempts = 0; open(); },
    stop() {
      wanted = false;
      cancelRetry?.();
      cancelBeat?.();
      const s = sock;
      sock = null;
      try { s?.close(1000, "bye"); } catch { /* already closed */ }
      set("offline");
    },
    status: () => status,
  };
}
