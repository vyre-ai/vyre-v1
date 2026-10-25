// @ts-check
// The agent channel to the Vyre app: a native messaging port of its own to the same host the worker uses (`run.vyre.bridge`), so a long agent call never queues behind a
// popup question. Requests carry an id and wait for the matching reply with a timeout; commands and pushes go to handlers. A missing host is not retried (nothing to retry
// until the app is installed); a closed connection is reopened after a pause, never in a tight loop.

import { BridgeFailure, HOST_NAME, isObject, parseIncoming, request } from "../worker/protocol.js";

/**
 * @typedef {{ postMessage(m: any): void, disconnect(): void, onMessage: { addListener(f: (m: any) => void): void }, onDisconnect: { addListener(f: () => void): void } }} NativePort
 * @param {{ runtime: { connectNative(name: string): NativePort, lastError?: { message?: string } | undefined } }} ext
 * @param {{ onMessage: (m: any) => void, timeoutMs?: number, retryMs?: number, setTimer?: (f: () => void, ms: number) => any, clearTimer?: (t: any) => void }} o
 */
export function createTransport(ext, o) {
  const timeoutMs = o.timeoutMs ?? 8000;
  const retryMs = o.retryMs ?? 15_000;
  const setTimer = o.setTimer ?? ((f, ms) => setTimeout(f, ms));
  const clearTimer = o.clearTimer ?? ((t) => clearTimeout(t));
  /** @type {NativePort | null} */
  let port = null;
  let seq = 0;
  let online = false;
  let stopped = false;
  /** @type {any} */
  let retry = null;
  /** @type {Map<string, { resolve: (v: any) => void, reject: (e: Error) => void, timer: any }>} */
  const pending = new Map();

  /** @param {BridgeFailure} why */
  function failAll(why) {
    for (const [id, p] of pending) { clearTimer(p.timer); p.reject(why); pending.delete(id); }
  }

  function connect() {
    if (port || stopped) return;
    /** @type {NativePort} */
    let p;
    try { p = ext.runtime.connectNative(HOST_NAME); } catch { return; }
    p.onMessage.addListener((raw) => {
      online = true;
      const m = parseIncoming(raw);
      if (m && "id" in m) {
        const wait = pending.get(m.id);
        if (!wait) return;
        pending.delete(m.id);
        clearTimer(wait.timer);
        if (m.ok) wait.resolve(m.output); else wait.reject(new BridgeFailure(m.error.code || "error", m.error.message));
        return;
      }
      // Everything else (fill pushes, agent commands) goes to the control, which knows which it wants.
      if (isObject(raw)) o.onMessage(raw);
    });
    p.onDisconnect.addListener(() => {
      const message = ext.runtime.lastError?.message ?? "";
      port = null;
      online = false;
      failAll(new BridgeFailure("offline", message || "the Vyre app closed the connection"));
      if (stopped || /not found|forbidden/i.test(message)) return;
      clearTimer(retry);
      retry = setTimer(connect, retryMs);
    });
    port = p;
  }

  /** @param {any} m */
  function post(m) {
    connect();
    if (!port) throw new BridgeFailure("offline", "could not reach the Vyre app");
    port.postMessage(m);
  }

  return {
    connect,
    get online() { return online && port !== null; },
    /** A capability call as the signed-in person or agent: `extra` rides beside it (which agent, which Space). @param {"invoke" | "bridge"} type @param {string} name @param {Record<string, any>} input @param {Record<string, any>} [extra] */
    call(type, name, input, extra = {}) {
      const id = `a${++seq}`;
      const message = { ...request(id, type, name, input), ...extra };
      return new Promise((resolve, reject) => {
        const timer = setTimer(() => { pending.delete(id); reject(new BridgeFailure("timeout", `no answer to ${name}`)); }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try { post(message); } catch (e) { pending.delete(id); clearTimer(timer); reject(e instanceof Error ? e : new BridgeFailure("offline", "")); }
      });
    },
    /** One message to the app that wants no answer beyond an acknowledgement: a tool result, or an event under an agent. @param {"agent.result" | "agent.event"} op @param {Record<string, any>} input */
    tell(op, input) {
      const id = `a${++seq}`;
      try { post({ id, type: "bridge", op, input }); } catch { /* the app is away: the result had nobody waiting */ }
    },
    close() {
      stopped = true;
      clearTimer(retry);
      const p = port;
      port = null;
      online = false;
      failAll(new BridgeFailure("offline", "closed"));
      try { p?.disconnect(); } catch { /* already gone */ }
    },
  };
}
