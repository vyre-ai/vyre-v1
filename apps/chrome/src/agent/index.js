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
import { createPauseKeep } from "./pausekeep.js";
import { parseIncoming } from "../worker/protocol.js";
import { createCdp } from "./cdp.js";
import { createTraffic } from "./net.js";
import { OVERLAY_PORT, errorOf, fail, parseCommand } from "./protocol.js";
import { createRights } from "./rights.js";
import { createSessions } from "./sessions.js";
import { createTools } from "./tools.js";
import { linkedExt } from "../worker/link.js";
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
 * @param {{ transport?: ReturnType<typeof createTransport>, activeSpace?: () => Promise<string | null>, now?: () => number, sleep?: (ms: number) => Promise<void>, settleMs?: number, idleMs?: number, setTimer?: (f: () => void, ms: number) => any, clearTimer?: (t: any) => void, restoreWaitMs?: number, restoreRetryMs?: number, restore?: (s: any) => Promise<void> }} [o] restoreWaitMs and restore are for tests: how long a call waits for the saved pauses, and a restore of their own
 */
const BAR_BUTTONS = new Set(["stop", "takeover", "giveback", "endtask", "openvyre"]);

export function createAgentControl(ext, o = {}) {
  const now = o.now ?? Date.now;
  const store = createStore(ext.storage.local);
  const activeSpace =
    o.activeSpace ??
    (async () => {
      const kept = await store.get(["activeSpace"]);
      return typeof kept["activeSpace"] === "string" ? kept["activeSpace"] : null;
    });

  /** @type {Set<string>} */
  let optedIn = new Set();
  /** @type {"personal" | "computer"} */
  let mode = "personal";
  /** @type {Map<string, (value: string | null) => void>} */
  const fills = new Map();
  let counter = 0;

  const transport =
    o.transport ??
    createTransport(linkedExt(ext), {
      onMessage: (m) => {
        void onIncoming(m);
      },
      ...(o.setTimer ? { setTimer: o.setTimer } : {}),
      ...(o.clearTimer ? { clearTimer: o.clearTimer } : {}),
    });
  const cdp = createCdp(ext.debugger);
  const traffic = createTraffic(cdp, { now });
  /** The chat each agent was last asked in, so what it does in the person's Chrome can be shown in that chat. @type {Map<string, string>} */
  const threads = new Map();
  /** @param {Record<string, any>} event */
  const emit = (event) =>
    transport.tell(
      "agent.event",
      typeof event["agent"] === "string" && threads.has(event["agent"])
        ? { ...event, thread: threads.get(event["agent"]) }
        : event,
    );
  const sessions = createSessions({
    ext,
    cdp,
    traffic,
    emit,
    now,
    grouping: () => mode === "personal",
    keep: createPauseKeep(ext.storage.session),
    ...(o.setTimer ? { setTimer: o.setTimer } : {}),
    ...(o.clearTimer ? { clearTimer: o.clearTimer } : {}),
    ...(o.idleMs !== undefined ? { idleMs: o.idleMs } : {}),
  });

  // The worker may have been stopped and started again since the person's Stop or take-over: their pauses are read back before any call of an agent is answered.
  // It fails closed and per agent: until they are known, an agent's calls are refused as paused (chrome_status still answers), never allowed. The wait for the answer is capped at two seconds so nothing holds the
  // channel open, and a restore that fails or never answers is tried again until it works, and never starts empty. The person is never locked out, and never made to wait: every press on the bar is handled at once
  // on what is live (a Stop acts now). Their Give back or End task while the restore is pending frees that bar's agent only (named by the bar itself), and is applied again to the take-over or Stop the late
  // restore finds for that agent. Resume on a Stop is the same press as Give back. Nothing is written to storage until the restore has read what was there.
  let restoreOk = false;
  /** Agents the person freed from the bar while their saved pause was unknown. @type {Set<string>} */
  const freed = new Set();
  /** @param {string} agentId */
  const restoring = (agentId) => !restoreOk && !freed.has(agentId);
  const restored = new Promise((resolve) => {
    const t = setTimeout(resolve, o.restoreWaitMs ?? 2000);
    const attempt = () => {
      Promise.resolve(o.restore ? o.restore(sessions) : sessions.restore()).then(
        (put) => {
          restoreOk = true;
          clearTimeout(t);
          resolve(undefined);
          // the person freed these while the pauses were unknown: lift what the restore found for them (only what it put back, never a Stop made since)
          if (Array.isArray(put)) for (const id of put) if (freed.has(id)) void sessions.resume(id);
          freed.clear();
        },
        () => {
          const again = /** @type {any} */ (setTimeout(attempt, o.restoreRetryMs ?? 500));
          again?.unref?.(); // a test process may end while storage is still broken; the browser gives no such handle
        },
      );
    };
    attempt();
  });

  cdp.allowOnly((tabId) => sessions.driverOf(tabId) !== null);

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
      const timer = (o.setTimer ?? ((f, ms) => setTimeout(f, ms)))(() => {
        fills.delete(ref);
        resolve(null);
      }, FILL_WAIT_MS);
      fills.set(ref, (v) => {
        (o.clearTimer ?? ((t) => clearTimeout(t)))(timer);
        fills.delete(ref);
        resolve(v);
      });
    });
    try {
      const done = await transport.call(
        "invoke",
        "vault.fill",
        { handle, target: { kind: "browser", ref } },
        { agent: call.agent.id, space: call.space },
      );
      if (!done || !done.filled) {
        fills.get(ref)?.(null);
        return null;
      }
    } catch {
      fills.get(ref)?.(null);
      return null;
    }
    return landed;
  }

  const rights = createRights({
    list: (call) => transport.call("invoke", "browser.sites.list", {}, { agent: call.agent.id, space: call.space }),
    mode: () => mode,
    now,
  });

  const tools = createTools({
    ext,
    cdp,
    traffic,
    sessions,
    restored,
    restoring,
    authorize,
    vaultFill,
    emit,
    rights,
    mode: () => mode,
    connected: (call) => transport.online && optedIn.has(call.space),
    now,
    ...(o.sleep ? { sleep: o.sleep } : {}),
    ...(o.settleMs !== undefined ? { settleMs: o.settleMs } : {}),
  });

  /** One message from the app on the agent channel. @param {unknown} raw */
  async function onIncoming(raw) {
    await restored;
    const fill = parseIncoming(raw);
    if (fill && "type" in fill && fill.type === "fill") {
      fills.get(fill.ref)?.(fill.value);
      return;
    }
    const cmd = parseCommand(raw);
    if (!cmd) return;
    if (cmd.type === "agent.optin") {
      const dropped = [...optedIn].filter((s) => !cmd.spaces.includes(s));
      optedIn = new Set(cmd.spaces);
      mode = cmd.mode;
      if (dropped.length) await sessions.releaseAll();
      return;
    }
    if (cmd.type === "agent.held.drop") {
      sessions.dropHeld(cmd.id);
      return;
    }
    if (cmd.type === "agent.takeover") {
      await sessions.pause(cmd.agent, "takeover");
      return;
    }
    if (cmd.type === "agent.watch") {
      const tabId = sessions.currentTab(cmd.agent);
      if (tabId !== null) {
        try {
          const t = await ext.tabs.update(tabId, { active: true });
          if (t && t.windowId !== undefined && ext.windows) await ext.windows.update(t.windowId, { focused: true });
        } catch {
          /* the tab is gone */
        }
      }
      return;
    }
    if (cmd.thread) threads.set(cmd.agent.id, cmd.thread);
    try {
      const output = await tools.run({
        id: cmd.id,
        tool: cmd.tool,
        input: cmd.input,
        agent: cmd.agent,
        space: cmd.space,
      });
      transport.tell("agent.result", { callId: cmd.id, ok: true, output });
    } catch (e) {
      transport.tell("agent.result", { callId: cmd.id, ok: false, error: errorOf(e) });
    }
  }

  // Stop and Esc from the frame on the page.
  ext.runtime.onConnect.addListener((/** @type {any} */ port) => {
    if (port.name !== OVERLAY_PORT || !port.sender || port.sender.id !== ext.runtime.id || !port.sender.tab) return;
    const tabId = port.sender.tab.id;
    /** @param {any} m */
    const onBar = (m) => {
      const agent = sessions.driverOf(tabId);
      const shownAgent = sessions.shownAgent(tabId);
      if (m && m.type === "openvyre") {
        const who = agent ?? shownAgent;
        const thread = who ? threads.get(who.id) : undefined;
        // the exact chat the agent works in: the desktop app opens it, else the Space's web app does
        void transport
          .call("bridge", "app.open", { place: "chats", ...(thread ? { threadId: thread } : {}) })
          .catch(async () => {
            const kept = await store.get(["spaces", "activeSpace"]);
            const sp = (kept["spaces"] ?? []).find((/** @type {any} */ x) => x.id === kept["activeSpace"]);
            if (sp && sp.webUrl) void ext.tabs.create({ url: `${sp.webUrl}/chats${thread ? `/${thread}` : ""}` });
          });
        return;
      }
      if (m && (m.type === "giveback" || m.type === "endtask") && shownAgent) {
        void sessions.resume(shownAgent.id).then(() => {
          if (m.type === "endtask") emit({ event: "ended", agent: shownAgent.id });
        });
        return;
      }
      if (!agent || !m) return;
      if (m.type === "stop") void sessions.pause(agent.id, "person");
      else if (m.type === "takeover") void sessions.pause(agent.id, "takeover");
      else if (m.type === "esc") void sessions.pause(agent.id, "esc");
      else if (m.type === "touch") void sessions.touched(tabId, m);
    };
    port.onMessage.addListener((/** @type {any} */ m) => {
      // Is this press the person's? Decided once, before anything acts or frees anyone (the filters use up the entry they match): a press on the bar's buttons that is the agent's own click (it clicked at the
      // bar's place), or a keyboard click that the agent's own Enter or Space made (it can Tab onto the bar), is not the person's: the bar never obeys the agent it is there to watch.
      if (m && m.x !== undefined && BAR_BUTTONS.has(m.type) && sessions.ownPress(tabId, Number(m.x), Number(m.y)))
        return;
      if (m && m.key === true && BAR_BUTTONS.has(m.type) && sessions.ownKeyPress(tabId)) return;
      // a release during the wait names its agent: the bar's own (from this page's overlay, never the page)
      if (!restoreOk && m && (m.type === "giveback" || m.type === "endtask")) {
        const who = sessions.shownAgent(tabId)?.id ?? (typeof m.agent === "string" ? m.agent : undefined);
        if (who) freed.add(who);
      }
      onBar(m);
    });
  });
  // Chrome's own "stop debugging" bar is a Stop too; a tab that closes simply ends its session.
  cdp.onInput((tabId, method, params) => sessions.ownInput(tabId, method, params));
  cdp.onDetach((tabId, reason) => {
    const agent = sessions.driverOf(tabId);
    if (!agent) return;
    if (reason === "canceled_by_user") void sessions.pause(agent.id, "person");
    else void sessions.release(tabId, "detached");
  });
  // A tab dragged out of the agent's group (or into another) is the person's: the agent stops at once and the bar says so.
  if (ext.tabs.onUpdated)
    ext.tabs.onUpdated.addListener((/** @type {number} */ tabId, /** @type {any} */ info) => {
      if (info.groupId === undefined) return;
      const agent = sessions.driverOf(tabId);
      if (!agent) return;
      void sessions.inGroup(agent.id, tabId).then((inside) => {
        if (!inside) void sessions.pause(agent.id, "takeover");
      });
    });
  /** The site each tab was last seen on, so what a tab recorded on one site is dropped when it goes to another and is never handed back later. @type {Map<number, string>} */
  const siteOf = new Map();
  cdp.onEvent((tabId, method, params) => {
    if (method === "Page.frameNavigated" && params && params.frame && !params.frame.parentId) {
      let host = "";
      try {
        host = new URL(String(params.frame.url)).hostname;
      } catch {
        host = "";
      }
      const before = siteOf.get(tabId);
      siteOf.set(tabId, host);
      if (before !== undefined && before !== host) traffic.forget(tabId);
    }
    if (method === "Page.loadEventFired") void sessions.redraw(tabId);
  });
  ext.tabs.onRemoved.addListener((/** @type {number} */ id) => {
    void sessions.tabGone(id);
  });

  return {
    sessions,
    tools,
    cdp,
    traffic,
    transport,
    rights,
    connect: () => transport.connect(),
    /** Release any debugger Chrome still holds for this extension that no agent is driving (see cdp.sweep). */
    sweepStray: () => cdp.sweep(sessions.driven),
    run: tools.run,
    onIncoming,
    get optedIn() {
      return [...optedIn];
    },
    get mode() {
      return mode;
    },
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
  // A worker that slept while an agent drove a tab left the debugger attached with nothing to detach it: let go of those now and every minute.
  const sweep = () => {
    if (control) void control.sweepStray();
  };
  sweep();
  if (ext.alarms && ext.alarms.create && ext.alarms.onAlarm) {
    ext.alarms.create("vyre.agent.sweep", { periodInMinutes: 1 });
    ext.alarms.onAlarm.addListener((/** @type {{ name: string }} */ a) => {
      if (a.name === "vyre.agent.sweep") sweep();
    });
  }
  if (ext.permissions && ext.permissions.onAdded) ext.permissions.onAdded.addListener(boot);
}

start();
