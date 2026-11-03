// @ts-check
// The review page for "Show Vyre how" (prototype "Show it once"), a Vyre page in a tab: the steps in plain words with a picture each, the inputs Vyre found ("Ask each time" or a
// fixed value), any step marked "Ask me before this step", who can run the skill, Save as skill, and then the share card (Add to my agents, Try it, View steps, Share).
// It talks only to the extension's worker (rec.* messages). Everything is built node by node: step words, names and values are text, never markup.

import { h, mount } from "../ui/dom.js";
import { face, ic, mark } from "../ui/icons.js";

const g = /** @type {any} */ (globalThis);
const chrome = g.chrome;
const id = new URLSearchParams(location.search).get("rec") || "";
const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (document.querySelector(s));

const S = {
  rec: /** @type {any} */ (null), words: /** @type {string[]} */ ([]), gone: false,
  agents: /** @type {any[]} */ ([]), who: /** @type {Set<string>} */ (new Set()),
  saved: /** @type {any} */ (null), busy: "", error: "", note: "", shared: /** @type {"me" | "people" | "space"} */ ("me"), sharedWith: /** @type {string[]} */ ([]), shareOpen: false, dir: /** @type {any} */ (null), tried: /** @type {string | null} */ (null),
};

/** @param {string} type @param {Record<string, any>} [body] */
function ask(type, body = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, id, ...body }, (/** @type {any} */ r) => {
      const le = chrome.runtime.lastError;
      if (le) { reject(new Error(le.message)); return; }
      if (r && r.error) { reject(Object.assign(new Error(r.error.message || "Something went wrong."), { code: r.error.code })); return; }
      resolve(r ? r.data : null);
    });
  });
}
const fail = (/** @type {any} */ e) => { S.error = e instanceof Error ? e.message : "Something went wrong. Try again."; S.busy = ""; render(); };

/** Step words with {inputs} drawn as pills. @param {string} text */
function pills(text) {
  const out = [];
  let at = 0;
  for (const m of text.matchAll(/\{([^}]+)\}/g)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push(h("span.var", { "data-tip": `Input: ${m[1]}` }, m[1]));
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** "A", "A and B", "A, B and C". @param {string[]} xs */
const listWords = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const hostsOf = () => [...new Set(S.rec.steps.map((/** @type {any} */ s) => s.host).filter(Boolean))];
const took = () => { const ms = (S.rec.endedAt || S.rec.startedAt) - S.rec.startedAt; const s = Math.max(1, Math.round(ms / 1000)); return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`; };
const when = () => new Date(S.rec.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function stepRow(/** @type {any} */ s, /** @type {number} */ i) {
  const signin = s.kind === "signin";
  return h("div.rstep", { data: { id: s.id } },
    h("span.n", null, String(i + 1)),
    h("div.th", null, s.shot ? h("img", { alt: "", src: s.shot }) : ic(signin ? "lock" : "globe")),
    h("div.grow", null,
      h("div.tx", null, pills(S.words[i] || "")),
      s.ask ? h("div.tag.warn", null, ic("hand", "xs"), "Asks you before this step") : null,
      signin ? h("div.tag.mut", null, ic("lock", "xs"), "Password not recorded. Agents sign in with Vault.") : null,
      s.secret ? h("div.tag.mut", null, ic("lock", "xs"), "Not recorded. Asked for each time.") : null),
    h("div.tools", null,
      signin ? null : h("button.ib.sm.hov", { data: { a: "ask", id: s.id }, "data-tip": s.ask ? "Don't ask before this step" : "Ask me before this step", "aria-label": "Ask me before this step", "aria-pressed": String(Boolean(s.ask)) }, ic("hand", "s")),
      h("button.ib.sm.hov", { data: { a: "del", id: s.id }, "data-tip": "Delete step", "aria-label": "Delete step" }, ic("trash", "s"))));
}

function inputRows() {
  if (!S.rec.inputs.length) return [h("div.xs.mut", null, "Nothing you typed changes between runs.")];
  return S.rec.inputs.map((/** @type {any} */ v) => {
    const fixed = v.mode === "fixed";
    const secret = v.example === "" && v.mode === "ask" && S.rec.steps.some((/** @type {any} */ s) => s.key === v.key && s.secret);
    return h("div.vrow", null,
      h("div.grow", null,
        h("div.b5", null, v.label),
        fixed ? h("input.fld", { value: v.example, "aria-label": `Always use for ${v.label}`, data: { a: "example", key: v.key } }) : h("div.xs.mut.ell", null, secret ? "Never recorded" : `Example: ${v.example}`)),
      secret ? h("span.xs.mut", null, "Ask each time") : h("button.pick.sm", { data: { a: "mode", key: v.key }, "aria-haspopup": "menu" }, fixed ? "Always the same" : "Ask each time", h("span.chev", null, ic("chev", "xs"))));
  });
}

function whoLine() {
  const picked = S.agents.filter((a) => S.who.has(a.id));
  return h("button.pick", { data: { a: "who" }, css: { marginLeft: "-8px" }, "aria-haspopup": "menu" },
    h("span.agents", null, picked.map((a) => face({ name: a.name, avatar: a.avatar ?? null, assistant: Boolean(a.assistant) }, 20))),
    h("span", null, picked.length ? picked.map((a) => a.name).join(", ") : "Nobody yet"), h("span.chev", null, ic("chev", "xs")));
}

const sharedNames = () => listWords(S.sharedWith.map((id) => ((S.dir && S.dir.people.find((/** @type {any} */ p) => p.id === id)) || { name: "someone" }).name));

/** The share choices, open under the card: Only you, specific people (from the people this person may see), everyone in the Space. */
function sharePanel() {
  const row = (/** @type {string} */ a, /** @type {string} */ k, /** @type {string} */ label, /** @type {boolean} */ on, /** @type {boolean} */ radio, /** @type {string} */ icon) =>
    h(`button.opt${on ? ".on" : ""}`, { data: { a, k }, role: radio ? "radio" : "checkbox", "aria-checked": String(on) }, h(`span.rd${radio ? "" : ".sq"}`, null, !radio && on ? ic("check", "xs") : null), h("div.grow.ell", null, h("div.ot.ell", null, label)), h("span.mut", null, ic(icon, "s")));
  const people = S.dir ? S.dir.people.filter((/** @type {any} */ p) => p.id !== S.dir.me) : [];
  return h("div", { css: { marginTop: "12px", paddingTop: "8px", borderTop: "1px solid var(--line)" } },
    row("shareMode", "me", "Only you", S.shared === "me", true, "lock"),
    row("shareMode", "people", "Specific people", S.shared === "people", true, "users"),
    S.shared === "people" ? h("div", { css: { padding: "0 0 4px 26px" } }, !S.dir ? h("div.xs.mut", null, "Loading") : people.length ? people.map((/** @type {any} */ p) => row("sharePerson", p.id, p.name, S.sharedWith.includes(p.id), false, "user")) : h("div.xs.mut", null, "No one else is in this Space yet.")) : null,
    row("shareMode", "space", "Everyone in this Space", S.shared === "space", true, "globe"),
    h("div.btns", { css: { marginTop: "8px" } }, h("button.btn.pri", { data: { a: "shareDone" }, disabled: S.shared === "people" && !S.sharedWith.length }, "Done"), h("button.btn.q", { data: { a: "shareX" } }, "Cancel")));
}

function skillCard() {
  const sv = S.saved;
  const agents = S.agents.filter((a) => (sv.agents || []).includes("*") || (sv.agents || []).includes(a.id));
  return h("div.skc", null,
    h("div.skh", null, h("span.skic", null, ic("skill")),
      h("div.grow", null, h("div.b6", null, S.rec.name), h("div.sm.mut", null, `Skill · ${S.rec.steps.length} steps · shown once in Chrome`))),
    h("div.dl", null,
      h("span.k", null, "Asks for"), h("span", null, S.rec.inputs.filter((/** @type {any} */ i) => i.mode === "ask").map((/** @type {any} */ i) => i.label).join(", ") || "Nothing"),
      h("span.k", null, "Sites"), h("span", null, hostsOf().join(", ")),
      h("span.k", null, "Signs in"), h("span", null, S.rec.steps.some((/** @type {any} */ s) => s.kind === "signin") ? "With Vault" : "No sign-in"),
      h("span.k", null, "Shared with"), h("span", null, S.shared === "space" ? "Everyone in this Space" : S.shared === "people" ? sharedNames() : "Only you")),
    h("div.skf", null,
      h("button.btn.pri", { data: { a: "add" }, disabled: S.busy === "add" }, ic("plus", "s"), "Add to my agents"),
      h("button.btn", { data: { a: "try" }, disabled: S.busy === "try" }, ic("play", "s"), "Try it"),
      h("button.btn.q", { data: { a: "view" } }, "View steps"),
      h("button.btn.q", { data: { a: "share" }, "aria-haspopup": "menu" }, ic("users", "s"), "Share"),
      h("span.grow"),
      h("span.xs.mut", null, agents.length ? `On ${agents.map((a) => a.name).join(", ")}` : "")),
    S.shareOpen ? sharePanel() : null);
}

function render() {
  const app = $("#app");
  if (S.gone) {
    mount(app, h("div.gone", null, h("div", { css: { display: "grid", placeItems: "center", color: "var(--ink-3)" } }, mark(26)), h("div.t", null, "This recording is gone"),
      "Recordings are kept until Chrome closes. Record it again from the right-click menu: Show Vyre how."));
    return;
  }
  if (!S.rec) { mount(app, h("div.gone", null, "Loading")); return; }
  const signins = hostsOf().filter((hh) => S.rec.steps.some((/** @type {any} */ s) => s.kind === "signin" && s.host === hh));
  mount(app, h("div.rv", null,
    S.saved ? h("div.full", null, h("div.banner", null, h("span.okc", null, ic("check")), h("span.grow", null, `Saved as a skill. ${listWords(S.agents.filter((a) => S.who.has(a.id)).map((a) => a.name)) || "You"} can use it now.`),
      S.tried ? h("button.btn", { data: { a: "chat" } }, ic("open", "s"), "Open the chat") : null), S.note ? h("div.xs.mut", { css: { marginTop: "6px" } }, S.note) : null) : null,
    h("div", null,
      h("div.rvk", null, mark(13), "Review what you showed"),
      h("input.rvname", { value: S.rec.name, "aria-label": "Name of the skill", data: { a: "name" } }),
      h("div.rvsub", null, `${S.rec.steps.length} step${S.rec.steps.length === 1 ? "" : "s"} · recorded ${when()} on ${hostsOf().join(" and ") || "this computer"} · ${took()}`),
      S.rec.steps.map(stepRow)),
    h("div.col", null,
      h("div.panel2", null, h("div.lbl", null, "Inputs Vyre found"), inputRows(), h("div.xs.mut", { css: { marginTop: "6px" } }, "An agent asks for these, or reads them from the chat.")),
      h("div.panel2", null, h("div.lbl", null, "Sign-ins"),
        signins.length ? signins.map((hh) => h("div", { css: { display: "flex", gap: "8px", alignItems: "center", padding: "2px 0" } }, ic("lock", "s"), h("div.grow", null, h("div.b5.sm", null, hh), h("div.xs.mut", null, "Agents sign in with a login from the Vault. The password was not recorded.")))) : [h("div.xs.mut", null, "No sign-in in these steps.")],
        h("div.lbl", null, "Who can run it"), whoLine(),
        h("div.xs.mut", { css: { marginTop: "6px" } }, "Runs on the agent's computer when it has one, else in your Chrome.")),
      S.error ? h("div.err", null, S.error) : null,
      h("div.btns", null, S.saved
        ? h("button.btn.lg", { data: { a: "save" }, disabled: S.busy === "save" }, ic("skill", "s"), "Save changes")
        : [h("button.btn.pri.lg", { data: { a: "save" }, disabled: S.busy === "save" || !S.rec.steps.length }, ic("skill", "s"), "Save as skill"), h("button.btn.q.lg", { data: { a: "discard" } }, "Discard")])),
    S.saved ? h("div.full", null, skillCard()) : null));
}

/** @param {HTMLElement} anchor @param {{ label: string, check?: boolean, run: () => void }[]} items */
function menu(anchor, items) {
  const m = $("#menu");
  mount(m, items.map((it, i) => h("button.mi", { role: "menuitem", data: { i } }, h("span.ell", null, it.label), it.check ? h("span.ck", null, ic("check", "s")) : null)));
  m.hidden = false;
  const r = anchor.getBoundingClientRect();
  m.style.left = `${Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, r.left))}px`;
  m.style.top = `${r.bottom + 4 + m.offsetHeight > innerHeight ? Math.max(8, r.top - m.offsetHeight - 4) : r.bottom + 4}px`;
  menuItems = items;
  /** @type {HTMLElement | null} */ (m.querySelector(".mi"))?.focus();
}
let menuItems = /** @type {{ run: () => void }[]} */ ([]);

/** @param {Record<string, any>} edit */
async function edit(edit) {
  try {
    const r = /** @type {any} */ (await ask("rec.edit", { edit }));
    S.rec = r.rec; S.words = r.words; S.error = "";
  } catch (e) { fail(e); return; }
  render();
}

const A = /** @type {Record<string, (el: HTMLElement) => void | Promise<void>>} */ ({
  del: (el) => edit({ remove: [String(el.dataset["id"])] }),
  ask: (el) => { const s = S.rec.steps.find((/** @type {any} */ x) => x.id === el.dataset["id"]); return edit({ ask: { [String(el.dataset["id"])]: !(s && s.ask) } }); },
  mode: (el) => {
    const key = String(el.dataset["key"]);
    const v = S.rec.inputs.find((/** @type {any} */ x) => x.key === key);
    menu(el, [
      { label: "Ask each time", check: v && v.mode === "ask", run: () => void edit({ inputs: { [key]: { mode: "ask" } } }) },
      { label: `Always ${v && v.example ? `"${String(v.example).slice(0, 30)}"` : "the same"}`, check: v && v.mode === "fixed", run: () => void edit({ inputs: { [key]: { mode: "fixed" } } }) },
    ]);
  },
  who: (el) => menu(el, [...S.agents.map((a) => ({ label: a.name, check: S.who.has(a.id), run: () => { if (S.who.has(a.id)) S.who.delete(a.id); else S.who.add(a.id); render(); } }))]),
  save: async () => {
    S.busy = "save"; S.error = ""; render();
    try {
      const r = /** @type {any} */ (await ask("rec.save", { agents: [...S.who] }));
      S.saved = r.saved; S.busy = ""; S.note = "";
    } catch (e) { fail(e); return; }
    render();
  },
  discard: async () => { try { await ask("rec.discard"); } catch { /* gone already */ } S.rec = null; S.gone = true; render(); },
  add: async () => {
    S.busy = "add"; render();
    try { await ask("rec.add"); S.who = new Set(S.agents.map((a) => a.id)); S.saved = { ...S.saved, agents: ["*"] }; S.note = "On all your agents."; } catch (e) { fail(e); return; }
    S.busy = ""; render();
  },
  try: async () => {
    const agent = [...S.who][0] || (S.agents.find((a) => a.assistant) || S.agents[0] || {}).id;
    if (!agent) { S.error = "Pick an agent under Who can run it."; render(); return; }
    S.busy = "try"; render();
    try { const r = /** @type {any} */ (await ask("rec.try", { agentId: agent })); S.tried = r && r.threadId ? r.threadId : null; S.note = S.tried ? "Started a test run in a chat." : "Asked. The reply will be in Vyre Chats."; } catch (e) { fail(e); return; }
    S.busy = ""; render();
  },
  chat: () => void ask("rec.open", { place: "chats", skillId: S.tried }).catch(() => {}),
  view: () => void ask("rec.open", { place: "skill", skillId: S.saved && S.saved.skillId }).catch(() => {}),
  share: async () => { S.shareOpen = !S.shareOpen; render(); if (S.shareOpen && !S.dir) { try { S.dir = await ask("rec.people"); } catch { S.dir = { people: [], channels: [], me: "" }; } render(); } },
  shareMode: (el) => { S.shared = /** @type {any} */ (el.dataset["k"]); render(); },
  sharePerson: (el) => { const id = String(el.dataset["k"]); S.sharedWith = S.sharedWith.includes(id) ? S.sharedWith.filter((x) => x !== id) : [...S.sharedWith, id]; render(); },
  shareX: () => { S.shareOpen = false; render(); },
  shareDone: async () => {
    try {
      if (S.shared === "me") await ask("rec.share", { stop: true });
      else if (S.shared === "people") { await ask("rec.share", { to: S.sharedWith }); S.note = `${sharedNames()} get a card and decide whether to add it.`; }
      else { await ask("rec.share", { space: true }); S.note = "Everyone in the Space gets a card and decides whether to add it."; }
      S.shareOpen = false;
    } catch (e) { fail(e); return; }
    render();
  },
});

document.addEventListener("click", (e) => {
  const t = /** @type {HTMLElement} */ (e.target);
  const mi = /** @type {HTMLElement | null} */ (t.closest("#menu .mi"));
  if (mi) { const it = menuItems[Number(mi.dataset["i"])]; $("#menu").hidden = true; if (it) void it.run(); return; }
  if (!t.closest("#menu")) $("#menu").hidden = true;
  const el = /** @type {HTMLElement | null} */ (t.closest("button[data-a]"));
  if (!el || /** @type {any} */ (el).disabled) return;
  const f = A[String(el.dataset["a"])];
  if (f) void f(el);
});
document.addEventListener("change", (e) => {
  const t = /** @type {HTMLInputElement} */ (e.target);
  if (t.dataset["a"] === "name") void edit({ name: t.value });
  if (t.dataset["a"] === "example") void edit({ inputs: { [String(t.dataset["key"])]: { example: t.value } } });
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#menu").hidden = true; });
document.addEventListener("mouseover", (e) => {
  const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest("[data-tip]"));
  const tip = $("#tip");
  if (!el || !el.dataset["tip"]) { tip.hidden = true; return; }
  tip.textContent = el.dataset["tip"] ?? "";
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  tip.style.left = `${Math.max(6, Math.min(innerWidth - tip.offsetWidth - 6, r.left + r.width / 2 - tip.offsetWidth / 2))}px`;
  tip.style.top = `${r.bottom + 6 + tip.offsetHeight > innerHeight ? r.top - tip.offsetHeight - 6 : r.bottom + 6}px`;
});

async function boot() {
  render();
  try {
    const r = /** @type {any} */ (await ask("rec.get"));
    S.rec = r.rec; S.words = r.words; S.saved = r.saved || null;
    document.title = `Review: ${S.rec.name}`;
  } catch { S.gone = true; render(); return; }
  render();
  try {
    const a = /** @type {any} */ (await ask("rec.agents"));
    S.agents = a && Array.isArray(a.agents) ? a.agents : [];
    const pick = a && a.suggested ? a.suggested.id : S.agents[0] ? S.agents[0].id : null;
    if (S.saved && Array.isArray(S.saved.agents)) S.who = new Set(S.saved.agents.includes("*") ? S.agents.map((x) => x.id) : S.saved.agents);
    else if (pick) S.who = new Set([pick]);
  } catch { /* the Vyre app is away: the agents appear when it is back */ }
  render();
}
void boot();
