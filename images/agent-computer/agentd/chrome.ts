// The browser of the agent computer: Chromium on the Xvfb display with its profile on the profile disk, driven over the DevTools Protocol (cdp.ts). The tools here are the Chrome tools of
// modules/computers (handlers/tools/chrome.ts) that agentd answers itself: open, tabs, state, status, snapshot with refs, click, type, fill, act, wait, screenshot, eval, plan, stop, resume, send.
// What it does not answer yet (none now) and a #Handle.field is filled by main.ts from the host (vault.ts).
//
// Outward acts are held, not done: a click on something that sends, posts, pays or deletes answers with a heldId, and only chrome_send (behind the Gate) does it.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { connectCdp } from "./cdp.ts";
import type { Cdp } from "./cdp.ts";
import { AgentError, badInput, notFound, paused, sleep, unavailable } from "./errors.ts";
import { browserBounds } from "./desktop.ts";
import type { Screen } from "./x11.ts";

const PORT = 9222;
const BASE = `http://127.0.0.1:${PORT}`;
const OUTWARD = "\\b(send|post|publish|submit order|pay|purchase|buy now|place order|checkout|confirm payment|delete|remove account|transfer|donate)\\b";
const HOLD_TTL_MS = 15 * 60_000;

export interface ChromeState {
  /** Pause the browser tools (Esc, or a person at the controls). */
  stopped: boolean;
  tabLimit: number;
}

interface Target { id: string; type: string; url: string; title: string; webSocketDebuggerUrl?: string }
interface Held { run: () => Promise<void>; what: string; at: number }

export interface Chrome {
  ready(): Promise<void>;
  alive(): boolean;
  tabs(): Promise<Target[]>;
  tool(name: string, args: Record<string, unknown>, state: ChromeState): Promise<Record<string, unknown>>;
  /** For sessions and sign-out: a connection to any page target. */
  page(): Promise<Cdp>;
  heldIds(): string[];
  /** Is Vyre for Chrome loaded: the flag it was started with, and its running workers. */
  extension(): Promise<{ configured: boolean; workers: number }>;
  stop(): void;
}

async function getJson<T>(path: string, method = "GET"): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { method });
  if (!r.ok) throw unavailable(`the browser answered ${r.status} to ${path}`);
  const text = await r.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export function launchChrome(screen: Screen, profileDir: string, extensionDir: string | null, log: (m: string) => void): Chrome {
  let proc: ChildProcess | null = null;
  let up: Promise<void> | null = null;
  let active: string | null = null;
  const held = new Map<string, Held>();
  let heldN = 0;

  const start = (): Promise<void> => {
    if (up) return up;
    up = (async () => {
      for (const f of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) { try { rmSync(join(profileDir, f), { force: true }); } catch { /* not there */ } }
      const bounds = browserBounds(screen);
      const args = [
        "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", `--user-data-dir=${profileDir}`, `--remote-debugging-port=${PORT}`, "--remote-debugging-address=127.0.0.1",
        `--window-position=${bounds.x},${bounds.y}`, `--window-size=${bounds.width},${bounds.height}`, "--no-first-run", "--test-type", "--no-default-browser-check", "--password-store=basic", "--disable-features=Translate,MediaRouter",
        ...(extensionDir && existsSync(join(extensionDir, "manifest.json")) ? [`--load-extension=${extensionDir}`] : []),
        "about:blank",
      ];
      const p = spawn("chromium", args, { env: { ...process.env, DISPLAY: screen.display }, stdio: ["ignore", "ignore", "pipe"] });
      proc = p;
      p.stderr!.on("data", (c: Buffer) => { const t = c.toString("utf8").trim(); if (/error|fatal/i.test(t)) log(`chromium: ${t.slice(0, 300)}`); });
      p.on("exit", () => { if (proc === p) proc = null; up = null; });
      for (let i = 0; i < 300; i++) {
        if (p.exitCode !== null) throw unavailable("the browser exited while starting");
        try { await getJson("/json/version"); return; } catch { await sleep(100); }
      }
      throw unavailable("the browser did not start in 30 seconds");
    })();
    up.catch(() => { up = null; });
    return up;
  };

  // What a tab logged, from the first time a tool touched it: console messages and network requests. Kept small; the oldest go first.
  interface Log { console: Array<{ level: string; text: string; at: number }>; net: Array<{ id: string; url: string; method: string; status?: number; type?: string; at: number }>; conn: Cdp }
  const logs = new Map<string, Log>();
  const watch = async (t: Target): Promise<Log> => {
    const have = logs.get(t.id);
    if (have) return have;
    const conn = await connect(t);
    const log: Log = { console: [], net: [], conn };
    logs.set(t.id, log);
    conn.on("Runtime.consoleAPICalled", (p) => {
      const args = (p["args"] as Array<{ value?: unknown; description?: string }> | undefined) ?? [];
      log.console.push({ level: String(p["type"]), text: args.map((a) => (a.value !== undefined ? String(a.value) : a.description ?? "")).join(" ").slice(0, 2000), at: Date.now() });
      if (log.console.length > 500) log.console.shift();
    });
    conn.on("Network.requestWillBeSent", (p) => {
      const r = p["request"] as { url: string; method: string };
      log.net.push({ id: String(p["requestId"]), url: r.url.slice(0, 2000), method: r.method, type: String(p["type"] ?? ""), at: Date.now() });
      if (log.net.length > 500) log.net.shift();
    });
    conn.on("Network.responseReceived", (p) => {
      const e = log.net.find((x) => x.id === p["requestId"]);
      if (e) e.status = (p["response"] as { status: number }).status;
    });
    await conn.send("Runtime.enable");
    await conn.send("Network.enable");
    return log;
  };

  const targets = async (): Promise<Target[]> => (await getJson<Target[]>("/json/list")).filter((t) => t.type === "page");
  const pick = async (tabId: unknown): Promise<Target> => {
    const all = await targets();
    const id = typeof tabId === "string" && tabId !== "" ? tabId : active ?? all[0]?.id;
    const t = all.find((x) => x.id === id) ?? (typeof tabId === "string" && tabId !== "" ? undefined : all[0]);
    if (!t) throw notFound(typeof tabId === "string" && tabId !== "" ? `There is no tab ${tabId}.` : "There is no open tab.");
    return t;
  };
  const connect = async (t: Target): Promise<Cdp> => {
    if (!t.webSocketDebuggerUrl) throw unavailable("that tab cannot be controlled");
    return connectCdp(t.webSocketDebuggerUrl);
  };
  const withTab = async <T>(tabId: unknown, f: (c: Cdp, t: Target) => Promise<T>): Promise<T> => {
    const t = await pick(tabId);
    await watch(t).catch(() => undefined);
    const c = await connect(t);
    try { return await f(c, t); } finally { c.close(); }
  };

  const evalIn = async <T>(c: Cdp, expression: string): Promise<T> => {
    const r = await c.send<{ result?: { value?: T }; exceptionDetails?: { text?: string; exception?: { description?: string } } }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw badInput(`the page raised: ${(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "an error").slice(0, 300)}`);
    return r.result?.value as T;
  };

  /** The element of a ref, scrolled into view, with where its middle is, and whether acting on it would send something out. */
  const locate = async (c: Cdp, ref: string): Promise<{ x: number; y: number; outward: boolean; label: string }> => {
    const r = await evalIn<{ x: number; y: number; outward: boolean; label: string } | null>(c, `(() => {
      const el = document.querySelector('[data-vyre-ref=${JSON.stringify(ref)}]');
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      const b = el.getBoundingClientRect();
      const label = (el.getAttribute("aria-label") || el.innerText || el.value || el.title || el.name || "").trim().slice(0, 120);
      const form = el.closest("form");
      const text = label + " " + (el.getAttribute("type") || "") + " " + (el.getAttribute("name") || "") + " " + (form ? (form.getAttribute("aria-label") || "") : "");
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), outward: new RegExp(${JSON.stringify(OUTWARD)}, "i").test(text), label };
    })()`);
    if (!r) throw notFound(`There is no element ${ref} on this page. Take a new snapshot.`);
    return r;
  };

  const mouse = async (c: Cdp, x: number, y: number, button = "left", count = 1): Promise<void> => {
    await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: count });
    await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: count });
  };
  const key = async (c: Cdp, name: string): Promise<void> => {
    const KEYS: Record<string, { key: string; code: string; vk: number; text?: string }> = {
      Enter: { key: "Enter", code: "Enter", vk: 13, text: "\r" }, Tab: { key: "Tab", code: "Tab", vk: 9 }, Escape: { key: "Escape", code: "Escape", vk: 27 },
      Backspace: { key: "Backspace", code: "Backspace", vk: 8 }, ArrowDown: { key: "ArrowDown", code: "ArrowDown", vk: 40 }, ArrowUp: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
      ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 }, ArrowRight: { key: "ArrowRight", code: "ArrowRight", vk: 39 }, Delete: { key: "Delete", code: "Delete", vk: 46 },
    };
    const k = KEYS[name];
    if (!k) { if (name.length === 1) { await c.send("Input.insertText", { text: name }); return; } throw badInput(`I do not know the key ${name}. Use Enter, Tab, Escape, Backspace, Delete, an arrow key or one character.`); }
    const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk };
    await c.send("Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...base, ...(k.text ? { text: k.text } : {}) });
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  };

  const hold = (what: string, run: () => Promise<void>): string => {
    for (const [id, h] of held) if (Date.now() - h.at > HOLD_TTL_MS) held.delete(id);
    const id = `hld_${Date.now().toString(36)}${(++heldN).toString(36)}`;
    held.set(id, { run, what, at: Date.now() });
    return id;
  };

  const SNAPSHOT = (selector: string, tree: boolean): string => `(() => {
    const root = document.querySelector(${JSON.stringify(selector)}) || document.body;
    if (!${tree}) { const t = (root.innerText || "").replace(/\\n{3,}/g, "\\n\\n"); return { text: t.slice(0, 40000), truncated: t.length > 40000 }; }
    window.__vyreRef = window.__vyreRef || 0;
    const seen = new Set(); const lines = [];
    const visible = (el) => { const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return b.width > 0 && b.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const nameOf = (el) => (el.getAttribute("aria-label") || (el.labels && el.labels[0] && el.labels[0].innerText) || el.placeholder || el.alt || el.title || el.innerText || el.value || "").replace(/\\s+/g, " ").trim().slice(0, 80);
    const roleOf = (el) => { const r = el.getAttribute("role"); if (r) return r; const t = el.tagName.toLowerCase();
      if (t === "a") return "link"; if (t === "button") return "button"; if (t === "select") return "combobox"; if (t === "textarea") return "textbox";
      if (t === "input") { const y = (el.type || "text").toLowerCase(); return y === "checkbox" ? "checkbox" : y === "radio" ? "radio" : (y === "submit" || y === "button") ? "button" : "textbox"; }
      if (/^h[1-6]$/.test(t)) return "heading"; return t; };
    const SEL = "a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=checkbox], [role=tab], [role=menuitem], [contenteditable=true], h1, h2, h3, h4, label";
    for (const el of root.querySelectorAll(SEL)) {
      if (seen.has(el) || !visible(el)) continue; seen.add(el);
      const role = roleOf(el); let ref = "";
      if (role !== "heading" && el.tagName !== "LABEL") { ref = el.getAttribute("data-vyre-ref") || ("e" + (++window.__vyreRef)); el.setAttribute("data-vyre-ref", ref); }
      else if (el.tagName === "LABEL") continue;
      const extra = el.tagName === "A" ? " href=" + (el.getAttribute("href") || "") : (el.value && el.type !== "password" ? " value=" + JSON.stringify(String(el.value).slice(0, 60)) : "") + (el.checked ? " checked" : "");
      lines.push("- " + role + ' "' + nameOf(el) + '"' + (ref ? " [ref=" + ref + "]" : "") + extra);
      if (lines.length >= 600) break;
    }
    return { text: lines.join("\\n"), truncated: lines.length >= 600 };
  })()`;

  const waitFor = async (c: Cdp, until: string, value: string | undefined, timeoutMs: number): Promise<number> => {
    const t0 = Date.now();
    if (until === "time") { await sleep(Number(value)); return Date.now() - t0; }
    for (;;) {
      let ok = false;
      if (until === "load" || until === "network_idle") ok = (await evalIn<string>(c, "document.readyState")) === "complete";
      else if (until === "text") ok = await evalIn<boolean>(c, `(document.body && document.body.innerText || "").includes(${JSON.stringify(value ?? "")})`);
      else if (until === "selector") ok = await evalIn<boolean>(c, `!!document.querySelector(${JSON.stringify(value ?? "")})`);
      else throw badInput(`I cannot wait for ${until}.`);
      if (ok) { if (until === "network_idle") await sleep(500); return Date.now() - t0; }
      if (Date.now() - t0 > timeoutMs) throw new AgentError("timeout", `Waited ${Math.round(timeoutMs / 1000)} seconds for ${until}.`);
      await sleep(150);
    }
  };

  const pngSize = (b: Buffer): { width: number; height: number } => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) });

  async function tool(name: string, args: Record<string, unknown>, state: ChromeState): Promise<Record<string, unknown>> {
        if (name === "chrome_status") return { connected: proc !== null && proc.exitCode === null, paused: state.stopped, held: [...held.keys()] };
    if (name === "chrome_stop") { state.stopped = true; return { stopped: true }; }
    if (name === "chrome_resume") { const was = state.stopped; state.stopped = false; return { resumed: was }; }
    if (state.stopped) throw paused("The browser is stopped. Resume it first.");
    if (name === "chrome_plan") return { ok: true };
    await start();
    const s = (k: string): string | undefined => (typeof args[k] === "string" ? (args[k] as string) : undefined);
    const tabId = s("tabId");

    switch (name) {
      case "chrome_open": {
        const url = s("url") ?? "";
        const all = await targets();
        const newTab = args["newTab"] === true || all.length === 0;
        if (newTab && all.length >= state.tabLimit) throw badInput(`This computer has ${all.length} tabs open, which is its limit. Close one first.`);
        if (newTab) {
          const t = await getJson<Target>(`/json/new?${encodeURIComponent(url)}`, "PUT");
          active = t.id;
          const out = await withTab(t.id, async (c) => { await waitFor(c, "load", undefined, 30_000).catch(() => 0); return { url: await evalIn<string>(c, "location.href"), title: await evalIn<string>(c, "document.title") }; });
          return { tabId: t.id, ...out };
        }
        return withTab(tabId, async (c, t) => {
          active = t.id;
          await c.send("Page.enable");
          await c.send("Page.navigate", { url });
          await sleep(100);
          await waitFor(c, "load", undefined, 30_000).catch(() => 0);
          return { tabId: t.id, url: await evalIn<string>(c, "location.href"), title: await evalIn<string>(c, "document.title") };
        });
      }
      case "chrome_tabs": {
        const action = s("action") ?? "list";
        if (action === "use") { const t = await pick(tabId); await getJson(`/json/activate/${t.id}`); active = t.id; }
        else if (action === "close") { const t = await pick(tabId); await getJson(`/json/close/${t.id}`); if (active === t.id) active = null; }
        else if (action === "new") {
          const all = await targets();
          if (all.length >= state.tabLimit) throw badInput(`This computer has ${all.length} tabs open, which is its limit. Close one first.`);
          const t = await getJson<Target>(`/json/new?${encodeURIComponent(s("url") ?? "about:blank")}`, "PUT");
          active = t.id;
        } else if (action !== "list") throw badInput(`I cannot ${action} tabs.`);
        await sleep(action === "list" ? 0 : 150);
        const all = await targets();
        return { tabs: all.map((t) => ({ tabId: t.id, url: t.url, title: t.title, active: t.id === (active ?? all[0]?.id) })) };
      }
      case "chrome_state":
        return withTab(tabId, async (c) => ({ url: await evalIn<string>(c, "location.href"), title: await evalIn<string>(c, "document.title"), loading: (await evalIn<string>(c, "document.readyState")) !== "complete" }));
      case "chrome_snapshot": {
        const tree = (s("format") ?? "tree") === "tree";
        return withTab(tabId, async (c) => {
          const r = await evalIn<{ text: string; truncated: boolean }>(c, SNAPSHOT(s("selector") ?? "body", tree));
          return { url: await evalIn<string>(c, "location.href"), title: await evalIn<string>(c, "document.title"), tree: r.text, truncated: r.truncated };
        });
      }
      case "chrome_screenshot":
        return withTab(tabId, async (c) => {
          const params: Record<string, unknown> = { format: "png" };
          if (typeof args["ref"] === "string") {
            const r = await evalIn<{ x: number; y: number; width: number; height: number } | null>(c, `(() => { const el = document.querySelector('[data-vyre-ref=${JSON.stringify(args["ref"])}]'); if (!el) return null; el.scrollIntoView({block:"center"}); const b = el.getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height }; })()`);
            if (!r) throw notFound(`There is no element ${String(args["ref"])} on this page.`);
            params["clip"] = { ...r, scale: 1 };
            params["captureBeyondViewport"] = true;
          } else if (args["fullPage"] === true) {
            const m = await c.send<{ cssContentSize?: { width: number; height: number } }>("Page.getLayoutMetrics");
            if (m.cssContentSize) { params["clip"] = { x: 0, y: 0, width: m.cssContentSize.width, height: Math.min(m.cssContentSize.height, 16_000), scale: 1 }; params["captureBeyondViewport"] = true; }
          }
          const shot = await c.send<{ data: string }>("Page.captureScreenshot", params);
          const png = Buffer.from(shot.data, "base64");
          return { png: shot.data, ...pngSize(png) };
        });
      case "chrome_eval":
        return withTab(tabId, async (c) => {
          const v = await evalIn<unknown>(c, s("expression") ?? "");
          return { result: v === undefined ? null : v };
        });
      case "chrome_wait":
        return withTab(tabId, async (c) => ({ ok: true, waitedMs: await waitFor(c, s("until") ?? "load", s("value"), typeof args["timeoutMs"] === "number" ? args["timeoutMs"] : 30_000) }));
      case "chrome_click":
        return withTab(tabId, async (c) => {
          const button = s("button") === "right" ? "right" : s("button") === "middle" ? "middle" : "left";
          let x = Number(args["x"]);
          let y = Number(args["y"]);
          let outward = false;
          let label = "";
          if (typeof args["ref"] === "string") { const l = await locate(c, args["ref"]); ({ x, y, outward, label } = l); }
          if (outward) return { ok: true, heldId: hold(`Click "${label}"`, async () => withTab(tabId, async (c2) => mouse(c2, x, y, button))) };
          await mouse(c, x, y, button);
          return { ok: true };
        });
      case "chrome_type": {
        return withTab(tabId, async (c) => {
          if (typeof args["ref"] === "string") { const l = await locate(c, args["ref"]); await mouse(c, l.x, l.y); }
          await c.send("Input.insertText", { text: s("text") ?? "" });
          if (args["submit"] === true) {
            const doIt = async (cc: Cdp): Promise<void> => key(cc, "Enter");
            const risky = typeof args["ref"] === "string" && (await locate(c, args["ref"])).outward;
            if (risky) return { ok: true, heldId: hold("Press Enter in a field that sends something", async () => withTab(tabId, doIt)) };
            await doIt(c);
          }
          return { ok: true };
        });
      }
      case "chrome_fill": {
        const fields = Array.isArray(args["fields"]) ? (args["fields"] as Array<{ ref: string; value: string }>) : [];
        return withTab(tabId, async (c) => {
          let n = 0;
          for (const f of fields) {
            const l = await locate(c, f.ref);
            await mouse(c, l.x, l.y);
            await evalIn(c, `(() => { const el = document.querySelector('[data-vyre-ref=${JSON.stringify(f.ref)}]'); if (el && el.select) el.select(); })()`);
            await c.send("Input.insertText", { text: f.value });
            n += 1;
          }
          return { ok: true, filled: n };
        });
      }
      case "chrome_act": {
        const action = s("action") ?? "";
        return withTab(tabId, async (c) => {
          const ref = s("ref");
          const l = ref ? await locate(c, ref) : null;
          const outward = l?.outward === true && (action === "click" || action === "double_click");
          if (outward && l) return { ok: true, heldId: hold(`Click "${l.label}"`, async () => withTab(tabId, async (c2) => mouse(c2, l.x, l.y))) };
          if (action === "click" && l) await mouse(c, l.x, l.y);
          else if (action === "double_click" && l) await mouse(c, l.x, l.y, "left", 2);
          else if (action === "hover" && l) await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: l.x, y: l.y });
          else if (action === "focus" && ref) await evalIn(c, `document.querySelector('[data-vyre-ref=${JSON.stringify(ref)}]').focus()`);
          else if (action === "press") await key(c, s("value") ?? "");
          else if ((action === "check" || action === "uncheck") && ref) await evalIn(c, `(() => { const el = document.querySelector('[data-vyre-ref=${JSON.stringify(ref)}]'); if (el.checked !== ${action === "check"}) el.click(); })()`);
          else if (action === "select" && ref) await evalIn(c, `(() => { const el = document.querySelector('[data-vyre-ref=${JSON.stringify(ref)}]'); el.value = ${JSON.stringify(s("value") ?? "")}; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); })()`);
          else if (action === "scroll") await evalIn(c, `window.scrollBy(0, ${Number(s("value")) || 600})`);
          else throw badInput(`I cannot ${action}${ref ? "" : " without an element"}.`);
          return { ok: true };
        });
      }
      case "chrome_console": {
        const t = await pick(tabId);
        const log = await watch(t);
        const level = s("level");
        const limit = typeof args["limit"] === "number" ? Math.max(1, Math.min(args["limit"], 500)) : 100;
        return { messages: log.console.filter((m) => !level || m.level === level).slice(-limit) };
      }
      case "chrome_net": {
        const t = await pick(tabId);
        const log = await watch(t);
        const filter = s("filter");
        const limit = typeof args["limit"] === "number" ? Math.max(1, Math.min(args["limit"], 500)) : 100;
        const rows = log.net.filter((r) => !filter || r.url.includes(filter)).slice(-limit);
        const requests = [];
        for (const r of rows) {
          const row: Record<string, unknown> = { url: r.url, method: r.method, ...(r.status !== undefined ? { status: r.status } : {}), type: r.type, at: r.at };
          if (args["bodies"] === true && r.status !== undefined) {
            try { const b = await log.conn.send<{ body: string; base64Encoded: boolean }>("Network.getResponseBody", { requestId: r.id }, 5000); if (!b.base64Encoded) row["body"] = b.body.slice(0, 20_000); } catch { /* gone from the browser's cache */ }
          }
          requests.push(row);
        }
        return { requests };
      }
      case "chrome_inspect":
        return withTab(tabId, async (c) => {
          const r = await evalIn<Record<string, unknown> | null>(c, `(() => {
            const el = document.querySelector('[data-vyre-ref=${JSON.stringify(s("ref") ?? "")}]');
            if (!el) return null;
            const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
            const attrs = {}; for (const a of el.attributes) if (a.name !== "data-vyre-ref" && a.name !== "value" || el.type !== "password") attrs[a.name] = el.type === "password" && a.name === "value" ? "" : a.value.slice(0, 300);
            return { tag: el.tagName.toLowerCase(), id: el.id, classes: [...el.classList], text: (el.innerText || "").slice(0, 500), attributes: attrs, rect: { x: b.left, y: b.top, width: b.width, height: b.height },
              visible: b.width > 0 && b.height > 0 && cs.visibility !== "hidden" && cs.display !== "none", styles: { color: cs.color, background: cs.backgroundColor, display: cs.display, position: cs.position, fontSize: cs.fontSize } };
          })()`);
          if (!r) throw notFound(`There is no element ${s("ref") ?? ""} on this page. Take a new snapshot.`);
          return { element: r };
        });
      case "chrome_sources": {
        const t = await pick(tabId);
        const log = await watch(t);
        const scripts = await withTab(tabId, (c) => evalIn<string[]>(c, "[...document.scripts].map((x) => x.src).filter(Boolean)"));
        const endpoints = [...new Set(log.net.filter((r) => r.type === "XHR" || r.type === "Fetch").map((r) => `${r.method} ${r.url.split("?")[0]}`))].slice(0, 200);
        return { scripts, endpoints };
      }
      case "chrome_api":
        return withTab(tabId, async (c) => {
          const r = await evalIn<{ status: number; headers: Record<string, string>; body: unknown }>(c, `(async () => {
            const init = { method: ${JSON.stringify(s("method") ?? "GET")}, credentials: "include", headers: ${JSON.stringify(args["headers"] ?? {})} };
            const body = ${JSON.stringify(args["body"] ?? null)};
            if (body !== null) { init.body = typeof body === "string" ? body : JSON.stringify(body); if (typeof body !== "string" && !Object.keys(init.headers).some((k) => k.toLowerCase() === "content-type")) init.headers["content-type"] = "application/json"; }
            const res = await fetch(${JSON.stringify(s("url") ?? "")}, init);
            const text = await res.text(); let parsed = text; try { parsed = JSON.parse(text); } catch {}
            const headers = {}; res.headers.forEach((v, k) => { headers[k] = v; });
            return { status: res.status, headers, body: typeof parsed === "string" ? parsed.slice(0, 200000) : parsed };
          })()`);
          return { status: r.status, headers: r.headers, body: r.body };
        });
      case "chrome_send": {
        const id = s("heldId") ?? "";
        const h = held.get(id);
        if (!h) throw notFound(`Nothing is held under ${id}. It may have expired.`);
        held.delete(id);
        await h.run();
        return { sent: true };
      }
      default:
        throw badInput(`${name} is not a browser tool of this computer.`);
    }
  }

  return {
    ready: start,
    alive: () => proc !== null && proc.exitCode === null,
    tabs: async () => { try { return await targets(); } catch { return []; } },
    tool,
    page: async () => { await start(); return connect(await pick(undefined)); },
    heldIds: () => [...held.keys()],
    extension: async () => {
      let workers = 0;
      try { workers = (await getJson<Target[]>("/json/list")).filter((t) => t.url.startsWith("chrome-extension://")).length; } catch { /* the browser is not up */ }
      return { configured: extensionDir !== null && existsSync(join(extensionDir, "manifest.json")), workers };
    },
    stop() { proc?.kill("SIGTERM"); },
  };
}
