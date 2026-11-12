// @ts-check
// The Vyre side panel (approved 3 Nov): one top bar (Space tile and switcher; Search chats, New chat, More, Open in Vyre, Close), a quiet record line, two suggestions on an
// empty chat, and a composer with the page chip (title and a screenshot thumbnail toggle), a separate Selected chip, and the agent and live model pickers.
// It talks only to the extension's worker (chrome.runtime messages "panel.*" and the "vyre.panel" port). The conversation is the same thread as Vyre Chats.
// Everything is built node by node (ui/dom.js): page titles, messages and names are text, never markup.

import { h, mount } from "../ui/dom.js";
import { face, ic, mark, spaceTile } from "../ui/icons.js";
import { recLine, showSheet, watchSheet, watchingSheet } from "./sheets.js";
import { FREQS, runsOnFor } from "../ui/watch-model.js";
import { ago, applyDelta, chips, groupThreads, modelGroups, modelLabel, suggestions, WHY_NOT } from "./model.js";

const g = /** @type {any} */ (globalThis);
const chrome = g.chrome;
const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (document.querySelector(s));
const params = new URLSearchParams(location.search);

/** @typedef {{ id: string, who: string, kind?: string, avatar?: string | null, face?: string | null, assistant?: boolean, text: string, at: number, turnId?: string, streaming?: boolean, error?: string | null, att?: { title: string, shot: string | null, selection: string } | null }} Msg */
const S = {
  windowId: /** @type {number | null} */ (null),
  status: "connecting", off: /** @type {string | null} */ (null), locked: false,
  spaces: /** @type {{ id: string, name: string }[]} */ ([]), active: /** @type {string | null} */ (null),
  agents: /** @type {{ id: string, name: string, avatar?: string, assistant?: boolean, role?: string }[]} */ ([]),
  agent: "", model: "",
  models: /** @type {any[] | null} */ (null), modelsError: "",
  page: /** @type {any} */ (null), shot: /** @type {string | null} */ (null), selection: "",
  pageRemoved: /** @type {boolean | null} */ (null), shotOn: true, selRemoved: false,
  records: /** @type {any[]} */ ([]), recOpen: false,
  conv: /** @type {Msg[]} */ ([]), threadId: /** @type {string | null} */ (null), sending: false,
  view: "chat", hq: "", threads: /** @type {any[]} */ ([]), searching: false,
  draft: "", error: "",
  // recording (Show Vyre how) and watching (Watch this page)
  rec: /** @type {{ running: boolean, paused?: boolean, count?: number, secret?: boolean }} */ ({ running: false }), recName: "", recError: "", recBusy: false,
  w: /** @type {{ tellOpen: boolean, tellPeople: string[], tellThreads: string[], goalOn: boolean, goalId: string | null, what: "region" | "page", region: { label: string, selector?: string, text?: string } | null, every: number, agentId: string, run: "computer" | "chrome" | null, picking: boolean, saving: boolean, error: string, note: string }} */ ({
    tellOpen: false, tellPeople: [], tellThreads: [], goalOn: false, goalId: null, what: "region", region: null, every: 30, agentId: "", run: null, picking: false, saving: false, error: "", note: "" }),
  dir: /** @type {any} */ (null), goals: /** @type {any[] | null} */ (null),
  wList: /** @type {any[] | null} */ (null), wOpen: /** @type {string | null} */ (null), wError: "",
};
const SHEETS = ["show", "watch", "watching"];

/** @param {string} type @param {Record<string, any>} [body] */
function ask(type, body = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, windowId: S.windowId, ...body }, (/** @type {any} */ r) => {
      const le = chrome.runtime.lastError;
      if (le) { reject(new Error(le.message)); return; }
      if (r && r.error) { reject(Object.assign(new Error(r.error.message || "Something went wrong."), { code: r.error.code })); return; }
      resolve(r ? r.data : null);
    });
  });
}

const agentOf = (/** @type {string} */ id) => S.agents.find((a) => a.id === id) ?? S.agents[0] ?? null;
const spaceOf = () => S.spaces.find((s) => s.id === S.active) ?? null;
/** @param {string} a @param {Record<string, any>} [o] */
const act = (a, o = {}) => ({ ...o, data: { a, ...(o["data"] ?? {}) } });
/** An icon button. @param {string} a @param {string} icon @param {string} tip @param {Record<string, any>} [o] */
const ib = (a, icon, tip, o = {}) => h(`button.ib.sm${o["on"] ? ".on" : ""}`, act(a, { "data-tip": tip, "aria-label": tip, ...o, on: undefined }), ic(icon, "s"));

// ---------- views

function top() {
  const sp = spaceOf();
  const v = S.view;
  mount($("#top"),
    h("button.spsw", act("space", { "data-tip": sp ? sp.name : "Spaces", "aria-label": "Switch Space", "aria-haspopup": "menu" }), spaceTile(sp ? sp.name : "V"), h("span.mut", { css: { display: "grid" } }, ic("chev", "xs"))),
    h("span.grow"),
    ib("history", "search", "Search chats", { on: v === "history" }),
    ib("new", "edit", "New chat"),
    ib("more", "more", "More", { on: v === "site", "aria-haspopup": "menu" }),
    ib("openVyre", "open", "Open in Vyre"),
    ib("close", "x", "Close"),
  );
}

/** @param {Msg} m */
function msgView(m) {
  const who = m.who === "me" ? { name: "You", kind: "person" } : { name: m.who, kind: m.kind ?? "agent", avatar: m.avatar ?? null, face: m.face ?? null, assistant: Boolean(m.assistant) };
  const t = new Date(m.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const att = m.att ? h("div.att", null, m.att.shot ? h("img", { alt: "", src: m.att.shot }) : ic("globe", "xs"),
    h("span.ell", null, `${m.att.title}${m.att.selection ? `${m.att.title ? " · " : ""}Selected text` : ""}`)) : null;
  return h(`div.msg${m.who === "me" ? ".me" : ""}`, { data: { turn: m.turnId ?? "" } }, face(who, 24),
    h("div.grow", null,
      h("div.who", null, who.name, h("span", null, t)),
      h(`div.txt${m.error ? ".err" : ""}`, null, m.error ? m.error : m.text, m.streaming ? h("span.caret") : null),
      att,
      ...(m.artifacts || []).map((/** @type {any} */ a) => h("button.btn.q", act("openArtifact", { data: { id: a.id } }), ic("open", "s"), `Open ${a.title}`)),
      m.who !== "me" && !m.streaming && !m.error ? h("div.mline", null, h("button.btn.q", act("openVyre"), ic("open", "s"), "Open in Vyre"), ib("copy", "copy", "Copy", { data: { a: "copy", id: m.id } })) : null));
}

function recordLine() {
  const rec = S.records[0];
  const kind = String(rec.kind || "Record");
  const line = h(`button.recl${S.recOpen ? ".open" : ""}`, act("rec", { "data-tip": `Matches a record in Vyre${rec.why ? `: ${rec.why}` : ""}`, "aria-expanded": String(S.recOpen) }),
    ic(/contact|person|lead/i.test(kind) ? "user" : /event|meeting/i.test(kind) ? "calendar" : "record", "s"),
    h("span.ell", null, h("span", { css: { color: "var(--ink)" } }, rec.name), ` · ${kind}`), h("span.rv", null, ic("chev", "xs")));
  if (!S.recOpen) return [line];
  const rows = [
    ...(rec.chats ?? []).slice(0, 3).map((/** @type {any} */ c) => h("button.rrow", act("openThread", { data: { id: c.threadId } }), face({ name: c.agentName || "?", kind: c.kind ?? "agent", avatar: c.avatar ?? null, face: c.face ?? null }, 18), h("span.grow.ell", null, c.title), h("span.xs.mut", null, ago(c.at, Date.now())))),
    ...(rec.goals ?? []).slice(0, 2).map((/** @type {any} */ gl) => h("button.rrow", act("openGoal", { data: { id: gl.goalId } }), ic("goal", "s"), h("span.grow.ell", null, gl.title),
      typeof gl.progress === "number" ? h("span.prog", { css: { width: "40px" } }, h("i", { css: { width: `${Math.round(Math.max(0, Math.min(1, gl.progress)) * 100)}%` } })) : null, gl.label ? h("span.xs.mut", null, gl.label) : null)),
    h("button.rrow", act("openRecord", { data: { id: rec.id } }), ic("open", "s"), h("span.grow.ell", null, `Open ${rec.name} in Vyre`)),
  ];
  return [line, h("div.recx", null, rows)];
}

function chatView() {
  const c = chips({ privacy: S.page ? S.page.privacy : null, pageRemoved: S.pageRemoved, selection: S.selection, selectionRemoved: S.selRemoved });
  const a = agentOf(S.agent);
  const rec = S.records[0] && !c.never ? S.records[0] : null;
  const empty = S.conv.length === 0;
  const list = [];
  if (c.page && S.page) {
    list.push(h("span.ch.pg", null, h("span.fav", null, h("img", { alt: "", src: faviconOf(S.page.url) })), h("span.t", { "data-tip": S.page.host }, S.page.title || S.page.host),
      h(`button.shot${S.shotOn ? "" : ".off"}`, act("shot", { "data-tip": S.shotOn ? "Screenshot included. Click to leave it out." : "No screenshot. Click to include one.", "aria-pressed": String(S.shotOn), "aria-label": "Screenshot" }),
        S.shotOn && S.shot ? h("img", { alt: "", src: S.shot }) : ic("camera", "xs")),
      h("button.cx", act("chipX", { "data-tip": "Don't send this page", "aria-label": "Don't send this page" }), ic("x", "xs"))));
  }
  if (c.selected) {
    list.push(h("span.ch.selq", null, h("span.sl", null, "Selected"), h("span.t", { "data-tip": S.selection.slice(0, 300) }, S.selection),
      h("button.cx", act("selX", { "data-tip": "Don't send the selection", "aria-label": "Don't send the selection" }), ic("x", "xs"))));
  }
  const q = h("textarea", { id: "q", rows: "2", placeholder: `Ask ${a ? a.name : "Vyre"}`, "aria-label": "Message", value: S.draft });
  const comp = h("div.comp2", null,
    list.length ? h("div.chips", { id: "chips" }, list) : null,
    q,
    h("div.cbar2", null,
      h("button.mp", act("agent", { "data-tip": "Who answers", "aria-haspopup": "menu" }), a ? face({ name: a.name, avatar: a.avatar ?? null, face: a.face ?? null, assistant: Boolean(a.assistant) }, 18) : null, h("span.ell", null, a ? a.name : "No agent"), ic("chev", "xs")),
      h("button.mp", act("model", { "data-tip": "Model", "aria-haspopup": "menu" }), h("span.ell", null, S.models ? modelLabel(S.models, S.model) : S.model ? String(S.model.split("/").pop()) : "Default model"), ic("chev", "xs")),
      c.never ? ib("site", "eyeoff", "This site is never sent") : c.canAttach ? ib("attach", "clip", "Attach this page") : null,
      h("span.grow"),
      h("button.send", act("send", { "data-tip": "Send", "aria-label": "Send", disabled: S.sending || !a }), ic("up", "s"))));
  return [
    S.rec.running ? recLine(S.rec) : null,
    ...(rec ? recordLine() : []),
    h("div.pconv", { id: "conv" }, S.conv.map(msgView)),
    empty && !c.never ? h("div.quiet", null, suggestions({ host: S.page ? S.page.host ?? "" : "", title: S.page ? S.page.title : "", record: rec }).map((t) => h("button", act("sugg", { data: { t } }), ic("spark", "xs"), h("span.ell", null, t)))) : null,
    S.error ? h("div.note.err", null, S.error) : null,
    comp,
  ];
}

function historyView() {
  const host = S.page && S.page.privacy && S.page.privacy.read ? S.page.host : null;
  const gr = groupThreads(S.threads, host);
  const row = (/** @type {any} */ t) => h("button.hrow", act("openThread", { data: { id: t.threadId } }), face({ name: t.agentName || "?", avatar: t.avatar ?? null, face: t.face ?? null, assistant: Boolean(t.assistant), kind: t.kind ?? "agent" }, 20),
    h("div.grow", null, h("div.ell", null, t.title), h("div.xs.mut.ell", null, `${t.agentName || ""}${t.host ? ` · ${t.host}` : ""}`)), h("span.xs.mut", null, ago(t.updatedAt, Date.now())));
  const body = S.searching && !S.threads.length ? [h("div.qline.pad", null, "Searching")]
    : !S.threads.length ? [h("div.qline.pad", null, S.hq ? `No chats match "${S.hq}"` : "No chats yet")]
    : [gr.here.length ? h("div.rlbl", null, "On this page") : null, ...gr.here.map(row), gr.earlier.length ? h("div.rlbl", null, "Earlier") : null, ...gr.earlier.map(row)];
  return [h("div.hsearch", null, ic("search", "s"), h("input", { id: "hq", placeholder: "Search chats", value: S.hq, autocomplete: "off", "aria-label": "Search chats" })), h("div.pconv.list", null, body)];
}

function siteView() {
  const p = S.page && S.page.privacy;
  const mode = p ? (p.read ? p.mode : "never") : "attach";
  const o = (/** @type {string} */ k, /** @type {string} */ t, /** @type {string} */ d) => h(`button.opt${mode === k ? ".on" : ""}`, act("siteOpt", { data: { k }, role: "radio", "aria-checked": String(mode === k) }), h("span.rd"), h("div", null, h("div.ot", null, t), h("div.od", null, d)));
  const rec = S.records[0];
  return h("div.sheet", null,
    h("div.shh", null, h("button.ib", act("back", { "data-tip": "Back", "aria-label": "Back" }), ic("chevl")), h("h3", null, "This site"), h("span.xs.mut", null, S.page ? S.page.host : "")),
    h("div.shb", null,
      h("div.lbl.first", null, "When you send a message"),
      o("attach", "Attach the page", "Title, address, page text and a screenshot. You can remove any of it before sending."),
      o("ask", "Ask me each time", "The page chip starts off. One click adds it."),
      o("never", "Never send this site", "Vyre reads nothing here. No chip, no record match, no watch."),
      h("div.lbl", null, "Screenshots"),
      h("div.note", null, ic("shield", "s"), h("div", null, "Password and card fields are blacked out on your computer before a screenshot leaves Chrome.")),
      h("div.lbl", null, "Records"),
      h("button.trow", act("recSwitch", { role: "switch", "aria-checked": String(Boolean(p && p.records)) }), h("div.grow", null, h("div.b5", null, "Show matching records"),
        h("div.xs.mut", null, rec && rec.why ? `${rec.name} matched ${rec.why}.` : "Vyre looks up records from the address and the contact details on the page.")), h(`span.tg${p && p.records ? ".on" : ""}`)),
      h("div.lbl", null, "Incognito"),
      h("div.note", null, ic("incog", "s"), h("div", null, "Vyre is off in incognito windows. Nothing is read, captured or sent."))));
}

function offView() {
  /** @param {Node} big @param {string} t @param {string} d @param {Node | null} [x] */
  const e = (big, t, d, x = null) => [h("div.empty", null, h("div.big", null, big), h("div.t", null, t), d, x ? h("div.after", null, x) : null)];
  if (S.off === "incognito") return e(ic("incog"), "Vyre is off in incognito", "Nothing in this window is read, captured or sent. Vault fill still works from the field badge.");
  if (S.status === "no_host") return e(mark(26), "This browser can't find the Vyre app", "Vyre is not set up for this browser yet. Open the Vyre app, then press Try again. If the app is not installed, install it first.", h("button.btn", act("retry"), "Try again"));
  if (S.status === "needs_reload") return e(mark(26), "Vyre needs updating: reload the extension", "The Vyre app is newer than this extension. Open your browser's extensions page and press reload on Vyre.", h("button.btn", act("retry"), "Try again"));
  if (S.status === "needs_app_update") return e(mark(26), "Update the Vyre app", "This extension is newer than the Vyre app on this computer. Update the Vyre app, then press Try again.", h("button.btn", act("retry"), "Try again"));
  if (S.status === "signed_out") return e(mark(26), "Sign in to Vyre on this computer", "Vyre for Chrome works as you, in the Space you pick here. Sign in to the Vyre app and this panel connects.", h("button.btn", act("retry"), "Try again"));
  if (S.status === "offline") return e(mark(26), "The Vyre app is not running", "Open the Vyre app and this panel connects.", h("button.btn", act("retry"), "Try again"));
  if (S.locked) return e(ic("lock"), "Your Space is locked", "Unlock it in the Vyre app.");
  return null;
}

function render() {
  const conv = document.querySelector("#conv");
  const atEnd = !conv || conv.scrollTop + conv.clientHeight >= conv.scrollHeight - 30;
  const focused = document.activeElement ? document.activeElement.id : "";
  const el = /** @type {HTMLTextAreaElement | null} */ (focused === "q" || focused === "hq" || focused === "recname" ? document.activeElement : null);
  const caret = el ? [el.selectionStart, el.selectionEnd] : null;
  top();
  const off = offView();
  const sheet = S.view === "show" ? showSheet({ name: S.recName, host: S.page ? S.page.host ?? "" : "", error: S.recError, busy: S.recBusy })
    : S.view === "watch" ? watchSheet({ page: S.page, w: S.w, agents: S.agents, dir: S.dir, goals: S.goals })
    : S.view === "watching" ? watchingSheet({ list: S.wList, open: S.wOpen, error: S.wError, agents: S.agents }) : null;
  mount($("#main"), off ?? (S.view === "history" ? historyView() : S.view === "site" ? [...chatView(), siteView()] : sheet ? [...chatView(), sheet] : chatView()));
  const c2 = document.querySelector("#conv");
  if (c2 && atEnd) c2.scrollTop = c2.scrollHeight;
  const q = /** @type {HTMLTextAreaElement | null} */ (document.querySelector("#q"));
  if (q) autosize(q);
  if (focused && caret) { const f = /** @type {HTMLTextAreaElement | null} */ (document.getElementById(focused)); if (f) { f.focus(); f.setSelectionRange(caret[0] ?? 0, caret[1] ?? 0); } }
  document.body.dataset["view"] = S.off ? "off" : S.view;
}

/** @param {HTMLTextAreaElement} t */
function autosize(t) { t.style.height = "auto"; t.style.height = `${Math.min(200, Math.max(40, t.scrollHeight))}px`; }

/** @param {string} url */
function faviconOf(url) {
  const u = new URL(chrome.runtime.getURL("/_favicon/"));
  u.searchParams.set("pageUrl", url || "");
  u.searchParams.set("size", "32");
  return u.toString();
}

// ---------- menus and tooltips

/** @typedef {{ head?: string, icon?: string, face?: any, label?: string, trail?: string, check?: boolean, disabled?: boolean, why?: string, run?: () => void } | "-"} Item */
let menuItems = /** @type {Item[]} */ ([]);
/** @param {HTMLElement} anchor @param {Item[]} items @param {"l" | "r"} [align] */
function menu(anchor, items, align = "l") {
  const m = $("#menu");
  menuItems = items;
  mount(m, items.map((it, i) => it === "-" ? h("div.msep") : it.head ? h("div.mhead", null, it.head)
    : h("button.mi", { role: "menuitem", data: { i }, "aria-disabled": it.disabled ? "true" : null, "data-tip": it.why || null },
      it.face ? face(it.face, 18) : it.icon ? ic(it.icon, "s") : null, h("span.ell", null, it.label ?? ""), it.trail ? h("span.tr", null, it.trail) : null, it.check ? h("span.ck", null, ic("check", "s")) : null)));
  m.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth, hh = m.offsetHeight;
  let x = align === "r" ? r.right - w : r.left;
  let y = r.bottom + 4;
  if (y + hh > innerHeight - 8) y = Math.max(8, r.top - hh - 4);
  x = Math.max(8, Math.min(innerWidth - w - 8, x));
  m.style.left = `${x}px`;
  m.style.top = `${y}px`;
  const first = /** @type {HTMLElement | null} */ (m.querySelector(".mi:not([aria-disabled=true])"));
  if (first) first.focus();
}
const closeMenu = () => { $("#menu").hidden = true; };

// ---------- loading

async function loadState() {
  try {
    const st = /** @type {any} */ (await ask("panel.state"));
    if (!st) return;
    S.off = st.off ?? null;
    if (S.off) { render(); return; }
    S.status = st.status; S.locked = st.locked;
    S.spaces = st.spaces; S.active = st.active;
    S.agents = st.agents;
    const keep = st.pick && S.agents.some((/** @type {any} */ a) => a.id === st.pick.agent);
    S.agent = keep ? st.pick.agent : st.suggested ? st.suggested.id : S.agents[0] ? S.agents[0].id : "";
    S.model = keep ? st.pick.model : "";
    const changedPage = !S.page || !st.page || S.page.tabId !== st.page.tabId || S.page.url !== st.page.url;
    S.page = st.page;
    if (changedPage) { S.pageRemoved = null; S.shotOn = true; S.selRemoved = false; S.selection = ""; S.shot = null; S.records = []; S.recOpen = false; }
    if (st.view === "chat" || st.view === "history" || st.view === "site") S.view = st.view;
    else if (SHEETS.includes(st.view)) enterView(st.view);
    render();
    if (S.status === "online" && !S.locked) { void loadPage(); void loadRecords(); if (!S.models) void loadModels(); }
  } catch {
    S.status = "offline";
    render();
  }
}

async function loadPage() {
  if (!S.page || !S.page.privacy || !S.page.privacy.read) { render(); return; }
  try {
    const p = /** @type {any} */ (await ask("panel.page", { shot: true }));
    if (!p || !S.page || p.tabId !== S.page.tabId) return;
    S.page = { ...S.page, title: p.title, privacy: p.privacy };
    S.shot = p.shot ? p.shot.dataUrl : null;
    if (p.selection && !S.selRemoved) S.selection = p.selection;
    render();
  } catch { /* the chip shows without a picture */ }
}

async function loadRecords() {
  try { const r = /** @type {any} */ (await ask("panel.records")); S.records = r ? r.records : []; } catch { S.records = []; }
  render();
}

async function loadModels() {
  try {
    const r = /** @type {any} */ (await ask("panel.models", S.threadId ? { threadId: S.threadId } : {}));
    S.models = r ? r.models : [];
    S.modelsError = "";
  } catch (e) {
    S.models = null;
    S.modelsError = e instanceof Error ? e.message : "";
  }
  render();
}

// ---------- actions

async function send(text = "") {
  const t = (text || S.draft).trim();
  if (!t || S.sending) return;
  const c = chips({ privacy: S.page ? S.page.privacy : null, pageRemoved: S.pageRemoved, selection: S.selection, selectionRemoved: S.selRemoved });
  const a = agentOf(S.agent);
  if (!a) return;
  S.sending = true;
  S.error = "";
  const mine = /** @type {Msg} */ ({ id: `m${Date.now()}`, who: "me", text: t, at: Date.now(), att: c.page || c.selected ? { title: c.page && S.page ? S.page.title : "", shot: c.page && S.shotOn ? S.shot : null, selection: c.selected ? S.selection : "" } : null });
  S.conv = [...S.conv, mine];
  S.draft = "";
  render();
  try {
    const r = /** @type {any} */ (await ask("panel.send", { text: t, agentId: a.id, model: S.model, threadId: S.threadId, page: c.page, shot: c.page && S.shotOn, selection: c.selected ? S.selection : "" }));
    if (r && r.threadId) S.threadId = r.threadId;
    if (r && r.turnId && !S.conv.some((m) => m.turnId === r.turnId)) S.conv = withFace(applyDelta(S.conv, { turnId: r.turnId, text: "", done: false, error: null }, a.name, Date.now()), r.turnId, a);
    S.selection = ""; S.selRemoved = false; // a selection goes once; the page chip stays for the next message
  } catch (e) {
    S.conv = S.conv.filter((m) => m !== mine);
    S.draft = t;
    S.error = e instanceof Error ? e.message : "Not sent. Try again.";
  } finally {
    S.sending = false;
    render();
  }
}

/** @param {Msg[]} conv @param {string} turnId @param {any} a */
const withFace = (conv, turnId, a) => conv.map((m) => (m.turnId === turnId && a ? { ...m, avatar: a.avatar ?? null, assistant: Boolean(a.assistant) } : m));

async function openThread(/** @type {string} */ id) {
  try {
    const t = /** @type {any} */ (await ask("panel.thread", { threadId: id }));
    if (!t) return;
    S.threadId = String(t.threadId || id);
    S.conv = (Array.isArray(t.messages) ? t.messages : []).map((/** @type {any} */ m) => ({
      id: String(m.id), who: m.author && m.author.me ? "me" : String((m.author && m.author.name) || "Vyre"), kind: m.author ? m.author.kind : "agent",
      avatar: m.author ? m.author.avatar ?? null : null, face: m.author ? m.author.face ?? null : null, assistant: Boolean(m.author && m.author.assistant), text: String(m.text ?? ""), at: Date.parse(m.at) || Date.now(),
      artifacts: Array.isArray(m.artifacts) ? m.artifacts.map((/** @type {any} */ a) => ({ id: String(a.id), title: String(a.title || "Artifact") })) : [],
    }));
    if (t.agentId && S.agents.some((a) => a.id === t.agentId)) S.agent = t.agentId;
    S.view = "chat";
    S.pageRemoved = true; S.selRemoved = true;
    render();
  } catch (e) { S.error = e instanceof Error ? e.message : ""; render(); }
}

let searchTimer = 0;
async function search() {
  S.searching = true;
  render();
  try { const r = /** @type {any} */ (await ask("panel.search", { q: S.hq })); S.threads = r ? r.threads : []; } catch { S.threads = []; }
  S.searching = false;
  render();
}

/** @param {string} agent @param {string} model */
function pick(agent, model) {
  S.agent = agent; S.model = model;
  void ask("panel.pick", { agent, model }).catch(() => {});
  render();
}

/** @param {{ mode?: string, records?: boolean }} change */
async function setSite(change) {
  try {
    await ask("panel.site", change);
    if (change.mode === "never") { S.selection = ""; S.records = []; S.shot = null; }
    await loadState();
  } catch (e) { S.error = e instanceof Error ? e.message : ""; render(); }
}

/** Show one of the sheets, with what it needs ready. @param {string} view */
function enterView(view) {
  S.view = view;
  S.recError = ""; S.wError = "";
  if (view === "show") S.recName = S.recName || "";
  if (view === "watch") {
    S.w = { tellOpen: false, tellPeople: [], tellThreads: [], goalOn: false, goalId: null, what: "region", region: null, every: 30, agentId: S.agent || (S.agents[0] ? S.agents[0].id : ""), run: null, picking: false, saving: false, error: "", note: "" };
    void loadPickers();
  }
  if (view === "watching") void loadWatching();
}

/** The people, channels and goals the person may pick on the Watch sheet, as the app shows them to this person. */
async function loadPickers() {
  try { S.dir = await ask("panel.watch.dir"); } catch { S.dir = { people: [], channels: [], me: "" }; }
  try { const g = /** @type {any} */ (await ask("panel.watch.goals")); S.goals = g ? g.goals : []; } catch { S.goals = []; }
  if (S.view === "watch") render();
}

async function loadWatching() {
  try { const r = /** @type {any} */ (await ask("panel.watch.list")); S.wList = r ? r.watches : []; S.wError = ""; } catch (e) { S.wList = S.wList || []; S.wError = e instanceof Error ? e.message : ""; }
  render();
}

let recTimer = 0;
/** While a recording runs, keep its count fresh (the page script changes it). */
function pollRec() {
  clearInterval(recTimer);
  recTimer = /** @type {any} */ (setInterval(async () => {
    try {
      const r = /** @type {any} */ (await ask("panel.rec.state"));
      const was = S.rec.running;
      S.rec = r && r.running ? r : { running: false };
      if (was !== S.rec.running || S.rec.running) render();
      if (!S.rec.running) clearInterval(recTimer);
    } catch { /* away */ }
  }, 1500));
}

const A = /** @type {Record<string, (el: HTMLElement) => void | Promise<void>>} */ ({
  space: (el) => menu(el, [{ head: "Spaces" }, ...S.spaces.map((s) => ({ label: s.name, check: s.id === S.active, run: async () => { if (s.id === S.active) return; await ask("panel.space", { id: s.id }).catch(() => {}); S.conv = []; S.threadId = null; S.models = null; await loadState(); } })), "-", { icon: "open", label: "Open Vyre", run: () => void ask("panel.open", { place: "chats" }).catch(() => {}) }]),
  history: () => { if (S.view === "history") { S.view = "chat"; render(); return; } S.view = "history"; render(); $("#hq")?.focus(); void search(); },
  new: () => { S.conv = []; S.threadId = null; S.view = "chat"; S.pageRemoved = null; S.shotOn = true; S.selRemoved = false; S.error = ""; render(); $("#q")?.focus(); void loadModels(); },
  more: (el) => {
    const p = S.page && S.page.privacy;
    const can = Boolean(p && p.read);
    menu(el, [
      { icon: "note", label: "Save page to Notes", disabled: !can, run: async () => { await ask("panel.clip").catch((e) => { S.error = e.message; render(); }); } },
      { icon: "eye", label: "Watch this page", disabled: !can, run: () => { enterView("watch"); render(); } },
      { icon: "list", label: "Watching", run: () => { enterView("watching"); render(); } },
      { icon: "rec", label: "Show Vyre how", disabled: !can || S.rec.running, run: () => { enterView("show"); render(); } },
      "-",
      { icon: "gear", label: "This site...", disabled: !S.page || !S.page.host, run: () => { S.view = "site"; render(); } },
      p && !p.read && p.why === "never" ? { icon: "eye", label: "Send this site again", run: () => void setSite({ mode: "attach" }) } : { icon: "eyeoff", label: "Never send this site", disabled: !can, run: () => void setSite({ mode: "never" }) },
    ], "r");
  },
  openVyre: () => void ask("panel.open", { place: "chats", id: S.threadId }).catch(() => {}),
  close: () => g.close(),
  retry: () => void loadState(),
  rec: () => { S.recOpen = !S.recOpen; render(); },
  openThread: (el) => void openThread(String(el.dataset["id"])),
  openArtifact: (el) => void ask("panel.openArtifact", { id: el.dataset["id"] }).catch(() => {}),
  openGoal: (el) => void ask("panel.open", { place: "goal", id: el.dataset["id"] }).catch(() => {}),
  openRecord: (el) => void ask("panel.open", { place: "record", id: el.dataset["id"] }).catch(() => {}),
  sugg: (el) => void send(String(el.dataset["t"])),
  shot: () => { S.shotOn = !S.shotOn; render(); if (S.shotOn && !S.shot) void loadPage(); },
  chipX: () => { S.pageRemoved = true; render(); },
  attach: () => { S.pageRemoved = false; S.shotOn = true; render(); if (!S.shot) void loadPage(); },
  selX: () => { S.selRemoved = true; render(); },
  send: () => void send(),
  copy: async (el) => { const m = S.conv.find((x) => x.id === el.dataset["id"]); if (m) await navigator.clipboard.writeText(m.text).catch(() => {}); },
  sheetX: () => { S.view = "chat"; S.w.picking = false; render(); },
  recStart: async () => {
    S.recBusy = true; S.recError = ""; render();
    try {
      await ask("panel.rec.start", { name: S.recName.trim() });
      S.rec = { running: true, paused: false, count: 1 }; S.view = "chat"; S.recName = "";
      pollRec();
    } catch (e) { S.recError = e instanceof Error ? e.message : "Recording did not start."; }
    S.recBusy = false; render();
  },
  recPause: async () => { try { const r = /** @type {any} */ (await ask("panel.rec.control", { op: S.rec.paused ? "resume" : "pause" })); S.rec = { ...S.rec, ...r }; } catch { /* ignored */ } render(); },
  recStop: async () => { try { await ask("panel.rec.control", { op: "stop" }); } catch { /* ignored */ } S.rec = { running: false }; render(); },
  wWhat: (el) => { S.w.what = el.dataset["k"] === "page" ? "page" : "region"; render(); },
  pickStart: async () => { S.w.picking = true; S.w.error = ""; render(); try { await ask("panel.watch.pick"); } catch (e) { S.w.picking = false; S.w.error = e instanceof Error ? e.message : "Could not pick."; render(); } },
  wFreq: (el) => menu(el, FREQS.map((f) => ({ label: f.label, check: f.min === S.w.every, run: () => { S.w.every = f.min; render(); } }))),
  wWho: (el) => menu(el, [{ head: "Who checks it" }, ...S.agents.map((a) => ({ face: { name: a.name, avatar: a.avatar ?? null, assistant: Boolean(a.assistant) }, label: a.name, trail: a.computer ? "Has a computer" : "", check: a.id === S.w.agentId, run: () => { S.w.agentId = a.id; S.w.run = null; render(); } }))]),
  wRun: (el) => { const k = el.dataset["k"] === "computer" ? "computer" : "chrome"; const a = S.agents.find((x) => x.id === S.w.agentId); if (k === "computer" && !(a && a.computer)) return; S.w.run = k; render(); },
  wStart: async () => {
    const a = S.agents.find((x) => x.id === S.w.agentId) || S.agents[0];
    if (!a || S.w.saving || (S.w.what === "region" && !S.w.region)) return;
    S.w.saving = true; S.w.error = ""; render();
    try {
      await ask("panel.watch.save", { watch: { mode: S.w.what, ...(S.w.what === "region" ? { region: { label: S.w.region?.label, selector: S.w.region?.selector } } : {}), everyMinutes: S.w.every, agentId: a.id, runsOn: runsOnFor(Boolean(a.computer), S.w.run), tell: S.w.tellPeople, tellThreads: S.w.tellThreads, ...(S.w.goalOn && S.w.goalId ? { goalId: S.w.goalId } : {}) } });
      S.w.saving = false; S.w.region = null; S.w.run = null; enterView("watching"); render();
    } catch (e) { S.w.saving = false; S.w.error = e instanceof Error ? e.message : "Could not start watching."; render(); }
  },
  wTell: () => { S.w.tellOpen = !S.w.tellOpen; render(); },
  wTellPerson: (el) => { const id = String(el.dataset["k"]); S.w.tellPeople = S.w.tellPeople.includes(id) ? S.w.tellPeople.filter((x) => x !== id) : [...S.w.tellPeople, id]; render(); },
  wTellThread: (el) => { const id = String(el.dataset["k"]); S.w.tellThreads = S.w.tellThreads.includes(id) ? S.w.tellThreads.filter((x) => x !== id) : [...S.w.tellThreads, id]; render(); },
  wGoal: () => { S.w.goalOn = !S.w.goalOn; if (!S.w.goalOn) S.w.goalId = null; else if (S.goals && S.goals.length === 1) S.w.goalId = S.goals[0].id; render(); },
  wGoalPick: (el) => { S.w.goalId = String(el.dataset["k"]); render(); },
  wNew: () => { enterView("watch"); render(); },
  wRow: (el) => { S.wOpen = S.wOpen === el.dataset["id"] ? null : String(el.dataset["id"]); render(); },
  wPause: async (el) => { try { await ask("panel.watch.change", { watchId: el.dataset["id"], op: el.dataset["on"] ? "pause" : "resume" }); } catch (e) { S.wError = e instanceof Error ? e.message : ""; } await loadWatching(); },
  wMore: (el) => {
    const id = String(el.dataset["id"]);
    menu(el, [
      { icon: "refresh", label: "Check now", run: async () => { try { await ask("panel.watch.check", { watchId: id }); } catch (e) { S.wError = e instanceof Error ? e.message : ""; } await loadWatching(); } },
      { icon: "open", label: "Open in Vyre", run: () => void ask("panel.open", { place: "watching", id }).catch(() => {}) },
      "-",
      { icon: "trash", label: "Delete watch", run: async () => { try { await ask("panel.watch.change", { watchId: id, op: "remove" }); } catch (e) { S.wError = e instanceof Error ? e.message : ""; } await loadWatching(); } },
    ], "r");
  },
  site: () => { S.view = "site"; render(); },
  back: () => { S.view = "chat"; render(); },
  siteOpt: (el) => void setSite({ mode: String(el.dataset["k"]) }),
  recSwitch: () => void setSite({ records: !(S.page && S.page.privacy && S.page.privacy.records) }),
  agent: (el) => menu(el, [{ head: "Who answers" }, ...S.agents.map((a) => ({ face: { name: a.name, avatar: a.avatar ?? null, assistant: Boolean(a.assistant) }, label: a.name, trail: a.role ?? "", check: a.id === S.agent, run: () => pick(a.id, "") }))]),
  model: (el) => {
    if (!S.models) { menu(el, [{ head: "Model" }, { label: S.modelsError || "Loading models", disabled: true }]); void loadModels(); return; }
    const a = agentOf(S.agent);
    const def = S.models.find((m) => m.isDefault);
    /** @type {Item[]} */
    const items = [];
    for (const gr of modelGroups(S.models)) {
      items.push({ head: gr.title });
      for (const m of gr.models) items.push({ label: m.title, check: S.model === m.id, disabled: !m.allowed, why: m.allowed ? "" : (/** @type {Record<string,string>} */ (WHY_NOT))[m.reason] ?? "Not available", run: () => pick(S.agent, m.id) });
    }
    items.push("-", { label: `${a ? a.name : "The agent"}'s default${def ? ` (${def.title})` : ""}`, check: !S.model, run: () => pick(S.agent, "") });
    menu(el, items);
  },
});

// ---------- events

document.addEventListener("click", (e) => {
  const t = /** @type {HTMLElement} */ (e.target);
  const mi = /** @type {HTMLElement | null} */ (t.closest("#menu .mi"));
  if (mi) {
    const it = menuItems[Number(mi.dataset["i"])];
    if (it && it !== "-" && !it.disabled && it.run) { closeMenu(); void it.run(); }
    return;
  }
  if (!t.closest("#menu")) closeMenu();
  const el = /** @type {HTMLElement | null} */ (t.closest("[data-a]"));
  if (!el || /** @type {any} */ (el).disabled) return;
  const f = A[String(el.dataset["a"])];
  if (f) void f(el);
});
document.addEventListener("input", (e) => {
  const t = /** @type {HTMLInputElement} */ (e.target);
  if (t.id === "q") { S.draft = t.value; autosize(/** @type {any} */ (t)); }
  if (t.id === "recname") S.recName = t.value;
  if (t.id === "hq") { S.hq = t.value; clearTimeout(searchTimer); searchTimer = /** @type {any} */ (setTimeout(() => void search(), 200)); }
});
document.addEventListener("keydown", (e) => {
  const t = /** @type {HTMLElement} */ (e.target);
  if (!$("#menu").hidden) {
    const items = /** @type {HTMLElement[]} */ ([...document.querySelectorAll("#menu .mi:not([aria-disabled=true])")]);
    const at = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    if (e.key === "Escape") { closeMenu(); e.preventDefault(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
    return;
  }
  if (t.id === "q" && e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); void send(); return; }
  if (e.key === "Escape" && S.view !== "chat") { S.view = "chat"; render(); }
});
document.addEventListener("mouseover", (e) => {
  const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest("[data-tip]"));
  const tip = $("#tip");
  if (!el || !el.dataset["tip"]) { tip.hidden = true; return; }
  tip.textContent = el.dataset["tip"] ?? "";
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  tip.style.left = `${Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2))}px`;
  tip.style.top = `${r.bottom + 6 + tip.offsetHeight > innerHeight ? r.top - tip.offsetHeight - 6 : r.bottom + 6}px`;
});

// ---------- the port: reply deltas, the Selected chip, tab switches

let refreshTimer = 0;
async function boot() {
  const w = params.get("window");
  S.windowId = w && /^\d+$/.test(w) ? Number(w) : (await chrome.windows.getCurrent()).id;
  const port = chrome.runtime.connect({ name: "vyre.panel" });
  port.postMessage({ type: "hello", windowId: S.windowId });
  port.onMessage.addListener((/** @type {any} */ m) => {
    if (m.type === "delta") {
      if (S.threadId !== null && m.threadId !== S.threadId) return;
      const a = agentOf(S.agent);
      S.threadId = m.threadId;
      S.conv = withFace(applyDelta(S.conv, m, a ? a.name : "Vyre", Date.now()), m.turnId, a);
      render();
    } else if (m.type === "selection") {
      if (S.page && m.tabId === S.page.tabId) { S.selection = m.text; S.selRemoved = false; render(); }
    } else if (m.type === "ask") {
      if (S.page && m.tabId === S.page.tabId) { S.selection = m.text; S.selRemoved = false; S.view = "chat"; render(); $("#q")?.focus(); }
    } else if (m.type === "view") {
      if (["chat", "history", "site"].includes(m.view)) { S.view = m.view; render(); }
      else if (SHEETS.includes(m.view)) { enterView(m.view); render(); }
    } else if (m.type === "picked") {
      S.w.picking = false;
      if (m.region && m.region.selector) { S.w.region = m.region; S.w.error = ""; }
      render();
    } else if (m.type === "tab" || m.type === "site" || m.type === "spaces") {
      clearTimeout(refreshTimer);
      refreshTimer = /** @type {any} */ (setTimeout(() => void loadState(), m.type === "tab" ? 250 : 0));
    }
  });
  port.onDisconnect.addListener(() => { S.status = "offline"; render(); setTimeout(() => location.reload(), 1000); });
  render();
  await loadState();
  try { const r = /** @type {any} */ (await ask("panel.rec.state")); if (r && r.running) { S.rec = r; pollRec(); render(); } } catch { /* the app is away */ }
  if (S.view === "chat") $("#q")?.focus();
}

void boot();
