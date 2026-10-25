// @ts-check
// The service worker's connection to the Vyre app on this computer: one native messaging port to `run.vyre.bridge`.
// Requests carry an id and wait for the matching reply (with a timeout); pushes (fill values, Space changes) go to handlers.
// When the host is not installed or the app is not running, every request fails fast with a code the popup turns into words, and
// the worker falls back to opening the web app for the Space (index.js). The port is reopened by the next request, never in a loop.

import { BridgeFailure, HOST_NAME, parseIncoming, request } from "./protocol.js";

/**
 * @typedef {{ postMessage(m: any): void, disconnect(): void, onMessage: { addListener(f: (m: any) => void): void }, onDisconnect: { addListener(f: () => void): void } }} NativePort
 * @typedef {{ runtime: { connectNative(name: string): NativePort, lastError?: { message?: string } | undefined } }} Ext
 * @typedef {"connecting" | "online" | "offline" | "no_host"} Status
 */

/**
 * @param {Ext} ext
 * @param {{ timeoutMs?: number, setTimer?: (f: () => void, ms: number) => any, clearTimer?: (t: any) => void }} [options]
 */
export function createBridge(ext, options = {}) {
  const timeoutMs = options.timeoutMs ?? 8000;
  const setTimer = options.setTimer ?? ((f, ms) => setTimeout(f, ms));
  const clearTimer = options.clearTimer ?? ((t) => clearTimeout(t));
  /** @type {NativePort | null} */
  let port = null;
  /** @type {Status} */
  let status = "offline";
  let seq = 0;
  /** @type {Map<string, { resolve: (v: any) => void, reject: (e: Error) => void, timer: any }>} */
  const pending = new Map();
  /** @type {Set<(m: any) => void>} */
  const pushHandlers = new Set();
  /** @type {Set<(s: Status) => void>} */
  const statusHandlers = new Set();

  /** @param {Status} s */
  function setStatus(s) {
    if (s === status) return;
    status = s;
    for (const h of statusHandlers) h(s);
  }

  /** @param {BridgeFailure} why */
  function failAll(why) {
    for (const [id, p] of pending) {
      clearTimer(p.timer);
      p.reject(why);
      pending.delete(id);
    }
  }

  function open() {
    if (port) return port;
    setStatus("connecting");
    /** @type {NativePort} */
    let p;
    try {
      p = ext.runtime.connectNative(HOST_NAME);
    } catch {
      setStatus("no_host");
      throw new BridgeFailure("no_host", "the native messaging host is not installed");
    }
    p.onMessage.addListener((raw) => {
      const m = parseIncoming(raw);
      if (!m) return;
      if ("id" in m) {
        const wait = pending.get(m.id);
        if (!wait) return;
        pending.delete(m.id);
        clearTimer(wait.timer);
        if (m.ok) wait.resolve(m.output);
        else wait.reject(new BridgeFailure(m.error.code || "error", m.error.message));
        return;
      }
      setStatus("online");
      for (const h of pushHandlers) h(m);
    });
    p.onDisconnect.addListener(() => {
      // Chrome says why in runtime.lastError: "Specified native messaging host not found." means it was never installed.
      const message = ext.runtime.lastError?.message ?? "";
      port = null;
      const missing = /not found|forbidden/i.test(message);
      setStatus(missing ? "no_host" : "offline");
      failAll(missing ? new BridgeFailure("no_host", message) : new BridgeFailure("offline", message || "the Vyre app closed the connection"));
    });
    port = p;
    return p;
  }

  /**
   * @param {"invoke"|"bridge"} type @param {string} name @param {Record<string, any>} [input]
   * @returns {Promise<any>}
   */
  function send(type, name, input = {}) {
    const id = `r${++seq}`;
    const message = request(id, type, name, input);
    const p = open();
    return new Promise((resolve, reject) => {
      const timer = setTimer(() => {
        pending.delete(id);
        reject(new BridgeFailure("timeout", `no answer to ${name}`));
      }, timeoutMs);
      pending.set(id, { resolve: (v) => { setStatus("online"); resolve(v); }, reject, timer });
      try {
        p.postMessage(message);
      } catch {
        pending.delete(id);
        clearTimer(timer);
        reject(new BridgeFailure("offline", "could not reach the Vyre app"));
      }
    });
  }

  return {
    get status() { return status; },
    /** One capability call for the active Space. @param {string} capability @param {Record<string, any>} [input] */
    invoke: (capability, input) => send("invoke", capability, input),
    /** One bridge-level operation. @param {string} op @param {Record<string, any>} [input] */
    op: (op, input) => send("bridge", op, input),
    /** @param {(m: any) => void} h @returns {() => void} */
    onPush(h) { pushHandlers.add(h); return () => pushHandlers.delete(h); },
    /** @param {(s: Status) => void} h @returns {() => void} */
    onStatus(h) { statusHandlers.add(h); return () => statusHandlers.delete(h); },
    close() {
      const p = port;
      port = null;
      setStatus("offline");
      failAll(new BridgeFailure("offline", "closed"));
      try { p?.disconnect(); } catch { /* already gone */ }
    },
  };
}
