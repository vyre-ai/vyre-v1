// @ts-check
// What an agent may do on a site, from the person's Browser connections (Vault > Connections > Browser; capability browser.sites.list). Three answers:
//   "act"      the site is connected for this Chrome, and this agent has the Act right: it may click, type and fill (a send, post, payment or delete is still held).
//   "read"     it may read the page and move around, nothing else: the site has no connection, the agent has only Read only, or the site is not set to run here.
//   "unknown"  the app does not answer the list (an older app): behave as before.
// In an agent's own computer the Chrome has no person in front of it, so only a site that is listed and not set to run there is held to Read only; an unlisted site keeps working as it did.
// The list is read through the app on every call after a short memory-only cache (nothing is stored); nothing here reads a page or a secret.

import { hostUnder } from "../worker/match.js";

const TTL_MS = 15_000;

/** Tools that change something on a page. chrome_act is split by its action below; chrome_api only when it is not a GET. */
export const ACTING = Object.freeze(new Set(["chrome_click", "chrome_type", "chrome_fill", "chrome_eval", "chrome_send"]));
/** chrome_act actions that only look or move. */
export const LOOKING = Object.freeze(new Set(["scroll", "hover", "focus"]));

/** Does this call change something on the page? @param {string} tool @param {Record<string, any>} input */
export function acts(tool, input) {
  if (ACTING.has(tool)) return true;
  if (tool === "chrome_act") return !LOOKING.has(String(input["action"] ?? ""));
  if (tool === "chrome_api") return String(input["method"] ?? "GET").toUpperCase() !== "GET";
  return false;
}

/**
 * @param {{ list: (call: { agent: { id: string, name: string }, space: string }) => Promise<{ sites?: any[] } | null>, mode: () => "personal" | "computer", now?: () => number }} deps
 */
export function createRights({ list, mode, now = Date.now }) {
  /** @type {Map<string, { at: number, sites: any[] | null }>} */
  const cache = new Map();

  /** @param {{ agent: { id: string, name: string }, space: string }} call */
  async function sitesFor(call) {
    const key = `${call.space}:${call.agent.id}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < TTL_MS) return hit.sites;
    /** @type {any[] | null} */
    let sites;
    try {
      const out = await list(call);
      sites = out && Array.isArray(out.sites) ? out.sites : [];
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? String(/** @type {any} */ (e).code) : "";
      sites = code === "not_available" ? null : [];
    }
    cache.set(key, { at: now(), sites });
    return sites;
  }

  return {
    /** @param {{ agent: { id: string, name: string }, space: string }} call @param {string} host @returns {Promise<"act" | "read" | "unknown">} */
    async of(call, host) {
      const sites = await sitesFor(call);
      if (sites === null) return "unknown";
      /** @type {any} */
      let best = null;
      for (const s of sites) if (hostUnder(host, String(s.host)) && (!best || String(s.host).length > String(best.host).length)) best = s;
      if (mode() === "computer") {
        if (!best) return "unknown";
        if (best.runsIn === "chrome") return "read";
      } else if (!best || best.runsIn === "computers") return "read";
      const mine = (Array.isArray(best.rights) ? best.rights : []).find((/** @type {any} */ r) => r && r.agentId === call.agent.id);
      return mine && mine.right === "act" ? "act" : "read";
    },
    forget() { cache.clear(); },
  };
}
