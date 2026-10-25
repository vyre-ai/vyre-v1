// @ts-check
// Page addresses, host rules and what is safe to send. The Space's Vault does the matching of items to an address
// (vault.items.match, names and field keys only); the extension decides which pages it will fill at all, applies the person's
// Never Fill / Never Save rules by host, and sends only an origin: never a path, query or fragment.

/** Two-part public suffixes the extension knows, so "evil.co.uk" is never taken as a parent of "bank.co.uk". A longer list lives with the Space. */
const MULTI_SUFFIX = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "co.in", "com.br", "com.mx", "co.za", "com.sg", "com.hk", "com.tr", "com.cn"]);

/**
 * The host of a page address when it is a page the extension may work on, else null.
 * @param {string | undefined | null} url
 * @returns {{ origin: string, host: string, secure: boolean, local: boolean } | null}
 */
export function pageOf(url) {
  if (!url) return null;
  /** @type {URL} */
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return null;
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  return { origin: `${u.protocol}//${host}${u.port ? ":" + u.port : ""}`, host, secure: u.protocol === "https:", local };
}

/** May Vyre put a secret into this page? https always; http only on this computer. */
export function fillablePage(page) {
  return Boolean(page && (page.secure || page.local));
}

/** @param {string} h */
const isIp = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.startsWith("[");

/**
 * Is `parent` the same site as `host` or a parent domain of it? "login.example.com" is under "example.com"; "evilexample.com",
 * "example.com.evil.net", "com" and "co.uk" are not. IP addresses and localhost match only themselves.
 * @param {string} host @param {string} parent
 */
export function hostUnder(host, parent) {
  const h = host.toLowerCase();
  const p = parent.toLowerCase().replace(/^\.+/, "");
  if (!h || !p) return false;
  if (h === p) return true;
  if (isIp(h) || isIp(p) || h === "localhost" || p === "localhost") return false;
  if (!p.includes(".") || MULTI_SUFFIX.has(p)) return false;
  return h.endsWith(`.${p}`);
}

/** @typedef {{ host: string, neverFill: boolean, neverSave: boolean }} SiteRule */

/**
 * The rule that governs a host: the most specific one that covers it (an exact host beats a parent domain).
 * @param {string} host @param {SiteRule[]} rules @returns {SiteRule | null}
 */
export function ruleFor(host, rules) {
  /** @type {SiteRule | null} */
  let best = null;
  for (const r of rules) {
    if (!hostUnder(host, r.host)) continue;
    if (!best || r.host.length > best.host.length) best = r;
  }
  return best;
}

/** @param {number} n @returns {string} badge text: empty for none, "9+" past nine */
export function badgeText(n) {
  return n <= 0 ? "" : n > 9 ? "9+" : String(n);
}

/** What the popup may know about a matched item: its name and kind, never a username or value. @param {any} entry */
export function loginRow(entry) {
  const item = entry && entry.item ? entry.item : {};
  return { id: String(item.id ?? ""), name: String(item.name ?? ""), kind: String(item.kind ?? "login"), handle: String(item.handle ?? ""), hasUsername: Boolean(entry && entry.usernameField), usernameField: entry && entry.usernameField ? String(entry.usernameField) : "", fieldKeys: Array.isArray(item.fieldKeys) ? item.fieldKeys.map(String) : [] };
}
