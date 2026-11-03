// @ts-check
// The side panel's worker half (prototype "Side panel"): the panel page asks, the worker answers from the page (context.js), the person's privacy choice (privacy.js)
// and the Vyre app (bridge). The panel opens from the toolbar icon or Cmd+Shift+L (chrome.sidePanel), one per window, and follows that window's active tab.
//
//   panel.state    Space, agents, the panel's last agent and model, the active tab's page (no screenshot) and whether Vyre is off here (incognito, not a page, never)
//   panel.page     the page chip: title, address, text and a masked screenshot; the Selected chip's text
//   panel.records  records that match the page (records.match), only when the site allows records
//   panel.models   the live models for the person's account (engine.models.list, lane l-livemodels)
//   panel.send     one message: chat.ask with what the chips still carry; the reply streams to the panel's port as "delta"
//   panel.search / panel.thread / panel.open / panel.space / panel.pick / panel.site
//
// The panel keeps a port named "vyre.panel" open; the worker pushes reply deltas, Selected chip changes and tab switches down it.

import { BridgeFailure } from "./protocol.js";
import { pageOf } from "./match.js";

export const PANEL_PORT = "vyre.panel";
const TEXT_SEND_MAX = 20_000;

/** @param {unknown} v @param {number} max */
const str = (v, max) => String(v ?? "").slice(0, max);

/**
 * What a message carries, from what the chips say. Pure: the chips decide, the privacy choice can only take away.
 * @param {{ text: string, page: boolean, shot: boolean, selection: string }} chips
 * @param {{ read: boolean } } may
 * @param {{ url: string, title: string, page: { text: string } | null, shot: { dataUrl: string } | null } | null} ctx
 */
export function outgoing(chips, may, ctx) {
  /** @type {{ text: string, page?: { url: string, title: string, text: string, shot?: string }, selection?: { text: string, url: string } }} */
  const out = { text: str(chips.text, 20_000).trim() };
  if (!may.read || !ctx) return out;
  if (chips.page) {
    out.page = { url: ctx.url, title: ctx.title, text: ctx.page ? str(ctx.page.text, TEXT_SEND_MAX) : "" };
    if (chips.shot && ctx.shot) out.page.shot = ctx.shot.dataUrl;
  }
  if (chips.selection && chips.selection.trim()) out.selection = { text: str(chips.selection, 4000), url: ctx.url };
  return out;
}

/**
 * @param {{
 *   ext: any,
 *   bridge: { op(o: string, i?: any): Promise<any>, invoke(c: string, i?: any): Promise<any>, onPush(h: (m: any) => void): () => void },
 *   store: { get(k: string[]): Promise<Record<string, any>>, set(i: Record<string, any>): Promise<void> },
 *   privacy: ReturnType<typeof import("./privacy.js").createPrivacy>,
 *   context: ReturnType<typeof import("./context.js").createContext>,
 *   views?: Map<number, string>,
 * }} deps
 */
export function createPanel({ ext, bridge, store, privacy, context, views = new Map() }) {
  /** @type {Set<any>} */
  const ports = new Set();
  /** @type {Map<number, string>} the last selection seen in each tab */
  const selections = new Map();

  /** @param {any} m @param {number | null} [windowId] */
  function tell(m, windowId = null) {
    for (const p of ports) {
      if (windowId !== null && p.windowId !== null && p.windowId !== windowId) continue;
      try { p.port.postMessage(m); } catch { ports.delete(p); }
    }
  }

  bridge.onPush((m) => {
    if (m && m.type === "chat.delta") tell({ type: "delta", threadId: m.threadId, turnId: m.turnId, text: m.text, done: m.done, error: m.error });
    if (m && m.type === "spaces") tell({ type: "spaces", spaces: m.spaces, active: m.active });
  });

  /** The tab a panel works for: the active tab in its window. @param {unknown} windowId */
  async function tabOf(windowId) {
    const q = typeof windowId === "number" ? { active: true, windowId } : { active: true, lastFocusedWindow: true };
    const [tab] = await ext.tabs.query(q);
    if (!tab) return null;
    return tab;
  }

  async function picks() {
    const kept = await store.get(["panelPicks", "activeSpace"]);
    const space = kept["activeSpace"] ?? null;
    const row = (kept["panelPicks"] ?? []).find((/** @type {any} */ r) => r.space === space);
    return { space, agent: row ? row.agent : "", model: row ? row.model : "" };
  }

  /** @param {any} msg */
  async function handle(msg) {
    switch (msg.type) {
      case "panel.state": {
        const tab = await tabOf(msg.windowId);
        const may = await privacy.of(tab);
        if (may.why === "incognito") return { data: { off: "incognito" } };
        /** @type {any} */
        let hello = null;
        let status = "online";
        try { hello = await bridge.op("hello"); } catch (e) { status = e instanceof BridgeFailure && e.code === "no_host" ? "no_host" : "offline"; }
        if (hello && hello.signedIn === false) status = "signed_out";
        if (hello && Array.isArray(hello.spaces)) await store.set({ spaces: hello.spaces.map((/** @type {any} */ s) => ({ id: String(s.id), name: String(s.name), webUrl: String(s.webUrl ?? "") })), activeSpace: typeof hello.active === "string" ? hello.active : null }).catch(() => {});
        /** @type {any} */
        let agents = { agents: [], suggested: null };
        if (hello && !hello.locked && status === "online") { try { agents = await bridge.op("agents.list", { page: may.read ? may.host : null }); } catch { /* the picker shows nobody */ } }
        const pick = await picks();
        const view = tab ? views.get(tab.windowId) ?? null : null;
        if (tab) views.delete(tab.windowId);
        return {
          data: {
            off: null, status, view, locked: Boolean(hello && hello.locked),
            spaces: hello ? hello.spaces ?? [] : [], active: hello ? hello.active ?? null : null,
            agents: Array.isArray(agents && agents.agents) ? agents.agents : [], suggested: agents ? agents.suggested ?? null : null, pick,
            page: tab ? { tabId: tab.id, url: may.read ? String(tab.url || "") : "", title: may.read ? String(tab.title || "") : "", host: may.host, privacy: may } : null,
          },
        };
      }
      case "panel.page": {
        const tab = await tabOf(msg.windowId);
        if (!tab) return { data: null };
        const ctx = await context.page(tab, { shot: msg.shot !== false });
        if (ctx.page && ctx.page.selection) selections.set(tab.id, ctx.page.selection);
        return { data: { ...ctx, selection: ctx.privacy.read ? (selections.get(tab.id) ?? "") : "" } };
      }
      case "panel.records": {
        const tab = await tabOf(msg.windowId);
        const may = await privacy.of(tab);
        if (!may.read || !may.records) return { data: { records: [] } };
        const got = await context.read(tab.id);
        try {
          const out = await bridge.op("records.match", { url: String(tab.url), title: str(tab.title, 300), emails: got ? got.emails : [], phones: got ? got.phones : [] });
          return { data: { records: Array.isArray(out && out.records) ? out.records.slice(0, 5) : [] } };
        } catch { return { data: { records: [] } }; }
      }
      case "panel.models": {
        const out = await bridge.invoke("engine.models.list", msg.threadId ? { threadId: str(msg.threadId, 80) } : {});
        const models = (Array.isArray(out && out.models) ? out.models : []).map((/** @type {any} */ m) => ({
          id: `${m.provider}/${m.model}`, provider: String(m.provider), model: String(m.model), title: String(m.title || m.model), driver: String(m.driver || ""), allowed: m.allowed !== false, reason: m.reason ?? null, isDefault: Boolean(m.isDefault),
        }));
        return { data: { models, listed: out && out.listed ? out.listed : null } };
      }
      case "panel.send": {
        const tab = await tabOf(msg.windowId);
        const may = await privacy.of(tab);
        if (may.why === "incognito") throw new BridgeFailure("incognito", "");
        const chips = { text: str(msg.text, 20_000), page: Boolean(msg.page), shot: Boolean(msg.shot), selection: str(msg.selection, 4000) };
        if (!chips.text.trim()) return { data: { sent: false } };
        // The screenshot is taken again at send time, so what goes is what the page shows now, masked.
        const ctx = may.read && (chips.page || chips.selection) && tab ? await context.page(tab, { shot: chips.page && chips.shot }) : null;
        const body = outgoing(chips, may, ctx);
        const pick = await picks();
        const out = await bridge.op("chat.ask", { agentId: str(msg.agentId || pick.agent, 80) || null, model: str(msg.model || pick.model, 120) || null, threadId: msg.threadId ? str(msg.threadId, 80) : null, ...body, from: "chrome" });
        return { data: { sent: true, threadId: out && out.threadId ? String(out.threadId) : null, turnId: out && out.turnId ? String(out.turnId) : null, carried: { page: Boolean(body.page), shot: Boolean(body.page && body.page.shot), selection: Boolean(body.selection) } } };
      }
      case "panel.search": {
        const tab = await tabOf(msg.windowId);
        const page = pageOf(tab && tab.url);
        const may = await privacy.of(tab);
        const out = await bridge.op("chat.search", { q: str(msg.q, 200), host: may.read && page ? page.host : null, limit: 40 });
        return { data: { threads: Array.isArray(out && out.threads) ? out.threads : [] } };
      }
      case "panel.thread": return { data: await bridge.op("chat.thread", { threadId: str(msg.threadId, 80) }) };
      case "panel.open": {
        const place = ["chats", "notes", "vault", "watching", "skill", "goal", "record"].includes(msg.place) ? msg.place : "chats";
        const id = msg.id ? str(msg.id, 80) : null;
        try { return { data: await bridge.op("app.open", { place, id }) }; } catch (e) {
          // No desktop app to open it: the Space's web app, at the same place.
          const kept = await store.get(["spaces", "activeSpace"]);
          const sp = (kept["spaces"] ?? []).find((/** @type {any} */ s) => s.id === kept["activeSpace"]);
          const web = sp && /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(sp.webUrl) ? new URL(sp.webUrl).origin : null;
          if (!web) throw e;
          const path = { chats: "/chats", notes: "/chats/notes", vault: "/vault", watching: "/automations#screen=watching", skill: "/settings/skills", goal: "/goals", record: "/records" }[place] ?? "/";
          await ext.tabs.create({ url: place === "watching" ? `${web}${path}` : `${web}${path}${id ? `/${encodeURIComponent(id)}` : ""}` });
          return { data: { opened: "web" } };
        }
      }
      case "panel.space": {
        await bridge.op("space.select", { id: str(msg.id, 80) });
        await store.set({ activeSpace: str(msg.id, 80) });
        return { data: { active: str(msg.id, 80) } };
      }
      case "panel.pick": {
        const kept = await store.get(["panelPicks", "activeSpace"]);
        const space = kept["activeSpace"];
        if (typeof space !== "string") return { data: null };
        const rows = (kept["panelPicks"] ?? []).filter((/** @type {any} */ r) => r.space !== space);
        rows.push({ space, agent: str(msg.agent, 80), model: str(msg.model, 120) });
        await store.set({ panelPicks: rows.slice(-50) });
        return { data: { agent: str(msg.agent, 80), model: str(msg.model, 120) } };
      }
      case "panel.site": {
        const tab = await tabOf(msg.windowId);
        const page = pageOf(tab && tab.url);
        if (!page || (tab && tab.incognito)) throw new BridgeFailure("no_page", "");
        /** @type {{ mode?: any, records?: boolean }} */
        const change = {};
        if (msg.mode !== undefined) change.mode = msg.mode;
        if (msg.records !== undefined) change.records = Boolean(msg.records);
        const next = await privacy.set(page.host, change);
        if (next.mode === "never") selections.delete(tab.id);
        tell({ type: "site", host: page.host, privacy: await privacy.of(tab) }, tab.windowId);
        return { data: next };
      }
      default: throw new BridgeFailure("not_allowed", String(msg.type));
    }
  }

  return {
    handle,
    tell,
    /** A panel page connected its port. @param {any} port */
    connect(port) {
      const entry = { port, windowId: /** @type {number | null} */ (null) };
      ports.add(entry);
      port.onMessage.addListener((/** @type {any} */ m) => { if (m && m.type === "hello" && typeof m.windowId === "number") entry.windowId = m.windowId; });
      port.onDisconnect.addListener(() => ports.delete(entry));
    },
    get open() { return ports.size; },
    /** A content script saw the selection change (select.js). Kept per tab, sent to that window's panel, never for a never-site or incognito. @param {any} tab @param {string} text */
    async selected(tab, text) {
      const may = await privacy.of(tab);
      if (!may.read) return false;
      const t = str(text, 4000).trim();
      if (t) selections.set(tab.id, t); else selections.delete(tab.id);
      tell({ type: "selection", tabId: tab.id, text: t }, tab.windowId);
      return true;
    },
    /** Ask from the bubble or the right-click menu: the Selected chip gets the text, and the panel is told to focus its composer. @param {any} tab @param {string} text */
    async ask(tab, text) {
      if (!(await this.selected(tab, text))) return false;
      tell({ type: "ask", tabId: tab.id, text: str(text, 4000).trim() }, tab.windowId);
      return true;
    },
    /** The active tab changed or loaded: the panel refreshes its chips. @param {any} tab */
    tabChanged(tab) { if (tab) tell({ type: "tab", tabId: tab.id }, tab.windowId); },
    tabClosed(/** @type {number} */ tabId) { selections.delete(tabId); },
  };
}
