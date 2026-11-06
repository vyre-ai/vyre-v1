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

export function createBrowserStream(deps: BrowserStreamDeps): BrowserStream {
  const now = deps.now ?? Date.now;
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
      try {
        for (;;) {
          const { value, done: end } = await reader.read();
          if (end || done) break;
          // a viewer that is behind sees fewer frames, never old ones
          if (res.writableLength > 2 * 1024 * 1024) continue;
          res.write(value);
        }
      } catch { /* the viewer left or the browser closed it */ }
      res.end();
      finish();
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
      up.addEventListener("message", (ev: MessageEvent) => { if (typeof ev.data === "string") peer.send(ev.data); else peer.send(new Uint8Array(ev.data as ArrayBuffer)); });
      up.addEventListener("close", () => { peer.close(1000); release(); });
      peer.onClose(() => { release(); try { up.close(); } catch { /* gone */ } });
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
