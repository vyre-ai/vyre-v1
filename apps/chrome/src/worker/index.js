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
import { createContext } from "./context.js";
import { createMenus } from "./menus.js";
import { createNotes } from "./notes.js";
import { createPanel, PANEL_PORT } from "./panel.js";
import { createPrivacy } from "./privacy.js";
import { createRecorder } from "./record.js";
import { createWatches } from "./watch.js";
// Agent control (P-L10_06): starts itself in the extension when Chrome has granted the optional debugger permission, and does nothing otherwise.
import "../agent/index.js";

/** What a page in an incognito window may still ask for: the fill the person clicks. Everything else is off there. */
const INCOGNITO_OK = new Set(["vyre.fill"]);

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
  const privacy = createPrivacy(store);
  const context = createContext(ext, privacy);
  /** @type {Map<number, string>} the view a side panel should open on, by window (a right-click Watch or Show Vyre how) */
  const views = new Map();
  const panel = createPanel({ ext, bridge, store, privacy, context, views });
  const notes = createNotes({ ext, bridge, privacy, context });
  const menus = createMenus({ ext, notes, panel, views, privacy });
  const recorder = createRecorder({ ext, bridge, privacy });
  const watches = createWatches({ ext, bridge, privacy });

  bridge.onPush((m) => {
    if (m && m.type === "spaces") {
      const tiles = m.spaces.map((/** @type {any} */ s) => ({ id: String(s.id), name: String(s.name), webUrl: openable(s.webUrl) ?? "" })).filter((/** @type {any} */ s) => s.webUrl);
      void store.set({ spaces: tiles, activeSpace: m.active });
      rules.forget();
    }
    if (m && m.type === "tab.open" && ext.tabs) void ext.tabs.create({ url: m.url });
    if (m && m.type === "watch.run") void watches.look();
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
    // Incognito: Vyre is off. Nothing a page says is read, saved or sent; only a fill the person clicks works (vault badge, below).
    if (sender.tab.incognito && !INCOGNITO_OK.has(msg.type)) return msg.type === "vyre.selection" ? { data: { off: true } } : failure(new BridgeFailure("incognito", ""));
    switch (msg.type) {
      case "vyre.selection": return { data: { off: !(await panel.selected(sender.tab, String(msg.text || ""))) } };
      case "vyre.clip": return { data: await notes.clip(sender.tab, String(msg.selection || "")) };
      case "vyre.ask": {
        // The bubble's Ask: the Selected chip gets the text and the panel opens (the click is the gesture; open before anything awaits).
        menus.openPanel(sender.tab, "chat").catch(() => {});
        return { data: { asked: await panel.ask(sender.tab, String(msg.selection || "")) } };
      }
      case "vyre.rec.hello": return { data: await recorder.hello(tabId) };
      case "vyre.rec.step": { void recorder.step(tabId, sender.tab, msg); return { data: { ok: true } }; }
      case "vyre.rec.ctl": {
        const op = msg.op === "stop" ? "stop" : msg.op === "pause" ? ((await recorder.state()).paused ? "resume" : "pause") : null;
        return op ? { data: await recorder.control(op) } : failure(new BridgeFailure("not_allowed", ""));
      }
      case "vyre.pick": return { data: { ok: watches.picked(tabId, msg) } };
      case "vyre.openNote": return { data: await bridge.op("app.open", { place: "notes", id: String(msg.noteId || "").slice(0, 80) }) };
      case "vyre.submit": return { data: await save.submitted({ tabId, origin }, { username: String(msg.username || ""), password: String(msg.password || ""), kind: msg.kind === "signup" ? "signup" : "signin" }) };
      case "vyre.save": return { data: await save.save({ tabId, origin }, { name: String(msg.name || ""), username: String(msg.username || ""), password: String(msg.password || ""), share: Boolean(msg.share), mode: msg.mode === "update" ? "update" : "save" }) };
      case "vyre.dismiss": return { data: await save.dismissed({ tabId, origin }, { never: Boolean(msg.never) }) };
      default: return failure(new BridgeFailure("not_allowed", String(msg.type)));
    }
  }

  /** The tab a panel works for: the active tab of its window. @param {any} msg */
  async function panelTab(msg) {
    const [tab] = await ext.tabs.query(typeof msg.windowId === "number" ? { active: true, windowId: msg.windowId } : { active: true, lastFocusedWindow: true });
    if (!tab || tab.id === undefined) throw new BridgeFailure("no_page", "");
    return tab;
  }

  /** The side panel's recording and watching messages. @param {any} msg */
  async function fromPanelExtra(msg) {
    switch (msg.type) {
      case "panel.rec.state": return { data: await recorder.state() };
      case "panel.rec.start": return { data: await recorder.start(await panelTab(msg), { name: typeof msg.name === "string" ? msg.name : "" }) };
      case "panel.rec.control": return { data: await recorder.control(msg.op === "stop" ? "stop" : msg.op === "resume" ? "resume" : "pause") };
      case "panel.watch.list": return { data: await watches.list() };
      case "panel.watch.save": return { data: await watches.save(await panelTab(msg), msg.watch || {}) };
      case "panel.watch.change": return { data: await watches.change(String(msg.watchId || ""), msg.op === "remove" ? "remove" : msg.op === "resume" ? "resume" : "pause") };
      case "panel.watch.check": return { data: await watches.checkNow(String(msg.watchId || "")) };
      case "panel.watch.givePc": {
        // The agent sets up its own computer (it has the tool for it); the person's click is the yes. The chat is where they follow it.
        const agentId = String(msg.agentId || "").slice(0, 80);
        if (!agentId) throw new BridgeFailure("not_allowed", "");
        const out = await bridge.op("chat.ask", { agentId, text: "Please set up your own computer. I want to give you pages to watch and check for me while my computer is off.", from: "chrome" });
        return { data: { threadId: out && out.threadId ? String(out.threadId) : null } };
      }
      case "panel.watch.pick": {
        const tab = await panelTab(msg);
        await watches.guard(tab);
        // the picker answers when the person clicks; the panel is told by its port so the sheet can show the choice
        void watches.pick(tab).then((region) => panel.tell({ type: "picked", region }, tab.windowId));
        return { data: { picking: true } };
      }
      default: return failure(new BridgeFailure("not_allowed", String(msg.type)));
    }
  }

  /** The review page: read and edit a recording, save it as a skill, share it, try it. @param {any} msg */
  async function fromReview(msg) {
    const id = String(msg.id || "").slice(0, 80);
    switch (msg.type) {
      case "rec.get": return { data: await recorder.get(id) };
      case "rec.edit": return { data: await recorder.edit(id, msg.edit || {}) };
      case "rec.discard": return { data: await recorder.discard(id) };
      case "rec.agents": return { data: await bridge.op("agents.list", {}) };
      case "rec.save": return { data: await recorder.save(id, { agents: Array.isArray(msg.agents) ? msg.agents : [] }) };
      case "rec.add": return { data: await recorder.addToAgents(id) };
      case "rec.share": return { data: await recorder.share(id, { space: Boolean(msg.space), stop: Boolean(msg.stop) }) };
      case "rec.try": return { data: await recorder.tryIt(id, String(msg.agentId || "")) };
      case "rec.open": return { data: await bridge.op("app.open", { place: msg.place === "chats" ? "chats" : "skill", id: String(msg.skillId || "").slice(0, 80) }) };
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
      // The side panel is an extension page: its sender has our own address (a content script's sender has the page's). Opened as its own window it also has a tab.
      const ownPage = typeof sender.url === "string" && sender.url.startsWith(`chrome-extension://${ext.runtime.id}/src/panel/`);
      if (msg.type === "panel.clip" && ownPage) {
        const [tab] = await ext.tabs.query(typeof msg.windowId === "number" ? { active: true, windowId: msg.windowId } : { active: true, lastFocusedWindow: true });
        if (!tab) return failure(new BridgeFailure("no_page", ""));
        return { data: await notes.clip(tab, "") };
      }
      const reviewPage = typeof sender.url === "string" && sender.url.startsWith(`chrome-extension://${ext.runtime.id}/src/review/`);
      if (msg.type.startsWith("rec.")) return reviewPage ? await fromReview(msg) : failure(new BridgeFailure("not_allowed", ""));
      if (ownPage && (msg.type.startsWith("panel.rec.") || msg.type.startsWith("panel.watch."))) return await fromPanelExtra(msg);
      if (msg.type.startsWith("panel.")) return ownPage ? await panel.handle(msg) : failure(new BridgeFailure("not_allowed", ""));
      if (msg.type.startsWith("vyre.")) return sender.tab ? await fromPage(msg, sender) : failure(new BridgeFailure("not_allowed", ""));
      return failure(new BridgeFailure("not_allowed", ""));
    } catch (e) {
      return failure(e);
    }
  }

  return {
    bridge, store, rules, fill, save, privacy, context, panel, notes, menus, recorder, watches, popupState, refreshBadge, onMessage,
    /** @param {number} tabId @param {{ status?: string, url?: string }} info @param {any} tab */
    async onTabUpdated(tabId, info, tab) {
      await save.tabUpdated(tabId, info);
      await recorder.tabUpdated(tabId, info, tab);
      if ((info.status === "complete" || info.url) && tab && tab.active) panel.tabChanged(tab);
      if (info.status === "complete" && tab) await refreshBadge(tab);
    },
    /** @param {number} tabId */
    onTabRemoved(tabId) { save.tabClosed(tabId); panel.tabClosed(tabId); void recorder.tabClosed(tabId); },
    /** @param {{ tabId: number }} info */
    async onTabActivated(info) {
      const tab = await ext.tabs.get(info.tabId);
      panel.tabChanged(tab);
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
  ext.tabs.onCreated.addListener((/** @type {any} */ tab) => { void w.recorder.tabCreated(tab); });
  // Watches that run in this Chrome are looked at once a minute.
  if (ext.alarms) {
    w.watches.schedule();
    ext.alarms.onAlarm.addListener((/** @type {any} */ a) => { if (a && a.name === "vyre.watch") void w.watches.look(); });
  }
  // The side panel opens from the toolbar icon and Cmd+Shift+L (the action's command), one per window.
  if (ext.sidePanel && ext.sidePanel.setPanelBehavior) void ext.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  ext.runtime.onConnect.addListener((/** @type {any} */ port) => {
    if (port.name !== PANEL_PORT || !port.sender || port.sender.id !== ext.runtime.id || !String(port.sender.url || "").startsWith(`chrome-extension://${ext.runtime.id}/src/panel/`)) return;
    w.panel.connect(port);
  });
  if (ext.contextMenus) {
    ext.runtime.onInstalled.addListener(() => w.menus.install());
    ext.contextMenus.onClicked.addListener((/** @type {any} */ info, /** @type {any} */ tab) => { void w.menus.clicked(info, tab); });
  }
}

start();
