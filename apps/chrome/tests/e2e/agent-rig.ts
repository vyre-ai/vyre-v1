// The browser the agent tools drive in the replay proof: copied from ext-agent.real.test.ts (a real Chromium page, a DevTools session standing in for chrome.debugger, scripting run in the page,
// the real chrome_* tools from src/agent). The vault filler is a stand-in: a handle for "username" fills the login name, any other fills the password, and the model never sees either.
import fs from "node:fs";
import assert from "node:assert/strict";
import { createAgentControl } from "../../src/agent/index.js";

export const SECRET = "hunter2-Pa55";
export const LOGIN = "techmanager@mylegalacademy.com";

export async function findChrome() {
  let pw: any;
  try { pw = await import("playwright-core"); } catch { return null; }
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) return null;
  const candidates = [process.env["CHROME_BIN"], (() => { try { return chromium.executablePath(); } catch { return undefined; } })(), "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const exe = candidates.find((c) => c && fs.existsSync(c));
  return exe ? { chromium, exe } : null;
}

const EVENTS = ["Page.frameStartedLoading", "Page.loadEventFired", "Network.requestWillBeSent", "Network.responseReceived", "Network.loadingFinished", "Network.loadingFailed", "Runtime.consoleAPICalled", "Runtime.exceptionThrown"];

/** A browser the extension code believes is Chrome with the debugger permission: one real tab, a DevTools session standing in for chrome.debugger, scripting run in the page. */
export async function rig(browser: any, colorScheme: "light" | "dark", opts: { idleMs?: number } = {}) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 2, colorScheme });
  const regs = new Map<number, { page: any; cdp: any; port: any }>();
  const listeners: any[] = [];
  const connectListeners: any[] = [];
  const sentEvents: any[] = [];
  const results: any[] = [];
  let nextId = 1;
  let fillCalls = 0;

  async function register(page: any) {
    const id = nextId++;
    const cdp = await context.newCDPSession(page);
    for (const ev of EVENTS) cdp.on(ev, (p: any) => { for (const l of listeners) l({ tabId: id }, ev, p); });
    regs.set(id, { page, cdp, port: null });
    return id;
  }
  await context.addInitScript(() => {
    (window as any).chrome = { runtime: { connect: () => ({ postMessage: (m: unknown) => { void (window as any).__vyreOverlay(JSON.stringify(m)); }, disconnect: () => {} }) } };
  });
  await context.exposeBinding("__vyreOverlay", (source: any, json: string) => {
    const entry = [...regs.entries()].find(([, r]) => r.page === source.page);
    if (!entry) return;
    const [tabId, r] = entry;
    if (!r.port) {
      const handlers: any[] = [];
      r.port = { name: "vyre.agent.overlay", sender: { id: "ext", tab: { id: tabId } }, onMessage: { addListener: (f: any) => handlers.push(f) }, handlers };
      for (const f of connectListeners) f(r.port);
    }
    for (const h of r.port.handlers) h(JSON.parse(json));
  });

  const page = await context.newPage();
  const tabId = await register(page);
  let active = tabId;

  const ext: any = {
    runtime: { id: "ext", onConnect: { addListener: (f: any) => connectListeners.push(f) } },
    storage: { local: { async get() { return {}; }, async set() {}, async remove() {} } },
    debugger: {
      attach: async () => {}, detach: async () => {},
      sendCommand: async ({ tabId: t }: any, method: string, params: any) => regs.get(t)!.cdp.send(method, params ?? {}),
      onEvent: { addListener: (f: any) => listeners.push(f) },
      onDetach: { addListener: () => {} },
    },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
    scripting: {
      executeScript: async ({ target, func, args }: any) => {
        const r = regs.get(target.tabId);
        if (!r) throw new Error("no tab");
        const result = await r.page.evaluate(`(${func.toString()})(...${JSON.stringify(args ?? [])})`);
        return [{ frameId: 0, result }];
      },
    },
    tabs: {
      get: async (id: number) => { const r = regs.get(id); if (!r) throw new Error("No tab with id: " + id); return { id, url: r.page.url(), title: await r.page.title(), status: "complete", active: id === active }; },
      query: async () => { const r = regs.get(active)!; return [{ id: active, url: r.page.url(), title: await r.page.title(), status: "complete", active: true }]; },
      create: async () => { const p = await context.newPage(); const id = await register(p); return { id, url: "about:blank" }; },
      remove: async (id: number) => { const r = regs.get(id); regs.delete(id); await r?.page.close(); },
      onRemoved: { addListener: () => {} },
    },
  };
  const transport = {
    online: true, connect() {}, close() {},
    tell(op: string, input: any) { if (op === "agent.event") sentEvents.push(input); else results.push({ op, ...input }); },
    async call(_type: string, name: string, input: any) {
      assert.equal(name, "vault.fill");
      fillCalls++;
      setTimeout(() => { void control.onIncoming({ type: "fill", ref: input.target.ref, value: /username/i.test(JSON.stringify(input)) ? LOGIN : SECRET }); }, 5);
      return { filled: true };
    },
  };
  const control = createAgentControl(ext, { transport: transport as any, activeSpace: async () => "spc_a", settleMs: 120, idleMs: opts.idleMs ?? 60_000 });
  await control.onIncoming({ type: "agent.optin", spaces: ["spc_a"], mode: "computer" });
  const agent = { id: "agt_intake", name: "Intake" };
  const call = (tool: string, input: any = {}) => control.run({ tool, input, agent, space: "spc_a" });
  const overlayState = () => page.evaluate(() => {
    const s = (globalThis as any)[Symbol.for("vyre.agent.overlay")];
    return s ? { shown: s.host.isConnected, text: s.text.textContent, goal: s.goal.textContent, paused: s.paused, stop: s.stop.style.display !== "none", cursor: s.cursor.style.display === "block" ? s.cursor.style.transform : null, chip: s.chip.textContent } : null;
  });
  return { context, page, ext, control, call, overlayState, sentEvents, results, fillCalls: () => fillCalls, tabId, cdp: () => regs.get(tabId)!.cdp, close: () => context.close() };
}

