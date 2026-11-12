// The live view of an agent's browser in the Space browser, for a viewer who cannot reach the browser service itself (a browser tab on the web app, a phone): the Space relays it.
//   viewer -> Space  GET /browsers/<agent>/stream?ticket=...  (MJPEG) or /browsers/<agent>/ws?ticket=...  (WebSocket: frames down, the person's input up). The ticket is the one
//                    computers.browser.stream or computers.browser.take_over handed out: one use, sixty seconds, for this agent's browser only. It is spent by the computers module (computers.browser_stream_open),
//                    which asks the browser service for its own ticketed address; that address never leaves the Space.
//   input            goes upstream only for a take-over ticket whose person still holds the controls, asked again (at most twice a second) so a give-back stops it at once. A watch ticket gets frames and nothing else.
// The browser service (images/space-browser) serves the same two transports as an agent computer, so the viewer is the same one.
import type http from "node:http";
import type { Duplex } from "node:stream";
import { acceptPeer as accept } from "../ws.ts";
import type { Peer } from "../ws.ts";
import { makeError } from "./errors.ts";

const TRACE = "0".repeat(32);
const VIEW_PATH = /^\/browsers\/([A-Za-z0-9][A-Za-z0-9_-]{2,79})\/(stream|ws)$/;
const MAX_VIEWER_MESSAGE = 4 * 1024;
const MAX_VIEWS = 16;
const INPUT_CHECK_MS = 500;
const INPUT = new Set(["move", "down", "up", "key", "scroll", "type"]);

export interface BrowserOpened { url: string; ws: string; personId: string; input: boolean }
export interface BrowserStreamDeps {
  /** Spend a viewer's ticket for this agent's browser: the browser service's own addresses, who the ticket was issued to, and whether it is a take-over ticket. Null when the ticket is not good. */
  open(ticket: string, agentId: string): Promise<BrowserOpened | null>;
  /** Does this person still hold the controls of this agent's browser? */
  mayInput(agentId: string, personId: string): Promise<boolean>;
  now?: () => number;
  /** How often a view is pinged, and how long one that answers nothing (or a MJPEG view that takes no frames) is kept before it is closed. Default 10 s and 30 s. */
  pingMs?: number;
  deadMs?: number;
}

export interface BrowserStream {
  claims(req: http.IncomingMessage): boolean;
  upgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void;
  /** GET /browsers/<agent>/stream. False when the request is not for this route. */
  handle(req: http.IncomingMessage, res: http.ServerResponse): boolean;
  views(): number;
}

function plain(res: http.ServerResponse, status: number, code: string, message: string): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ error: makeError(code as never, TRACE, { message }) }));
}
const refuseUpgrade = (socket: Duplex, status: string): void => { socket.end(`HTTP/1.1 ${status}\r\nconnection: close\r\n\r\n`); };

// A view counts only while it is alive (second look D, 12 Nov): the holder's own open view keeps a takeover going (sbrowser/hold.ts), so a view whose other end went away (a closed laptop, a proxy that keeps
// the connection) must close here, or it would hold the agent's browser for good. A WebSocket view is pinged and closed when nothing came back for deadMs; a MJPEG view that takes no frame for deadMs
// (its socket is full) is closed too. Closing it closes the view in the browser service, which then counts one view fewer.
export function createBrowserStream(deps: BrowserStreamDeps): BrowserStream {
  const now = deps.now ?? Date.now;
  const PING_MS = deps.pingMs ?? 10_000;
  const DEAD_MS = deps.deadMs ?? 30_000;
  let views = 0;

  function mjpeg(req: http.IncomingMessage, res: http.ServerResponse, agentId: string): void {
    const ticket = new URL(req.url ?? "/", "http://x").searchParams.get("ticket") ?? "";
    if (views >= MAX_VIEWS) return plain(res, 429, "rate_limit.exceeded", "Browsers already have as many viewers as the Space serves.");
    views += 1;
    const abort = new AbortController();
    let done = false;
    const finish = (): void => { if (done) return; done = true; views -= 1; abort.abort(); };
    res.once("close", finish);
    void (async () => {
      const opened = ticket ? await deps.open(ticket, agentId).catch(() => null) : null;
      if (!opened) { finish(); return plain(res, 403, "permission.no_grant", "This view needs a live ticket for this browser."); }
      let up: Response;
      try { up = await fetch(opened.url, { signal: abort.signal }); } catch { finish(); return plain(res, 502, "provider.unavailable", "The browser did not open its view."); }
      if (!up.ok || !up.body) { finish(); return plain(res, 502, "provider.unavailable", "The browser did not open its view."); }
      res.writeHead(200, { "content-type": up.headers.get("content-type") ?? "multipart/x-mixed-replace", "cache-control": "no-store", connection: "close" });
      const reader = up.body.getReader();
      let behindSince = 0;
      // A still page sends no frame, so a viewer that went away (a closed laptop) would never be found out by the frames alone (fourth look, 12 Nov). The last whole frame is kept, sent again when
      // nothing was written for PING_MS, and a timer looks at the socket: one that is gone, or that has taken nothing for DEAD_MS, ends the view and its view in the browser service.
      const BOUNDARY = Buffer.from("--vyreframe");
      let pending = Buffer.alloc(0);
      let lastPart: Buffer | null = null;
      let wroteAt = now();
      const stalled = (): boolean => {
        if (res.writableLength <= 2 * 1024 * 1024) { behindSince = 0; return false; }
        if (behindSince === 0) behindSince = now();
        return now() - behindSince >= DEAD_MS;
      };
      const end = (): void => { clearInterval(watch); try { abort.abort(); } catch { /* gone */ } try { res.end(); } catch { /* gone */ } finish(); };
      const watch = setInterval(() => {
        if (done || res.destroyed || res.writableEnded) { end(); return; }
        if (stalled()) { end(); return; }
        if (lastPart && now() - wroteAt >= PING_MS) { res.write(lastPart); wroteAt = now(); }
      }, Math.max(10, Math.min(PING_MS, DEAD_MS) / 2));
      (watch as { unref?: () => void }).unref?.();
      try {
        for (;;) {
          const { value, done: eof } = await reader.read();
          if (eof || done) break;
          pending = pending.length === 0 ? Buffer.from(value) : Buffer.concat([pending, Buffer.from(value)]);
          for (let at = pending.indexOf(BOUNDARY, 1); at > 0; at = pending.indexOf(BOUNDARY, 1)) { lastPart = pending.subarray(0, at); pending = pending.subarray(at); }
          if (pending.length > 8 * 1024 * 1024) pending = Buffer.alloc(0);
          // a viewer that is behind sees fewer frames, never old ones; one that has taken nothing for DEAD_MS is gone
          if (stalled()) break;
          if (res.writableLength > 2 * 1024 * 1024) continue;
          res.write(value);
          wroteAt = now();
        }
      } catch { /* the viewer left or the browser closed it */ }
      end();
    })().catch(() => { finish(); if (!res.headersSent) plain(res, 500, "internal.unexpected", "The view failed."); else res.end(); });
  }

  function socket(req: http.IncomingMessage, sock: Duplex, head: Buffer, agentId: string): void {
    const ticket = new URL(req.url ?? "/", "http://x").searchParams.get("ticket") ?? "";
    if (views >= MAX_VIEWS) return refuseUpgrade(sock, "429 Too Many Requests");
    views += 1;
    let counted = true;
    const release = (): void => { if (counted) { counted = false; views -= 1; } };
    void (async () => {
      const opened = ticket ? await deps.open(ticket, agentId).catch(() => null) : null;
      if (!opened) { release(); return refuseUpgrade(sock, "403 Forbidden"); }
      const up = new WebSocket(opened.ws);
      up.binaryType = "arraybuffer";
      const connected = await new Promise<boolean>((resolve) => { up.addEventListener("open", () => resolve(true)); up.addEventListener("error", () => resolve(false)); up.addEventListener("close", () => resolve(false)); });
      if (!connected) { release(); return refuseUpgrade(sock, "502 Bad Gateway"); }
      const peer: Peer | null = accept(req, sock, head, MAX_VIEWER_MESSAGE);
      if (!peer) { release(); try { up.close(); } catch { /* gone */ } return; }
      let inputOk = { at: 0, ok: false };
      // alive or closed: pinged every PING_MS, closed when nothing came back for DEAD_MS
      const alive = setInterval(() => {
        if (!peer.open) { clearInterval(alive); return; }
        if (peer.heardAt && Date.now() - peer.heardAt() >= DEAD_MS) { clearInterval(alive); peer.close(1001); try { up.close(); } catch { /* gone */ } release(); return; }
        peer.ping?.();
      }, PING_MS);
      (alive as { unref?: () => void }).unref?.();
      up.addEventListener("message", (ev: MessageEvent) => { if (typeof ev.data === "string") peer.send(ev.data); else peer.send(new Uint8Array(ev.data as ArrayBuffer)); });
      up.addEventListener("close", () => { peer.close(1000); release(); });
      peer.onClose(() => { clearInterval(alive); release(); try { up.close(); } catch { /* gone */ } });
      peer.onMessage((data, binary) => {
        if (binary) return;
        const text = data.toString("utf8");
        let m: { t?: unknown; seq?: unknown };
        try { m = JSON.parse(text) as typeof m; } catch { return; }
        const seq = typeof m.seq === "number" ? m.seq : 0;
        if (m.t === "ping") { peer.send(JSON.stringify({ t: "pong", seq })); return; }
        if (typeof m.t !== "string" || !INPUT.has(m.t)) { peer.send(JSON.stringify({ t: "refused", seq, reason: "I do not know that input." })); return; }
        void (async () => {
          const at = now();
          // only a take-over ticket, and only while its person still holds the controls: the service is asked again, not more than twice a second
          if (opened.input && at - inputOk.at >= INPUT_CHECK_MS) inputOk = { at, ok: await deps.mayInput(agentId, opened.personId).catch(() => false) };
          if (!opened.input || !inputOk.ok) { peer.send(JSON.stringify({ t: "refused", seq, reason: "A person has to take over before the view takes input." })); return; }
          if (up.readyState === 1) up.send(text);
        })();
      });
    })().catch(() => { release(); refuseUpgrade(sock, "500 Internal Server Error"); });
  }

  return {
    claims(req) { return VIEW_PATH.test(new URL(req.url ?? "/", "http://x").pathname); },
    upgrade(req, sock, head) {
      const m = VIEW_PATH.exec(new URL(req.url ?? "/", "http://x").pathname);
      if (!m || m[2] !== "ws") return refuseUpgrade(sock, "404 Not Found");
      socket(req, sock, head, m[1]!);
    },
    handle(req, res) {
      const m = VIEW_PATH.exec(new URL(req.url ?? "/", "http://x").pathname);
      if (!m || m[2] !== "stream") return false;
      if (req.method !== "GET") { plain(res, 405, "validation.bad_input", "Use GET."); return true; }
      mjpeg(req, res, m[1]!);
      return true;
    },
    views: () => views,
  };
}
