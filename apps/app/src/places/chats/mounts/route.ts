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
  | { view: "helper"; threadId: string };

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
  computer: "chats.computer-popup",
  agentComputer: "chats.agent-computer",
  recording: "chats.recording-sheet",
  connect: "chats.connect-outside-agent",
  allAgents: "chats.all-agents",
  terminalTab: "chats.terminal-tab",
  terminalList: "chats.terminal-list",
  terminalRules: "chats.terminal-rules",
} as const;

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
    case SCREEN.conversation: return arg("threadId") === "" ? START : step(START, { t: "chat", threadId: arg("threadId") });
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
