// @ts-check
// The Vyre side panel (approved 3 Nov): one top bar (Space tile and switcher; Search chats, New chat, More, Open in Vyre, Close), a quiet record line, two suggestions on an
// empty chat, and a composer with the page chip (title and a screenshot thumbnail toggle), a separate Selected chip, and the agent and live model pickers.
// It talks only to the extension's worker (chrome.runtime messages "panel.*" and the "vyre.panel" port). The conversation is the same thread as Vyre Chats.

import { applyCss, esc, face, ic, mark, spaceTile } from "../ui/icons.js";
import { ago, applyDelta, chips, groupThreads, modelGroups, modelLabel, suggestions, WHY_NOT } from "./model.js";

const g = /** @type {any} */ (globalThis);
const chrome = g.chrome;
const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (document.querySelector(s));
const params = new URLSearchParams(location.search);

/** @typedef {{ id: string, who: string, kind?: string, avatar?: string | null, assistant?: boolean, text: string, at: number, turnId?: string, streaming?: boolean, error?: string | null, att?: { title: string, shot: string | null, selection: string } | null }} Msg */
const S = {
  windowId: /** @type {number | null} */ (null),
  status: "connecting", off: /** @type {string | null} */ (null), locked: false,
  spaces: /** @type {{ id: string, name: string }[]} */ ([]), active: /** @type {string | null} */ (null),
  agents: /** @type {{ id: string, name: string, avatar?: string, assistant?: boolean }[]} */ ([]),
  agent: "", model: "",
  models: /** @type {any[] | null} */ (null), modelsError: "",
  page: /** @type {any} */ (null), shot: /** @type {string | null} */ (null), selection: "",
  pageRemoved: /** @type {boolean | null} */ (null), shotOn: true, selRemoved: false,
  records: /** @type {any[]} */ ([]), recOpen: false,
  conv: /** @type {Msg[]} */ ([]), threadId: /** @type {string | null} */ (null), sending: false,
  view: "chat", hq: "", threads: /** @type {any[]} */ ([]), searching: false,
  draft: "", error: "",
};

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

// ---------- render

function top() {
  const sp = spaceOf();
  const v = S.view;
  $("#top").innerHTML = `<button class="spsw" data-a="space" data-tip="${esc(sp ? sp.name : "Spaces")}" aria-label="Switch Space">${spaceTile(sp ? sp.name : "V")}<span class="mut" data-css="display:grid">${ic("chev", "xs")}</span></button><span class="grow"></span>
    <button class="ib sm ${v === "history" ? "on" : ""}" data-a="history" data-tip="Search chats" aria-label="Search chats">${ic("search", "s")}</button>
    <button class="ib sm" data-a="new" data-tip="New chat" aria-label="New chat">${ic("edit", "s")}</button>
    <button class="ib sm ${v === "watching" || v === "site" ? "on" : ""}" data-a="more" data-tip="More" aria-label="More">${ic("more", "s")}</button>
    <button class="ib sm" data-a="openVyre" data-tip="Open in Vyre" aria-label="Open in Vyre">${ic("open", "s")}</button>
    <button class="ib sm" data-a="close" data-tip="Close" aria-label="Close">${ic("x", "s")}</button>`;
}

/** @param {Msg} m */
function msgHtml(m) {
  const who = m.who === "me" ? { name: "You", kind: "person" } : { name: m.who, kind: m.kind ?? "agent", avatar: m.avatar ?? null, assistant: Boolean(m.assistant) };
  const att = m.att ? `<div class="att">${m.att.shot ? `<img alt="" src="${esc(m.att.shot)}">` : ic("globe", "xs")}<span class="ell">${m.att.title ? esc(m.att.title) : ""}${m.att.selection ? `${m.att.title ? " · " : ""}Selected text` : ""}</span></div>` : "";
  const t = new Date(m.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `<div class="msg ${m.who === "me" ? "me" : ""}" data-turn="${esc(m.turnId ?? "")}">${face(who, 24)}<div class="grow"><div class="who">${esc(who.name)}<span>${esc(t)}</span></div>
    <div class="txt ${m.error ? "err" : ""}">${esc(m.error ? m.error : m.text)}${m.streaming ? '<span class="caret"></span>' : ""}</div>${att}
    ${m.who !== "me" && !m.streaming && !m.error ? `<div class="mline"><button class="btn q" data-a="openVyre">${ic("open", "s")} Open in Vyre</button><button class="ib sm" data-a="copy" data-id="${esc(m.id)}" data-tip="Copy" aria-label="Copy">${ic("copy", "s")}</button></div>` : ""}</div></div>`;
}

function chatView() {
  const c = chips({ privacy: S.page ? S.page.privacy : null, pageRemoved: S.pageRemoved, selection: S.selection, selectionRemoved: S.selRemoved });
  const a = agentOf(S.agent);
  const rec = S.records[0] && !c.never ? S.records[0] : null;
  const recl = rec ? `<button class="recl ${S.recOpen ? "open" : ""}" data-a="rec" data-tip="Matches a record in Vyre${rec.why ? `: ${esc(rec.why)}` : ""}">${ic(/contact|person|lead/i.test(rec.kind) ? "user" : /event|meeting/i.test(rec.kind) ? "calendar" : "record", "s")}<span class="ell"><span data-css="color:var(--ink)">${esc(rec.name)}</span> · ${esc(rec.kind)}</span><span class="rv">${ic("chev", "xs")}</span></button>
    ${S.recOpen ? `<div class="recx">${(rec.chats ?? []).slice(0, 3).map((/** @type {any} */ ch) => `<button class="rrow" data-a="openThread" data-id="${esc(ch.threadId)}">${face({ name: ch.agentName || ch.who || "?", kind: ch.kind ?? "agent", avatar: ch.avatar ?? null }, 18)}<span class="grow ell">${esc(ch.title)}</span><span class="xs mut">${esc(ago(ch.at, Date.now()))}</span></button>`).join("")}
      ${(rec.goals ?? []).slice(0, 2).map((/** @type {any} */ gl) => `<button class="rrow" data-a="openGoal" data-id="${esc(gl.goalId)}">${ic("goal", "s")}<span class="grow ell">${esc(gl.title)}</span>${typeof gl.progress === "number" ? `<span class="prog" data-css="width:40px"><i data-css="width:${Math.round(Math.max(0, Math.min(1, gl.progress)) * 100)}%"></i></span>` : ""}${gl.label ? `<span class="xs mut">${esc(gl.label)}</span>` : ""}</button>`).join("")}
      <button class="rrow" data-a="openRecord" data-id="${esc(rec.id)}">${ic("open", "s")}<span class="grow ell">Open ${esc(rec.name)} in Vyre</span></button></div>` : ""}` : "";
  const empty = S.conv.length === 0;
  const conv = `<div class="pconv" id="conv">${S.conv.map(msgHtml).join("")}</div>`;
  const sugg = empty && !c.never ? `<div class="quiet">${suggestions({ host: S.page ? S.page.host ?? "" : "", title: S.page ? S.page.title : "", record: rec }).map((t) => `<button data-a="sugg" data-t="${esc(t)}">${ic("spark", "xs")}<span class="ell">${esc(t)}</span></button>`).join("")}</div>` : "";
  const list = [];
  if (c.page && S.page) {
    list.push(`<span class="ch pg"><span class="fav"><img alt="" src="${esc(faviconOf(S.page.url))}"></span><span class="t" data-tip="${esc(S.page.host)}">${esc(S.page.title || S.page.host)}</span>
      <button class="shot ${S.shotOn ? "" : "off"}" data-a="shot" data-tip="${S.shotOn ? "Screenshot included. Click to leave it out." : "No screenshot. Click to include one."}" aria-pressed="${S.shotOn}" aria-label="Screenshot">${S.shotOn && S.shot ? `<img alt="" src="${esc(S.shot)}">` : ic("camera", "xs")}</button>
      <button class="cx" data-a="chipX" data-tip="Don't send this page" aria-label="Don't send this page">${ic("x", "xs")}</button></span>`);
  }
  if (c.selected) list.push(`<span class="ch selq"><span class="sl">Selected</span><span class="t" data-tip="${esc(S.selection.slice(0, 300))}">${esc(S.selection)}</span><button class="cx" data-a="selX" data-tip="Don't send the selection" aria-label="Don't send the selection">${ic("x", "xs")}</button></span>`);
  const comp = `<div class="comp2">${list.length ? `<div class="chips" id="chips">${list.join("")}</div>` : ""}<textarea id="q" rows="2" placeholder="Ask ${esc(a ? a.name : "Vyre")}" aria-label="Message">${esc(S.draft)}</textarea>
    <div class="cbar2"><button class="mp" data-a="agent" data-tip="Who answers">${a ? face({ name: a.name, avatar: a.avatar ?? null, assistant: Boolean(a.assistant) }, 18) : ""}<span class="ell">${esc(a ? a.name : "No agent")}</span>${ic("chev", "xs")}</button>
    <button class="mp" data-a="model" data-tip="Model"><span class="ell">${esc(S.models ? modelLabel(S.models, S.model) : S.model ? S.model.split("/").pop() : "Default model")}</span>${ic("chev", "xs")}</button>
    ${c.never ? `<button class="ib sm" data-a="site" data-tip="This site is never sent" aria-label="This site is never sent">${ic("eyeoff", "s")}</button>` : c.canAttach ? `<button class="ib sm" data-a="attach" data-tip="Attach this page" aria-label="Attach this page">${ic("clip", "s")}</button>` : ""}
    <span class="grow"></span><button class="send" data-a="send" data-tip="Send" aria-label="Send" ${S.sending || !a ? "disabled" : ""}>${ic("up", "s")}</button></div></div>`;
  const err = S.error ? `<div class="note" data-css="margin:0 10px 4px;color:var(--danger)">${esc(S.error)}</div>` : "";
  return `${recl}${conv}${sugg}${err}${comp}`;
}

function historyView() {
  const host = S.page && S.page.privacy && S.page.privacy.read ? S.page.host : null;
  const gr = groupThreads(S.threads, host);
  const row = (/** @type {any} */ h) => `<button class="hrow" data-a="openThread" data-id="${esc(h.threadId)}">${face({ name: h.agentName || "?", avatar: h.avatar ?? null, assistant: Boolean(h.assistant), kind: h.kind ?? "agent" }, 20)}<div class="grow"><div class="ell">${esc(h.title)}</div><div class="xs mut ell">${esc(h.agentName || "")}${h.host ? ` · ${esc(h.host)}` : ""}</div></div><span class="xs mut">${esc(ago(h.updatedAt, Date.now()))}</span></button>`;
  const body = S.searching && !S.threads.length ? `<div class="qline" data-css="padding:30px 0">Searching</div>`
    : !S.threads.length ? `<div class="qline" data-css="padding:30px 0">${S.hq ? `No chats match "${esc(S.hq)}"` : "No chats yet"}</div>`
    : `${gr.here.length ? `<div class="rlbl">On this page</div>${gr.here.map(row).join("")}` : ""}${gr.earlier.length ? `<div class="rlbl">Earlier</div>${gr.earlier.map(row).join("")}` : ""}`;
  return `<div class="hsearch">${ic("search", "s")}<input id="hq" placeholder="Search chats" value="${esc(S.hq)}" autocomplete="off" aria-label="Search chats"></div><div class="pconv" data-css="gap:0;padding:2px 6px 10px">${body}</div>`;
}

function siteView() {
  const p = S.page && S.page.privacy;
  const mode = p ? (p.read ? p.mode : "never") : "attach";
  const o = (/** @type {string} */ k, /** @type {string} */ t, /** @type {string} */ d) => `<button class="opt ${mode === k ? "on" : ""}" data-a="siteOpt" data-k="${k}" role="radio" aria-checked="${mode === k}"><span class="rd"></span><div><div class="ot">${t}</div><div class="od">${d}</div></div></button>`;
  return `<div class="sheet"><div class="shh"><button class="ib" data-a="back" data-tip="Back" aria-label="Back">${ic("chevl")}</button><h3>This site</h3><span class="xs mut">${esc(S.page ? S.page.host : "")}</span></div><div class="shb">
    <div class="lbl" data-css="margin-top:4px">When you send a message</div>
    ${o("attach", "Attach the page", "Title, address, page text and a screenshot. You can remove any of it before sending.")}
    ${o("ask", "Ask me each time", "The page chip starts off. One click adds it.")}
    ${o("never", "Never send this site", "Vyre reads nothing here. No chip, no record match, no watch.")}
    <div class="lbl">Screenshots</div>
    <div class="note">${ic("shield", "s")}<div>Password and card fields are blacked out on your computer before a screenshot leaves Chrome.</div></div>
    <div class="lbl">Records</div>
    <button class="trow" data-a="recSwitch" role="switch" aria-checked="${Boolean(p && p.records)}"><div class="grow"><div class="b5">Show matching records</div><div class="xs mut">${S.records[0] && S.records[0].why ? esc(`${S.records[0].name} matched ${S.records[0].why}.`) : "Vyre looks up records from the address and the contact details on the page."}</div></div><span class="tg ${p && p.records ? "on" : ""}"></span></button>
    <div class="lbl">Incognito</div>
    <div class="note">${ic("incog", "s")}<div>Vyre is off in incognito windows. Nothing is read, captured or sent.</div></div>
  </div></div>`;
}

function offView() {
  if (S.off === "incognito") return `<div class="empty"><div class="big">${ic("incog")}</div><div class="t">Vyre is off in incognito</div>Nothing in this window is read, captured or sent. Vault fill still works from the field badge.</div>`;
  if (S.status === "no_host") return `<div class="empty"><div class="big">${mark(26)}</div><div class="t">Vyre is not on this computer</div>Install the Vyre app to chat with your agents here.</div>`;
  if (S.status === "offline") return `<div class="empty"><div class="big">${mark(26)}</div><div class="t">The Vyre app is not running</div>Open it and this panel connects.<div data-css="margin-top:16px"><button class="btn" data-a="retry">Try again</button></div></div>`;
  if (S.locked) return `<div class="empty"><div class="big">${ic("lock")}</div><div class="t">Your Space is locked</div>Unlock it in the Vyre app.</div>`;
  return "";
}

function render() {
  const keepScroll = /** @type {HTMLElement | null} */ (document.querySelector("#conv"));
  const atEnd = !keepScroll || keepScroll.scrollTop + keepScroll.clientHeight >= keepScroll.scrollHeight - 30;
  const focused = document.activeElement ? document.activeElement.id : "";
  const caret = focused === "q" || focused === "hq" ? [/** @type {HTMLTextAreaElement} */ (document.activeElement).selectionStart, /** @type {HTMLTextAreaElement} */ (document.activeElement).selectionEnd] : null;
  top();
  const off = offView();
  $("#main").innerHTML = off || (S.view === "history" ? historyView() : S.view === "site" ? `${chatView()}${siteView()}` : chatView());
  applyCss(document.body);
  const conv = /** @type {HTMLElement | null} */ (document.querySelector("#conv"));
  if (conv && atEnd) conv.scrollTop = conv.scrollHeight;
  const q = /** @type {HTMLTextAreaElement | null} */ (document.querySelector("#q"));
  if (q) autosize(q);
  if (focused && caret) { const el = /** @type {HTMLTextAreaElement | null} */ (document.getElementById(focused)); if (el) { el.focus(); el.setSelectionRange(caret[0] ?? 0, caret[1] ?? 0); } }
  document.body.dataset.view = S.off ? "off" : S.view;
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
  m.innerHTML = items.map((it, i) => it === "-" ? '<div class="msep"></div>' : it.head ? `<div class="mhead">${esc(it.head)}</div>`
    : `<button class="mi" role="menuitem" data-i="${i}" ${it.disabled ? 'aria-disabled="true"' : ""} ${it.why ? `data-tip="${esc(it.why)}"` : ""}>${it.face ? face(it.face, 18) : it.icon ? ic(it.icon, "s") : ""}<span class="ell">${esc(it.label ?? "")}</span>${it.trail ? `<span class="tr">${esc(it.trail)}</span>` : ""}${it.check ? `<span class="ck">${ic("check", "s")}</span>` : ""}</button>`).join("");
  applyCss(m);
  m.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth, h = m.offsetHeight;
  let x = align === "r" ? r.right - w : r.left;
  let y = r.bottom + 4;
  if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 4);
  x = Math.max(8, Math.min(innerWidth - w - 8, x));
  m.style.left = `${x}px`;
  m.style.top = `${y}px`;
  const first = /** @type {HTMLElement | null} */ (m.querySelector(".mi:not([aria-disabled=true])"));
  if (first) first.focus();
}
const closeMenu = () => { $("#menu").hidden = true; };

// ---------- actions

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
    render();
    if (S.status === "online" && !S.locked) {
      void loadPage();
      void loadRecords();
      void loadModels();
    }
  } catch (e) {
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
  try {
    const r = /** @type {any} */ (await ask("panel.records"));
    S.records = r ? r.records : [];
    render();
  } catch { S.records = []; }
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
    if (r && r.turnId && !S.conv.some((m) => m.turnId === r.turnId)) S.conv = applyDelta(S.conv, { turnId: r.turnId, text: "", done: false, error: null }, a.name, Date.now()).map((m) => (m.turnId === r.turnId ? { ...m, avatar: a.avatar ?? null, assistant: Boolean(a.assistant) } : m));
    // A selection is sent once; the page chip stays for the next message.
    S.selection = ""; S.selRemoved = false;
  } catch (e) {
    S.conv = S.conv.filter((m) => m !== mine);
    S.draft = t;
    S.error = e instanceof Error ? e.message : "Not sent. Try again.";
  } finally {
    S.sending = false;
    render();
  }
}

async function openThread(/** @type {string} */ id) {
  try {
    const t = /** @type {any} */ (await ask("panel.thread", { threadId: id }));
    if (!t) return;
    S.threadId = String(t.threadId || id);
    S.conv = (Array.isArray(t.messages) ? t.messages : []).map((/** @type {any} */ m) => ({
      id: String(m.id), who: m.author && m.author.kind === "person" && m.author.me ? "me" : String((m.author && m.author.name) || "Vyre"), kind: m.author ? m.author.kind : "agent",
      avatar: m.author ? m.author.avatar ?? null : null, assistant: Boolean(m.author && m.author.assistant), text: String(m.text ?? ""), at: Date.parse(m.at) || Date.now(),
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
  try {
    const r = /** @type {any} */ (await ask("panel.search", { q: S.hq }));
    S.threads = r ? r.threads : [];
  } catch { S.threads = []; }
  S.searching = false;
  render();
}

/** @param {string} agent @param {string} model */
function pick(agent, model) {
  S.agent = agent; S.model = model;
  void ask("panel.pick", { agent, model }).catch(() => {});
  render();
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
      "-",
      { icon: "gear", label: "This site...", disabled: !S.page || !S.page.host, run: () => { S.view = "site"; render(); } },
      p && !p.read && p.why === "never" ? { icon: "eye", label: "Send this site again", run: () => setSite({ mode: "attach" }) } : { icon: "eyeoff", label: "Never send this site", disabled: !can, run: () => setSite({ mode: "never" }) },
    ], "r");
  },
  openVyre: () => void ask("panel.open", { place: "chats", id: S.threadId }).catch(() => {}),
  close: () => g.close(),
  retry: () => void loadState(),
  rec: () => { S.recOpen = !S.recOpen; render(); },
  openThread: (el) => void openThread(String(el.dataset["id"])),
  openGoal: (el) => void ask("panel.open", { place: "goal", id: el.dataset["id"] }).catch(() => {}),
  openRecord: (el) => void ask("panel.open", { place: "record", id: el.dataset["id"] }).catch(() => {}),
  sugg: (el) => void send(String(el.dataset["t"])),
  shot: () => { S.shotOn = !S.shotOn; render(); if (S.shotOn && !S.shot) void loadPage(); },
  chipX: () => { S.pageRemoved = true; render(); },
  attach: () => { S.pageRemoved = false; S.shotOn = true; render(); if (!S.shot) void loadPage(); },
  selX: () => { S.selRemoved = true; render(); },
  send: () => void send(),
  copy: async (el) => { const m = S.conv.find((x) => x.id === el.dataset["id"]); if (m) await navigator.clipboard.writeText(m.text).catch(() => {}); },
  site: () => { S.view = "site"; render(); },
  back: () => { S.view = "chat"; render(); },
  siteOpt: (el) => setSite({ mode: String(el.dataset["k"]) }),
  recSwitch: () => setSite({ records: !(S.page && S.page.privacy && S.page.privacy.records) }),
  agent: (el) => menu(el, [{ head: "Who answers" }, ...S.agents.map((a) => ({ face: { name: a.name, avatar: a.avatar ?? null, assistant: Boolean(a.assistant) }, label: a.name, trail: /** @type {any} */ (a).role ?? "", check: a.id === S.agent, run: () => pick(a.id, "") }))]),
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

/** @param {{ mode?: string, records?: boolean }} change */
async function setSite(change) {
  try {
    await ask("panel.site", change);
    await loadState();
    if (change.mode === "never") { S.selection = ""; S.records = []; S.shot = null; }
    render();
  } catch (e) { S.error = e instanceof Error ? e.message : ""; render(); }
}

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
  if (!el) return;
  const f = A[String(el.dataset["a"])];
  if (f) void f(el);
});
document.addEventListener("input", (e) => {
  const t = /** @type {HTMLInputElement} */ (e.target);
  if (t.id === "q") { S.draft = t.value; autosize(/** @type {any} */ (t)); }
  if (t.id === "hq") { S.hq = t.value; clearTimeout(searchTimer); searchTimer = /** @type {any} */ (setTimeout(() => void search(), 200)); }
});
document.addEventListener("keydown", (e) => {
  const t = /** @type {HTMLElement} */ (e.target);
  if (!$("#menu").hidden) {
    const items = /** @type {HTMLElement[]} */ ([...document.querySelectorAll("#menu .mi:not([aria-disabled=true])")]);
    const at = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    if (e.key === "Escape") { closeMenu(); e.preventDefault(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const n = items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]; n?.focus(); return; }
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
      const a = agentOf(S.agent);
      if (m.threadId !== S.threadId && S.threadId !== null) return;
      S.threadId = m.threadId;
      S.conv = applyDelta(S.conv, m, a ? a.name : "Vyre", Date.now()).map((x) => (x.turnId === m.turnId && a ? { ...x, avatar: a.avatar ?? null, assistant: Boolean(a.assistant) } : x));
      render();
    } else if (m.type === "selection") {
      if (S.page && m.tabId === S.page.tabId) { S.selection = m.text; S.selRemoved = false; render(); }
    } else if (m.type === "ask") {
      if (S.page && m.tabId === S.page.tabId) { S.selection = m.text; S.selRemoved = false; S.view = "chat"; render(); $("#q")?.focus(); }
    } else if (m.type === "view") {
      if (["chat", "history", "site"].includes(m.view)) { S.view = m.view; render(); }
    } else if (m.type === "tab" || m.type === "site" || m.type === "spaces") {
      clearTimeout(refreshTimer);
      refreshTimer = /** @type {any} */ (setTimeout(() => void loadState(), m.type === "tab" ? 250 : 0));
    }
  });
  port.onDisconnect.addListener(() => { S.status = "offline"; render(); setTimeout(() => location.reload(), 1000); });
  render();
  await loadState();
  $("#q")?.focus();
}

void boot();
