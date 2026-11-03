// @ts-check
// Fill orchestration. The person picks a login (or a code) in the popup; the worker never fetches the value. It
//   1. finds the sign-in fields in the page (content scripts hand back refs, never values),
//   2. asks the Space's Vault for a handle to the item (vault.use) and then for a fill of each field into a browser ref (vault.fill),
//   3. relays what the vault filler pushes for that ref into that one field, once, and drops it.
// So a value passes through this worker's memory for one message and is never stored, logged or kept in a variable afterwards
// (the fill test checks every storage area and every log line for the value).

import { BridgeFailure, REF_TTL_MS } from "./protocol.js";
import { fillablePage, loginRow, pageOf } from "./match.js";
import { applyInPage, forgetInPage, prepareInPage, submitInPage } from "./pagecalls.js";

const FILL_WAIT_MS = 3000;
/** The field keys a Vault card may use for each card field, first match wins. */
const CARD_KEYS = /** @type {Record<string, string[]>} */ ({
  "cc-number": ["number", "card_number", "cardnumber"], "cc-name": ["name", "cardholder", "holder", "card_name"], "cc-exp": ["expiry", "exp", "expires", "expiration"],
  "cc-expMonth": ["exp_month", "expiry_month", "month"], "cc-expYear": ["exp_year", "expiry_year", "year"], "cc-cvc": ["cvc", "cvv", "csc", "security_code"],
});

/** @param {number} n */
function randomRef(n) {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return `w${n}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * @param {{
 *   bridge: { invoke(c: string, i?: Record<string, any>): Promise<any>, onPush(h: (m: any) => void): () => void },
 *   scripting: { executeScript(o: any): Promise<{ frameId: number, result?: any }[]> },
 *   rules: { forHost(host: string): Promise<{ neverFill: boolean } | null> },
 *   now?: () => number, waitMs?: number,
 * }} deps
 */
export function createFill({ bridge, scripting, rules, now = Date.now, waitMs = FILL_WAIT_MS }) {
  /** @type {Map<string, { tabId: number, frameId: number, pageRef: string, role: string, expires: number }>} */
  const refs = new Map();
  let counter = 0;
  /** @type {Map<string, (applied: boolean) => void>} */
  const waiters = new Map();

  /** Resolves true when the value pushed for `ref` has gone into its field, false after `ms` without a push. @param {string} ref @param {number} ms */
  function waitFor(ref, ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { waiters.delete(ref); resolve(false); }, ms);
      waiters.set(ref, (applied) => { clearTimeout(timer); waiters.delete(ref); resolve(applied); });
    });
  }

  /** The vault filler pushed a value for a ref we handed out: put it in that field and forget it. @param {any} m */
  async function deliver(m) {
    if (!m || m.type !== "fill") return;
    const r = refs.get(m.ref);
    refs.delete(m.ref);
    if (!r || r.expires < now()) return;
    let value = String(m.value);
    let applied = false;
    try {
      const [res] = await scripting.executeScript({ target: { tabId: r.tabId, frameIds: [r.frameId] }, func: applyInPage, args: [r.pageRef, value] });
      applied = Boolean(res && res.result);
    } finally {
      value = "";
      const w = waiters.get(m.ref);
      if (w) w(applied);
    }
  }
  bridge.onPush(deliver);

  /** Logins for a page: names and kinds only. @param {string | undefined} url */
  async function loginsFor(url) {
    const page = pageOf(url);
    if (!page) return { page: null, blocked: "no_page", rows: [] };
    const rule = await rules.forHost(page.host);
    if (rule && rule.neverFill) return { page, blocked: "never_fill", rows: [] };
    const out = await bridge.invoke("vault.items.match", { url: page.origin });
    const rows = (Array.isArray(out && out.items) ? out.items : []).map(loginRow);
    return { page, blocked: null, rows };
  }

  /**
   * Fill one login (or its code) into a tab.
   * @param {{ tabId: number, url: string, itemId: string, usernameField?: string, kind?: "login" | "otp" | "card", signIn?: boolean }} job
   * @returns {Promise<{ filled: string[], signedIn: boolean }>}
   */
  async function fill(job) {
    const page = pageOf(job.url);
    if (!page) throw new BridgeFailure("no_page", "not a web page");
    if (!fillablePage(page)) throw new BridgeFailure("insecure", "not secure");
    const rule = await rules.forHost(page.host);
    if (rule && rule.neverFill) throw new BridgeFailure("never_fill", "never fill here");

    const wantRoles = job.kind === "otp" ? ["otp"] : job.kind === "card" ? ["cc-number", "cc-name", "cc-exp", "cc-expMonth", "cc-expYear", "cc-cvc"] : ["username", "password"];
    const found = await scripting.executeScript({ target: { tabId: job.tabId, allFrames: true }, func: prepareInPage, args: [{ roles: wantRoles }] });
    const frame = found.find((f) => f.result && f.result.fields && f.result.fields.some((/** @type {any} */ x) => x.role === "password" || x.role === "otp" || x.role === "cc-number")) ?? found.find((f) => f.result && f.result.fields && f.result.fields.length);
    if (!frame || !frame.result) throw new BridgeFailure("no_field", "no sign-in field");
    /** @type {{ ref: string, role: string }[]} */
    const fields = frame.result.fields;

    const used = await bridge.invoke("vault.use", { item: job.itemId, purpose: `fill ${page.host}` });
    const have = new Set(Array.isArray(used && used.fields) ? used.fields : []);
    const keyFor = (/** @type {string} */ role) => role === "username" ? (job.usernameField || "username") : role === "password" ? "password" : role.startsWith("cc-") ? (CARD_KEYS[role] || []).find((/** @type {string} */ k) => have.has(k)) ?? "" : "totp";

    /** @type {string[]} */
    const filled = [];
    /** @type {string[]} */
    const minted = [];
    try {
      for (const f of fields) {
        const key = keyFor(f.role);
        if (!key || !have.has(key)) continue;
        const ref = randomRef(++counter);
        minted.push(ref);
        refs.set(ref, { tabId: job.tabId, frameId: frame.frameId, pageRef: f.ref, role: f.role, expires: now() + REF_TTL_MS });
        const landed = waitFor(ref, waitMs);
        const done = await bridge.invoke("vault.fill", { handle: `${used.handle}.${key}`, target: { kind: "browser", ref } });
        const applied = await landed;
        if (done && done.filled && applied) filled.push(f.role);
      }
      let signedIn = false;
      if (job.signIn && job.kind !== "card" && filled.some((r) => r === "password" || r === "otp")) {
        const [res] = await scripting.executeScript({ target: { tabId: job.tabId, frameIds: [frame.frameId] }, func: submitInPage, args: [] });
        signedIn = Boolean(res && res.result);
      }
      return { filled, signedIn };
    } finally {
      for (const ref of minted) refs.delete(ref);
      try { await scripting.executeScript({ target: { tabId: job.tabId, frameIds: [frame.frameId] }, func: forgetInPage, args: [] }); } catch { /* the tab closed */ }
    }
  }

  /** The accounts for a page as the field badge's picker lists them: the item's name and, under it, the username when the Vault says it (so two logins for one site can be told apart). Never a password. @param {string | undefined} url */
  async function accountsFor(url) {
    const r = await loginsFor(url);
    if (r.blocked || !r.page) return { blocked: r.blocked, rows: [] };
    const out = await bridge.invoke("vault.items.match", { url: r.page.origin });
    const items = Array.isArray(out && out.items) ? out.items : [];
    return { blocked: null, rows: items.map((/** @type {any} */ e) => ({ ...loginRow(e), username: typeof e.username === "string" ? e.username.slice(0, 120) : "" })) };
  }

  /** The person's card items, names only: a card is not tied to a site, so the list is the Vault's cards the person may use. */
  async function cards() {
    const out = await bridge.invoke("vault.items.list", { kind: "card", section: "personal" });
    return (Array.isArray(out && out.items) ? out.items : []).map((/** @type {any} */ i) => ({ id: String(i.id ?? ""), name: String(i.name ?? "Card").slice(0, 80), kind: "card" }));
  }

  return { loginsFor, accountsFor, cards, fill, deliver, get pendingRefs() { return refs.size; } };
}
