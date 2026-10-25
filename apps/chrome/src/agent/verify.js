// @ts-check
// from vyre 0.6.9 modules/hands-chrome/verify.js@dbd2dfbab
// Did the action do anything? A click the browser accepted is not a click that landed. The check is blunt on purpose: sign the page before, sign it after,
// require the signatures to differ. The hash is FNV-1a (a service worker has no node:crypto and needs no secrecy here).

/** @param {string} s @param {number} seed */
function fnv(s, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
/** @param {string} s */
const hash = (s) => fnv(s, 0x811c9dc5) + fnv(s, 0x9747b28c);

/**
 * @typedef {{ path?: string, role: string, name?: string, enabled?: boolean, focused?: boolean, value?: string, length?: number, checked?: boolean }} Sigil
 * @typedef {{ title?: string, url?: string, text?: string, controls?: Sigil[] }} Looked
 */

/**
 * A fingerprint of what an action could plausibly move: title, url, which controls exist, their names, whether they are enabled and checked, what they hold
 * and where focus is, plus a hash of the visible text. Geometry is left out: a reflow by a pixel or a spinner turning changes boxes without anything having happened.
 * @param {Looked} snap
 */
export function signature(snap) {
  const parts = [snap.title || "", snap.url || "", hash(snap.text || "")];
  for (const c of snap.controls || []) {
    parts.push([c.path, c.role, c.name || "", c.enabled === false ? "0" : "1", c.focused ? "f" : "", c.checked === undefined ? "" : c.checked ? "c" : "u", c.value == null ? "" : String(c.value), c.length == null ? "" : String(c.length)].join("\u0001"));
  }
  return hash(parts.join("\u0002"));
}

/** @param {Looked} before @param {Looked} after */
export function changed(before, after) {
  const a = signature(before);
  const b = signature(after);
  if (a !== b) return { ok: true, why: "the page changed", before: a, after: b };
  return { ok: false, why: "nothing changed, so the action did not land", before: a, after: b };
}

/** What specifically moved, by control name only: never page text. @param {Looked} before @param {Looked} after */
export function diff(before, after) {
  /** @param {Sigil} c */
  const key = (c) => `${c.path}\u0001${c.role}`;
  const was = new Map((before.controls || []).map((c) => [key(c), c]));
  const now = new Map((after.controls || []).map((c) => [key(c), c]));
  /** @type {{ appeared: string[], vanished: string[], altered: string[], title: null | { from: string, to: string }, url: null | { from: string, to: string }, text: boolean }} */
  const out = { appeared: [], vanished: [], altered: [], title: null, url: null, text: (before.text || "") !== (after.text || "") };
  if ((before.title || "") !== (after.title || "")) out.title = { from: before.title || "", to: after.title || "" };
  if ((before.url || "") !== (after.url || "")) out.url = { from: before.url || "", to: after.url || "" };
  for (const [k, c] of now) if (!was.has(k)) out.appeared.push(c.name || c.role);
  for (const [k, c] of was) if (!now.has(k)) out.vanished.push(c.name || c.role);
  for (const [k, c] of now) {
    const p = was.get(k);
    if (!p) continue;
    if (p.enabled !== c.enabled || p.checked !== c.checked || String(p.value ?? "") !== String(c.value ?? "") || p.length !== c.length || p.name !== c.name) out.altered.push(c.name || c.role);
  }
  return out;
}
