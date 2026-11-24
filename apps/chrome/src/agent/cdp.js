// @ts-check
// from vyre 0.6.9 modules/hands-chrome/cdp.js@dbd2dfbab (the per-agent pool), rebuilt on chrome.debugger: the extension is already inside the browser, so there is no
// socket to open and no endpoint to be handed. One attach per tab, kept only while an agent is driving it; detached when the agent goes idle, is stopped, or
// the person cancels Chrome's "started debugging this browser" bar (that is a Stop). Page, Runtime and Network are enabled on attach, so what the page said
// and sent from then on is there for chrome_console, chrome_net and chrome_sources.

import { AgentFailure, fail } from "./protocol.js";

export const PROTOCOL_VERSION = "1.3";

/**
 * @typedef {{ attach(t: { tabId: number }, version: string): Promise<void>, detach(t: { tabId: number }): Promise<void>, getTargets?(): Promise<{ tabId?: number, attached?: boolean }[]>, sendCommand(t: { tabId: number }, method: string, params?: object): Promise<any>,
 *   onEvent: { addListener(f: (source: { tabId?: number }, method: string, params?: any) => void): void },
 *   onDetach: { addListener(f: (source: { tabId?: number }, reason: string) => void): void } }} Debugger
 * @typedef {(tabId: number, method: string, params: any) => void} EventHandler
 * @typedef {(tabId: number, reason: string) => void} DetachHandler
 */

/** @param {Debugger} dbg */
export function createCdp(dbg) {
  /** @type {Set<number>} */
  const attached = new Set();
  /** @type {Set<EventHandler>} */
  const listeners = new Set();
  /** @type {Set<DetachHandler>} */
  const detachHandlers = new Set();
  /** @type {Set<(tabId: number, method: string, params: any) => void>} */
  const inputHandlers = new Set();
  /** @type {Map<number, Promise<void>>} */
  const attaching = new Map();

  dbg.onEvent.addListener((source, method, params) => {
    if (source.tabId === undefined) return;
    for (const l of listeners) l(source.tabId, method, params ?? {});
  });
  dbg.onDetach.addListener((source, reason) => {
    if (source.tabId === undefined || !attached.delete(source.tabId)) return;
    netOn.delete(source.tabId);
    for (const h of detachHandlers) h(source.tabId, reason);
  });

  /** Who may be debugged right now. Set by the agent control to "a tab an agent is driving", so a late call (a picture taken as the agent goes idle, a stopped agent's last read) can never put the debugger back on a tab the person has again. @type {(tabId: number) => boolean} */
  let mayAttach = () => true;

  /** Tabs whose network traffic is being read: only after the person allowed network reading for the site. @type {Set<number>} */
  const netOn = new Set();

  /** @param {number} tabId */
  async function attach(tabId) {
    if (attached.has(tabId)) return;
    if (!mayAttach(tabId)) fail("no_tab", "The agent is not working in that tab now.");
    const pending = attaching.get(tabId);
    if (pending) return pending;
    const p = (async () => {
      try {
        await dbg.attach({ tabId }, PROTOCOL_VERSION);
      } catch (e) {
        // "Already attached" is what Chrome says both when this extension attached before a worker restart made it forget, and when DevTools or another extension holds the tab.
        // Only the first can be used: ask the tab something small, and if it answers the attach was ours.
        const message = String(/** @type {any} */ (e)?.message ?? e);
        let ours = false;
        if (/already attached/i.test(message)) {
          try {
            await dbg.sendCommand({ tabId }, "Runtime.evaluate", { expression: "1" });
            ours = true;
          } catch {
            ours = false;
          }
        }
        if (!ours) fail("debugger_denied", message.slice(0, 120));
      }
      attached.add(tabId);
      for (const m of ["Page.enable", "Runtime.enable"]) await dbg.sendCommand({ tabId }, m, {});
    })().finally(() => attaching.delete(tabId));
    attaching.set(tabId, p);
    return p;
  }

  return {
    attach,
    isNetworkOn: (/** @type {number} */ tabId) => netOn.has(tabId),
    /** Start reading a tab's network calls. Call only once the person allowed it for the site. @param {number} tabId */
    async enableNetwork(tabId) {
      if (netOn.has(tabId)) return;
      await attach(tabId);
      await dbg.sendCommand({ tabId }, "Network.enable", {});
      netOn.add(tabId);
    },
    /** Stop reading a tab's network calls (the tab went to a site the person did not allow). @param {number} tabId */
    async disableNetwork(tabId) {
      if (!netOn.delete(tabId)) return;
      try {
        await dbg.sendCommand({ tabId }, "Network.disable", {});
      } catch {
        /* the tab closed first */
      }
    },
    /** @param {(tabId: number) => boolean} f */
    allowOnly(f) {
      mayAttach = f;
    },
    /** @param {number} tabId */
    isAttached: (tabId) => attached.has(tabId),
    get attachedTabs() {
      return [...attached];
    },
    /**
     * One protocol command in a tab, attaching first if needed. A failed command becomes an AgentFailure with the protocol's own words.
     * @param {number} tabId @param {string} method @param {object} [params]
     */
    async send(tabId, method, params = {}) {
      await attach(tabId);
      // the page sees what the agent types and clicks as real events: say what is about to be sent, so the page's report of exactly that is not taken for a person's hand
      const input = method.startsWith("Input.");
      if (input) for (const h of inputHandlers) h(tabId, method, params);
      try {
        return await dbg.sendCommand({ tabId }, method, params);
      } catch (e) {
        const message = String(/** @type {any} */ (e)?.message ?? e);
        if (/detached|not attached|no tab with given id|target closed/i.test(message)) {
          attached.delete(tabId);
          netOn.delete(tabId);
          throw new AgentFailure("no_tab", "The tab went away.");
        }
        throw new AgentFailure("error", message.slice(0, 200));
      }
    },
    /** The agent is sending input to a tab (called just before each such command). @param {(tabId: number, method: string, params: any) => void} h @returns {() => void} */
    onInput(h) {
      inputHandlers.add(h);
      return () => inputHandlers.delete(h);
    },
    /** @param {number} tabId */
    async detach(tabId) {
      netOn.delete(tabId);
      if (!attached.delete(tabId)) return;
      try {
        await dbg.detach({ tabId });
      } catch {
        /* the tab closed first */
      }
    },
    /**
     * Let go of every tab Chrome still shows as debugged that no agent is driving now. Chrome keeps a debugger attached when the extension's worker goes to sleep, but the worker's
     * memory (what is attached, the idle clock) is gone, so nothing would ever detach it and Chrome's "started debugging this browser" bar would stay on a tab the person is just
     * reading. Run when the worker starts and on a timer. A detach of a tab another debugger (DevTools) holds fails and changes nothing, so only our own is released.
     * @param {number[]} [keep] tabs an agent is driving right now
     * @returns {Promise<number[]>} the tabs released
     */
    async sweep(keep = []) {
      if (typeof dbg.getTargets !== "function") return [];
      let targets;
      try {
        targets = await dbg.getTargets();
      } catch {
        return [];
      }
      /** @type {number[]} */
      const released = [];
      for (const t of targets) {
        if (t.tabId === undefined || !t.attached || keep.includes(t.tabId)) continue;
        if (attaching.has(t.tabId)) continue;
        attached.delete(t.tabId);
        try {
          await dbg.detach({ tabId: t.tabId });
          released.push(t.tabId);
        } catch {
          /* not ours (DevTools or another extension), or the tab closed first */
        }
      }
      return released;
    },
    /** @param {EventHandler} h @returns {() => void} */
    onEvent(h) {
      listeners.add(h);
      return () => listeners.delete(h);
    },
    /** @param {DetachHandler} h @returns {() => void} */
    onDetach(h) {
      detachHandlers.add(h);
      return () => detachHandlers.delete(h);
    },
    /**
     * Resolve with the first event for `tabId` that `match` accepts, or null after `ms`.
     * @param {number} tabId @param {(method: string, params: any) => boolean} match @param {number} ms
     * @param {{ setTimer?: (f: () => void, ms: number) => any, clearTimer?: (t: any) => void }} [t]
     * @returns {Promise<{ method: string, params: any } | null>}
     */
    waitFor(tabId, match, ms, t = {}) {
      const setT = t.setTimer ?? ((/** @type {() => void} */ f, /** @type {number} */ n) => setTimeout(f, n));
      const clearT = t.clearTimer ?? ((/** @type {any} */ x) => clearTimeout(x));
      return new Promise((resolve) => {
        /** @type {any} */
        let timer = null;
        let off = () => {};
        /** @type {EventHandler} */
        const h = (id, method, params) => {
          if (id === tabId && match(method, params)) {
            clearT(timer);
            off();
            resolve({ method, params });
          }
        };
        listeners.add(h);
        off = () => {
          listeners.delete(h);
        };
        timer = setT(() => {
          off();
          resolve(null);
        }, ms);
      });
    },
  };
}
