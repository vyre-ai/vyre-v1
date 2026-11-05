// @ts-check
// Save-a-login (V1-SPEC 3.12). A page reports a sign-in the person submitted (username and password, from a trusted click or Enter).
// The worker asks the Vyre app whether the Vault already knows that login (bridge op login.check: the filler compares, nothing is
// revealed). If it is new or the password changed, the card (content/prompt.js) is shown once the page has settled, and the password
// leaves this worker for exactly one place: the page's card. Save then calls vault.item.put (or vault.item.update); Never for this
// site sets the site rule. A site the person set to Never Save is never asked about at all.

import { BridgeFailure } from "./protocol.js";
import { fillablePage, pageOf } from "./match.js";
import { showPromptInPage } from "./pagecalls.js";

const SETTLE_MS = 1500;

/** May the person add items to this folder? @param {any} f */
const canAdd = (f) => f && (f.yourLevel === "edit" || f.yourLevel === "manage");

/** The key every call of one card shares, so a retry is the same request. @param {unknown} id */
function cardKey(id) {
  const clean = typeof id === "string" ? id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) : "";
  return `chr_card_${clean || randomHex()}`;
}
function randomHex() {
  const b = new Uint8Array(9);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Try a call, and once more with the same key if the answer was lost. @template T @param {() => Promise<T>} f @returns {Promise<T>} */
async function again(f) {
  try { return await f(); } catch (e) {
    const code = e instanceof BridgeFailure ? e.code : "";
    if (code === "offline" || code === "timeout" || code === "no_host") return f();
    throw e;
  }
}
const PENDING_MS = 60_000;

/**
 * @param {{
 *   bridge: { invoke(c: string, i?: Record<string, any>): Promise<any>, op(o: string, i?: Record<string, any>): Promise<any> },
 *   scripting: { executeScript(o: any): Promise<any[]> },
 *   rules: { forHost(h: string): Promise<{ neverSave: boolean } | null>, set(h: string, c: { neverFill?: boolean, neverSave?: boolean }): Promise<any> },
 *   now?: () => number, setTimer?: (f: () => void, ms: number) => any, clearTimer?: (t: any) => void,
 * }} deps
 */
export function createSave({ bridge, scripting, rules, now = Date.now, setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (t) => clearTimeout(t) }) {
  /** @type {Map<number, { origin: string, host: string, username: string, password: string, mode: "save"|"update", name: string, itemId: string | null, agent: { id: string, name: string } | null, at: number, loading: boolean, timer: any }>} */
  const pending = new Map();

  /** What the card on a tab is about, without the password: which item it would update and which agent it offered. @type {Map<number, { itemId: string | null, agentId: string | null }>} */
  const offers = new Map();

  /** @param {number} tabId */
  function drop(tabId) {
    const p = pending.get(tabId);
    if (!p) return;
    clearTimer(p.timer);
    p.password = "";
    pending.delete(tabId);
  }

  /** @param {number} tabId */
  async function show(tabId) {
    const p = pending.get(tabId);
    if (!p) return false;
    if (now() - p.at > PENDING_MS) { drop(tabId); return false; }
    offers.set(tabId, { itemId: p.itemId, agentId: p.agent ? p.agent.id : null });
    const card = { host: p.host, username: p.username, password: p.password, mode: p.mode, name: p.name, agent: p.agent };
    drop(tabId);
    try {
      await scripting.executeScript({ target: { tabId, frameIds: [0] }, func: showPromptInPage, args: [card] });
      return true;
    } catch {
      return false;
    } finally {
      card.password = "";
    }
  }

  return {
    /**
     * A page reported a submitted login. `sender` is what the browser says about where it came from, never the message.
     * @param {{ tabId: number, origin: string }} sender @param {{ username: string, password: string, kind: "signin"|"signup" }} msg
     * @returns {Promise<{ prompt: boolean, why?: string }>}
     */
    async submitted(sender, msg) {
      const page = pageOf(sender.origin);
      if (!page || !fillablePage(page)) return { prompt: false, why: "page" };
      if (!msg.password || typeof msg.password !== "string" || msg.password.length > 1024) return { prompt: false, why: "password" };
      const rule = await rules.forHost(page.host);
      if (rule && rule.neverSave) return { prompt: false, why: "never_save" };
      /** @type {any} */
      let check;
      try {
        check = await bridge.op("login.check", { origin: page.origin, username: msg.username, password: msg.password, kind: msg.kind });
      } catch {
        return { prompt: false, why: "app" };
      }
      if (!check || check.state === "known") return { prompt: false, why: "known" };
      /** @type {{ id: string, name: string } | null} */
      let agent = null;
      try {
        const a = await bridge.op("agents.list", {});
        if (a && a.suggested && a.suggested.id) agent = { id: String(a.suggested.id), name: String(a.suggested.name || "your agent") };
      } catch { /* no agent to offer */ }
      drop(sender.tabId);
      const entry = {
        origin: page.origin, host: page.host, username: String(msg.username || ""), password: msg.password,
        mode: /** @type {"save"|"update"} */ (check.state === "changed" ? "update" : "save"), name: String(check.name || page.host),
        itemId: check.itemId ? String(check.itemId) : null, agent, at: now(), loading: false, timer: null,
      };
      // Show it once the page after the sign-in has loaded; a single-page app that never navigates shows it after a short settle.
      entry.timer = setTimer(() => { const p = pending.get(sender.tabId); if (p && !p.loading) void show(sender.tabId); }, SETTLE_MS);
      pending.set(sender.tabId, entry);
      return { prompt: true };
    },

    /** Wire to chrome.tabs.onUpdated. @param {number} tabId @param {{ status?: string }} info */
    async tabUpdated(tabId, info) {
      const p = pending.get(tabId);
      if (!p) return;
      if (info.status === "loading") { p.loading = true; return; }
      if (info.status === "complete" && p.loading) await show(tabId);
    },

    /** Wire to chrome.tabs.onRemoved. @param {number} tabId */
    tabClosed(tabId) { drop(tabId); offers.delete(tabId); },

    /**
     * What the card may choose from when the person picks Shared: the Space's shared folders they may add to, and the agents that can be allowed. Names and ids only.
     * @param {{ tabId: number, origin: string }} sender
     * @returns {Promise<{ folders: { id: string, name: string }[], agents: { id: string, name: string, suggested: boolean }[] }>}
     */
    async choices(sender) {
      const page = pageOf(sender.origin);
      if (!page || !fillablePage(page)) throw new BridgeFailure("insecure", "not secure");
      const [f, a] = await Promise.all([
        bridge.invoke("vault.folders.list", { scope: "shared" }).catch(() => ({ folders: [] })),
        bridge.op("agents.list", {}).catch(() => ({ agents: [], suggested: null })),
      ]);
      const folders = (Array.isArray(f && f.folders) ? f.folders : []).filter(canAdd).map((/** @type {any} */ x) => ({ id: String(x.id), name: String(x.name || "Shared folder").slice(0, 80) }));
      const suggested = a && a.suggested ? String(a.suggested.id) : "";
      const agents = (Array.isArray(a && a.agents) ? a.agents : []).map((/** @type {any} */ x) => ({ id: String(x.id), name: String(x.name || "Agent").slice(0, 60), suggested: String(x.id) === suggested }));
      return { folders, agents };
    },

    /**
     * The card's Save. Mine is the default and is private: a Mine item cannot be shared, so allowing agents needs a Shared folder (folderId, one the Space lists for this person).
     * Every call carries a key made from the card's id, so a retry after a dropped answer does not make a second item or a second grant.
     * @param {{ tabId: number, origin: string }} sender
     * @param {{ name: string, username: string, password: string, scope?: "mine"|"shared", folderId?: string, agentIds?: string[], cardId?: string, mode: "save"|"update" }} msg
     */
    async save(sender, msg) {
      const page = pageOf(sender.origin);
      if (!page || !fillablePage(page)) throw new BridgeFailure("insecure", "not secure");
      const name = String(msg.name || page.host).slice(0, 120);
      const offer = offers.get(sender.tabId) ?? { itemId: null, agentId: null };
      offers.delete(sender.tabId);
      const card = cardKey(msg.cardId);
      const shared = msg.scope === "shared";
      /** @type {any} */
      let item;
      if (msg.mode === "update" && offer.itemId) {
        const out = await again(() => bridge.invoke("vault.item.update", { itemId: offer.itemId, fieldsSet: [{ key: "password", value: msg.password, secret: true }] }));
        item = out && out.item;
      } else {
        const folders = await bridge.invoke("vault.folders.list", { scope: shared ? "shared" : "mine" });
        const list = (Array.isArray(folders && folders.folders) ? folders.folders : []).filter(canAdd);
        // A Shared save names its folder, and only a folder the Space just listed for this person is accepted: the page's word is never enough.
        const target = shared ? list.find((/** @type {any} */ f) => String(f.id) === String(msg.folderId)) : list[0];
        if (!target) throw new BridgeFailure("no_folder", shared ? "That shared folder is not one you can add to." : "There is no folder of yours to save into.");
        const out = await again(() => bridge.invoke("vault.item.put", {
          idempotencyKey: `${card}_put`, folderId: target.id, name, kind: "login",
          fields: [
            { key: "url", value: page.origin },
            { key: "username", value: msg.username },
            { key: "password", value: msg.password, secret: true },
          ],
        }));
        item = out && out.item;
      }
      /** @type {string[]} */
      const allowed = [];
      /** @type {string[]} */
      const refused = [];
      if (shared && item && item.id) {
        const known = new Set((await bridge.op("agents.list", {}).catch(() => ({ agents: [] }))).agents?.map((/** @type {any} */ a) => String(a.id)) ?? []);
        for (const agentId of [...new Set((Array.isArray(msg.agentIds) ? msg.agentIds : []).map(String))].slice(0, 20)) {
          if (!known.has(agentId)) { refused.push(agentId); continue; }
          try {
            await again(() => bridge.invoke("vault.share", { idempotencyKey: `${card}_use_${agentId}`, resource: { type: "vault_item", id: item.id }, subject: { kind: "agent", id: agentId }, level: "use" }));
            allowed.push(agentId);
          } catch { refused.push(agentId); }
        }
      }
      return { saved: true, itemId: item ? String(item.id) : null, scope: shared ? "shared" : "mine", allowed, refused };
    },

    /** The card's Not now or Never. @param {{ tabId: number, origin: string }} sender @param {{ never: boolean }} msg */
    async dismissed(sender, msg) {
      drop(sender.tabId);
      offers.delete(sender.tabId);
      const page = pageOf(sender.origin);
      if (msg.never && page) await rules.set(page.host, { neverSave: true });
      return { never: Boolean(msg.never && page) };
    },

    get pendingCount() { return pending.size; },
  };
}
