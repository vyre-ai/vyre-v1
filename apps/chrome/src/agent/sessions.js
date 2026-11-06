// @ts-check
// Who is driving which tab, for how long, and what is waiting for a person. One entry per driven tab: the agent's named frame is on the tab while the entry exists,
// the debugger is attached while it exists, and it goes (frame off, debugger detached, buffers dropped) when the agent is idle, is stopped, or the tab closes.
// A held item is a send, post or payment the agent reached but did not press: it waits here under an id until the person approves it through the Gate and chrome_send names it.

import { overlayCursor, overlayHide, overlayShow } from "./overlay.js";
import { HELD_TTL_MS, IDLE_MS, OVERLAY_PORT, fail } from "./protocol.js";

export const BEACON = "●";
/** Chrome's tab group colours, without grey (grey reads as "no agent"). */
export const GROUP_COLORS = Object.freeze(["blue", "purple", "cyan", "green", "orange", "pink", "yellow", "red"]);
/** Chrome's own tab group colours, so the frame matches the group. */
export const GROUP_HEX = Object.freeze({ blue: "#1a73e8", purple: "#9334e6", cyan: "#12b5cb", green: "#188038", orange: "#fa7b17", pink: "#d01884", yellow: "#f9ab00", red: "#d93025" });
/** The same agent always gets the same colour. @param {string} agentId */
export function groupColor(agentId) { let h = 7; for (const c of String(agentId)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return GROUP_COLORS[h % GROUP_COLORS.length]; }
/** @param {string} name */
export const groupTitle = (name) => `Vyre · ${String(name).slice(0, 24)}`;
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
 * @typedef {{ to?: string, from?: string, subject?: string, message?: string, site?: string }} Card
 * @typedef {{ id: string, agentId: string, space: string, tabId: number, kind: string, why: string, summary: string, card?: Card, selector: import("./selector.js").Selector | null, action: { type: "click", button: "left" | "right" | "middle", double: boolean } | { type: "press", key: string }, expires: number }} Held
 * @param {{
 *   ext: { scripting: { executeScript(o: any): Promise<any> }, tabs?: any, tabGroups?: any, action?: { setBadgeText(o: any): any, setBadgeBackgroundColor(o: any): any, setTitle?(o: any): any } },
 *   cdp: { detach(tabId: number): Promise<void> },
 *   traffic: { forget(tabId: number): void },
 *   emit: (event: Record<string, any>) => void,
 *   now?: () => number, setTimer?: (f: () => void, ms: number) => any, clearTimer?: (t: any) => void, idleMs?: number,
 *   grouping?: () => boolean,
 * }} deps
 */
export function createSessions({ ext, cdp, traffic, emit, now = Date.now, setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (t) => clearTimeout(t), idleMs = IDLE_MS, grouping = () => true }) {
  /** @type {Map<number, Driver>} */
  const drivers = new Map();
  /** @type {Map<string, Set<number>>} tabs an agent opened or was given, by agent id */
  const owned = new Map();
  /** @type {Map<string, Set<number>>} the person's own tabs an agent was asked to work in; usable, never closed by the agent */
  const borrowed = new Map();
  /** @type {Map<string, Set<number>>} the person's tabs the agent's last find returned */
  const offered = new Map();
  /** @type {Map<string, number>} the tab each agent is working in */
  const current = new Map();
  /** @type {Map<string, Held>} */
  const held = new Map();
  /** @type {Map<string, { by: "person" | "esc" | "tool", at: number }>} agents the person (or the agent itself) stopped, until chrome_resume */
  const paused = new Map();
  /** @type {Map<number, Map<string, import("./selector.js").Selector>>} refs the agent last read, by tab */
  const refs = new Map();
  /** @type {Map<string, { total: number, done: number, steps: string[] }>} how far each agent is in the plan it gave */
  const plans = new Map();
  /** @type {Map<number, AgentRef>} tabs that wear a Take over or Stopped bar, and whose agent it is */
  const shown = new Map();
  /** @type {Map<string, string>} what each agent said it is doing (chrome_plan) */
  const goals = new Map();

  /** @type {Map<string, number>} the Chrome tab group of each agent in this window set */
  const groupIds = new Map();

  /** @param {() => Promise<any>} f */
  const quiet = async (f) => { try { await f(); } catch { /* a restricted or closed tab: nothing to draw on */ } };

  /** Is something an agent reached waiting for the person on this tab? @param {number} tabId */
  const waitingOn = (tabId) => { for (const h of held.values()) if (h.tabId === tabId && h.expires >= now()) return true; return false; };

  /** Put a tab in its agent's group, "Vyre · <agent>", made on first use and found again by id. The group is the person's view of which tabs an agent has. @param {AgentRef} agent @param {number} tabId */
  async function group(agent, tabId) {
    if (!grouping() || !ext.tabs || typeof ext.tabs.group !== "function" || !ext.tabGroups) return;
    await quiet(async () => {
      let gid = groupIds.get(agent.id);
      if (gid !== undefined) {
        try { const t = await ext.tabs.get(tabId); if (t && t.groupId === gid) return; } catch { return; }
      }
      /** @type {number} */
      let made;
      try { made = await ext.tabs.group(gid !== undefined ? { tabIds: [tabId], groupId: gid } : { tabIds: [tabId] }); }
      catch { if (gid === undefined) return; groupIds.delete(agent.id); made = await ext.tabs.group({ tabIds: [tabId] }); gid = undefined; }
      if (gid === undefined || gid !== made) {
        groupIds.set(agent.id, made);
        await ext.tabGroups.update(made, { title: groupTitle(agent.name), color: groupColor(agent.id), collapsed: false });
      }
    });
  }

  /** @param {string} agentId */
  const goalText = (agentId) => { const g = goals.get(agentId) ?? ""; const p = plans.get(agentId); return g && p && p.total > 0 ? `${g} · ${p.done} of ${p.total}` : g; };

  /** @param {number} tabId @param {AgentRef} agent @param {boolean | "takeover" | "stopped"} [mode] true: Esc paused */
  async function draw(tabId, agent, mode = false) {
    const isPaused = mode === true;
    const state = mode === "takeover" || mode === "stopped" ? mode : undefined;
    if (state) shown.set(tabId, agent); else shown.delete(tabId);
    await quiet(() => ext.scripting.executeScript({ target: { tabId }, func: overlayShow, args: [{ name: agent.name, goal: goalText(agent.id), paused: isPaused, ...(state ? { state } : {}), waiting: !isPaused && waitingOn(tabId), color: GROUP_HEX[/** @type {keyof typeof GROUP_HEX} */ (groupColor(agent.id))], port: OVERLAY_PORT }] }));
    if (ext.action) {
      const a = ext.action;
      await quiet(async () => { await a.setBadgeText({ tabId, text: BEACON }); await a.setBadgeBackgroundColor({ tabId, color: BEACON_COLOR }); if (a.setTitle) await a.setTitle({ tabId, title: `Vyre: ${agent.name} is using this tab` }); });
    }
  }

  /** @param {number} tabId */
  async function undraw(tabId) {
    shown.delete(tabId);
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
    // The person's own tab goes back out of the agent's group when the agent lets go of it.
    if (borrowed.get(d.agent.id)?.has(tabId) && ext.tabs && typeof ext.tabs.ungroup === "function") await quiet(() => ext.tabs.ungroup([tabId]));
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
        /** @type {string} */
        let site = "";
        try { site = new URL(String((await ext.tabs.get(tabId)).url ?? "")).hostname.replace(/^www\./, ""); } catch { /* no address to name */ }
        emit({ event: "driving", on: true, agent: call.agent.id, name: call.agent.name, tab: tabId, space: call.space, ...(site ? { site } : {}) });
        await draw(tabId, call.agent);
      }
      await group(call.agent, tabId);
      arm(tabId);
    },
    /** @param {number} tabId */
    touch: arm,
    /** The page loaded again (a navigation, a reload): the frame went with the old document, so draw it again. @param {number} tabId */
    async redraw(tabId) { const d = drivers.get(tabId); if (d) await draw(tabId, d.agent); },
    release,
    group,
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
    /** A tab of the person's own that they asked an agent to work in: usable, in the agent's group, never closed by the agent. @param {string} agentId @param {number} tabId */
    borrow(agentId, tabId) { let s = borrowed.get(agentId); if (!s) { s = new Set(); borrowed.set(agentId, s); } s.add(tabId); },
    /** @param {string} agentId @param {number} tabId */
    borrowed: (agentId, tabId) => Boolean(borrowed.get(agentId)?.has(tabId)),
    /** Tabs a person's open tab list was offered to an agent in a find, usable by `use` for a while. @param {string} agentId @param {number[]} tabIds */
    offer(agentId, tabIds) { offered.set(agentId, new Set(tabIds)); },
    /** @param {string} agentId @param {number} tabId */
    offeredTab: (agentId, tabId) => Boolean(offered.get(agentId)?.has(tabId)),
    /** @param {string} agentId */
    ownedTabs: (agentId) => [...(owned.get(agentId) ?? [])],
    /** @param {string} agentId @param {number | null} tabId */
    setCurrent(agentId, tabId) { if (tabId === null) current.delete(agentId); else current.set(agentId, tabId); },
    /** @param {string} agentId */
    currentTab: (agentId) => current.get(agentId) ?? null,
    /** A tab closed or navigated away from anything drivable. @param {number} tabId */
    async tabGone(tabId) {
      for (const s of owned.values()) s.delete(tabId);
      for (const s of borrowed.values()) s.delete(tabId);
      for (const s of offered.values()) s.delete(tabId);
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
     * @param {string} agentId @param {"person" | "esc" | "tool" | "takeover"} by @param {string} [reason]
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
        } else if (by === "person" || by === "takeover") {
          // the tab is the person's now: the debugger and the frame go, and the bar stays to say so and to give it back
          clearTimer(d.timer);
          drivers.delete(tabId);
          refs.delete(tabId);
          for (const [id, h] of held) if (h.tabId === tabId) held.delete(id);
          await cdp.detach(tabId);
          traffic.forget(tabId);
          emit({ event: "driving", on: false, agent: d.agent.id, tab: tabId, why: by === "person" ? "stopped by the person" : "the person took over" });
          await draw(tabId, d.agent, by === "person" ? "stopped" : "takeover");
        } else await release(tabId, "stopped by the agent");
      }
      emit({ event: by === "esc" ? "paused" : by === "takeover" ? "takeover" : "stopped", agent: agentId, by, ...(reason ? { reason: String(reason).slice(0, 200) } : {}) });
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
      emit({ event: "held", agent: call.agent.id, name: call.agent.name, space: call.space, id, kind: what.kind, why: what.why, summary: what.summary, tab: tabId, ...(what.card ? { card: what.card } : {}) });
      const d = drivers.get(tabId);
      if (d) void draw(tabId, d.agent);
      return id;
    },
    /** Take a held item out for chrome_send: only the agent and Space that reached it, only before it expires. @param {{ agent: AgentRef, space: string }} call @param {string} id */
    take(call, id) {
      const h = held.get(id);
      if (!h || h.expires < now() || h.agentId !== call.agent.id || h.space !== call.space) fail("held_gone");
      held.delete(id);
      const d = drivers.get(h.tabId);
      if (d) void draw(h.tabId, d.agent);
      return h;
    },
    /** The held items of one agent, as the approval card shows them. @param {string} agentId */
    heldOf: (agentId) => [...held.values()].filter((h) => h.agentId === agentId && h.expires >= now()).map((h) => ({ id: h.id, kind: h.kind, summary: h.summary, tab: h.tabId, ...(h.card ? { card: h.card } : {}) })),
    /** @param {string} agentId */
    heldIds: (agentId) => [...held.values()].filter((h) => h.agentId === agentId && h.expires >= now()).map((h) => h.id),

    /** The person chose Don't send in Vyre: forget the item, so the agent cannot press it later. @param {string} id */
    dropHeld(id) { const h = held.get(id); if (!h) return false; held.delete(id); const d = drivers.get(h.tabId); if (d) void draw(h.tabId, d.agent); return true; },

    // ---- goal line
    /** @param {string} agentId */
    goalOf: (agentId) => goals.get(agentId) ?? "",
    /** The agent whose Take over or Stopped bar is on this tab. @param {number} tabId */
    shownAgent: (tabId) => shown.get(tabId) ?? null,
    /** One step of the plan is done (an acting tool succeeded): the bar counts it and the chat's checklist follows. @param {string} agentId */
    advance(agentId) {
      const p = plans.get(agentId);
      if (!p || p.done >= p.total) return null;
      p.done++;
      for (const [tabId, d] of drivers) if (d.agent.id === agentId) void draw(tabId, d.agent);
      return { total: p.total, done: p.done, steps: p.steps };
    },
    /** @param {AgentRef} agent @param {string} goal @param {string[]} [steps] */
    async setGoal(agent, goal, steps = []) {
      goals.set(agent.id, goal);
      plans.set(agent.id, { total: steps.length, done: 0, steps });
      for (const [tabId, d] of drivers) if (d.agent.id === agent.id) await draw(tabId, agent);
    },
    /** Everything off: the worker is going away or the Space was closed. */
    async releaseAll() { for (const tabId of [...drivers.keys()]) await release(tabId, "closed"); },
  };
}
