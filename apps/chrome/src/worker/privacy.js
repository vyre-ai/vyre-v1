// @ts-check
// Per-site privacy (prototype "This site"): what Vyre may read on a site when the person sends a message, and whether it looks up matching records.
//
//   attach  the default: the page chip starts on, with title, address, page text and a screenshot (each removable before sending)
//   ask     the page chip starts off; one click adds it
//   never   Vyre reads nothing here: no chip, no Selected chip, no record match, no watch, no clip, no bubble, no recording
//
// Incognito is not a setting: in an incognito window Vyre is off (nothing read, captured or sent) and only a Vault fill the person clicks still works.
// The choice is kept by host in storage (hosts and a word, never page content); a parent domain's choice covers its subdomains unless a subdomain has its own.

import { hostUnder, pageOf } from "./match.js";

/** @typedef {"attach" | "ask" | "never"} Mode */
/** @typedef {{ host: string, mode: Mode, records: boolean }} SitePrivacy */

export const MODES = Object.freeze(["attach", "ask", "never"]);
export const DEFAULT = Object.freeze({ mode: /** @type {Mode} */ ("attach"), records: true });

/**
 * The choice that governs a host: the most specific one that covers it, else the default.
 * @param {string} host @param {SitePrivacy[]} list @returns {{ host: string | null, mode: Mode, records: boolean }}
 */
export function privacyFor(host, list) {
  /** @type {SitePrivacy | null} */
  let best = null;
  for (const r of list) if (hostUnder(host, r.host) && (!best || r.host.length > best.host.length)) best = r;
  return best ? { host: best.host, mode: best.mode, records: best.records } : { host: null, ...DEFAULT };
}

/**
 * What Vyre may do on a tab, all in one place so every caller asks the same question.
 * @param {{ url?: string, incognito?: boolean } | null | undefined} tab @param {SitePrivacy[]} list
 * @returns {{ off: boolean, why: "incognito" | "not_a_page" | "never" | null, host: string | null, mode: Mode, records: boolean, read: boolean }}
 */
export function allowed(tab, list) {
  const page = pageOf(tab && tab.url);
  if (tab && tab.incognito) return { off: true, why: "incognito", host: page ? page.host : null, mode: "never", records: false, read: false };
  if (!page) return { off: true, why: "not_a_page", host: null, mode: "never", records: false, read: false };
  const p = privacyFor(page.host, list);
  if (p.mode === "never") return { off: false, why: "never", host: page.host, mode: "never", records: false, read: false };
  return { off: false, why: null, host: page.host, mode: p.mode, records: p.records, read: true };
}

/**
 * @param {{ get(k: string[]): Promise<Record<string, any>>, set(i: Record<string, any>): Promise<void> }} store
 */
export function createPrivacy(store) {
  async function list() {
    const kept = await store.get(["sitePrivacy"]);
    return /** @type {SitePrivacy[]} */ (kept["sitePrivacy"] ?? []);
  }
  return {
    list,
    /** @param {{ url?: string, incognito?: boolean } | null | undefined} tab */
    async of(tab) { return allowed(tab, await list()); },
    /**
     * Set one host's choice. Going back to the defaults removes the row.
     * @param {string} host @param {{ mode?: Mode, records?: boolean }} change
     */
    async set(host, change) {
      const h = String(host).toLowerCase();
      if (!h || h.length > 253) throw new Error("bad host");
      if (change.mode !== undefined && !MODES.includes(change.mode)) throw new Error("bad mode");
      const rows = await list();
      const now = privacyFor(h, rows);
      const next = { host: h, mode: change.mode ?? now.mode, records: change.records ?? now.records };
      const kept = rows.filter((r) => r.host !== h);
      if (next.mode !== DEFAULT.mode || next.records !== DEFAULT.records || kept.some((r) => hostUnder(h, r.host))) kept.push(next);
      await store.set({ sitePrivacy: kept.slice(-2000) });
      return next;
    },
  };
}
