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
  /** `focus`: a message to open on and mark (a link from memory `...&m=<messageId>`, a search result or the link a fork starts with). */
  | { view: "chat"; threadId: string | null; focus?: string; /** counts each time the same message is asked for again, so it is marked again */ focusN?: number }
  /** The first screen: a new chat, with what needs you and what is running under the composer. */
  | { view: "new" }
  /** Tasks and one task's page: the routes the Tasks lane fills. */
  | { view: "tasks" }
  | { view: "task"; taskId: string }
  /** One goal's page, with its chat under it. */
  | { view: "goal"; goalId: string }
  /** The threads you are in. */
  | { view: "threads" }
  /** What models made to show you. */
  | { view: "artifacts" }
  /** Your notes: the grid. `noteId` opens one (a search hit, a link); `take` opens Take a note (each new number opens it again). */
  | { view: "notes"; noteId?: string; take?: number }
  /** One page to make an agent (null) or change one. */
  | { view: "agent-form"; agentId: string | null }
  | { view: "search"; q: string; from: string | null }
  | { view: "needs"; taskId: string | null }
  /** Tasks: the list. */
  | { view: "tasks" }
  /** One task's page, in its own tab. */
  | { view: "task"; taskId: string }
  | { view: "agent"; agentId: string; tab: TabKey | null }
  | { view: "helper"; threadId: string }
  /** An imported coding session: its saved transcript, read-only, with Continue here. */
  | { view: "imported"; conversationId: string }
  /** An Ask about an object with an agent: resolved to the person's Ask thread on it (the newest one, else a new one), which then opens as a chat. With no object it is the person's chat with that agent. */
  | { view: "ask"; agentId: string; scopeType: string; scopeId: string; bringFrom: string | null; draft?: string; first?: string };

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
  /** An inline thread open beside its message (the chat stays put): on a computer in the right column, on a phone as a sheet over the chat. */
  side?: string | null;
}

export const START: Shown = { route: { view: "new" }, pane: false, terminalId: null, layer: null };

export type Act =
  /** `pane` opens the agent's pane beside the chat (a click on an agent). */
  | { t: "chat"; threadId: string; pane?: boolean; focus?: string; /** the inline thread to open beside the chat */ side?: string }
  /** Close the thread beside the chat (Escape, its close button). */
  | { t: "side-close" }
  | { t: "new" }
  | { t: "tasks" }
  | { t: "task"; taskId: string }
  | { t: "goal"; goalId: string }
  | { t: "threads" }
  | { t: "artifacts" }
  | { t: "notes"; noteId?: string; take?: boolean }
  | { t: "agent-form"; agentId?: string }
  /** Search every chat. `q` starts the box with those words. */
  | { t: "search"; q?: string }
  | { t: "search-close" }
  | { t: "helper"; threadId: string }
  | { t: "imported"; conversationId: string }
  | { t: "ask"; agentId: string; scopeType: string; scopeId: string; bringFrom?: string; draft?: string; first?: string }
  | { t: "needs"; taskId?: string }
  | { t: "tasks" }
  | { t: "task"; taskId: string }
  | { t: "agent"; agentId: string; tab?: TabKey }
  | { t: "pane" }
  /** Opens the agent's pane whatever it showed (the message menu's "Show what the agent knew here"). */
  | { t: "pane-open" }
  | { t: "terminal"; terminalId: string }
  | { t: "terminal-close" }
  | { t: "layer"; layer: Layer }
  | { t: "layer-close" };

export function step(s: Shown, a: Act): Shown {
  switch (a.t) {
    case "chat": {
      if (a.threadId.startsWith(LOCAL_PREFIX)) return s;
      const same = s.route.view === "chat" && s.route.threadId === a.threadId;
      // the same message asked for again (the box at the top of its thread) is marked again
      const n = same && s.route.view === "chat" && a.focus !== undefined && s.route.focus === a.focus ? (s.route.focusN ?? 0) + 1 : 0;
      // a thread beside the chat stays while the chat does, and goes when another one opens
      const side = a.side ?? (same ? s.side ?? null : null);
      return {
        ...s, route: a.threadId === "" ? { view: "new" } : { view: "chat", threadId: a.threadId, ...(a.focus ? { focus: a.focus } : {}), ...(n > 0 ? { focusN: n } : {}) },
        ...(a.pane ? { pane: true, terminalId: null } : {}), side: a.threadId === "" ? null : side, layer: null,
      };
    }
    case "side-close": return { ...s, side: null };
    case "new": return { ...s, route: { view: "new" }, layer: null };
    case "goal": return { ...s, route: { view: "goal", goalId: a.goalId }, pane: false, terminalId: null, layer: null };
    case "threads": return { ...s, route: { view: "threads" }, layer: null };
    case "artifacts": return { ...s, route: { view: "artifacts" }, layer: null };
    case "notes": return { ...s, route: { view: "notes", ...(a.noteId ? { noteId: a.noteId } : {}), ...(a.take ? { take: (s.route.view === "notes" ? s.route.take ?? 0 : 0) + 1 } : {}) }, layer: null };
    case "agent-form": return { ...s, route: { view: "agent-form", agentId: a.agentId ?? null }, layer: null };
    case "search": return { ...s, route: { view: "search", q: a.q ?? "", from: s.route.view === "chat" ? s.route.threadId : s.route.view === "search" ? s.route.from : null }, layer: null };
    case "search-close": { const from = s.route.view === "search" ? s.route.from : null; return { ...s, route: from === null ? { view: "new" } : { view: "chat", threadId: from }, layer: null }; }
    case "helper": return { ...s, route: { view: "helper", threadId: a.threadId }, layer: null };
    case "imported": return { ...s, route: { view: "imported", conversationId: a.conversationId }, layer: null };
    case "ask": return { ...s, route: { view: "ask", agentId: a.agentId, scopeType: a.scopeType, scopeId: a.scopeId, bringFrom: a.bringFrom ?? null, ...(a.draft ? { draft: a.draft } : {}), ...(a.first ? { first: a.first } : {}) }, layer: null };
    // one Tasks door: a Needs you link opens Tasks, or the task it names (the old Needs you page is gone)
    case "needs": return a.taskId ? step(s, { t: "task", taskId: a.taskId }) : step(s, { t: "tasks" });
    case "tasks": return { ...s, route: { view: "tasks" }, pane: false, terminalId: null, layer: null };
    case "task": return { ...s, route: { view: "task", taskId: a.taskId }, pane: false, terminalId: null, layer: null };
    case "agent": return { ...s, route: { view: "agent", agentId: a.agentId, tab: a.tab ?? null }, layer: null };
    // One column on the right: the agent's pane or the terminal. The pane button closes whichever is showing, or opens the pane.
    case "pane": return s.terminalId !== null ? { ...s, terminalId: null } : { ...s, pane: !s.pane };
    case "pane-open": return { ...s, terminalId: null, pane: true };
    case "terminal": return { ...s, terminalId: a.terminalId, pane: false, layer: null };
    case "terminal-close": return { ...s, terminalId: null };
    case "layer": return { ...s, layer: a.layer };
    case "layer-close": return { ...s, layer: null };
  }
}

/**
 * What the middle shows, as the key the Chats sidebar selects its row by: `t:<thread>` a chat or a channel, `i:<conversation>` an imported transcript, `a:<agent>` an agent's page or its
 * form, and `tasks`, `threads`, `artifacts`, `notes`. Null for a page that has no row (a new chat, one task, search, Needs you, a helper). A tab switch, a link and Cmd-K all arrive as a route, so
 * the selection follows each of them.
 */
export function openKeyOf(r: Route): string | null {
  switch (r.view) {
    case "chat": return r.threadId ? `t:${r.threadId}` : null;
    case "tasks": case "threads": case "artifacts": case "notes": return r.view;
    case "goal": return `g:${r.goalId}`;
    case "imported": return `i:${r.conversationId}`;
    case "agent": return `a:${r.agentId}`;
    case "agent-form": return r.agentId ? `a:${r.agentId}` : null;
    default: return null;
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
  tasks: "tasks.my-work",
  task: "tasks.page",
  goal: "goals.page",
  threads: "chats.threads",
  artifacts: "chats.artifacts",
  notes: "chats.notes",
  agentForm: "chats.agent-form",
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

/** What a chat is the workspace of: the record or the project it is tied to. DMs, channels and Ask panes (their own door) have none. */
export interface Work { type: "record" | "project"; id: string }
export function workOf(t: { kind?: string; recordId?: string; scopeType?: string; scopeId?: string }): Work | null {
  if (t.kind !== "chat" && t.kind !== "thread") return null;
  const id = t.recordId ?? (t.scopeType === "record" || t.scopeType === "project" ? t.scopeId : undefined);
  if (!id) return null;
  return { type: id.startsWith("prj_") || t.scopeType === "project" ? "project" : "record", id };
}

/** `record:rec_1` as the object an Ask is about. Null when it is not that shape. */
export function askAbout(v: string): { type: string; id: string } | null {
  const m = /^([a-z][a-z0-9_]{0,31}):(.{1,200})$/.exec(v);
  return m ? { type: m[1]!, id: m[2]! } : null;
}

export const TASKS_HASH = "screen=tasks.my-work";

/** The first `Shown` for a link from another place, or the start when the link is not for this place. */
export function fromHash(hash: string): Shown {
  // the route of Tasks: the Chats sidebar links here, and tabKey keeps it one tab of its own
  if (hash === TASKS_HASH || hash === "tasks") return step(START, { t: "tasks" });
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const screen = p.get("screen") ?? "";
  const arg = (k: string): string => p.get(k) ?? "";
  const fixed = { x: 8, y: 48 };
  const subject = /^(thread|chat|channel|task|goal):(.+)$/.exec(arg("subject"));
  if (subject?.[1] === "goal") return step(START, { t: "goal", goalId: subject[2]! });
  if (subject) return subject[1] === "task" ? step(START, { t: "task", taskId: subject[2]! }) : step(START, { t: "chat", threadId: subject[2]! });
  switch (screen) {
    case SCREEN.tasks: return step(START, { t: "tasks" });
    case SCREEN.task: return arg("taskId") === "" ? step(START, { t: "tasks" }) : step(START, { t: "task", taskId: arg("taskId") });
    case SCREEN.goal: return arg("goalId") === "" ? START : step(START, { t: "goal", goalId: arg("goalId") });
    case SCREEN.threads: return step(START, { t: "threads" });
    case SCREEN.artifacts: return step(START, { t: "artifacts" });
    case SCREEN.notes: return step(START, { t: "notes", ...(arg("noteId") === "" ? {} : { noteId: arg("noteId") }) });
    case SCREEN.agentForm: return step(START, { t: "agent-form", ...(arg("agentId") === "" ? {} : { agentId: arg("agentId") }) });
    case SCREEN.agent: { const tab = arg("tab"); return arg("agentId") === "" ? START : step(START, { t: "agent", agentId: arg("agentId"), ...(isTabKey(tab) ? { tab } : {}) }); }
    case SCREEN.helper: return arg("threadId") === "" ? START : step(START, { t: "helper", threadId: arg("threadId") });
    case SCREEN.needs: return step(START, { t: "needs", ...(arg("taskId") === "" ? {} : { taskId: arg("taskId") }) });
    // `with` is the agent and `about` the object (`record:rec_1`): an Ask, not a chat. A conversation link with a thread id is still that thread.
    case SCREEN.conversation: case SCREEN.ask: {
      const about = askAbout(arg("about"));
      if (arg("threadId") !== "") return step(START, { t: "chat", threadId: arg("threadId"), ...(arg("m") === "" ? {} : { focus: arg("m") }) });
      if (about !== null && arg("with") !== "") return step(START, { t: "ask", agentId: arg("with"), scopeType: about.type, scopeId: about.id, ...(arg("bring") === "" ? {} : { bringFrom: arg("bring") }), ...(arg("draft") === "" ? {} : { draft: arg("draft") }), ...(arg("first") === "" ? {} : { first: arg("first") }) });
      // `with` alone is a chat with that agent: the open chat it leads, else a new one.
      return arg("with") === "" ? START : step(START, { t: "ask", agentId: arg("with"), scopeType: "", scopeId: "", ...(arg("first") === "" ? {} : { first: arg("first") }) });
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

/**
 * Where a thread opens: a helper as the helper chat; a reply thread beside the message it hangs off (the chat stays put); a task's thread on its task; anything else as a chat.
 */
export type ThreadDoor = { t: "helper" | "chat" } | { t: "side"; parent: string; messageId: string } | { t: "task"; taskId: string };
export function threadDoor(t: { kind: string; parentThreadId?: string | undefined; parentMessageId?: string | undefined; scopeType?: string | undefined; scopeId?: string | undefined }): ThreadDoor {
  if (t.kind === "helper") return { t: "helper" };
  if (t.kind === "thread" && t.scopeType === "task" && t.scopeId) return { t: "task", taskId: t.scopeId };
  if (t.kind === "thread" && t.parentThreadId && t.parentMessageId) return { t: "side", parent: t.parentThreadId, messageId: t.parentMessageId };
  return { t: "chat" };
}
