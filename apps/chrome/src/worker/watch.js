// @ts-check
// Watch a page (prototype "Watch a page"): the worker's half. A watch is kept by the Vyre app (browser.watches.*, in Automations > Watching); this file makes and changes them from
// the Watch sheet, picks the part of a page to watch, and checks the ones that run in this Chrome.
//
//   * Where it runs: an agent's computer when the agent has one (the app wakes the agent on the rhythm), else My Chrome. A watch in this Chrome is read every minute the alarm
//     fires and it is due: the page is opened in a background tab, the part is read as text, the tab is closed, and the reading goes to the app (browser.watches.report). The app
//     compares it with the last reading and, when it differs, tells the watch's chat with what it was and what it is.
//   * Privacy: a site that is never sent is not watched, and incognito is off. What leaves Chrome is the text of the watched part (or of the page for "any change"); no field value
//     is ever read, and a screenshot is not part of a reading.
//   * "Check now" in Automations sets a flag the app keeps; the next minute's look reads it, so it needs no push.

import { BridgeFailure } from "./protocol.js";

export const ALARM = "vyre.watch";
export const LOOK_MS = 60_000;
/** How long a background tab may take to load and show the watched part. */
export const LOAD_MS = 25_000;
const MAX_READING = 20_000;

export { FREQS, freqLabel } from "../ui/watch-model.js";

/**
 * Run in the page (chrome.scripting): the text of the watched part, or of the whole page. Waits a little for a page that draws itself. Never reads a field's value.
 * Self-contained: the browser serializes it.
 * @param {{ selector?: string } | null} region @param {number} waitMs @param {number} max
 * @returns {Promise<{ ok: true, text: string } | { ok: false, error: string }>}
 */
export async function readRegion(region, waitMs, max) {
  const g = /** @type {any} */ (globalThis);
  const doc = g.document;
  const sleep = (/** @type {number} */ ms) => new Promise((r) => g.setTimeout(r, ms));
  const textOf = (/** @type {any} */ el) => {
    if (!el) return "";
    const tag = String(el.tagName || "");
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return "";
    let t = String(el.innerText || el.textContent || "");
    // a field inside the part is not read
    return t.replace(/\s+/g, " ").trim().slice(0, max);
  };
  if (!region || !region.selector) {
    const end = Date.now() + Math.min(waitMs, 2500);
    while (!doc.body && Date.now() < end) await sleep(100);
    return doc.body ? { ok: true, text: textOf(doc.body) } : { ok: false, error: "The page showed nothing." };
  }
  const end = Date.now() + waitMs;
  /** @type {any} */
  let el = null;
  for (;;) {
    try { el = doc.querySelector(region.selector); } catch { return { ok: false, error: "The part to watch cannot be found again. Pick it again." }; }
    if (el || Date.now() > end) break;
    await sleep(250);
  }
  if (!el) return { ok: false, error: "The part to watch is not on the page. It may have moved: pick it again." };
  return { ok: true, text: textOf(el) };
}

/**
 * @param {{ ext: any, bridge: { invoke(c: string, i?: any): Promise<any>, op(o: string, i?: any): Promise<any> }, privacy: { list(): Promise<any[]>, of(tab: any): Promise<any> }, now?: () => number }} deps
 */
export function createWatches({ ext, bridge, privacy, now = Date.now }) {
  let looking = false;
  /** @type {Map<number, (r: any) => void>} */
  const pickers = new Map();

  /** Wait until a tab says it has loaded, or give up. @param {number} tabId @param {number} ms */
  function loaded(tabId, ms) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (/** @type {boolean} */ ok) => { if (done) return; done = true; try { ext.tabs.onUpdated.removeListener(on); } catch { /* gone */ } clearTimeout(timer); resolve(ok); };
      const on = (/** @type {number} */ id, /** @type {any} */ info) => { if (id === tabId && info.status === "complete") finish(true); };
      const timer = setTimeout(() => finish(false), ms);
      ext.tabs.onUpdated.addListener(on);
      ext.tabs.get(tabId).then((/** @type {any} */ t) => { if (t && t.status === "complete" && t.url && t.url !== "about:blank") finish(true); }).catch(() => finish(false));
    });
  }

  /**
   * Read a page the way a watch does: a background tab, one read, close it.
   * @param {string} url @param {{ selector?: string } | null} region
   * @returns {Promise<{ ok: true, text: string } | { ok: false, error: string }>}
   */
  async function read(url, region) {
    const may = await privacy.of({ url, incognito: false });
    if (may.why === "never") return { ok: false, error: "This site is never sent to Vyre, so it is not watched." };
    if (!may.read) return { ok: false, error: "That is not a page Vyre can watch." };
    /** @type {any} */
    let tab;
    try { tab = await ext.tabs.create({ url, active: false }); } catch { return { ok: false, error: "Chrome would not open the page." }; }
    try {
      const ok = await loaded(tab.id, LOAD_MS);
      if (!ok) return { ok: false, error: "The page did not finish loading." };
      const [r] = await ext.scripting.executeScript({ target: { tabId: tab.id }, func: readRegion, args: [region, 6000, MAX_READING] });
      return r && r.result ? r.result : { ok: false, error: "The page could not be read." };
    } catch { return { ok: false, error: "The page could not be read." }; }
    finally { try { await ext.tabs.remove(tab.id); } catch { /* already closed */ } }
  }

  /** Check one watch that runs here and report what it read. @param {any} w */
  async function check(w) {
    const r = await read(String(w.url), w.mode === "region" && w.region ? { selector: w.region.selector } : null);
    const out = await bridge.invoke("browser.watches.report", r.ok ? { watchId: w.watchId, value: r.text } : { watchId: w.watchId, error: r.error });
    return { ok: r.ok, changed: Boolean(out && out.changed), error: r.ok ? null : r.error };
  }

  /** The watches that run in this Chrome and are due (or asked for). */
  async function due() {
    const out = await bridge.invoke("browser.watches.list", { runsOn: "chrome" });
    const t = now();
    return (Array.isArray(out && out.watches) ? out.watches : []).filter((/** @type {any} */ w) => w.state !== "paused" && (w.checkNow || w.nextDueAt === undefined || w.nextDueAt <= t));
  }

  /** Whether a watch may be made on this tab: not in incognito, not on a site that is never sent. @param {any} tab */
  async function guard(tab) {
    const may = await privacy.of(tab);
    if (may.why === "incognito") throw new BridgeFailure("incognito", "");
    if (!may.read) throw new BridgeFailure(may.why === "never" ? "never_site" : "no_page", "");
    return may;
  }

  return {
    guard,
    /** Start the once-a-minute look. Chrome keeps the alarm across worker restarts. */
    schedule() {
      if (!ext.alarms) return;
      ext.alarms.get(ALARM, (/** @type {any} */ a) => { if (!a) ext.alarms.create(ALARM, { periodInMinutes: 1, delayInMinutes: 1 }); });
    },
    /** The alarm fired (or the app pushed watch.run): check what is due, one at a time. */
    async look() {
      if (looking) return { checked: 0 };
      looking = true;
      let n = 0;
      try {
        for (const w of await due()) { try { await check(w); } catch { /* the app is away; the next look tries again */ } n++; }
      } catch { /* not signed in or the app is not running: nothing to look at */ }
      finally { looking = false; }
      return { checked: n };
    },
    read, check,

    /** The person's watches, for the panel's Watching list. */
    async list() {
      const out = await bridge.invoke("browser.watches.list", {});
      return { watches: Array.isArray(out && out.watches) ? out.watches : [] };
    },
    /**
     * Make or change a watch from the sheet. For a watch that runs here the first reading is taken now, so a change is measured from what the person saw.
     * @param {any} tab @param {{ watchId?: string, title?: string, mode: "region" | "page", region?: { label: string, selector?: string }, everyMinutes: number, agentId?: string, runsOn: "computer" | "chrome", paused?: boolean }} w
     */
    async save(tab, w) {
      const may = await guard(tab);
      const url = String(tab.url);
      const input = {
        ...(w.watchId ? { watchId: w.watchId } : {}), title: String(w.title || tab.title || may.host || "A page").slice(0, 200), url, mode: w.mode === "page" ? "page" : "region",
        ...(w.mode === "region" && w.region ? { region: { label: String(w.region.label || "Part of the page").slice(0, 200), ...(w.region.selector ? { selector: String(w.region.selector).slice(0, 500) } : {}) } } : {}),
        everyMinutes: Math.max(5, Math.min(10_080, Math.round(Number(w.everyMinutes) || 60))), runsOn: w.runsOn === "computer" ? "computer" : "chrome", ...(w.agentId ? { agentId: String(w.agentId) } : {}),
        ...(w.paused !== undefined ? { paused: Boolean(w.paused) } : {}),
      };
      // the baseline: what the page shows now, read in the tab the person is looking at, so nothing has to open
      let value;
      if (input.runsOn === "chrome" || !w.watchId) {
        try {
          const [r] = await ext.scripting.executeScript({ target: { tabId: tab.id }, func: readRegion, args: [input.mode === "region" && input.region ? { selector: input.region.selector } : null, 1500, MAX_READING] });
          if (r && r.result && r.result.ok) value = r.result.text;
        } catch { /* the first look will set the baseline */ }
      }
      const out = await bridge.invoke("browser.watches.save", { ...input, ...(value !== undefined ? { value } : {}) });
      return { watch: out && out.watch ? out.watch : null };
    },
    /** @param {string} watchId @param {"remove" | "pause" | "resume"} op */
    async change(watchId, op) {
      const out = await bridge.invoke("browser.watches.remove", { watchId: String(watchId).slice(0, 80), op });
      return { removed: Boolean(out && out.removed), watch: out && out.watch ? out.watch : null };
    },
    /** Check now, from the list: here for a watch that runs here, else the app wakes the agent. @param {string} watchId */
    async checkNow(watchId) {
      const out = await bridge.invoke("browser.watches.list", { watchId });
      const w = out && Array.isArray(out.watches) ? out.watches[0] : null;
      if (!w) throw new BridgeFailure("not_available", "That watch is gone.");
      if (w.runsOn === "chrome") return await check(w);
      await bridge.invoke("browser.watches.check", { watchId });
      return { ok: true, changed: false, woke: true };
    },

    /**
     * Pick the part of the page to watch: the page draws a highlight under the pointer, and the click is the answer. Resolves with the region or null when cancelled.
     * @param {any} tab
     */
    async pick(tab) {
      await guard(tab);
      return new Promise(async (resolve) => {
        pickers.set(tab.id, resolve);
        try { await ext.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/content/pick.js"] }); } catch { pickers.delete(tab.id); resolve(null); }
      });
    },
    /** The page script answered. @param {number} tabId @param {any} m */
    picked(tabId, m) {
      const done = pickers.get(tabId);
      if (!done) return false;
      pickers.delete(tabId);
      done(m && m.region ? { label: String(m.region.label || "").slice(0, 200), selector: String(m.region.selector || "").slice(0, 500), text: String(m.region.text || "").slice(0, 300) } : null);
      return true;
    },
  };
}

