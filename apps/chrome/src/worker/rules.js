// @ts-check
// The person's Never Fill and Never Save sites for the active Space, read through vault.site_rules.list. Cached for a minute so a
// page does not cost a round trip every time; the last list is also kept in storage (hosts and two booleans) so the badge and the
// rule checks still work while the Vyre app is starting.

import { ruleFor } from "./match.js";

const FRESH_MS = 60_000;

/**
 * @param {{ bridge: { invoke(c: string, i?: Record<string, any>): Promise<any> }, store: { get(k: string[]): Promise<Record<string, any>>, set(i: Record<string, any>): Promise<void> }, now?: () => number }} deps
 */
export function createRules({ bridge, store, now = Date.now }) {
  /** @type {{ at: number, rules: { host: string, neverFill: boolean, neverSave: boolean }[] } | null} */
  let cache = null;

  async function list() {
    if (cache && now() - cache.at < FRESH_MS) return cache.rules;
    try {
      const out = await bridge.invoke("vault.site_rules.list", {});
      const rules = (Array.isArray(out && out.sites) ? out.sites : []).map((/** @type {any} */ s) => ({ host: String(s.host), neverFill: Boolean(s.neverFill), neverSave: Boolean(s.neverSave) }));
      cache = { at: now(), rules };
      await store.set({ siteRules: rules });
      return rules;
    } catch {
      if (cache) return cache.rules;
      const kept = await store.get(["siteRules"]);
      return kept["siteRules"] ?? [];
    }
  }

  return {
    list,
    /** @param {string} host */
    async forHost(host) { return ruleFor(host, await list()); },
    /**
     * Set one site's rule; keeps the other flag as it was. @param {string} host @param {{ neverFill?: boolean, neverSave?: boolean }} change
     */
    async set(host, change) {
      const before = ruleFor(host, await list());
      const exact = before && before.host === host ? before : null;
      const next = { host, neverFill: change.neverFill ?? exact?.neverFill ?? false, neverSave: change.neverSave ?? exact?.neverSave ?? false };
      await bridge.invoke("vault.site_rules.set", next);
      cache = null;
      return next;
    },
    forget() { cache = null; },
  };
}
