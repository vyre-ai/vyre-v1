// The live view of a Space browser profile (owner decision 6 Nov: Chrome's own screencast and input, no virtual screen). Page.startScreencast sends JPEG frames of the profile's front tab; they go to
// everyone watching in the same wire format as the agent computer's live view (MJPEG over HTTP at /stream, a WebSocket at /ws that also carries the person's input), so the viewer is unchanged.
// A viewer needs a ticket that `stream` handed out for one profile; input is applied only while a person has taken that profile over. Input goes in as DevTools Input events.
//
// Messages from the viewer (JSON text): {t:"move",x,y,seq} {t:"down",n,seq} {t:"up",n,seq} {t:"key",name,down,seq} {t:"scroll",dx,dy,seq} {t:"type",text,seq} {t:"ping",seq}
// Each is answered {t:"ack",seq,x,y,ms} once the browser has the input, or {t:"refused",seq,reason}.
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { connectCdp } from "../../agent-computer/agentd/cdp.ts";
import type { Cdp } from "../../agent-computer/agentd/cdp.ts";
import { sleep } from "../../agent-computer/agentd/errors.ts";
import { acceptWebSocket } from "../../agent-computer/agentd/ws.ts";

const TOKEN_TTL_MS = 5 * 60_000;
const BOUNDARY = "vyreframe";

// ---- frames ----------------------------------------------------------------------------------------------------------------------------------------

export interface Hub {
  watch(onFrame: (jpeg: Buffer) => void): () => void;
  viewers(): number;
  lastFrameAt(): number | null;
  latest(): Buffer | null;
}

export interface HubOptions {
  /** The browser's DevTools port, or null while it is not running. */
  port(): number | null;
  /** Make sure the browser is up (a viewer of a sleeping profile wakes it). */
  wake(): Promise<void>;
  width?: number;
  height?: number;
  quality?: number;
  lingerMs?: number;
  /** A viewer came or went: the profile's activity clock. */
  activity?(): void;
  log?: (m: string) => void;
}

interface PageTarget { id: string; type: string; webSocketDebuggerUrl?: string }

/** Frames of the front tab of one browser. Starts when the first viewer comes, follows the front tab, and stops a few seconds after the last viewer leaves. */
export function createScreencastHub(o: HubOptions): Hub {
  const watchers = new Set<(jpeg: Buffer) => void>();
  let last: Buffer | null = null;
  let lastAt: number | null = null;
  let conn: Cdp | null = null;
  let target: string | null = null;
  let loop: Promise<void> | null = null;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  const log = o.log ?? (() => undefined);

  const push = (jpeg: Buffer): void => { last = jpeg; lastAt = Date.now(); for (const w of watchers) w(jpeg); };

  async function front(port: number): Promise<PageTarget | null> {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!r.ok) return null;
    return ((await r.json()) as PageTarget[]).find((t) => t.type === "page" && t.webSocketDebuggerUrl) ?? null;
  }

  async function attach(t: PageTarget): Promise<void> {
    conn?.close();
    const c = await connectCdp(t.webSocketDebuggerUrl as string);
    conn = c;
    target = t.id;
    c.on("Page.screencastFrame", (p) => {
      const data = p["data"];
      if (typeof data === "string") push(Buffer.from(data, "base64"));
      c.send("Page.screencastFrameAck", { sessionId: p["sessionId"] }).catch(() => undefined);
    });
    await c.send("Page.enable");
    await c.send("Page.startScreencast", { format: "jpeg", quality: o.quality ?? 60, maxWidth: o.width ?? 1280, maxHeight: o.height ?? 800, everyNthFrame: 1 });
    // A page that is not changing sends no frame: give the viewer the picture as it is now.
    try {
      const shot = await c.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: o.quality ?? 60 });
      push(Buffer.from(shot.data, "base64"));
    } catch { /* the next frame will do */ }
  }

  async function run(gen: number): Promise<void> {
    while (gen === generation && watchers.size > 0) {
      try {
        const port = o.port();
        if (port === null) { await o.wake(); continue; }
        const t = await front(port);
        if (t && (t.id !== target || conn === null)) await attach(t);
      } catch (e) { log(`screencast: ${e instanceof Error ? e.message : "failed"}`); conn = null; target = null; }
      await sleep(700);
    }
  }

  const stop = (): void => {
    stopTimer = null;
    if (watchers.size > 0) return;
    generation += 1;
    loop = null;
    conn?.close();
    conn = null;
    target = null;
  };

  return {
    watch(onFrame) {
      watchers.add(onFrame);
      o.activity?.();
      if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
      if (!loop) { generation += 1; loop = run(generation); }
      if (last) onFrame(last);
      return () => {
        watchers.delete(onFrame);
        o.activity?.();
        if (watchers.size === 0 && !stopTimer) stopTimer = setTimeout(stop, o.lingerMs ?? 3000);
      };
    },
    viewers: () => watchers.size,
    lastFrameAt: () => lastAt,
    latest: () => last,
  };
}

// ---- input -----------------------------------------------------------------------------------------------------------------------------------------

export interface Pointer { x: number; y: number }
export interface Input {
  /** One input; resolves once the browser has taken it, with where the pointer is. */
  call(req: Record<string, unknown>): Promise<Pointer>;
}

// X keysym names (what the viewer sends) to DevTools keys.
const KEYS: Record<string, { key: string; code: string; vk: number; text?: string }> = {
  Return: { key: "Enter", code: "Enter", vk: 13, text: "\r" }, Enter: { key: "Enter", code: "Enter", vk: 13, text: "\r" }, Tab: { key: "Tab", code: "Tab", vk: 9 },
  Escape: { key: "Escape", code: "Escape", vk: 27 }, BackSpace: { key: "Backspace", code: "Backspace", vk: 8 }, Backspace: { key: "Backspace", code: "Backspace", vk: 8 },
  Delete: { key: "Delete", code: "Delete", vk: 46 }, Left: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 }, Up: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
  Right: { key: "ArrowRight", code: "ArrowRight", vk: 39 }, Down: { key: "ArrowDown", code: "ArrowDown", vk: 40 }, Home: { key: "Home", code: "Home", vk: 36 }, End: { key: "End", code: "End", vk: 35 },
  Page_Up: { key: "PageUp", code: "PageUp", vk: 33 }, Page_Down: { key: "PageDown", code: "PageDown", vk: 34 }, space: { key: " ", code: "Space", vk: 32, text: " " },
};

/** A pointer and a keyboard for a browser, through DevTools. `page` gives a connection to the front tab (closed after each input: inputs are rare next to frames). */
export function createCdpInput(page: () => Promise<Cdp>): Input {
  let at: Pointer = { x: 0, y: 0 };
  let buttons = 0;
  const BUTTON: Record<number, { name: string; bit: number }> = { 1: { name: "left", bit: 1 }, 2: { name: "middle", bit: 4 }, 3: { name: "right", bit: 2 } };
  return {
    async call(req) {
      const c = await page();
      try {
        const op = String(req["op"]);
        if (op === "move") {
          at = { x: Number(req["x"]), y: Number(req["y"]) };
          await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y, buttons });
        } else if (op === "button") {
          const b = BUTTON[Number(req["n"])];
          if (!b) throw new Error("that button does not exist");
          const down = req["down"] === true;
          buttons = down ? buttons | b.bit : buttons & ~b.bit;
          await c.send("Input.dispatchMouseEvent", { type: down ? "mousePressed" : "mouseReleased", x: at.x, y: at.y, button: b.name, buttons, clickCount: 1 });
        } else if (op === "scroll") {
          await c.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: at.x, y: at.y, deltaX: Number(req["dx"] ?? 0), deltaY: Number(req["dy"] ?? 0) });
        } else if (op === "key") {
          const name = String(req["name"]);
          const down = req["down"] === true;
          const k = KEYS[name];
          if (k) await c.send("Input.dispatchKeyEvent", { type: down ? (k.text ? "keyDown" : "rawKeyDown") : "keyUp", key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, ...(down && k.text ? { text: k.text } : {}) });
          else if (name.length === 1) {
            if (down) await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, text: name });
            else await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: name });
          } else throw new Error(`I do not know the key ${name}`);
        } else if (op === "type") {
          await c.send("Input.insertText", { text: String(req["text"] ?? "") });
        } else throw new Error("I do not know that input");
        return at;
      } finally { c.close(); }
    },
  };
}

// ---- the server ------------------------------------------------------------------------------------------------------------------------------------

/** What one ticket opens: the profile's frames and input, and whether a person has the controls. */
export interface ViewOf {
  hub: Hub;
  input: Input;
  takenOver(): boolean;
  /** Something the person did (counts, never what they typed), for the audit. */
  onInput(e: Record<string, unknown>): void;
}

export interface ViewServer {
  /** A ticket for one viewer of one profile, valid for five minutes. */
  mint(profileId: string): string;
  url(token: string, transport: "mjpeg" | "ws"): string;
  close(): void;
  viewers(): number;
}

export interface ViewDeps {
  port: number;
  address(): string;
  /** The view of a profile, or null when there is none. */
  viewOf(profileId: string): ViewOf | null;
}

export function startViewServer(d: ViewDeps): ViewServer {
  const tokens = new Map<string, { exp: number; profileId: string }>();
  let viewers = 0;
  const open = (t: string | null): { profileId: string; view: ViewOf } | null => {
    if (!t) return null;
    const e = tokens.get(t);
    if (!e) return null;
    if (e.exp < Date.now()) { tokens.delete(t); return null; }
    const view = d.viewOf(e.profileId);
    return view ? { profileId: e.profileId, view } : null;
  };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://browserd");
    if (url.pathname === "/stream") {
      const got = open(url.searchParams.get("t"));
      if (!got) { res.writeHead(401, { "content-type": "text/plain" }).end("This view needs a ticket.\n"); return; }
      res.writeHead(200, { "content-type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`, "cache-control": "no-store", connection: "close" });
      viewers += 1;
      const stop = got.view.hub.watch((jpeg) => {
        if (res.writableLength > 2 * 1024 * 1024) return;
        res.write(`--${BOUNDARY}\r\ncontent-type: image/jpeg\r\ncontent-length: ${jpeg.length}\r\n\r\n`);
        res.write(jpeg);
        res.write("\r\n");
      });
      res.once("close", () => { stop(); viewers -= 1; });
      return;
    }
    if (url.pathname === "/health") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true })); return; }
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found.\n");
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://browserd");
    const got = url.pathname === "/ws" ? open(url.searchParams.get("t")) : null;
    if (!got) { socket.end("HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n"); return; }
    const view = got.view;
    const ws = acceptWebSocket(req, socket, head);
    if (!ws) return;
    viewers += 1;
    const stop = view.hub.watch((jpeg) => { ws.send(jpeg); });
    ws.onClose(() => { stop(); viewers -= 1; });
    ws.onMessage((data, binary) => {
      if (binary || typeof data !== "string") return;
      const t0 = performance.now();
      let m: { t?: string; seq?: number; x?: number; y?: number; n?: number; name?: string; down?: boolean; dx?: number; dy?: number; text?: string };
      try { m = JSON.parse(data); } catch { return; }
      const seq = m.seq ?? 0;
      if (m.t === "ping") { ws.send(JSON.stringify({ t: "pong", seq })); return; }
      if (!view.takenOver()) { ws.send(JSON.stringify({ t: "refused", seq, reason: "A person has to take over before the view takes input." })); return; }
      let req2: Record<string, unknown> | null = null;
      if (m.t === "move" && Number.isInteger(m.x) && Number.isInteger(m.y)) req2 = { op: "move", x: m.x, y: m.y };
      else if ((m.t === "down" || m.t === "up") && Number.isInteger(m.n)) req2 = { op: "button", n: m.n, down: m.t === "down" };
      else if (m.t === "key" && typeof m.name === "string" && m.name.length <= 32) req2 = { op: "key", name: m.name, down: m.down === true };
      else if (m.t === "scroll") req2 = { op: "scroll", dx: Number(m.dx ?? 0), dy: Number(m.dy ?? 0) };
      else if (m.t === "type" && typeof m.text === "string" && m.text.length <= 2000) req2 = { op: "type", text: m.text };
      if (!req2) { ws.send(JSON.stringify({ t: "refused", seq, reason: "I do not know that input." })); return; }
      view.input.call(req2).then(
        (p) => {
          // What the person typed is not written down: a count for text, and a key's name only when it is a named key (Enter, Tab), never a letter.
          const what = m.t === "type" ? { chars: m.text?.length } : m.t === "key" ? { down: m.down === true, ...(String(m.name).length > 1 ? { name: m.name } : {}) } : (req2 ?? {});
          view.onInput({ type: String(m.t), by: "person", ...what });
          ws.send(JSON.stringify({ t: "ack", seq, x: p.x, y: p.y, ms: Math.round((performance.now() - t0) * 100) / 100 }));
        },
        (e: unknown) => { ws.send(JSON.stringify({ t: "refused", seq, reason: e instanceof Error ? e.message : "The input failed." })); },
      );
    });
  });

  server.listen(d.port, "0.0.0.0");

  return {
    mint(profileId) {
      for (const [t, e] of tokens) if (e.exp < Date.now()) tokens.delete(t);
      const t = randomBytes(24).toString("hex");
      tokens.set(t, { exp: Date.now() + TOKEN_TTL_MS, profileId });
      return t;
    },
    url: (token, transport) => (transport === "ws" ? `ws://${d.address()}:${d.port}/ws?t=${token}` : `http://${d.address()}:${d.port}/stream?t=${token}`),
    close() { server.close(); },
    viewers: () => viewers,
  };
}
