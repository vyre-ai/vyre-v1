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
