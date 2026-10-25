// @ts-check
// What an agent may read back about a page's traffic and values. Credentials, tokens, cookies and anything named like a secret are masked
// before a result leaves the extension; a URL in an event keeps its origin and path, never its query or fragment, where sign-in links live.
// Ported from the 0.6 hands-chrome scrub (bareUrl, scrub) and lib/siteops/redact, with real types.

export const MASK = "••••";
const SECRETY = /pass(word|phrase|wd)?|secret|token|otp|totp|credential|cookie|session|private|api[-_]?key|authoriz|bearer|cvv|cvc|csrf|xsrf|card[-_]?number|(^|[^a-z])(pin|ssn|auth)([^a-z]|$)/i;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

/** @param {string} name */
export const isSecretName = (name) => SECRETY.test(String(name));

/**
 * A URL's origin and path, with no query, fragment or login, and any long token-shaped path segment (a reset or magic link, a signed download) replaced by an ellipsis.
 * Works on what URL() refuses too: everything from the first ? or # goes whatever else the string holds.
 * @param {string} u
 */
export function bareUrl(u) {
  const cut = String(u).split(/[?#]/)[0] ?? "";
  let head, path;
  try { const x = new URL(cut); head = `${x.protocol}//${x.host}`; path = x.pathname; } catch {
    const m = /^([a-z][a-z0-9+.-]*:\/\/)(?:[^/@]*@)?([^/]*)(.*)$/i.exec(cut);
    head = m ? `${m[1]}${m[2]}` : cut;
    path = m ? (m[3] ?? "") : "";
  }
  return head + path.replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/g, "/…");
}

/**
 * Words about an action, cut to one line of at most 200 characters, with every URL in them made bare. A URL runs to the next whitespace, quotes included,
 * so a quote cannot end it early and leave its query behind.
 * @param {unknown} text
 */
export function scrub(text) {
  const one = String(text ?? "").replace(/\s+/g, " ").trim();
  const cut = one.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, bareUrl);
  return cut.length > 200 ? `${cut.slice(0, 199)}…` : cut;
}

/** A URL for a result: the path and query kept, the values of secret-named query keys and any login masked. @param {string} u */
export function maskUrl(u) {
  try {
    const x = new URL(u);
    x.username = "";
    x.password = "";
    x.hash = "";
    for (const k of [...x.searchParams.keys()]) if (isSecretName(k)) x.searchParams.set(k, MASK);
    return x.toString().replace(/%E2%80%A2/gi, "•");
  } catch { return bareUrl(u); }
}

/** @param {string} text */
export function maskText(text) {
  return String(text).replace(JWT, MASK).replace(BEARER, (_m, scheme) => `${scheme} ${MASK}`);
}

/** Mask by key name at any depth. @param {unknown} v @param {number} [depth] @returns {unknown} */
export function maskJson(v, depth = 0) {
  if (depth > 8) return MASK;
  if (typeof v === "string") return maskText(v);
  if (Array.isArray(v)) return v.slice(0, 500).map((x) => maskJson(x, depth + 1));
  if (v && typeof v === "object") {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = isSecretName(k) && x !== null && x !== undefined && x !== "" ? MASK : maskJson(x, depth + 1);
    return out;
  }
  return v;
}

/** Header names and values of a request or response, secret ones masked. @param {Record<string, unknown> | undefined} h */
export function maskHeaders(h) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(h ?? {})) out[k.toLowerCase()] = isSecretName(k) || /^set-cookie$|^authorization$|^proxy-authorization$|^x-api-key$/i.test(k) ? MASK : maskText(String(v));
  return out;
}

/** @param {string} s */
function safeDecode(s) {
  try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s; }
}

/** A body for a result, parsed by its type and masked: JSON by key, form posts by field, anything else by token shape. @param {string} body @param {string} [mime] @param {number} [max] */
export function maskBody(body, mime = "", max = 4000) {
  const text = String(body ?? "");
  let out;
  if (/json/i.test(mime) || /^\s*[[{]/.test(text)) {
    try { out = JSON.stringify(maskJson(JSON.parse(text))); } catch { out = maskText(text); }
  } else if (/x-www-form-urlencoded/i.test(mime)) {
    out = text.split("&").map((p) => { const i = p.indexOf("="); return i > 0 && isSecretName(safeDecode(p.slice(0, i))) ? `${p.slice(0, i)}=${MASK}` : maskText(p); }).join("&");
  } else out = maskText(text);
  return out.length > max ? `${out.slice(0, max)}…` : out;
}
