// @ts-check
// Agent control for Vyre for Chrome (V1-SPEC 3.12 and 2.7, ARCH 7.12): the `chrome_*` tools run here, in the browser that owns the tab, over chrome.debugger.
//
//   * In an agent's computer this extension is installed and signed in as the agent. In a person's own Chrome it works for agents only in Spaces the person opened it to
//     (the app says which, in `agent.optin`; nothing is stored here), only for the Space that is active in this extension, and always with the frame on the tab.
//   * While an agent drives a tab it wears an indigo frame, a bar reading "<Agent> is using this tab" with Stop, and the agent's named cursor; Esc pauses everything until the
//     person answers (chrome_resume). Stop gives the tab back and is logged under the agent.
//   * A send, post or payment is held (heldId) and pressed only by chrome_send, which the Gate approves.
//   * A secret goes into a page only as a Vault handle; the value passes through this worker for one message and is dropped; the field stays masked and blurred.
//
// Wiring (outside this packet's files, noted on P-L10_06): worker/index.js imports "../agent/index.js" once; manifest.json adds "debugger" (optional, requested when the person opens
// Chrome to an agent) to its permissions. Until then this file is inert: it starts only when chrome.debugger exists.

import { createStore } from "../worker/store.js";
import { parseIncoming } from "../worker/protocol.js";
import { createCdp } from "./cdp.js";
import { createTraffic } from "./net.js";
import { OVERLAY_PORT, errorOf, fail, parseCommand } from "./protocol.js";
import { createSessions } from "./sessions.js";
import { createTools } from "./tools.js";
import { createTransport } from "./transport.js";

const FILL_WAIT_MS = 3000;

/** @param {number} n */
function randomRef(n) {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return `ag${n}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Build the agent control around a browser API. `ext` is `chrome` (or a fake in tests).
 * @param {any} ext
 * @param {{ transport?: ReturnType<typeof createTransport>, activeSpace?: () => Promise<string | null>, now?: () => number, sleep?: (ms: number) => Promise<void>, settleMs?: number, idleMs?: number, setTimer?: (f: () => void, ms: number) => any, clearTimer?: (t: any) => void }} [o]
 */
export function createAgentControl(ext, o = {}) {
  const now = o.now ?? Date.now;
  const store = createStore(ext.storage.local);
  const activeSpace = o.activeSpace ?? (async () => { const kept = await store.get(["activeSpace"]); return typeof kept["activeSpace"] === "string" ? kept["activeSpace"] : null; });

  /** @type {Set<string>} */
  let optedIn = new Set();
  /** @type {"personal" | "computer"} */
  let mode = "personal";
  /** @type {Map<string, (value: string | null) => void>} */
  const fills = new Map();
  let counter = 0;

  const transport = o.transport ?? createTransport(ext, { onMessage: (m) => { void onIncoming(m); }, ...(o.setTimer ? { setTimer: o.setTimer } : {}), ...(o.clearTimer ? { clearTimer: o.clearTimer } : {}) });
  const cdp = createCdp(ext.debugger);
  const traffic = createTraffic(cdp, { now });
  /** @param {Record<string, any>} event */
  const emit = (event) => transport.tell("agent.event", event);
  const sessions = createSessions({ ext, cdp, traffic, emit, now, ...(o.setTimer ? { setTimer: o.setTimer } : {}), ...(o.clearTimer ? { clearTimer: o.clearTimer } : {}), ...(o.idleMs !== undefined ? { idleMs: o.idleMs } : {}) });

  /** The agent's Space must be the one active here, and the person (or the agent computer's owner) must have opened Chrome to it. @param {{ space: string }} call */
  async function authorize(call) {
    if ((await activeSpace()) !== call.space) fail("wrong_space");
    if (!optedIn.has(call.space)) fail("not_opted_in");
  }

  /** Ask the filler for a handle's value into a ref and wait for it to be pushed; null when the Vault would not. @param {{ agent: { id: string }, space: string }} call @param {string} handle */
  async function vaultFill(call, handle) {
    const ref = randomRef(++counter);
    /** @type {Promise<string | null>} */
    const landed = new Promise((resolve) => {
      const timer = (o.setTimer ?? ((f, ms) => setTimeout(f, ms)))(() => { fills.delete(ref); resolve(null); }, FILL_WAIT_MS);
      fills.set(ref, (v) => { (o.clearTimer ?? ((t) => clearTimeout(t)))(timer); fills.delete(ref); resolve(v); });
    });
    try {
      const done = await transport.call("invoke", "vault.fill", { handle, target: { kind: "browser", ref } }, { agent: call.agent.id, space: call.space });
      if (!done || !done.filled) { fills.get(ref)?.(null); return null; }
    } catch { fills.get(ref)?.(null); return null; }
    return landed;
  }

  const tools = createTools({
    ext, cdp, traffic, sessions, authorize, vaultFill, emit,
    mode: () => mode,
    connected: (call) => transport.online && optedIn.has(call.space),
    now, ...(o.sleep ? { sleep: o.sleep } : {}), ...(o.settleMs !== undefined ? { settleMs: o.settleMs } : {}),
  });

  /** One message from the app on the agent channel. @param {unknown} raw */
  async function onIncoming(raw) {
    const fill = parseIncoming(raw);
    if (fill && "type" in fill && fill.type === "fill") { fills.get(fill.ref)?.(fill.value); return; }
    const cmd = parseCommand(raw);
    if (!cmd) return;
    if (cmd.type === "agent.optin") {
      const dropped = [...optedIn].filter((s) => !cmd.spaces.includes(s));
      optedIn = new Set(cmd.spaces);
      mode = cmd.mode;
      if (dropped.length) await sessions.releaseAll();
      return;
    }
    try {
      const output = await tools.run({ id: cmd.id, tool: cmd.tool, input: cmd.input, agent: cmd.agent, space: cmd.space });
      transport.tell("agent.result", { callId: cmd.id, ok: true, output });
    } catch (e) {
      transport.tell("agent.result", { callId: cmd.id, ok: false, error: errorOf(e) });
    }
  }

  // Stop and Esc from the frame on the page.
  ext.runtime.onConnect.addListener((/** @type {any} */ port) => {
    if (port.name !== OVERLAY_PORT || !port.sender || port.sender.id !== ext.runtime.id || !port.sender.tab) return;
    const tabId = port.sender.tab.id;
    port.onMessage.addListener((/** @type {any} */ m) => {
      const agent = sessions.driverOf(tabId);
      if (!agent || !m) return;
      if (m.type === "stop") void sessions.pause(agent.id, "person");
      else if (m.type === "esc") void sessions.pause(agent.id, "esc");
    });
  });
  // Chrome's own "stop debugging" bar is a Stop too; a tab that closes simply ends its session.
  cdp.onDetach((tabId, reason) => {
    const agent = sessions.driverOf(tabId);
    if (!agent) return;
    if (reason === "canceled_by_user") void sessions.pause(agent.id, "person");
    else void sessions.release(tabId, "detached");
  });
  cdp.onEvent((tabId, method) => { if (method === "Page.loadEventFired") void sessions.redraw(tabId); });
  ext.tabs.onRemoved.addListener((/** @type {number} */ id) => { void sessions.tabGone(id); });

  return {
    sessions, tools, cdp, traffic, transport,
    connect: () => transport.connect(),
    run: tools.run,
    onIncoming,
    get optedIn() { return [...optedIn]; },
    get mode() { return mode; },
  };
}

/** Wire the real browser. Runs only inside the extension with the debugger permission, never in tests. */
function start() {
  const ext = /** @type {any} */ (globalThis).chrome;
  if (!ext || !ext.runtime || !ext.runtime.id) return;
  /** @type {ReturnType<typeof createAgentControl> | null} */
  let control = null;
  const boot = () => {
    if (control || !ext.debugger) return;
    control = createAgentControl(ext);
    control.connect();
  };
  boot();
  if (ext.permissions && ext.permissions.onAdded) ext.permissions.onAdded.addListener(boot);
}

start();
