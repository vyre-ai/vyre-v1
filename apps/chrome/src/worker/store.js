// @ts-check
// The only way the extension writes to browser storage. The extension never holds a value at rest (ARCH 7.12): what it keeps is
// which Space is active, the Spaces' names and web addresses (for the "open the web app" fallback), the site rules it last saw
// (hosts and two booleans, so the badge works before the app answers) and two switches. Every write is checked against this list
// here; a key that is not on it, a shape that does not fit, or a name that smells like a secret is refused.

/** @typedef {{ id: string, name: string, webUrl: string }} SpaceTile */

/** @type {Record<string, (v: any) => boolean>} */
const SHAPES = {
  activeSpace: (v) => v === null || (typeof v === "string" && v.length <= 80),
  spaces: (v) => Array.isArray(v) && v.length <= 50 && v.every((s) => s && typeof s.id === "string" && typeof s.name === "string" && typeof s.webUrl === "string" && Object.keys(s).length === 3),
  siteRules: (v) => Array.isArray(v) && v.length <= 2000 && v.every((r) => r && typeof r.host === "string" && typeof r.neverFill === "boolean" && typeof r.neverSave === "boolean" && Object.keys(r).length === 3),
  suggestOnPages: (v) => typeof v === "boolean",
  offerToSave: (v) => typeof v === "boolean",
};

export const KEYS = Object.freeze(Object.keys(SHAPES));
const SECRETY = /pass(word|phrase)?|secret|token|otp|totp|credential|cookie|session|private|apikey|api_key|cvv|pin\b/i;

export class StoreRefusal extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "StoreRefusal";
  }
}

/** Throws when anything in `v` (keys at any depth) is named like a secret. @param {unknown} v @param {string} at */
function noSecretNames(v, at) {
  if (Array.isArray(v)) { v.forEach((x, i) => noSecretNames(x, `${at}[${i}]`)); return; }
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (SECRETY.test(k)) throw new StoreRefusal(`${at}.${k}: the extension does not store secrets`);
      noSecretNames(x, `${at}.${k}`);
    }
  }
}

/**
 * @param {{ get(keys: string[]): Promise<Record<string, any>>, set(items: Record<string, any>): Promise<void>, remove(keys: string[]): Promise<void> }} area
 */
export function createStore(area) {
  return {
    /** @param {string[]} keys */
    async get(keys) {
      for (const k of keys) if (!KEYS.includes(k)) throw new StoreRefusal(`${k} is not a key the extension keeps`);
      const raw = await area.get(keys);
      /** @type {Record<string, any>} */
      const out = {};
      for (const k of keys) if (k in raw && SHAPES[k]?.(raw[k])) out[k] = raw[k];
      return out;
    },
    /** @param {Record<string, any>} items */
    async set(items) {
      for (const [k, v] of Object.entries(items)) {
        const shape = SHAPES[k];
        if (!shape) throw new StoreRefusal(`${k} is not a key the extension keeps`);
        if (!shape(v)) throw new StoreRefusal(`${k} has the wrong shape`);
        noSecretNames(v, k);
      }
      await area.set(items);
    },
    /** Forget everything the extension keeps (signing out, or the app was removed). */
    async clear() {
      await area.remove([...KEYS]);
    },
  };
}
