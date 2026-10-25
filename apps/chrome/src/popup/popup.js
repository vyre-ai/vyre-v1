// @ts-check
// The popup under the toolbar icon (V1-SPEC 3.12): the Space, the logins for this site by item name, one Ask field, Open Vault.
// Click or Enter fills (the row reads Filled, then the popup closes); right-click or the menu key opens Fill, Fill and Sign In,
// Open in Vault, Never Fill on This Site; `/` jumps to Ask; Escape closes. Everything goes through the service worker.

import { keyAction, move, rowMenu, viewOf } from "./popup-model.js";

const ext = /** @type {any} */ (globalThis).chrome;
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

const skin = new URLSearchParams(location.search).get("skin");
if (skin === "paper" || skin === "graphite") document.documentElement.dataset["skin"] = skin;

/** @type {any} */
let state = null;
let selected = -1;
/** @type {{ id: string, name: string } | null} */
let agent = null;
/** @type {{ id: string, name: string }[]} */
let agents = [];

/** @param {any} msg @returns {Promise<any>} */
function ask(msg) {
  return new Promise((resolve) => {
    try {
      ext.runtime.sendMessage(msg, (/** @type {any} */ r) => resolve(r || { error: { code: "error", message: "Something went wrong. Try again." } }));
    } catch {
      resolve({ error: { code: "error", message: "Something went wrong. Try again." } });
    }
  });
}

/** @param {string} text @param {{ id: string, label: string } | null} [action] */
function showNote(text, action = null) {
  const note = $("note");
  note.textContent = "";
  note.append(text);
  if (action) {
    note.append(" ");
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = action.label;
    b.addEventListener("click", () => void onNoteAction(action.id));
    note.append(b);
  }
  note.hidden = false;
}

/** @param {string} id */
async function onNoteAction(id) {
  if (id === "openWeb") { await ask({ type: "popup.openWeb" }); window.close(); return; }
  if (id === "fillOn") { await ask({ type: "popup.neverFill", on: false }); await load(); }
}

function render() {
  const v = viewOf(state);
  $("space-name").textContent = v.spaceName;
  $("site").textContent = v.site;
  $("site").hidden = !v.site;
  const list = $("logins");
  list.textContent = "";
  v.rows.forEach((r, i) => {
    const li = document.createElement("li");
    li.className = "row";
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(i === selected));
    li.tabIndex = i === selected || (selected < 0 && i === 0) ? 0 : -1;
    li.dataset["id"] = r.id;
    const lead = document.createElement("span");
    lead.className = "lead";
    lead.textContent = r.letter;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = r.name;
    const trail = document.createElement("span");
    trail.className = "trail";
    trail.textContent = r.trail;
    li.append(lead, name, trail);
    li.addEventListener("click", () => void doFill(i, { signIn: false }));
    li.addEventListener("mousemove", () => { if (selected !== i) select(i); });
    li.addEventListener("contextmenu", (e) => { e.preventDefault(); select(i); openRowMenu(i, e.clientX, e.clientY); });
    list.append(li);
  });
  $("logins").hidden = v.rows.length === 0;
  if (v.note) showNote(v.note.text, v.note.action ?? null); else $("note").hidden = true;
  $("web").hidden = !v.showWeb;
  /** @type {HTMLInputElement} */ ($("q")).disabled = !v.canAsk;
  $("face-letter").textContent = agent ? (agent.name[0] || "V").toUpperCase() : "V";
}

/** @param {number} i */
function select(i) {
  selected = i;
  document.querySelectorAll("#logins .row").forEach((el, n) => {
    el.setAttribute("aria-selected", String(n === i));
    /** @type {HTMLElement} */ (el).tabIndex = n === i ? 0 : -1;
  });
  const row = /** @type {HTMLElement | undefined} */ (document.querySelectorAll("#logins .row")[i]);
  if (row && document.activeElement !== row && !(document.activeElement instanceof HTMLInputElement)) row.focus({ preventScroll: false });
}

/** @param {number} i @param {{ signIn: boolean, code?: boolean }} how */
async function doFill(i, how) {
  const v = viewOf(state);
  const row = v.rows[i];
  const el = /** @type {HTMLElement | undefined} */ (document.querySelectorAll("#logins .row")[i]);
  if (!row || !el) return;
  const trail = /** @type {HTMLElement} */ (el.querySelector(".trail"));
  trail.textContent = "Filling";
  const login = (state.rows || []).find((/** @type {any} */ r) => r.id === row.id);
  const r = await ask({ type: "popup.fill", itemId: row.id, kind: how.code || row.kind === "totp" ? "otp" : "login", signIn: how.signIn, usernameField: login && login.usernameField ? login.usernameField : undefined });
  if (r.error) { trail.textContent = ""; showNote(r.error.message); return; }
  if (!r.data.filled.length) { trail.textContent = ""; showNote("Vyre found no field to fill on this page."); return; }
  el.classList.add("done");
  trail.textContent = "Filled";
  setTimeout(() => window.close(), 650);
}

/** @type {HTMLElement} */
const menu = $("menu");
/** @type {HTMLElement | null} */
let menuReturn = null;

/** @param {{ id?: string, label?: string, sep?: boolean, check?: boolean }[]} items @param {number} x @param {number} y @param {(id: string) => void} pick */
function openMenu(items, x, y, pick) {
  menu.textContent = "";
  for (const it of items) {
    if (it.sep) { const s = document.createElement("div"); s.className = "sep"; menu.append(s); continue; }
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    if (it.check) b.classList.add("check");
    const label = document.createElement("span");
    label.textContent = it.label || "";
    b.append(label);
    b.addEventListener("click", () => { closeMenu(); pick(String(it.id)); });
    menu.append(b);
  }
  menu.hidden = false;
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.max(4, Math.min(x, document.documentElement.clientWidth - w - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, Math.max(document.documentElement.clientHeight, h + 8) - h - 4))}px`;
  menuReturn = /** @type {HTMLElement | null} */ (document.activeElement);
  /** @type {HTMLElement | null} */ (menu.querySelector("button"))?.focus();
}

function closeMenu() {
  if (menu.hidden) return;
  menu.hidden = true;
  $("space").setAttribute("aria-expanded", "false");
  if (menuReturn) menuReturn.focus();
}

/** @param {number} i @param {number} x @param {number} y */
function openRowMenu(i, x, y) {
  const v = viewOf(state);
  const row = v.rows[i];
  if (!row) return;
  const login = (state.rows || []).find((/** @type {any} */ r) => r.id === row.id) ?? null;
  const items = rowMenu(row, login).map((m) => ("sep" in m ? { sep: true } : { id: m.id, label: m.label }));
  openMenu(items, x, y, (id) => {
    if (id === "fill") void doFill(i, { signIn: false });
    else if (id === "fillSignIn") void doFill(i, { signIn: true });
    else if (id === "fillCode") void doFill(i, { signIn: false, code: true });
    else if (id === "openVault") void ask({ type: "popup.openVault", itemId: row.id }).then(() => window.close());
    else if (id === "neverFill") void ask({ type: "popup.neverFill", on: true }).then(() => load());
  });
}

$("space").addEventListener("click", () => {
  if (!menu.hidden) { closeMenu(); return; }
  const r = $("space").getBoundingClientRect();
  $("space").setAttribute("aria-expanded", "true");
  const spaces = state && state.spaces ? state.spaces : [];
  openMenu(spaces.map((/** @type {any} */ s) => ({ id: s.id, label: s.name, check: s.id === state.active })), r.left, r.bottom + 2, (id) => {
    void ask({ type: "popup.selectSpace", id }).then(() => load());
  });
});

$("face").addEventListener("click", async () => {
  if (!agents.length) { const r = await ask({ type: "popup.agents" }); if (r.data) { agents = r.data.agents || []; if (!agent && r.data.suggested) agent = r.data.suggested; } }
  if (!agents.length) return;
  const r = $("face").getBoundingClientRect();
  openMenu(agents.map((a) => ({ id: a.id, label: a.name, check: agent ? a.id === agent.id : false })), r.left, r.top - 8 - agents.length * 30, (id) => {
    agent = agents.find((a) => a.id === id) ?? agent;
    render();
    $("q").focus();
  });
});

$("ask").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = /** @type {HTMLInputElement} */ ($("q"));
  const question = input.value.trim();
  if (!question) return;
  input.disabled = true;
  const r = await ask({ type: "popup.ask", question, agentId: agent ? agent.id : null });
  if (r.error) { input.disabled = false; showNote(r.error.message); return; }
  showNote("Sent.");
  setTimeout(() => window.close(), 500);
});

$("vault").addEventListener("click", async () => { await ask({ type: "popup.openVault" }); window.close(); });
$("web").addEventListener("click", async () => { await ask({ type: "popup.openWeb" }); window.close(); });

document.addEventListener("keydown", (e) => {
  const where = { inInput: e.target instanceof HTMLInputElement, menuOpen: !menu.hidden };
  if (!menu.hidden) {
    const buttons = Array.from(menu.querySelectorAll("button"));
    const at = buttons.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
    if (e.key === "Escape") { e.preventDefault(); closeMenu(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); buttons[move(at, e.key, buttons.length)]?.focus(); }
    return;
  }
  const act = keyAction(e, where);
  if (act === "close") { window.close(); return; }
  if (act === "focusAsk") { e.preventDefault(); $("q").focus(); return; }
  const count = state ? viewOf(state).rows.length : 0;
  if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
    if (where.inInput && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    select(move(selected, e.key, count));
    return;
  }
  if (act === "fill" || act === "fillSignIn") { if (selected >= 0) { e.preventDefault(); void doFill(selected, { signIn: act === "fillSignIn" }); } return; }
  if (act === "menu" && selected >= 0) {
    e.preventDefault();
    const el = document.querySelectorAll("#logins .row")[selected];
    if (el) { const r = el.getBoundingClientRect(); openRowMenu(selected, r.left + 24, r.bottom); }
  }
});

document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(/** @type {Node} */ (e.target)) && e.target !== $("space")) closeMenu(); });

async function load() {
  const r = await ask({ type: "popup.state" });
  state = r.data || { page: null, spaces: [], active: null, status: "offline", rows: [], blocked: null, error: r.error || null };
  selected = viewOf(state).rows.length ? Math.max(0, Math.min(selected, viewOf(state).rows.length - 1)) : -1;
  render();
  if (selected >= 0) /** @type {HTMLElement | undefined} */ (document.querySelectorAll("#logins .row")[selected])?.focus();
  if (state.status === "online" && !agent) {
    const a = await ask({ type: "popup.agents" });
    if (a.data) { agents = a.data.agents || []; agent = a.data.suggested || agents[0] || null; render(); }
  }
}

void load();
