// A small Chrome DevTools Protocol client over the WebSocket built into Node 24. One connection per page target; a call is a JSON message with an id and the answer carries it back.
import { AgentError, unavailable } from "./errors.ts";

export interface Cdp {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  on(event: string, f: (params: Record<string, unknown>) => void): void;
  close(): void;
}

export function connectCdp(url: string, timeoutMs = 10_000): Promise<Cdp> {
  return new Promise<Cdp>((resolve, reject) => {
    const ws = new WebSocket(url);
    let next = 0;
    const pending = new Map<number, { ok: (v: never) => void; fail: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    const handlers = new Map<string, Array<(p: Record<string, unknown>) => void>>();
    const opening = setTimeout(() => { reject(unavailable("the browser did not accept a connection")); try { ws.close(); } catch { /* gone */ } }, timeoutMs);

    const dead = (why: string): void => {
      for (const [id, w] of pending) { clearTimeout(w.timer); w.fail(unavailable(why)); pending.delete(id); }
    };

    ws.addEventListener("open", () => {
      clearTimeout(opening);
      resolve({
        send<T>(method: string, params: Record<string, unknown> = {}, ms = 30_000): Promise<T> {
          const id = ++next;
          return new Promise<T>((ok, fail) => {
            if (ws.readyState !== 1) { fail(unavailable("the browser connection is closed")); return; }
            const timer = setTimeout(() => { pending.delete(id); fail(new AgentError("timeout", `${method} took longer than ${Math.round(ms / 1000)} seconds`)); }, ms);
            pending.set(id, { ok: ok as (v: never) => void, fail, timer });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        on(event, f) { const l = handlers.get(event) ?? []; l.push(f); handlers.set(event, l); },
        close() { try { ws.close(); } catch { /* already closed */ } dead("the browser connection was closed"); },
      });
    });
    ws.addEventListener("message", (ev: MessageEvent) => {
      let m: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: Record<string, unknown> };
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.id !== undefined) {
        const w = pending.get(m.id);
        if (!w) return;
        pending.delete(m.id);
        clearTimeout(w.timer);
        if (m.error) w.fail(new AgentError("bad_input", `the browser refused: ${m.error.message ?? "unknown"}`));
        else w.ok((m.result ?? {}) as never);
      } else if (m.method) {
        for (const f of handlers.get(m.method) ?? []) f(m.params ?? {});
      }
    });
    ws.addEventListener("error", () => { clearTimeout(opening); reject(unavailable("the browser connection failed")); dead("the browser connection failed"); });
    ws.addEventListener("close", () => dead("the browser connection closed"));
  });
}

// ---- over a pipe ------------------------------------------------------------------------------------------------------------------------------------
// Chromium started with --remote-debugging-pipe opens no port at all: it reads DevTools messages on its fd 3 and writes them on fd 4, each one JSON ended by a NUL byte. Only the process that started it holds
// the two ends, so a page, another profile's browser or anything else in the container cannot reach this browser's DevTools (the Space browser runs a browser per agent in one container: a port on
// 127.0.0.1 would be open to every other agent's pages). One connection carries the browser and every page: a page is a flat session (Target.attachToTarget with flatten), its messages carry the sessionId.

/** The browser's DevTools over its pipe: the browser itself as a Cdp, and a Cdp per page target. */
export interface CdpPipe {
  /** The browser target (Browser.*, Target.*, Storage.*). Closing it does nothing: the pipe lives as long as the browser. */
  browser: Cdp;
  /** A session on one target; closing it detaches. */
  attach(targetId: string, timeoutMs?: number): Promise<Cdp>;
  /** The pipe is gone (the browser exited). */
  closed(): boolean;
  /** Events of the browser target (not of a session), such as Target.targetCreated. */
  onBrowser(event: string, f: (params: Record<string, unknown>) => void): void;
}

const PIPE_MAX = 256 * 1024 * 1024;

export function connectPipe(write: NodeJS.WritableStream, read: NodeJS.ReadableStream): CdpPipe {
  let next = 0;
  let gone = false;
  const pending = new Map<number, { ok: (v: never) => void; fail: (e: Error) => void; timer: ReturnType<typeof setTimeout>; session: string }>();
  // handlers per session; "" is the browser target
  const handlers = new Map<string, Map<string, Array<(p: Record<string, unknown>) => void>>>();
  const on = (session: string, event: string, f: (p: Record<string, unknown>) => void): void => {
    let m = handlers.get(session);
    if (!m) { m = new Map(); handlers.set(session, m); }
    const l = m.get(event) ?? [];
    l.push(f);
    m.set(event, l);
  };
  const failSession = (session: string | null, why: string): void => {
    for (const [id, w] of pending) if (session === null || w.session === session) { clearTimeout(w.timer); w.fail(unavailable(why)); pending.delete(id); }
  };

  const send = <T>(session: string, method: string, params: Record<string, unknown> = {}, ms = 30_000): Promise<T> => {
    const id = ++next;
    return new Promise<T>((ok, fail) => {
      if (gone) { fail(unavailable("the browser connection is closed")); return; }
      const timer = setTimeout(() => { pending.delete(id); fail(new AgentError("timeout", `${method} took longer than ${Math.round(ms / 1000)} seconds`)); }, ms);
      pending.set(id, { ok: ok as (v: never) => void, fail, timer, session });
      write.write(`${JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) })}\0`);
    });
  };

  let buf: Buffer[] = [];
  let size = 0;
  const onMessage = (text: string): void => {
    let m: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
    try { m = JSON.parse(text); } catch { return; }
    if (m.id !== undefined) {
      const w = pending.get(m.id);
      if (!w) return;
      pending.delete(m.id);
      clearTimeout(w.timer);
      if (m.error) w.fail(new AgentError("bad_input", `the browser refused: ${m.error.message ?? "unknown"}`));
      else w.ok((m.result ?? {}) as never);
      return;
    }
    if (!m.method) return;
    const session = m.sessionId ?? "";
    for (const f of handlers.get(session)?.get(m.method) ?? []) f(m.params ?? {});
    // a page that closed or crashed: what its sessions waited for ends now
    if (m.method === "Target.detachedFromTarget" && typeof m.params?.["sessionId"] === "string") { const s = m.params["sessionId"] as string; failSession(s, "the tab closed"); handlers.delete(s); }
  };
  read.on("data", (chunk: Buffer) => {
    let start = 0;
    for (let i = chunk.indexOf(0); i !== -1; i = chunk.indexOf(0, start)) {
      buf.push(chunk.subarray(start, i));
      onMessage(Buffer.concat(buf).toString("utf8"));
      buf = []; size = 0;
      start = i + 1;
    }
    if (start < chunk.length) { buf.push(chunk.subarray(start)); size += chunk.length - start; if (size > PIPE_MAX) { buf = []; size = 0; } }
  });
  const end = (): void => { gone = true; failSession(null, "the browser connection closed"); };
  read.on("end", end);
  read.on("close", end);
  read.on("error", end);
  (write as NodeJS.WritableStream & { on(e: string, f: () => void): void }).on("error", end);

  const browser: Cdp = {
    send: (method, params, ms) => send("", method, params, ms),
    on: (event, f) => on("", event, f),
    close() { /* the pipe stays */ },
  };

  return {
    browser,
    async attach(targetId, timeoutMs = 10_000) {
      const r = await send<{ sessionId: string }>("", "Target.attachToTarget", { targetId, flatten: true }, timeoutMs);
      const session = r.sessionId;
      let open = true;
      return {
        send: (method, params, ms) => (open ? send(session, method, params, ms) : Promise.reject(unavailable("the browser connection was closed"))),
        on: (event, f) => on(session, event, f),
        close() {
          if (!open) return;
          open = false;
          failSession(session, "the browser connection was closed");
          handlers.delete(session);
          send("", "Target.detachFromTarget", { sessionId: session }, 5000).catch(() => undefined);
        },
      };
    },
    closed: () => gone,
    onBrowser: (event, f) => on("", event, f),
  };
}
