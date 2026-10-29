// What the Chats place is showing, as plain data (P-L9b_23). One `Shown` says which page fills the middle (a chat, the Needs you page, an agent's page, a helper), whether the
// agent pane is open, which terminal sits beside the chat, and which layer is up over it (the computer popup, the recording sheet, Connect an outside agent, the All agents picker,
// the terminal list, the terminal rules). Every click in the place is one `Act`; `step` is the only thing that changes a `Shown`, so a test can press the face, the helper icon,
// the channel menu or the Computer chip by calling the same function the screen calls, and read the result. A link from another place (`screen=chats.agent-page&agentId=...`)
// becomes the first `Shown` through `fromHash`.
import type { TabKey } from "../agentpage/model.ts";
import { isTabKey } from "../agentpage/model.ts";
import { LOCAL_PREFIX } from "../sidebar/model.ts";
import type { CapMap } from "../../../../../../generated/types.ts";

type RecentOut = CapMap["chat.recent"]["out"];

export type Route =
  | { view: "chat"; threadId: string | null }
  | { view: "needs"; taskId: string | null }
  | { view: "agent"; agentId: string; tab: TabKey | null }
  | { view: "helper"; threadId: string }
  /** An Ask about an object with an agent: resolved to the person's Ask thread on it (the newest one, else a new one), which then opens as a chat. With no object it is the person's chat with that agent. */
  | { view: "ask"; agentId: string; scopeType: string; scopeId: string; bringFrom: string | null };

export type Layer =
  | { kind: "computer"; computerId: string; chat: boolean }
  | { kind: "recording"; recordingId: string }
  | { kind: "connect"; channelId: string }
  | { kind: "all-agents"; x: number; y: number }
  | { kind: "terminals"; x: number; y: number }
  | { kind: "rules" };

export interface Shown {
  route: Route;
  pane: boolean;
  /** The terminal drawn beside the chat, as a side tab. */
  terminalId: string | null;
  layer: Layer | null;
}

export const START: Shown = { route: { view: "chat", threadId: null }, pane: false, terminalId: null, layer: null };

export type Act =
  /** `pane` opens the agent's pane beside the chat (a click on an agent). */
  | { t: "chat"; threadId: string; pane?: boolean }
  | { t: "helper"; threadId: string }
  | { t: "ask"; agentId: string; scopeType: string; scopeId: string; bringFrom?: string }
  | { t: "needs"; taskId?: string }
  | { t: "agent"; agentId: string; tab?: TabKey }
  | { t: "pane" }
  | { t: "terminal"; terminalId: string }
  | { t: "terminal-close" }
  | { t: "layer"; layer: Layer }
  | { t: "layer-close" };

export function step(s: Shown, a: Act): Shown {
  switch (a.t) {
    case "chat": return a.threadId.startsWith(LOCAL_PREFIX) ? s : { ...s, route: { view: "chat", threadId: a.threadId === "" ? null : a.threadId }, ...(a.pane ? { pane: true, terminalId: null } : {}), layer: null };
    case "helper": return { ...s, route: { view: "helper", threadId: a.threadId }, layer: null };
    case "ask": return { ...s, route: { view: "ask", agentId: a.agentId, scopeType: a.scopeType, scopeId: a.scopeId, bringFrom: a.bringFrom ?? null }, layer: null };
    case "needs": return { ...s, route: { view: "needs", taskId: a.taskId ?? null }, layer: null };
    case "agent": return { ...s, route: { view: "agent", agentId: a.agentId, tab: a.tab ?? null }, layer: null };
    // One column on the right: the agent's pane or the terminal. The pane button closes whichever is showing, or opens the pane.
    case "pane": return s.terminalId !== null ? { ...s, terminalId: null } : { ...s, pane: !s.pane };
    case "terminal": return { ...s, terminalId: a.terminalId, pane: false, layer: null };
    case "terminal-close": return { ...s, terminalId: null };
    case "layer": return { ...s, layer: a.layer };
    case "layer-close": return { ...s, layer: null };
  }
}

/** The newest chat or channel the Space has, in the order the sidebar lists them. */
export function newestThread(recent: RecentOut | undefined): string | null {
  if (!recent) return null;
  for (const g of [recent.starred, recent.today, recent.yesterday, recent.earlier]) {
    const first = g.find((i) => !i.threadId.startsWith(LOCAL_PREFIX));
    if (first) return first.threadId;
  }
  return null;
}

/** Screens of the generated registry this place draws, and the link that opens each (the shell turns `rt.open({ screen, args })` into this hash). */
export const SCREEN = {
  agent: "chats.agent-page",
  helper: "chats.helper-chat",
  needs: "tasks.needs-you",
  conversation: "chats.conversation",
  ask: "chats.ask",
  computer: "chats.computer-popup",
  agentComputer: "chats.agent-computer",
  recording: "chats.recording-sheet",
  connect: "chats.connect-outside-agent",
  allAgents: "chats.all-agents",
  terminalTab: "chats.terminal-tab",
  terminalList: "chats.terminal-list",
  terminalRules: "chats.terminal-rules",
} as const;

/** What a chat is the workspace of: the record, project, task or run it is tied to. DMs, channels and Ask panes (their own door) have none. */
export interface Work { type: "record" | "project" | "task" | "run"; id: string }
export function workOf(t: { kind?: string; recordId?: string; scopeType?: string; scopeId?: string }): Work | null {
  if (t.kind !== "chat" && t.kind !== "thread") return null;
  const id = t.recordId ?? (t.scopeType === "record" || t.scopeType === "project" || t.scopeType === "task" || t.scopeType === "run" ? t.scopeId : undefined);
  if (!id) return null;
  // a task or a run keeps its own page; everything else is a record, or a project when it is one
  if (t.scopeType === "task" || id.startsWith("tsk_")) return { type: "task", id };
  if (t.scopeType === "run" || id.startsWith("run_")) return { type: "run", id };
  return { type: id.startsWith("prj_") || t.scopeType === "project" ? "project" : "record", id };
}

/** `record:rec_1` as the object an Ask is about. Null when it is not that shape. */
export function askAbout(v: string): { type: string; id: string } | null {
  const m = /^([a-z][a-z0-9_]{0,31}):(.{1,200})$/.exec(v);
  return m ? { type: m[1]!, id: m[2]! } : null;
}

/** The first `Shown` for a link from another place, or the start when the link is not for this place. */
export function fromHash(hash: string): Shown {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const screen = p.get("screen") ?? "";
  const arg = (k: string): string => p.get(k) ?? "";
  const fixed = { x: 8, y: 48 };
  switch (screen) {
    case SCREEN.agent: { const tab = arg("tab"); return arg("agentId") === "" ? START : step(START, { t: "agent", agentId: arg("agentId"), ...(isTabKey(tab) ? { tab } : {}) }); }
    case SCREEN.helper: return arg("threadId") === "" ? START : step(START, { t: "helper", threadId: arg("threadId") });
    case SCREEN.needs: return step(START, { t: "needs", ...(arg("taskId") === "" ? {} : { taskId: arg("taskId") }) });
    // `with` is the agent and `about` the object (`record:rec_1`): an Ask, not a chat. A conversation link with a thread id is still that thread.
    case SCREEN.conversation: case SCREEN.ask: {
      const about = askAbout(arg("about"));
      if (arg("threadId") !== "") return step(START, { t: "chat", threadId: arg("threadId") });
      if (about !== null && arg("with") !== "") return step(START, { t: "ask", agentId: arg("with"), scopeType: about.type, scopeId: about.id, ...(arg("bring") === "" ? {} : { bringFrom: arg("bring") }) });
      // `with` alone is a chat with that agent: the open chat it leads, else a new one.
      return arg("with") === "" ? START : step(START, { t: "ask", agentId: arg("with"), scopeType: "", scopeId: "" });
    }
    case SCREEN.computer: case SCREEN.agentComputer: return arg("computerId") === "" ? START : step(START, { t: "layer", layer: { kind: "computer", computerId: arg("computerId"), chat: false } });
    case SCREEN.recording: return arg("recordingId") === "" ? START : step(START, { t: "layer", layer: { kind: "recording", recordingId: arg("recordingId") } });
    case SCREEN.connect: return arg("channelId") === "" ? START : step(START, { t: "layer", layer: { kind: "connect", channelId: arg("channelId") } });
    case SCREEN.allAgents: return step(START, { t: "layer", layer: { kind: "all-agents", ...fixed } });
    case SCREEN.terminalList: return step(START, { t: "layer", layer: { kind: "terminals", ...fixed } });
    case SCREEN.terminalRules: return step(START, { t: "layer", layer: { kind: "rules" } });
    case SCREEN.terminalTab: return arg("terminalId") === "" ? START : step(START, { t: "terminal", terminalId: arg("terminalId") });
    default: return START;
  }
}

/** Where a popover opens: under the control that has the focus (a mouse press and a key press both leave it there), never at the pointer. */
export function anchorOfFocus(fallback: { x: number; y: number } = { x: 8, y: 48 }): { x: number; y: number } {
  const doc = (globalThis as { document?: { activeElement?: { getBoundingClientRect?: () => { left: number; bottom: number; width: number; height: number } } | null } }).document;
  const box = doc?.activeElement?.getBoundingClientRect?.();
  if (!box || (box.width === 0 && box.height === 0)) return fallback;
  return { x: box.left, y: box.bottom + 4 };
}
