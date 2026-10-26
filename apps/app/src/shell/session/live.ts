// The live link of the open Space (ARCH 5.9): the client connection manager (client/src/connection) over a WebSocket to the Space's live socket (`/sync/v1/ws?token=`). The manager says
// hello with the cursor, acks each numbered batch after it is applied, keeps the heartbeat, fails over between endpoints and reconnects with backoff. Here a batch only tells the session
// "something changed" and the session re-reads the queries on screen; the replica that applies rows replaces that later. A server that answers anything but live (update required, resync)
// leaves the link offline for the session, which then polls.
import { createConnection, endpoint } from "../../../../../client/src/connection/index.ts";
import type { Connection, Dial, Scheduler, Status, Transport } from "../../../../../client/src/connection/index.ts";

export type LiveStatus = "connecting" | "live" | "offline";

export interface LiveLinkOptions {
  /** The Space's address (http or https); the socket address is derived from it. */
  baseUrl: string;
  token(): string | null;
  /** This device, from identity.whoami. */
  deviceId: string;
  /**
   * The sync epoch this device last agreed with the server (kept in the stored session), or undefined on a fresh sign-in. It is NOT identity.whoami's epoch: that counts the key epochs,
   * the server's purge test counts sync epochs. A fresh device has nothing local to wipe, so its first purge answer is the server telling it the current epoch: it adopts that and says hello
   * again. A device that has agreed before is purged for real when its epoch is behind (a revoke, a bump), as before.
   */
  epoch?: number;
  /** The epoch this device adopted from the server; the session keeps it for the next hello. */
  onEpoch?(epoch: number): void;
  /** The contract hash this build was made with; the server answers update_required when it is too old. */
  registryHash: string;
  appVersion?: string;
  /** A numbered batch arrived: something in the Space changed. */
  onChange(seq: number): void;
  onStatus?(s: LiveStatus): void;
  /** The server told this device to purge (a revoke or an epoch bump, ARCH 5.7); the manager halts after it. */
  onPurge?(epoch: number): void;
  /** Injectable for tests. */
  dial?: Dial;
  scheduler?: Scheduler;
}

export interface LiveLink { start(): void; stop(): void; status(): LiveStatus }

/** ws(s)://host, the base the manager dials. */
export function socketBase(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "";
  u.search = "";
  return u.toString().replace(/\/$/, "");
}

export const socketPath = (base: string, token: string): string => `${base}/sync/v1/ws?token=${encodeURIComponent(token)}`;

interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

/** A WebSocket as the manager's Transport. Rejects when the socket cannot open. */
export function webSocketDial(token: () => string | null): Dial {
  return (ep, signal) => new Promise<Transport>((resolve, reject) => {
    const t = token();
    const WS = (globalThis as { WebSocket?: new (u: string) => SocketLike }).WebSocket;
    if (!t || !WS) { reject(new Error(t ? "no WebSocket on this platform" : "not signed in")); return; }
    const ws = new WS(socketPath(ep.url, t));
    const frames: ((f: unknown) => void)[] = [];
    const closes: ((reason: string) => void)[] = [];
    let opened = false;
    ws.onopen = () => {
      opened = true;
      resolve({
        send: (f) => ws.send(JSON.stringify(f)),
        close: (reason) => { try { ws.close(1000, reason); } catch { /* already closed */ } },
        onFrame: (cb) => { frames.push(cb); },
        onClose: (cb) => { closes.push(cb); },
      });
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      let f: unknown;
      try { f = JSON.parse(e.data); } catch { return; }
      for (const cb of frames) cb(f);
    };
    ws.onclose = () => { if (!opened) reject(new Error("closed before it opened")); for (const cb of closes) cb("closed"); };
    ws.onerror = () => { /* onclose follows */ };
    signal.addEventListener("abort", () => { try { ws.close(1000, "superseded"); } catch { /* closed */ } }, { once: true });
  });
}

const toLive = (s: Status): LiveStatus => (s === "live" ? "live" : s === "connecting" || s === "reconnecting" ? "connecting" : "offline");

export function createLiveLink(o: LiveLinkOptions): LiveLink {
  let status: LiveStatus = "offline";
  let cursor = 0;
  let conn: Connection | null = null;
  let epoch = o.epoch ?? 0;
  let trusted = o.epoch !== undefined;
  const set = (s: LiveStatus): void => { if (s !== status) { status = s; o.onStatus?.(s); } };

  const link: LiveLink = {
    start() {
      if (conn) return;
      conn = createConnection({
        space: o.baseUrl,
        endpoints: [endpoint("direct", socketBase(o.baseUrl))],
        dial: o.dial ?? webSocketDial(o.token),
        hello: () => ({ deviceId: o.deviceId, deviceClass: "web", appVersion: o.appVersion ?? "0.0.0", registryHash: o.registryHash, epoch, replica: { entities: {} } }),
        cursor: { get: () => cursor, set: (n) => { cursor = n; } },
        apply: (batch) => { o.onChange(batch.seq); },
        ...(o.scheduler ? { scheduler: o.scheduler } : {}),
        on: {
          status: (s) => set(toLive(s)),
          purge: (e) => {
            if (!trusted) {
              // a fresh device: nothing here to wipe, so adopt the server's epoch and say hello again
              trusted = true;
              epoch = e;
              o.onEpoch?.(e);
              const old = conn;
              conn = null;
              queueMicrotask(() => { old?.stop(); restart(); });
              return;
            }
            o.onPurge?.(e);
          },
        },
      });
      conn.start();
    },
    stop() {
      conn?.stop();
      conn = null;
      set("offline");
    },
    status: () => status,
  };
  const restart = (): void => link.start();
  return link;
}
