// @ts-check
// from vyre 0.6.9 modules/hands-chrome/index.js@dbd2dfbab, act.js@dbd2dfbab, api-exec.js@dbd2dfbab
// The chrome_* tools (manifests/computers.ts, toolset `computer`) as this extension executes them over chrome.debugger. Each tool resolves its tab, starts (or keeps)
// the agent's frame on it, does the work against a FRESH look at the page, and answers with the contract's output shape. The disciplines carried over from 0.6:
//   * fresh binding: a ref names a control by what it is (role, name, identifier, container), is re-resolved against a new look just before it is used, and a control
//     that will not bind uniquely is a miss with a reason, never a click on the nearest thing;
//   * verify: a click that changed nothing is reported as not landed;
//   * consequence: a send, post, payment or deletion is HELD (returns heldId, presses nothing); only chrome_send, which the Gate approves, presses it;
//   * secrets: a value goes into a page only as a Vault handle the app's filler substitutes; fields filled that way stay masked, are blurred in screenshots and scrubbed
//     from anything read back.

import { callExpression, blurSecrets, collectPage, describeElement, focusElement, markSecret, pageRequest, pointInfo, probe, revealElement, scrollTo, scrubSecrets, selectOption } from "./page.js";
import { AgentFailure, BATCHABLE, TAB_LIMIT, checkInput, errorOf, fail } from "./protocol.js";
import { bareUrl, maskBody, maskHeaders, maskJson, maskUrl, scrub } from "./mask.js";
import { refMap, renderTree, toSnapshot } from "./snapshot.js";
import * as selector from "./selector.js";
import * as consequence from "./consequence.js";
import * as verify from "./verify.js";

const HANDLE = /^#[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const ACTIVATORS = new Set(["button", "link", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "treeitem", "option"]);
const ALLOWED_WHILE_PAUSED = new Set(["chrome_status", "chrome_resume", "chrome_stop"]);
const MAX_BODY = 120_000;
const FORBIDDEN_HEADERS = /^(cookie|host|origin|referer|content-length|connection|user-agent|accept-encoding|sec-.*|proxy-.*)$/i;

/** @type {Record<string, { key: string, code: string, vk: number, text?: string }>} */
const KEYS = {
  Enter: { key: "Enter", code: "Enter", vk: 13, text: "\r" }, Tab: { key: "Tab", code: "Tab", vk: 9 }, Escape: { key: "Escape", code: "Escape", vk: 27 },
  Backspace: { key: "Backspace", code: "Backspace", vk: 8 }, Delete: { key: "Delete", code: "Delete", vk: 46 }, Space: { key: " ", code: "Space", vk: 32, text: " " },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", vk: 38 }, ArrowDown: { key: "ArrowDown", code: "ArrowDown", vk: 40 }, ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 }, ArrowRight: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
  Home: { key: "Home", code: "Home", vk: 36 }, End: { key: "End", code: "End", vk: 35 }, PageUp: { key: "PageUp", code: "PageUp", vk: 33 }, PageDown: { key: "PageDown", code: "PageDown", vk: 34 },
};
const MODS = { alt: 1, control: 2, ctrl: 2, meta: 4, cmd: 4, command: 4, shift: 8 };

/** "Enter", "Control+A", "Shift+Tab" as a protocol key event. @param {string} spec */
export function parseKey(spec) {
  const parts = String(spec).split("+");
  const main = parts.pop() ?? "";
  let modifiers = 0;
  for (const m of parts) {
    const bit = /** @type {Record<string, number>} */ (MODS)[m.toLowerCase()];
    if (!bit) fail("bad_input", `${JSON.stringify(m)} is not a key modifier`);
    modifiers |= bit;
  }
  const named = KEYS[main === " " ? "Space" : main];
  if (named) return { ...named, modifiers };
  if (main.length === 1) {
    const up = main.toUpperCase();
    const code = /[A-Z]/.test(up) ? `Key${up}` : /[0-9]/.test(up) ? `Digit${up}` : "";
    return { key: main, code, vk: up.charCodeAt(0), ...(modifiers & 6 ? {} : { text: main }), modifiers };
  }
  return fail("bad_input", `${JSON.stringify(main)} is not a key name`);
}

/** Agents browse the public web: not this computer, not a private network, not a bare internal name. Names that resolve to a private address are caught by the egress proxy on an agent computer. @param {string} u */
export function isPublicUrl(u) {
  let x;
  try { x = new URL(u); } catch { return false; }
  if (!/^https?:$/.test(x.protocol)) return false;
  const h = x.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h || h === "localhost" || /\.(localhost|local|internal|lan|home\.arpa|corp|intranet)$/.test(h)) return false;
  if (h.includes(":")) return !(h === "::1" || h === "::" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith("::ffff:"));
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
  }
  return h.includes(".");
}

/** A tab an agent may drive: a web page, or a blank one. @param {unknown} u */
const drivable = (u) => typeof u === "string" && (/^https?:\/\//i.test(u) || u === "about:blank");
/** @param {{ name?: string, role: string }} c */
const label = (c) => JSON.stringify(c.name || c.role);
/** @param {"unbound" | "tied" | undefined} why */
const miss = (why) => ({ ok: false, why: why === "tied" ? "More than one control matches that ref now, so nothing was pressed. Take a new snapshot." : "That control moved or changed since you looked, so nothing was pressed. Take a new snapshot." });

/**
 * @param {{
 *   ext: { tabs: any, scripting?: any },
 *   cdp: ReturnType<typeof import("./cdp.js").createCdp>,
 *   traffic: ReturnType<typeof import("./net.js").createTraffic>,
 *   sessions: ReturnType<typeof import("./sessions.js").createSessions>,
 *   authorize: (call: Call) => Promise<void> | void,
 *   mode: () => "personal" | "computer",
 *   connected: (call: Call) => boolean,
 *   vaultFill: (call: Call, handle: string) => Promise<string | null>,
 *   emit: (event: Record<string, any>) => void,
 *   now?: () => number, sleep?: (ms: number) => Promise<void>, settleMs?: number,
 * }} kit
 * @typedef {{ id?: string, tool: string, input: Record<string, any>, agent: { id: string, name: string }, space: string }} Call
 */
export function createTools(kit) {
  const { ext, cdp, traffic, sessions } = kit;
  const now = kit.now ?? Date.now;
  const sleep = kit.sleep ?? ((/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms)));
  const settleMs = kit.settleMs ?? 250;

  // ---------- page access

  /** Run a page.js function in the tab and return its value. @param {number} tabId @param {Function} fn @param {...unknown} args */
  async function evalPage(tabId, fn, ...args) {
    const r = await cdp.send(tabId, "Runtime.evaluate", { expression: callExpression(fn, ...args), returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) throw new AgentFailure("page_error", scrub(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "the page script failed"));
    return r && r.result ? r.result.value : undefined;
  }

  /** @param {number} tabId @param {{ selector?: string | null, max?: number }} [o] */
  async function look(tabId, o = {}) {
    const raw = await evalPage(tabId, collectPage, o.selector ?? null, o.max ?? 400);
    if (raw && raw.error) fail("no_element", o.selector ? `Nothing matches ${JSON.stringify(o.selector)}.` : "");
    return toSnapshot(raw);
  }

  /** A look taken while a page may be navigating: a missing context counts as "it moved on". @param {number} tabId */
  async function lookAfter(tabId) {
    for (let i = 0; i < 3; i++) {
      try { return await look(tabId); } catch (e) {
        if (e instanceof AgentFailure && e.code === "no_tab") throw e;
        await sleep(150);
      }
    }
    return null;
  }

  /** Give the agent this look's refs and the text of it. @param {number} tabId @param {import("./snapshot.js").Snapshot} snap @param {number} [limit] */
  function publish(tabId, snap, limit) {
    sessions.setRefs(tabId, refMap(snap));
    return renderTree(snap, limit);
  }

  /** Let a click's effects land: a short pause, then the load if a navigation began and has not finished. @param {number} tabId @param {{ navigations: number, loads: number }} before */
  async function settle(tabId, before) {
    if (settleMs > 0) await sleep(settleMs);
    if (traffic.navigations(tabId) !== before.navigations && traffic.loads(tabId) === before.loads) await cdp.waitFor(tabId, (m) => m === "Page.loadEventFired", 8000);
  }

  /** What to compare after an action to know whether a navigation began. @param {number} tabId */
  const marks = (tabId) => ({ navigations: traffic.navigations(tabId), loads: traffic.loads(tabId) });

  /** @param {number} tabId @param {string} type @param {number} x @param {number} y @param {"left" | "right" | "middle"} [button] @param {number} [clickCount] */
  const mouse = (tabId, type, x, y, button = "left", clickCount = 1) =>
    cdp.send(tabId, "Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : button, buttons: type === "mouseReleased" ? 0 : button === "left" ? 1 : button === "right" ? 2 : 4, clickCount });

  /** @param {number} tabId @param {ReturnType<typeof parseKey>} k */
  async function sendKey(tabId, k) {
    const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: k.modifiers };
    await cdp.send(tabId, "Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...base, ...(k.text ? { text: k.text } : {}) });
    await cdp.send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  /** Select what the focused field holds so the next text replaces it. @param {number} tabId */
  const selectAll = (tabId) => cdp.send(tabId, "Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2, commands: ["selectAll"] }).then(() => cdp.send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 }));

  // ---------- tabs

  /** @param {Call} call @param {number} tabId @param {{ owned?: boolean }} [o] */
  async function mayUse(call, tabId, o = {}) {
    if (sessions.owns(call.agent.id, tabId) || kit.mode() === "computer") return;
    let tab;
    try { tab = await ext.tabs.get(tabId); } catch { return fail("no_tab"); }
    // The tab the person has in front of them can be handed to an agent (use, or a tool that names it); it can never be closed by one.
    if (o.owned || !tab.active) fail("not_yours");
  }

  /** The tab a tool works in: the one named, else the agent's current one, else (an agent computer) the tab Chrome has open. @param {Call} call @param {Record<string, any>} input */
  async function tabFor(call, input) {
    const agentId = call.agent.id;
    /** @type {number | null} */
    let tabId = null;
    if (input["tabId"] !== undefined) {
      tabId = Number(input["tabId"]);
      if (!Number.isInteger(tabId)) fail("bad_input", "tabId is the number from chrome_tabs, as text.");
      await mayUse(call, tabId);
    } else tabId = sessions.currentTab(agentId);
    if (tabId === null && kit.mode() === "computer") {
      const [t] = await ext.tabs.query({ active: true, currentWindow: true });
      if (t && t.id !== undefined && drivable(t.url)) { tabId = t.id; sessions.own(agentId, tabId); sessions.setCurrent(agentId, tabId); }
    }
    if (tabId === null) return fail("no_tab");
    let tab;
    try { tab = await ext.tabs.get(tabId); } catch { await sessions.tabGone(tabId); return fail("no_tab"); }
    if (!drivable(tab.url)) fail("no_page", tab.url ? `(${bareUrl(String(tab.url))})` : "");
    sessions.own(agentId, tabId);
    sessions.setCurrent(agentId, tabId);
    return tabId;
  }

  /** Resolve the tab, put the agent's frame on it, attach, run, and keep the idle clock honest. @template T @param {Call} call @param {Record<string, any>} input @param {(tabId: number) => Promise<T>} fn */
  async function drive(call, input, fn) {
    const tabId = await tabFor(call, input);
    await sessions.begin(call, tabId);
    try { await cdp.attach(tabId); } catch (e) { await sessions.release(tabId, "denied"); throw e; }
    try { return await fn(tabId); } finally { sessions.touch(tabId); }
  }

  /** @param {Call} call @param {string} url @param {boolean} active */
  async function newTab(call, url, active) {
    const mine = sessions.ownedTabs(call.agent.id);
    if (mine.length >= TAB_LIMIT) fail("tab_limit");
    if (url !== "about:blank" && !isPublicUrl(url)) fail("not_public");
    const tab = await ext.tabs.create({ url: "about:blank", active });
    if (tab.id === undefined) fail("no_tab");
    sessions.own(call.agent.id, tab.id);
    sessions.setCurrent(call.agent.id, tab.id);
    return tab.id;
  }

  // ---------- acting on a control

  /** Press (click, double click, hover) a control, chosen by selector, against a fresh look. @param {Call} call @param {number} tabId @param {selector.Selector} sel @param {{ verb: "click" | "hover", button?: "left" | "right" | "middle", double?: boolean, mode?: "normal" | "approved", wantChecked?: boolean }} o */
  async function pressControl(call, tabId, sel, o) {
    const before = await look(tabId);
    const r = selector.resolve(sel, before.controls);
    if (!r.control) return miss(r.why);
    const c = r.control;
    if (c.enabled === false) return { ok: false, why: `${label(c)} is disabled right now` };
    if (o.wantChecked !== undefined && c.checked === o.wantChecked) return { ok: true, why: `${label(c)} is already ${o.wantChecked ? "checked" : "unchecked"}` };
    const button = o.button ?? "left";
    if (o.verb === "click" && o.mode !== "approved") {
      const v = consequence.of(c);
      if (v.consequential) {
        const heldId = sessions.hold(call, tabId, { kind: v.kind, why: v.why, summary: `${v.kind}: ${label(c)} on ${bareUrl(before.url)}`, selector: sel, action: { type: "click", button, double: Boolean(o.double) } });
        return { ok: false, heldId, why: `${v.why}. It is held until the person approves it.` };
      }
    }
    const rect = await evalPage(tabId, revealElement, c.idx);
    if (!rect) return { ok: false, why: `${label(c)} is gone` };
    if (rect.covered) return { ok: false, why: `${label(c)} is covered by ${JSON.stringify(rect.covered)}. Close or dismiss that first.` };
    await sessions.cursor(tabId, rect.cx, rect.cy, o.verb === "click");
    const nav = marks(tabId);
    await mouse(tabId, "mouseMoved", rect.cx, rect.cy);
    if (o.verb === "hover") { if (settleMs > 0) await sleep(settleMs); return { ok: true, why: `moved over ${label(c)}` }; }
    await mouse(tabId, "mousePressed", rect.cx, rect.cy, button, 1);
    await mouse(tabId, "mouseReleased", rect.cx, rect.cy, button, 1);
    if (o.double) { await mouse(tabId, "mousePressed", rect.cx, rect.cy, button, 2); await mouse(tabId, "mouseReleased", rect.cx, rect.cy, button, 2); }
    await settle(tabId, nav);
    const after = await lookAfter(tabId);
    if (!after) return { ok: true, pressed: true, why: `pressed ${label(c)}; the page is navigating` };
    const moved = verify.changed(before, after);
    if (!moved.ok) return { ok: false, pressed: true, why: moved.why, retryable: consequence.retryable(c) };
    return { ok: true, pressed: true, why: `pressed ${label(c)}`, snapshot: publish(tabId, after, 6000).tree };
  }

  /** Press a key, with the consequence check Enter and Space need. @param {Call} call @param {number} tabId @param {string} spec @param {import("./snapshot.js").Control | undefined} ctl @param {"normal" | "approved"} [mode] */
  async function pressKey(call, tabId, spec, ctl, mode = "normal") {
    const k = parseKey(spec);
    if (mode !== "approved" && !k.modifiers && (k.key === "Enter" || k.key === " ")) {
      const activator = Boolean(ctl && ACTIVATORS.has(ctl.role));
      const v = activator && ctl ? consequence.of(ctl) : k.key === "Enter" && ctl ? consequence.ofEnter(ctl) : { consequential: false, kind: "none", why: "" };
      if (v.consequential) {
        const heldId = sessions.hold(call, tabId, { kind: v.kind, why: v.why, summary: `${v.kind}: ${spec} on ${ctl ? label(ctl) : "the page"}`, selector: ctl ? selector.of(ctl) : null, action: { type: "press", key: spec } });
        return { ok: false, heldId, why: `${v.why}. It is held until the person approves it.` };
      }
    }
    const nav = marks(tabId);
    await sendKey(tabId, k);
    await settle(tabId, nav);
    const after = await lookAfter(tabId);
    if (!after) return { ok: true, pressed: true };
    return { ok: true, pressed: true, snapshot: publish(tabId, after, 6000).tree };
  }

  /** Put keyboard focus on a control and return it. @param {number} tabId @param {import("./snapshot.js").Control} c */
  async function focusControl(tabId, c) {
    const rect = await evalPage(tabId, revealElement, c.idx);
    if (!rect) fail("no_element", `${label(c)} is gone.`);
    await sessions.cursor(tabId, rect.cx, rect.cy, false);
    if (!(await evalPage(tabId, focusElement, c.idx))) fail("no_element", `${label(c)} cannot take focus.`);
  }

  /** Bind a ref the agent read to a control in a fresh look. @param {number} tabId @param {string} ref */
  async function bind(tabId, ref) {
    const sel = sessions.ref(tabId, ref);
    if (!sel) fail("unknown_ref");
    const snap = await look(tabId);
    const r = selector.resolve(/** @type {selector.Selector} */ (sel), snap.controls);
    return { sel: /** @type {selector.Selector} */ (sel), snap, control: r.control, why: r.why };
  }

  /** Type text (or fill a Vault handle) into a control, or into whatever has focus. @param {Call} call @param {number} tabId @param {string | undefined} ref @param {string} text @param {boolean} replace */
  async function writeText(call, tabId, ref, text, replace) {
    /** @type {import("./snapshot.js").Control | undefined} */
    let target;
    if (ref) {
      const b = await bind(tabId, ref);
      if (!b.control) return miss(b.why);
      target = b.control;
      if (target.enabled === false) return { ok: false, why: `${label(target)} is disabled right now` };
      await focusControl(tabId, target);
    } else {
      target = (await look(tabId)).controls.find((c) => c.focused);
    }
    const isHandle = HANDLE.test(text);
    if (target && target.secret && !isHandle) fail("secret_field");
    if (isHandle) {
      if (!target) fail("no_element", "Name the field to fill with a ref.");
      const value = await kit.vaultFill(call, text);
      if (value === null) fail("fill_failed");
      let v = value;
      try {
        await selectAll(tabId);
        await cdp.send(tabId, "Input.insertText", { text: v });
      } finally { v = ""; }
      await evalPage(tabId, markSecret, target.idx);
      return { ok: true, why: `filled ${label(target)} from the Vault` };
    }
    if (replace) await selectAll(tabId);
    await cdp.send(tabId, "Input.insertText", { text });
    return { ok: true, ...(target ? { why: `typed into ${label(target)}` } : {}) };
  }

  // ---------- results an agent may read

  /** Anything read back from a page, with the values of its secret fields taken out. @param {number} tabId @param {string} text */
  const scrubbed = async (tabId, text) => String((await evalPage(tabId, scrubSecrets, text)) ?? text);

  // ---------- the tools

  /** @type {Record<string, (call: Call, input: Record<string, any>, note: (s: string) => void) => Promise<any>>} */
  const table = {
    async chrome_snapshot(call, input, note) {
      return drive(call, input, async (tabId) => {
        const snap = await look(tabId, { selector: input["selector"] ?? null });
        note(`${snap.controls.length} controls on ${snap.title || snap.url}`);
        if (input["format"] === "text") {
          const text = await scrubbed(tabId, snap.text);
          return { url: maskUrl(snap.url), title: snap.title, tree: text.slice(0, 60_000), truncated: text.length > 60_000 };
        }
        const { tree, truncated } = publish(tabId, snap);
        return { url: maskUrl(snap.url), title: snap.title, tree, truncated };
      });
    },

    async chrome_act(call, input, note) {
      const action = String(input["action"]);
      return drive(call, input, async (tabId) => {
        if (action === "press") {
          const key = String(input["value"] ?? "");
          if (!key) fail("bad_input", "press needs a key in value, such as Enter or Control+A.");
          /** @type {import("./snapshot.js").Control | undefined} */
          let ctl;
          if (input["ref"]) { const b = await bind(tabId, String(input["ref"])); if (!b.control) return miss(b.why); ctl = b.control; await focusControl(tabId, ctl); } else ctl = (await look(tabId)).controls.find((c) => c.focused);
          note(`pressed ${key}`);
          return pressKey(call, tabId, key, ctl);
        }
        if (action === "scroll") {
          let idx = null;
          if (input["ref"]) { const b = await bind(tabId, String(input["ref"])); if (!b.control) return miss(b.why); idx = b.control.idx; }
          const r = await evalPage(tabId, scrollTo, idx, String(input["value"] ?? "down"));
          note(`scrolled ${input["value"] ?? "down"}`);
          if (!r) return { ok: false, why: "That control is gone." };
          return { ok: true, why: r.moved ? (r.atEnd ? "scrolled to the end" : "scrolled") : "already at the end" };
        }
        if (!input["ref"]) fail("bad_input", `${action} needs a ref from chrome_snapshot.`);
        const ref = String(input["ref"]);
        if (action === "focus") { const b = await bind(tabId, ref); if (!b.control) return miss(b.why); await focusControl(tabId, b.control); note(`focused ${label(b.control)}`); return { ok: true }; }
        if (action === "select") {
          const b = await bind(tabId, ref);
          if (!b.control) return miss(b.why);
          await focusControl(tabId, b.control);
          const r = await evalPage(tabId, selectOption, b.control.idx, String(input["value"] ?? ""));
          note(`selected ${JSON.stringify(input["value"] ?? "")}`);
          return r && r.ok ? { ok: true, why: `selected ${JSON.stringify(r.label)}` } : { ok: false, why: String(r?.why ?? "could not select") };
        }
        const b = await bind(tabId, ref);
        if (!b.control) return miss(b.why);
        note(`${action} ${label(b.control)}`);
        const sel = b.sel;
        if (action === "hover") return pressControl(call, tabId, sel, { verb: "hover" });
        if (action === "check" || action === "uncheck") return pressControl(call, tabId, sel, { verb: "click", wantChecked: action === "check" });
        return pressControl(call, tabId, sel, { verb: "click", double: action === "double_click" });
      });
    },

    async chrome_click(call, input, note) {
      return drive(call, input, async (tabId) => {
        const button = input["button"] ?? "left";
        if (input["ref"]) {
          const b = await bind(tabId, String(input["ref"]));
          if (!b.control) return miss(b.why);
          note(`click ${label(b.control)}`);
          return pressControl(call, tabId, b.sel, { verb: "click", button });
        }
        if (typeof input["x"] !== "number" || typeof input["y"] !== "number") fail("bad_input", "Give a ref, or both x and y.");
        const x = Math.round(input["x"]);
        const y = Math.round(input["y"]);
        // A click by coordinates is classified by what is under the point.
        const under = await evalPage(tabId, pointInfo, x, y);
        if (under && under.actionable) {
          const v = consequence.of({ name: under.name, nameless: under.nameless, role: under.role, submit: under.submit, href: under.href });
          if (v.consequential) {
            const heldId = sessions.hold(call, tabId, { kind: v.kind, why: v.why, summary: `${v.kind}: click at ${x},${y} on ${bareUrl((await ext.tabs.get(tabId)).url ?? "")}`, selector: null, action: { type: "click", button, double: false } });
            return { ok: false, heldId, why: `${v.why}. It is held until the person approves it.` };
          }
        }
        note(`click at ${x},${y}`);
        await sessions.cursor(tabId, x, y, true);
        const nav = marks(tabId);
        await mouse(tabId, "mouseMoved", x, y);
        await mouse(tabId, "mousePressed", x, y, button, 1);
        await mouse(tabId, "mouseReleased", x, y, button, 1);
        await settle(tabId, nav);
        return { ok: true };
      });
    },

    async chrome_type(call, input, note) {
      return drive(call, input, async (tabId) => {
        const text = String(input["text"]);
        const r = await writeText(call, tabId, input["ref"] ? String(input["ref"]) : undefined, text, false);
        note(HANDLE.test(text) ? "filled from the Vault" : `typed ${text.length} characters`);
        if (!r.ok || input["submit"] !== true) return { ok: r.ok, ...(r.why ? { why: r.why } : {}) };
        const ctl = (await look(tabId)).controls.find((c) => c.focused);
        const sent = await pressKey(call, tabId, "Enter", ctl);
        return { ok: true, ...(sent.heldId ? { heldId: sent.heldId, why: sent.why } : {}), ...(sent.snapshot ? { snapshot: sent.snapshot } : {}) };
      });
    },

    async chrome_fill(call, input, note) {
      const fields = /** @type {any[]} */ (input["fields"]);
      if (!fields.length) fail("bad_input", "fields needs at least one { ref, value }.");
      return drive(call, input, async (tabId) => {
        let filled = 0;
        for (const f of fields) {
          if (!f || typeof f.ref !== "string" || typeof f.value !== "string") fail("bad_input", "Each field is { ref, value } with both as text.");
          const r = await writeText(call, tabId, f.ref, f.value, true);
          if (!r.ok) { note(`filled ${filled} of ${fields.length}`); return { ok: false, filled, why: r.why }; }
          filled++;
        }
        note(`filled ${filled} fields`);
        return { ok: true, filled };
      });
    },

    async chrome_open(call, input, note) {
      const url = String(input["url"]);
      if (!/^https?:\/\//i.test(url)) fail("bad_input", `${JSON.stringify(url)} is not an http(s) address.`);
      if (!isPublicUrl(url)) fail("not_public");
      /** @type {number} */
      let tabId;
      const current = input["newTab"] === true ? null : sessions.currentTab(call.agent.id);
      if (current !== null) {
        try { const t = await ext.tabs.get(current); tabId = drivable(t.url) ? current : await newTab(call, url, false); } catch { tabId = await newTab(call, url, false); }
      } else if (input["newTab"] !== true && kit.mode() === "computer") {
        const [t] = await ext.tabs.query({ active: true, currentWindow: true });
        tabId = t && t.id !== undefined && drivable(t.url) ? t.id : await newTab(call, url, false);
        sessions.own(call.agent.id, tabId);
        sessions.setCurrent(call.agent.id, tabId);
      } else tabId = await newTab(call, url, false);
      await sessions.begin(call, tabId);
      try { await cdp.attach(tabId); } catch (e) { await sessions.release(tabId, "denied"); throw e; }
      try {
        const loaded = cdp.waitFor(tabId, (m) => m === "Page.loadEventFired", 20_000);
        const nav = await cdp.send(tabId, "Page.navigate", { url });
        if (nav && nav.errorText) { note(`could not open ${bareUrl(url)}`); fail("error", `The page did not open: ${String(nav.errorText).slice(0, 80)}`); }
        if (!(await loaded)) fail("timeout");
        const tab = await ext.tabs.get(tabId);
        // A redirect or a script may have taken the tab somewhere inside: check where it landed, and leave it on a blank page.
        if (tab.url && /^https?:/.test(tab.url) && !isPublicUrl(tab.url)) {
          await cdp.send(tabId, "Page.navigate", { url: "about:blank" }).catch(() => null);
          note("landed on a non-public address");
          fail("not_public");
        }
        note(bareUrl(url));
        return { tabId: String(tabId), url: maskUrl(String(tab.url ?? url)), title: String(tab.title ?? "") };
      } finally { sessions.touch(tabId); }
    },

    async chrome_tabs(call, input, note) {
      const agentId = call.agent.id;
      const action = String(input["action"]);
      /** @param {number} id */
      const row = async (id) => {
        try {
          const t = await ext.tabs.get(id);
          return { tabId: String(id), url: maskUrl(String(t.url ?? "")), title: String(t.title ?? ""), active: sessions.currentTab(agentId) === id };
        } catch { await sessions.tabGone(id); return null; }
      };
      if (action === "list") {
        const rows = [];
        for (const id of sessions.ownedTabs(agentId)) { const r = await row(id); if (r) rows.push(r); }
        note(`${rows.length} tabs`);
        return { tabs: rows };
      }
      if (action === "new") {
        const url = input["url"] ? String(input["url"]) : "about:blank";
        const id = await newTab(call, url, false);
        if (url !== "about:blank") { await sessions.begin(call, id); await cdp.attach(id); await cdp.send(id, "Page.navigate", { url }); sessions.touch(id); }
        note(`opened a tab`);
        const rows = [];
        for (const t of sessions.ownedTabs(agentId)) { const r = await row(t); if (r) rows.push(r); }
        return { tabs: rows };
      }
      const id = input["tabId"] !== undefined ? Number(input["tabId"]) : sessions.currentTab(agentId);
      if (id === null || !Number.isInteger(id)) fail("no_tab");
      if (action === "use") {
        await mayUse(call, /** @type {number} */ (id));
        sessions.own(agentId, /** @type {number} */ (id));
        sessions.setCurrent(agentId, /** @type {number} */ (id));
        note(`using tab ${id}`);
      } else {
        await mayUse(call, /** @type {number} */ (id), { owned: true });
        await sessions.release(/** @type {number} */ (id), "closed");
        await ext.tabs.remove(id);
        await sessions.tabGone(/** @type {number} */ (id));
        note(`closed tab ${id}`);
      }
      const rows = [];
      for (const t of sessions.ownedTabs(agentId)) { const r = await row(t); if (r) rows.push(r); }
      return { tabs: rows };
    },

    async chrome_wait(call, input, note) {
      const until = String(input["until"]);
      const timeout = Math.max(100, Math.min(120_000, Number(input["timeoutMs"] ?? 10_000)));
      return drive(call, input, async (tabId) => {
        const t0 = now();
        if (until === "time") {
          const ms = Math.max(0, Math.min(timeout, Number(input["value"] ?? 0)));
          await sleep(ms);
          note(`waited ${ms} ms`);
          return { ok: true, waitedMs: ms };
        }
        if ((until === "text" || until === "selector") && !input["value"]) fail("bad_input", `wait for ${until} needs a value.`);
        let quietSince = now();
        for (;;) {
          let done = false;
          if (until === "network_idle") { if (traffic.inflight(tabId) > 0) quietSince = now(); done = now() - quietSince >= 500; } else done = Boolean(await evalPage(tabId, probe, until, String(input["value"] ?? "")));
          if (done) { note(`${until} reached`); return { ok: true, waitedMs: now() - t0 }; }
          if (now() - t0 >= timeout) { note(`${until} not reached`); return { ok: false, waitedMs: now() - t0 }; }
          await sleep(100);
        }
      });
    },

    async chrome_screenshot(call, input, note) {
      return drive(call, input, async (tabId) => {
        /** @type {Record<string, any>} */
        const params = { format: "png" };
        let width = 0;
        let height = 0;
        if (input["ref"]) {
          const b = await bind(tabId, String(input["ref"]));
          if (!b.control) return fail("unknown_ref", "That control moved since you looked. Take a new snapshot.");
          const rect = await evalPage(tabId, revealElement, b.control.idx);
          if (!rect) return fail("no_element");
          width = Math.max(1, Math.round(rect.w));
          height = Math.max(1, Math.round(rect.h));
          params["clip"] = { x: rect.x + rect.sx, y: rect.y + rect.sy, width, height, scale: 1 };
          params["captureBeyondViewport"] = true;
        } else {
          const m = await cdp.send(tabId, "Page.getLayoutMetrics");
          if (input["fullPage"] === true) {
            const size = m.cssContentSize ?? m.contentSize ?? { width: 1280, height: 800 };
            width = Math.round(size.width);
            height = Math.min(16_000, Math.round(size.height));
            params["clip"] = { x: 0, y: 0, width, height, scale: 1 };
            params["captureBeyondViewport"] = true;
          } else {
            const v = m.cssVisualViewport ?? m.visualViewport ?? { clientWidth: 1280, clientHeight: 800 };
            width = Math.round(v.clientWidth);
            height = Math.round(v.clientHeight);
          }
        }
        await evalPage(tabId, blurSecrets, true);
        try {
          const shot = await cdp.send(tabId, "Page.captureScreenshot", params);
          note(`captured ${width}x${height}`);
          return { image: String(shot.data), mime: "image/png", width, height };
        } finally { await evalPage(tabId, blurSecrets, false).catch(() => null); }
      });
    },

    async chrome_eval(call, input, note) {
      return drive(call, input, async (tabId) => {
        const r = await cdp.send(tabId, "Runtime.evaluate", { expression: String(input["expression"]), returnByValue: true, awaitPromise: true, userGesture: false });
        if (r.exceptionDetails) {
          note("the expression threw");
          fail("page_error", scrub(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "the expression threw"));
        }
        const value = r.result ? r.result.value : undefined;
        const json = value === undefined ? "null" : JSON.stringify(value);
        let parsed;
        try { parsed = JSON.parse(await scrubbed(tabId, json)); } catch { parsed = null; }
        note("evaluated an expression");
        return { result: maskJson(parsed) };
      });
    },

    async chrome_console(call, input, note) {
      return drive(call, input, async (tabId) => {
        const lines = traffic.console(tabId, input["level"], input["limit"]);
        const clean = lines.length ? (await scrubbed(tabId, lines.map((l) => l.text).join("\u0000"))).split("\u0000") : [];
        const messages = lines.map((l, i) => ({ level: l.level, text: clean[i] ?? "", at: l.at }));
        note(`${messages.length} messages`);
        return { messages };
      });
    },

    async chrome_net(call, input, note) {
      return drive(call, input, async (tabId) => {
        const list = traffic.requests(tabId, { filter: input["filter"], limit: input["limit"] });
        let bodies = 0;
        const requests = [];
        for (const r of list) {
          const row = /** @type {Record<string, any>} */ (traffic.present(r));
          if (input["bodies"] === true && r.finished && !r.failed && bodies < 10 && /^(XHR|Fetch|Document)$/.test(r.type)) {
            bodies++;
            try {
              const got = await cdp.send(tabId, "Network.getResponseBody", { requestId: r.id });
              if (got && !got.base64Encoded) row["body"] = await scrubbed(tabId, maskBody(String(got.body ?? ""), r.mime ?? ""));
            } catch { /* the body is gone or was never kept */ }
          }
          const sent = traffic.sentBody(r);
          if (input["bodies"] === true && sent !== undefined) row["requestBody"] = await scrubbed(tabId, sent);
          requests.push(row);
        }
        note(`${requests.length} requests`);
        return { requests };
      });
    },

    async chrome_inspect(call, input, note) {
      return drive(call, input, async (tabId) => {
        const b = await bind(tabId, String(input["ref"]));
        if (!b.control) return fail("unknown_ref", "That control moved since you looked. Take a new snapshot.");
        const el = await evalPage(tabId, describeElement, b.control.idx);
        if (!el) return fail("no_element");
        note(`inspected ${label(b.control)}`);
        return { element: { ...el, name: b.control.name ?? "", role: b.control.role, enabled: b.control.enabled, ...(b.control.secret ? { secret: true } : {}) } };
      });
    },

    async chrome_state(call, input, note) {
      const tabId = await tabFor(call, input);
      const t = await ext.tabs.get(tabId);
      note(`${t.status ?? "complete"}`);
      return { url: maskUrl(String(t.url ?? "")), title: String(t.title ?? ""), loading: t.status === "loading" };
    },

    async chrome_status(call) {
      const p = sessions.pausedFor(call.agent.id);
      return { connected: kit.connected(call), paused: Boolean(p), held: sessions.heldIds(call.agent.id), ...(p ? { pausedBy: p.by } : {}) };
    },

    async chrome_stop(call, input, note) {
      await sessions.pause(call.agent.id, "tool", input["reason"]);
      note(input["reason"] ? `stopped: ${input["reason"]}` : "stopped");
      return { stopped: true };
    },

    async chrome_resume(call, _input, note) {
      const was = await sessions.resume(call.agent.id);
      note(was ? "resumed" : "was not stopped");
      return { resumed: true };
    },

    async chrome_send(call, input, note) {
      const h = sessions.take(call, String(input["heldId"]));
      note(`sent held ${h.kind}`);
      return drive(call, { tabId: String(h.tabId) }, async (tabId) => {
        if (h.action.type === "click") {
          if (!h.selector) {
            // A click by coordinates was held without a control to re-bind: it cannot be replayed safely.
            return { sent: false, why: "A click by coordinates cannot be replayed. Click the control by ref." };
          }
          const r = await pressControl(call, tabId, h.selector, { verb: "click", button: h.action.button, double: h.action.double, mode: "approved" });
          return { sent: Boolean(r.pressed), ...(r.why ? { why: r.why } : {}) };
        }
        /** @type {import("./snapshot.js").Control | undefined} */
        let ctl;
        if (h.selector) {
          const snap = await look(tabId);
          const r = selector.resolve(h.selector, snap.controls);
          if (!r.control) return { sent: false, ...miss(r.why) };
          ctl = r.control;
          await focusControl(tabId, ctl);
        }
        const r = await pressKey(call, tabId, h.action.key, ctl, "approved");
        return { sent: Boolean(r.pressed) };
      });
    },

    async chrome_batch(call, input, note) {
      const steps = /** @type {any[]} */ (input["steps"]);
      if (!steps.length || steps.length > 50) fail("bad_input", "A batch has 1 to 50 steps.");
      /** @type {{ tool: string, ok: boolean, result?: unknown, heldId?: string }[]} */
      const results = [];
      for (const s of steps) {
        const tool = s && typeof s.tool === "string" ? s.tool : "";
        if (!BATCHABLE.has(tool)) { results.push({ tool, ok: false, result: { error: errorOf(new AgentFailure("not_in_batch", "")) } }); break; }
        const args = { ...(input["tabId"] !== undefined && tool !== "chrome_status" && tool !== "chrome_plan" ? { tabId: input["tabId"] } : {}), ...(s.args && typeof s.args === "object" ? s.args : {}) };
        if (tool === "chrome_api" && String(args["method"] ?? "GET") !== "GET") { results.push({ tool, ok: false, result: { error: errorOf(new AgentFailure("not_in_batch", "")) } }); break; }
        try {
          const out = await run({ ...call, tool, input: args }, true);
          const ok = !(out && out.ok === false);
          results.push({ tool, ok, result: out, ...(out && out.heldId ? { heldId: out.heldId } : {}) });
          if (!ok || (out && out.heldId)) break;
        } catch (e) {
          results.push({ tool, ok: false, result: { error: errorOf(e) } });
          break;
        }
      }
      note(`${results.length} of ${steps.length} steps`);
      return { results };
    },

    async chrome_plan(call, input, note) {
      const steps = Array.isArray(input["steps"]) ? input["steps"].filter((/** @type {unknown} */ s) => typeof s === "string").slice(0, 20).map(scrub) : [];
      kit.emit({ event: "plan", agent: call.agent.id, goal: scrub(input["goal"]), steps });
      await sessions.setGoal(call.agent, scrub(input["goal"]));
      note(scrub(input["goal"]));
      return { ok: true };
    },

    async chrome_api(call, input, note) {
      return drive(call, input, async (tabId) => {
        const tab = await ext.tabs.get(tabId);
        let target;
        try { target = new URL(String(input["url"]), String(tab.url)); } catch { return fail("bad_input", "That is not an address."); }
        if (!/^https?:$/.test(target.protocol)) fail("bad_input", "chrome_api takes http(s) addresses.");
        if (target.origin !== new URL(String(tab.url)).origin) fail("cross_origin");
        const method = String(input["method"]);
        /** @type {Record<string, string>} */
        const headers = {};
        for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (input["headers"] ?? {}))) {
          if (typeof v !== "string") fail("bad_input", `header ${k} must be text.`);
          if (HANDLE.test(String(v).replace(/^(Bearer|Basic)\s+/i, ""))) fail("handle_unsupported");
          if (!FORBIDDEN_HEADERS.test(k)) headers[k] = /** @type {string} */ (v);
        }
        let body = null;
        if (method !== "GET" && input["body"] !== undefined && input["body"] !== null) {
          if (typeof input["body"] === "string") body = input["body"];
          else { body = JSON.stringify(input["body"]); if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) headers["content-type"] = "application/json"; }
        }
        const res = await evalPage(tabId, pageRequest, { method, url: target.toString(), headers, body, max: MAX_BODY });
        note(`${method} ${bareUrl(target.toString())} -> ${res?.status ?? 0}`);
        if (!res || typeof res !== "object") fail("error", "The page did not answer.");
        let out;
        if (/json/i.test(res.mime)) { try { out = maskJson(JSON.parse(await scrubbed(tabId, String(res.body)))); } catch { out = maskBody(await scrubbed(tabId, String(res.body)), res.mime, MAX_BODY); } } else out = maskBody(await scrubbed(tabId, String(res.body)), res.mime, MAX_BODY);
        return { status: Number(res.status), headers: maskHeaders(res.headers), body: out, ...(res.truncated ? { truncated: true } : {}) };
      });
    },

    async chrome_sources(call, input, note) {
      return drive(call, input, async (tabId) => {
        const s = traffic.sources(tabId);
        note(`${s.endpoints.length} endpoints`);
        return s;
      });
    },
  };

  /**
   * Run one tool call: check it, gate it, do it, log it under the agent.
   * @param {Call} call @param {boolean} [nested] a step of chrome_batch: already authorized
   */
  async function run(call, nested = false) {
    const input = checkInput(call.tool, call.input);
    if (!nested && call.tool !== "chrome_status") {
      await kit.authorize(call);
      if (!ALLOWED_WHILE_PAUSED.has(call.tool) && sessions.pausedFor(call.agent.id)) fail("paused");
    }
    const impl = table[call.tool];
    if (!impl) return fail("unknown_tool");
    let summary = "";
    let ok = true;
    try {
      const out = await impl({ ...call, input }, input, (s) => { summary = scrub(s); });
      ok = !(out && out.ok === false);
      return out;
    } catch (e) {
      ok = false;
      summary = summary || scrub(errorOf(e).message);
      throw e;
    } finally {
      if (call.tool !== "chrome_status") kit.emit({ event: "acted", agent: call.agent.id, tool: call.tool, ok, summary });
    }
  }

  return { run, tools: Object.keys(table), look, tabFor };
}

