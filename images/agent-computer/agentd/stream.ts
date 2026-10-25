// The live view server (spec 2.7, S9): MJPEG over HTTP (`/stream`) and a WebSocket (`/ws`) that carries the same JPEG frames to the viewer and the person's input back. A viewer needs a ticket token
// that `stream` handed out; the token is random, expires, and means nothing to anyone but the host that asked for it. Input is applied only while a person has the controls (take over).
//
// Messages from the viewer (JSON text): {t:"move",x,y,seq} {t:"down",n,seq} {t:"up",n,seq} {t:"key",name,down,seq} {t:"scroll",dx,dy,seq} {t:"type",text,seq} {t:"ping",seq}
// Each is answered {t:"ack",seq,x,y,ms} once the X server has the input (x and y are where the pointer is then), or {t:"refused",seq,reason}.
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { FrameHub } from "./frames.ts";
import type { Injector } from "./x11.ts";
import { acceptWebSocket } from "./ws.ts";

const TOKEN_TTL_MS = 5 * 60_000;
const BOUNDARY = "vyreframe";

export interface StreamServer {
  /** A token for one viewer, valid for five minutes. */
  mint(): string;
  url(token: string, transport: "mjpeg" | "ws"): string;
  close(): void;
  readonly viewers: () => number;
}

export interface StreamDeps {
  port: number;
  hub: FrameHub;
  input: Injector;
  /** Is a person at the controls? Input from the viewer is refused when not. */
  takenOver(): boolean;
  /** The container's address that the host can reach. */
  address(): string;
  /** Something the person did, for the recording. */
  onInput(e: Record<string, unknown>): void;
}

export function startStreamServer(d: StreamDeps): StreamServer {
  const tokens = new Map<string, number>();
  let viewers = 0;
  const valid = (t: string | null): boolean => {
    if (!t) return false;
    const exp = tokens.get(t);
    if (exp === undefined) return false;
    if (exp < Date.now()) { tokens.delete(t); return false; }
    return true;
  };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://agentd");
    if (url.pathname === "/stream") {
      if (!valid(url.searchParams.get("t"))) { res.writeHead(401, { "content-type": "text/plain" }).end("This view needs a ticket.\n"); return; }
      res.writeHead(200, { "content-type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`, "cache-control": "no-store", connection: "close" });
      viewers += 1;
      const stop = d.hub.watch((jpeg) => {
        if (res.writableLength > 2 * 1024 * 1024) return;
        res.write(`--${BOUNDARY}\r\ncontent-type: image/jpeg\r\ncontent-length: ${jpeg.length}\r\n\r\n`);
        res.write(jpeg);
        res.write("\r\n");
      });
      const done = (): void => { stop(); viewers -= 1; };
      res.once("close", done);
      return;
    }
    if (url.pathname === "/health") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true })); return; }
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found.\n");
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://agentd");
    if (url.pathname !== "/ws" || !valid(url.searchParams.get("t"))) { socket.end("HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n"); return; }
    const ws = acceptWebSocket(req, socket, head);
    if (!ws) return;
    viewers += 1;
    const stop = d.hub.watch((jpeg) => { ws.send(jpeg); });
    ws.onClose(() => { stop(); viewers -= 1; });
    ws.onMessage((data, binary) => {
      if (binary || typeof data !== "string") return;
      const t0 = performance.now();
      let m: { t?: string; seq?: number; x?: number; y?: number; n?: number; name?: string; down?: boolean; dx?: number; dy?: number; text?: string };
      try { m = JSON.parse(data); } catch { return; }
      const seq = m.seq ?? 0;
      if (m.t === "ping") { ws.send(JSON.stringify({ t: "pong", seq })); return; }
      if (!d.takenOver()) { ws.send(JSON.stringify({ t: "refused", seq, reason: "A person has to take over before the view takes input." })); return; }
      let req2: Record<string, unknown> | null = null;
      if (m.t === "move" && Number.isInteger(m.x) && Number.isInteger(m.y)) req2 = { op: "move", x: m.x, y: m.y };
      else if ((m.t === "down" || m.t === "up") && Number.isInteger(m.n)) req2 = { op: "button", n: m.n, down: m.t === "down" };
      else if (m.t === "key" && typeof m.name === "string" && m.name.length <= 32) req2 = { op: "key", name: m.name, down: m.down === true };
      else if (m.t === "scroll") req2 = { op: "scroll", dx: Number(m.dx ?? 0), dy: Number(m.dy ?? 0) };
      else if (m.t === "type" && typeof m.text === "string" && m.text.length <= 2000) req2 = { op: "type", text: m.text };
      if (!req2) { ws.send(JSON.stringify({ t: "refused", seq, reason: "I do not know that input." })); return; }
      d.input.call(req2).then(
        (p) => {
          // What the person typed is not written down: a count for text, and a key's name only when it is a named key (Enter, Tab), never a letter.
          const what = m.t === "type" ? { chars: m.text?.length } : m.t === "key" ? { down: m.down === true, ...(String(m.name).length > 1 ? { name: m.name } : {}) } : (req2 ?? {});
          d.onInput({ type: String(m.t), by: "person", ...what });
          ws.send(JSON.stringify({ t: "ack", seq, x: p.x, y: p.y, ms: Math.round((performance.now() - t0) * 100) / 100 }));
        },
        (e: unknown) => { ws.send(JSON.stringify({ t: "refused", seq, reason: e instanceof Error ? e.message : "The input failed." })); },
      );
    });
  });

  server.listen(d.port, "0.0.0.0");

  return {
    mint() {
      for (const [t, exp] of tokens) if (exp < Date.now()) tokens.delete(t);
      const t = randomBytes(24).toString("hex");
      tokens.set(t, Date.now() + TOKEN_TTL_MS);
      return t;
    },
    url: (token, transport) => (transport === "ws" ? `ws://${d.address()}:${d.port}/ws?t=${token}` : `http://${d.address()}:${d.port}/stream?t=${token}`),
    close() { server.close(); },
    viewers: () => viewers,
  };
}
