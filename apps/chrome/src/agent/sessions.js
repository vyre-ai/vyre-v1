// @ts-check
// Who is driving which tab, for how long, and what is waiting for a person. One entry per driven tab: the agent's named frame is on the tab while the entry exists,
// the debugger is attached while it exists, and it goes (frame off, debugger detached, buffers dropped) when the agent is idle, is stopped, or the tab closes.
// A held item is a send, post or payment the agent reached but did not press: it waits here under an id until the person approves it through the Gate and chrome_send names it.

import { overlayCursor, overlayHide, overlayShow } from "./overlay.js";
import { HELD_TTL_MS, IDLE_MS, OVERLAY_PORT, fail } from "./protocol.js";

export const BEACON = "●";
const BEACON_COLOR = "#4f46e5";

/** @param {string} prefix */
function randomId(prefix) {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * @typedef {{ id: string, name: string }} AgentRef
 * @typedef {{ agent: AgentRef, space: string, since: number, timer: any, goal: string }} Driver
 * @typedef {{ id: string, agentId: string, space: string, tabId: number, kind: string, why: string, summary: string, selector: import("./selector.js").Selector | null, action: { type: "click", button: "left" | "right" | "middle", double: boolean } | { type: "press", key: string }, expires: number }} Held
 * @param {{
 *   ext: { scripting: { executeScript(o: any): Promise<any> }, action?: { setBadgeText(o: any): any, setBadgeBackgroundColor(o: any): any, setTitle?(o: any): any } },
 *   cdp: { detach(tabId: number): Promise<void> },
 *   traffic: { forget(tabId: number): void },
 *   emit: (event: Record<string, any>) => void,
 *   now?: () => number, setTimer?: (f: () => void, ms: number) => any, clearTimer?: (t: any) => void, idleMs?: number,
 * }} deps
 */
export function createSessions({ ext, cdp, traffic, emit, now = Date.now, setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (t) => clearTimeout(t), idleMs = IDLE_MS }) {
  /** @type {Map<number, Driver>} */
  const drivers = new Map();
  /** @type {Map<string, Set<number>>} tabs an agent opened or was given, by agent id */
  const owned = new Map();
  /** @type {Map<string, number>} the tab each agent is working in */
  const current = new Map();
  /** @type {Map<string, Held>} */
  const held = new Map();
  /** @type {Map<string, { by: "person" | "esc" | "tool", at: number }>} agents the person (or the agent itself) stopped, until chrome_resume */
  const paused = new Map();
  /** @type {Map<number, Map<string, import("./selector.js").Selector>>} refs the agent last read, by tab */
  const refs = new Map();
  /** @type {Map<string, string>} what each agent said it is doing (chrome_plan) */
  const goals = new Map();

  /** @param {() => Promise<any>} f */
  const quiet = async (f) => { try { await f(); } catch { /* a restricted or closed tab: nothing to draw on */ } };

  /** @param {number} tabId @param {AgentRef} agent @param {boolean} [isPaused] */
  async function draw(tabId, agent, isPaused = false) {
    await quiet(() => ext.scripting.executeScript({ target: { tabId }, func: overlayShow, args: [{ name: agent.name, goal: goals.get(agent.id) ?? "", paused: isPaused, port: OVERLAY_PORT }] }));
    if (ext.action) {
      const a = ext.action;
      await quiet(async () => { await a.setBadgeText({ tabId, text: BEACON }); await a.setBadgeBackgroundColor({ tabId, color: BEACON_COLOR }); if (a.setTitle) await a.setTitle({ tabId, title: `Vyre: ${agent.name} is using this tab` }); });
    }
  }

  /** @param {number} tabId */
  async function undraw(tabId) {
    await quiet(() => ext.scripting.executeScript({ target: { tabId }, func: overlayHide, args: [] }));
    if (ext.action) { const a = ext.action; await quiet(async () => { await a.setBadgeText({ tabId, text: "" }); if (a.setTitle) await a.setTitle({ tabId, title: "Vyre" }); }); }
  }

  /** @param {number} tabId */
  function arm(tabId) {
    const d = drivers.get(tabId);
    if (!d) return;
    clearTimer(d.timer);
    d.timer = setTimer(() => { void release(tabId, "idle"); }, idleMs);
  }

  /** Stop driving a tab: frame off, debugger detached, buffers dropped. @param {number} tabId @param {string} why */
  async function release(tabId, why) {
    const d = drivers.get(tabId);
    if (!d) return;
    clearTimer(d.timer);
    drivers.delete(tabId);
    refs.delete(tabId);
    for (const [id, h] of held) if (h.tabId === tabId) held.delete(id);
    await undraw(tabId);
    await cdp.detach(tabId);
    traffic.forget(tabId);
    emit({ event: "driving", on: false, agent: d.agent.id, tab: tabId, why });
  }

  return {
    /** Start (or keep) driving a tab as this agent: frame, beacon, idle timer. @param {{ agent: AgentRef, space: string }} call @param {number} tabId */
    async begin(call, tabId) {
      const d = drivers.get(tabId);
      if (d && d.agent.id !== call.agent.id) fail("busy");
      if (!d) {
        drivers.set(tabId, { agent: call.agent, space: call.space, since: now(), timer: null, goal: "" });
        emit({ event: "driving", on: true, agent: call.agent.id, name: call.agent.name, tab: tabId, space: call.space });
        await draw(tabId, call.agent);
      }
      arm(tabId);
    },
    /** @param {number} tabId */
    touch: arm,
    /** The page loaded again (a navigation, a reload): the frame went with the old document, so draw it again. @param {number} tabId */
    async redraw(tabId) { const d = drivers.get(tabId); if (d) await draw(tabId, d.agent); },
    release,
    /** The agent's cursor goes to a point; with `click`, a ring. @param {number} tabId @param {number} x @param {number} y @param {boolean} [click] */
    async cursor(tabId, x, y, click) {
      await quiet(() => ext.scripting.executeScript({ target: { tabId }, func: overlayCursor, args: [x, y, Boolean(click)] }));
    },
    /** @param {number} tabId */
    driverOf: (tabId) => drivers.get(tabId)?.agent ?? null,
    get driven() { return [...drivers.keys()]; },

    // ---- tabs an agent may touch
    /** @param {string} agentId @param {number} tabId */
    own(agentId, tabId) { let s = owned.get(agentId); if (!s) { s = new Set(); owned.set(agentId, s); } s.add(tabId); },
    /** @param {string} agentId @param {number} tabId */
    owns: (agentId, tabId) => Boolean(owned.get(agentId)?.has(tabId)),
    /** @param {string} agentId */
    ownedTabs: (agentId) => [...(owned.get(agentId) ?? [])],
    /** @param {string} agentId @param {number | null} tabId */
    setCurrent(agentId, tabId) { if (tabId === null) current.delete(agentId); else current.set(agentId, tabId); },
    /** @param {string} agentId */
    currentTab: (agentId) => current.get(agentId) ?? null,
    /** A tab closed or navigated away from anything drivable. @param {number} tabId */
    async tabGone(tabId) {
      for (const s of owned.values()) s.delete(tabId);
      for (const [a, t] of current) if (t === tabId) current.delete(a);
      refs.delete(tabId);
      for (const [id, h] of held) if (h.tabId === tabId) held.delete(id);
      const d = drivers.get(tabId);
      if (d) { clearTimer(d.timer); drivers.delete(tabId); traffic.forget(tabId); emit({ event: "driving", on: false, agent: d.agent.id, tab: tabId, why: "closed" }); }
    },

    // ---- refs the agent last read
    /** @param {number} tabId @param {Map<string, import("./selector.js").Selector>} map */
    setRefs(tabId, map) { refs.set(tabId, map); },
    /** @param {number} tabId @param {string} ref */
    ref: (tabId, ref) => refs.get(tabId)?.get(ref) ?? null,

    // ---- pause: Stop, Esc, or the agent's own chrome_stop
    /** @param {string} agentId */
    pausedFor: (agentId) => paused.get(agentId) ?? null,
    /**
     * The person pressed Stop, or Esc, or the agent stopped itself. Stop and the tool give the tab back (frame off, detached); Esc keeps the dashed frame so the person
     * sees it is waiting for them. Either way nothing runs for this agent until chrome_resume.
     * @param {string} agentId @param {"person" | "esc" | "tool"} by @param {string} [reason]
     */
    async pause(agentId, by, reason) {
      paused.set(agentId, { by, at: now() });
      for (const [tabId, d] of [...drivers]) {
        if (d.agent.id !== agentId) continue;
        if (by === "esc") {
          clearTimer(d.timer);
          for (const [id, h] of held) if (h.tabId === tabId) held.delete(id);
          await cdp.detach(tabId);
          await draw(tabId, d.agent, true);
          drivers.delete(tabId);
          traffic.forget(tabId);
        } else await release(tabId, by === "person" ? "stopped by the person" : "stopped by the agent");
      }
      emit({ event: by === "esc" ? "paused" : "stopped", agent: agentId, by, ...(reason ? { reason: String(reason).slice(0, 200) } : {}) });
    },
    /** @param {string} agentId */
    async resume(agentId) {
      const was = paused.delete(agentId);
      if (was) {
        // An Esc pause left a dashed frame on the tabs: take it off now that the person has answered.
        for (const tabId of owned.get(agentId) ?? []) if (!drivers.has(tabId)) await undraw(tabId);
        emit({ event: "resumed", agent: agentId });
      }
      return was;
    },

    // ---- held: a send, post or payment that waits for the person
    /**
     * @param {{ agent: AgentRef, space: string }} call @param {number} tabId
     * @param {Pick<Held, "kind" | "why" | "summary" | "selector" | "action">} what
     */
    hold(call, tabId, what) {
      for (const [id, h] of held) if (h.expires < now()) held.delete(id);
      const id = randomId("hld");
      held.set(id, { id, agentId: call.agent.id, space: call.space, tabId, expires: now() + HELD_TTL_MS, ...what });
      emit({ event: "held", agent: call.agent.id, id, kind: what.kind, summary: what.summary, tab: tabId });
      return id;
    },
    /** Take a held item out for chrome_send: only the agent and Space that reached it, only before it expires. @param {{ agent: AgentRef, space: string }} call @param {string} id */
    take(call, id) {
      const h = held.get(id);
      if (!h || h.expires < now() || h.agentId !== call.agent.id || h.space !== call.space) fail("held_gone");
      held.delete(id);
      return h;
    },
    /** @param {string} agentId */
    heldIds: (agentId) => [...held.values()].filter((h) => h.agentId === agentId && h.expires >= now()).map((h) => h.id),

    // ---- goal line
    /** @param {AgentRef} agent @param {string} goal */
    async setGoal(agent, goal) {
      goals.set(agent.id, goal);
      for (const [tabId, d] of drivers) if (d.agent.id === agent.id) await draw(tabId, agent);
    },
    /** Everything off: the worker is going away or the Space was closed. */
    async releaseAll() { for (const tabId of [...drivers.keys()]) await release(tabId, "closed"); },
  };
}
