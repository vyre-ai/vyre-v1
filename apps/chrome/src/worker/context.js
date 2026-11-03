// @ts-check
// What the side panel, Ask, Save to Notes and the record lookup read from a page, decided in one place against the per-site privacy choice (privacy.js).
// The page chip carries the title, the address, the page's visible text and a masked screenshot; the Selected chip carries the highlighted text. Neither ever carries
// a field's value: innerText leaves inputs out, and the selection is refused when it sits in a password field. Record lookup sends only the address and the email
// addresses and phone numbers written on the page, so the app can say "Marisol Vega matched by her email address".

import { maskedShot } from "./shot.js";
import { pageOf } from "./match.js";

export const TEXT_MAX = 20_000;
export const SELECTION_MAX = 4_000;

/** Run in the page: its visible text (no field values), the selection when it is not inside a secret field, and the contact details written on it. */
export function readPage(textMax, selMax) {
  const g = /** @type {any} */ (globalThis);
  const doc = g.document;
  const body = doc.body;
  const text = body ? String(body.innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, textMax) : "";
  let selection = "";
  const sel = g.getSelection ? g.getSelection() : null;
  const active = doc.activeElement;
  const inSecret = active && active.tagName === "INPUT" && String(active.type).toLowerCase() === "password";
  if (sel && !inSecret) selection = String(sel.toString() || "").trim().slice(0, selMax);
  const emails = [...new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((e) => e.toLowerCase()))].slice(0, 10);
  const phones = [...new Set((text.match(/\+?\d[\d ().-]{7,}\d/g) || []).map((p) => p.replace(/[^\d+]/g, "")).filter((p) => p.length >= 8 && p.length <= 15))].slice(0, 10);
  const desc = doc.querySelector('meta[name="description"]');
  return { title: String(doc.title || ""), description: desc ? String(desc.getAttribute("content") || "").slice(0, 300) : "", text, selection, emails, phones };
}

/**
 * @param {{ tabs: any, scripting: any }} ext
 * @param {{ of(tab: any): Promise<ReturnType<typeof import("./privacy.js").allowed>> }} privacy
 */
export function createContext(ext, privacy) {
  /** @param {number} tabId */
  async function read(tabId) {
    try {
      const [r] = await ext.scripting.executeScript({ target: { tabId }, func: readPage, args: [TEXT_MAX, SELECTION_MAX] });
      return r && r.result ? r.result : null;
    } catch { return null; }
  }

  return {
    read,
    /**
     * The page as the panel shows it before sending. `shot` false skips the screenshot (the person removed it, or this is a refresh that does not need one).
     * @param {any} tab @param {{ shot?: boolean, text?: boolean }} [o]
     */
    async page(tab, o = {}) {
      const may = await privacy.of(tab);
      const p = pageOf(tab && tab.url);
      const base = { tabId: tab ? tab.id : null, url: tab ? String(tab.url || "") : "", title: tab ? String(tab.title || "") : "", host: p ? p.host : "", privacy: may };
      if (!may.read) return { ...base, page: null, shot: null };
      const got = o.text === false ? null : await read(tab.id);
      const shot = o.shot === false ? null : await maskedShot(ext, tab.id, { maxW: 1280 });
      return { ...base, title: got && got.title ? got.title : base.title, page: got, shot };
    },
    /** Only the selection, for the Selected chip. Empty when the site is never sent or the window is incognito. @param {any} tab */
    async selection(tab) {
      const may = await privacy.of(tab);
      if (!may.read) return "";
      const got = await read(tab.id);
      return got ? got.selection : "";
    },
  };
}
