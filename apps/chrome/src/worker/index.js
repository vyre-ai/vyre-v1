// @ts-check
// The service worker: the only part of the extension that talks to the Vyre app on this computer, and the only owner of fill and
// save state. The popup and the content scripts send it messages; it answers from the bridge (native messaging host
// `run.vyre.bridge`) and, when there is no app, offers the web app for the Space. The worker holds no value at rest: see store.js,
// fill.js and save.js.

import { createBridge } from "./bridge.js";
import { createFill } from "./fill.js";
import { badgeText, pageOf } from "./match.js";
import { BridgeFailure, wordsFor } from "./protocol.js";
import { createRules } from "./rules.js";
import { createSave } from "./save.js";
import { createStore } from "./store.js";

/** A web address we will open for a Space: https, or http on this computer. @param {unknown} u */
function openable(u) {
  const p = pageOf(typeof u === "string" ? u : "");
  return p && (p.secure || p.local) ? p.origin : null;
}

/** @param {unknown} e */
function failure(e) {
  const code = e instanceof BridgeFailure ? e.code : "error";
  return { error: { code, message: wordsFor(e) } };
}

/**
 * Build the worker around a browser API. `ext` is `chrome` (or a fake in tests).
 * @param {any} ext
 */
export function createWorker(ext) {
  const bridge = createBridge(ext);
  const store = createStore(ext.storage.local);
  const rules = createRules({ bridge, store });
  const fill = createFill({ bridge, scripting: ext.scripting, rules });
  const save = createSave({ bridge, scripting: ext.scripting, rules });

  bridge.onPush((m) => {
    if (m && m.type === "spaces") {
      const tiles = m.spaces.map((/** @type {any} */ s) => ({ id: String(s.id), name: String(s.name), webUrl: openable(s.webUrl) ?? "" })).filter((/** @type {any} */ s) => s.webUrl);
      void store.set({ spaces: tiles, activeSpace: m.active });
      rules.forget();
    }
  });

  async function activeTab() {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    return tab && tab.id !== undefined ? tab : null;
  }

  /** @param {{ id?: number, url?: string }} tab */
  async function refreshBadge(tab) {
    if (tab.id === undefined) return;
    const kept = await store.get(["activeSpace"]);
    if (!kept["activeSpace"]) { await ext.action.setBadgeText({ tabId: tab.id, text: "" }); return; }
    try {
      const r = await fill.loginsFor(tab.url);
      await ext.action.setBadgeText({ tabId: tab.id, text: badgeText(r.rows.length) });
      await ext.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#4338ca" });
    } catch {
      await ext.action.setBadgeText({ tabId: tab.id, text: "" });
    }
  }

  /** What the popup draws: the Space, the page, the logins for it. */
  async function popupState() {
    const tab = await activeTab();
    const page = pageOf(tab && tab.url);
    const kept = await store.get(["activeSpace", "spaces"]);
    /** @type {any} */
    const state = { page: page ? { host: page.host, origin: page.origin, secure: page.secure || page.local } : null, spaces: kept["spaces"] ?? [], active: kept["activeSpace"] ?? null, status: "connecting", rows: [], blocked: null, error: null, agents: null };
    try {
      const hello = await bridge.op("hello");
      const spaces = (Array.isArray(hello && hello.spaces) ? hello.spaces : []).map((/** @type {any} */ s) => ({ id: String(s.id), name: String(s.name), webUrl: openable(s.webUrl) ?? "" }));
      state.spaces = spaces;
      state.active = hello && typeof hello.active === "string" ? hello.active : null;
      await store.set({ spaces, activeSpace: state.active });
      state.locked = Boolean(hello && hello.locked);
      state.status = "online";
      if (state.locked) { state.error = { code: "locked", message: wordsFor({ code: "locked" }) }; return state; }
      const r = await fill.loginsFor(tab && tab.url);
      state.rows = r.rows;
      state.blocked = r.blocked;
      if (tab) await ext.action.setBadgeText({ tabId: tab.id, text: badgeText(r.rows.length) });
    } catch (e) {
      state.status = e instanceof BridgeFailure && e.code === "no_host" ? "no_host" : "offline";
      state.error = failure(e).error;
    }
    return state;
  }

  /** @param {any} msg @param {any} sender */
  async function fromPopup(msg, sender) {
    const tab = await activeTab();
    switch (msg.type) {
      case "popup.state": return { data: await popupState() };
      case "popup.fill": {
        if (!tab) return failure(new BridgeFailure("no_page", ""));
        const r = await fill.fill({ tabId: tab.id, url: tab.url, itemId: String(msg.itemId), usernameField: msg.usernameField ? String(msg.usernameField) : undefined, kind: msg.kind === "otp" ? "otp" : "login", signIn: Boolean(msg.signIn) });
        return { data: r };
      }
      case "popup.neverFill": {
        const page = pageOf(tab && tab.url);
        if (!page) return failure(new BridgeFailure("no_page", ""));
        await rules.set(page.host, { neverFill: msg.on !== false });
        if (tab) await refreshBadge(tab);
        return { data: { host: page.host, neverFill: msg.on !== false } };
      }
      case "popup.selectSpace": {
        await bridge.op("space.select", { id: String(msg.id) });
        await store.set({ activeSpace: String(msg.id) });
        rules.forget();
        if (tab) await refreshBadge(tab);
        return { data: { active: String(msg.id) } };
      }
      case "popup.agents": return { data: await bridge.op("agents.list", { page: tab ? pageOf(tab.url)?.host ?? null : null }) };
      case "popup.ask": {
        if (!tab || !pageOf(tab.url)) return failure(new BridgeFailure("no_page", ""));
        const q = String(msg.question || "").trim();
        if (!q) return { data: { sent: false } };
        await bridge.op("ask.page", { agentId: msg.agentId ? String(msg.agentId) : null, question: q, page: { url: String(tab.url), title: String(tab.title || "") } });
        return { data: { sent: true } };
      }
      case "popup.openVault": {
        try {
          await bridge.op("app.open", { place: "vault", itemId: msg.itemId ? String(msg.itemId) : null });
          return { data: { opened: "app" } };
        } catch (e) {
          const kept = await store.get(["spaces", "activeSpace"]);
          const space = (kept["spaces"] ?? []).find((/** @type {any} */ s) => s.id === kept["activeSpace"]) ?? (kept["spaces"] ?? [])[0];
          const web = space ? openable(space.webUrl) : null;
          if (!web) return failure(e);
          await ext.tabs.create({ url: `${web}/vault` });
          return { data: { opened: "web" } };
        }
      }
      case "popup.openWeb": {
        const kept = await store.get(["spaces", "activeSpace"]);
        const space = (kept["spaces"] ?? []).find((/** @type {any} */ s) => s.id === (msg.id ?? kept["activeSpace"])) ?? (kept["spaces"] ?? [])[0];
        const web = space ? openable(space.webUrl) : null;
        if (!web) return failure(new BridgeFailure("no_host", ""));
        await ext.tabs.create({ url: web });
        return { data: { opened: "web" } };
      }
      default: return failure(new BridgeFailure("not_allowed", String(msg.type)));
    }
  }

  /** @param {any} msg @param {any} sender */
  async function fromPage(msg, sender) {
    const tabId = sender.tab.id;
    const origin = sender.origin || sender.url || "";
    switch (msg.type) {
      case "vyre.submit": return { data: await save.submitted({ tabId, origin }, { username: String(msg.username || ""), password: String(msg.password || ""), kind: msg.kind === "signup" ? "signup" : "signin" }) };
      case "vyre.save": return { data: await save.save({ tabId, origin }, { name: String(msg.name || ""), username: String(msg.username || ""), password: String(msg.password || ""), share: Boolean(msg.share), mode: msg.mode === "update" ? "update" : "save" }) };
      case "vyre.dismiss": return { data: await save.dismissed({ tabId, origin }, { never: Boolean(msg.never) }) };
      default: return failure(new BridgeFailure("not_allowed", String(msg.type)));
    }
  }

  /**
   * chrome.runtime.onMessage: popup messages come from the extension's own page (no tab); page messages come from a content script (a tab).
   * Returns a promise for the reply. @param {any} msg @param {any} sender
   */
  async function onMessage(msg, sender) {
    if (!msg || typeof msg.type !== "string" || sender.id !== ext.runtime.id) return failure(new BridgeFailure("not_allowed", ""));
    try {
      if (msg.type.startsWith("popup.")) return sender.tab ? failure(new BridgeFailure("not_allowed", "")) : await fromPopup(msg, sender);
      if (msg.type.startsWith("vyre.")) return sender.tab ? await fromPage(msg, sender) : failure(new BridgeFailure("not_allowed", ""));
      return failure(new BridgeFailure("not_allowed", ""));
    } catch (e) {
      return failure(e);
    }
  }

  return {
    bridge, store, rules, fill, save, popupState, refreshBadge, onMessage,
    /** @param {number} tabId @param {{ status?: string }} info @param {any} tab */
    async onTabUpdated(tabId, info, tab) {
      await save.tabUpdated(tabId, info);
      if (info.status === "complete" && tab) await refreshBadge(tab);
    },
    /** @param {number} tabId */
    onTabRemoved(tabId) { save.tabClosed(tabId); },
    /** @param {{ tabId: number }} info */
    async onTabActivated(info) {
      const tab = await ext.tabs.get(info.tabId);
      await refreshBadge(tab);
    },
  };
}

/** Wire the real browser. Runs only inside the extension, never in tests. */
function start() {
  const ext = /** @type {any} */ (globalThis).chrome;
  if (!ext || !ext.runtime || !ext.runtime.id) return;
  const w = createWorker(ext);
  ext.runtime.onMessage.addListener((/** @type {any} */ msg, /** @type {any} */ sender, /** @type {(r: any) => void} */ reply) => {
    w.onMessage(msg, sender).then(reply, () => reply({ error: { code: "error", message: "Something went wrong. Try again." } }));
    return true;
  });
  ext.tabs.onUpdated.addListener((/** @type {number} */ id, /** @type {any} */ info, /** @type {any} */ tab) => { void w.onTabUpdated(id, info, tab); });
  ext.tabs.onRemoved.addListener((/** @type {number} */ id) => w.onTabRemoved(id));
  ext.tabs.onActivated.addListener((/** @type {any} */ info) => { void w.onTabActivated(info); });
}

start();
