// ui/AskButton logic, pure so it is tested without a renderer. Mirrors the prototype's VyreUI.ask:
// which agent shows, how the picker is sectioned and filtered, how the arrows move, which modes the viewer's access allows.

import type { AskAccess, AskAgent, AskContext, AskMode, AskStorage, PickerEntry } from "./types.ts";

export const STORAGE_PREFIX = "vyre-ui:";
export const RECENT_KEY = "ask:recent";
export const RECENT_MAX = 4;
export const NARROW_PARENT_PX = 230;
export const ASSISTANT_NOTE = "Your assistant in this Space";
export const SUGGESTED_NOTE = "Tied to this";

/** In-memory storage; also the fallback when the browser blocks localStorage. */
export function memoryStorage(): AskStorage {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
  };
}

/** localStorage with every access wrapped, so a private window or blocked storage never throws. */
export function webStorage(): AskStorage | null {
  try {
    const host = globalThis as { localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } };
    const ls = host.localStorage;
    if (ls === undefined) return null;
    return {
      get: (key) => {
        try {
          return ls.getItem(STORAGE_PREFIX + key);
        } catch {
          return null;
        }
      },
      set: (key, value) => {
        try {
          ls.setItem(STORAGE_PREFIX + key, value);
        } catch {
          // nothing to undo; the pick lives in memory for this session
        }
      },
    };
  } catch {
    return null;
  }
}

/** Storage that keeps picks in memory too, so a blocked localStorage still remembers within the session. */
export function layeredStorage(primary: AskStorage | null): AskStorage {
  const memory = memoryStorage();
  if (primary === null) return memory;
  return {
    get: (key) => memory.get(key) ?? primary.get(key),
    set: (key, value) => {
      memory.set(key, value);
      primary.set(key, value);
    },
  };
}

export function placeKey(place: string): string {
  return `ask:${place}`;
}

/** The per-item key, or null when the item has no id. */
export function itemKey(place: string, context: AskContext | null): string | null {
  if (context === null || context.id === "") return null;
  return `ask:${place}:${context.kind}:${context.id}`;
}

export function findAgent(agents: readonly AskAgent[], id: string | null | undefined): AskAgent | null {
  if (id === null || id === undefined || id === "") return null;
  return agents.find((agent) => agent.id === id) ?? null;
}

/** The Space assistant: the flagged one, else the one named Assistant, else the first agent. */
export function assistantOf(agents: readonly AskAgent[]): AskAgent | null {
  return agents.find((agent) => agent.assistant === true) ?? agents.find((agent) => agent.name === "Assistant") ?? agents[0] ?? null;
}

export interface ResolveInput {
  agents: readonly AskAgent[];
  place: string;
  context: AskContext | null;
  suggested?: string | undefined;
  storage: AskStorage;
}

/** The agent the control shows: the one picked for this same item, else the suggested one, else the last pick in this place, else the assistant. */
export function resolveAgent(input: ResolveInput): AskAgent | null {
  const key = itemKey(input.place, input.context);
  const forItem = key === null ? null : findAgent(input.agents, input.storage.get(key));
  return forItem ?? findAgent(input.agents, input.suggested) ?? findAgent(input.agents, input.storage.get(placeKey(input.place))) ?? assistantOf(input.agents);
}

/** True when pressing the main button can go straight to a thread: an agent is tied to this item or was picked for it. */
export function hasDefault(input: ResolveInput): boolean {
  const key = itemKey(input.place, input.context);
  return findAgent(input.agents, input.suggested) !== null || (key !== null && findAgent(input.agents, input.storage.get(key)) !== null);
}

export function readRecents(storage: AskStorage): string[] {
  const raw = storage.get(RECENT_KEY);
  if (raw === null || raw === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function pushRecent(storage: AskStorage, id: string): string[] {
  const next = [id, ...readRecents(storage).filter((x) => x !== id)].slice(0, RECENT_MAX);
  storage.set(RECENT_KEY, JSON.stringify(next));
  return next;
}

/** Remembers the pick for the place and for the item, and in the recents. */
export function rememberPick(storage: AskStorage, place: string, context: AskContext | null, agent: AskAgent): void {
  storage.set(placeKey(place), agent.id);
  const key = itemKey(place, context);
  if (key !== null) storage.set(key, agent.id);
  pushRecent(storage, agent.id);
}

export interface PickerInput {
  agents: readonly AskAgent[];
  current: AskAgent | null;
  suggested: AskAgent | null;
  recents: readonly string[];
  query?: string;
}

/**
 * The picker, in the prototype's order: Suggested, Recent (at most three, never the current or suggested one), Assistant, then Agents.
 * A query hides the section titles and keeps every agent whose name or role contains it.
 */
export function pickerEntries(input: PickerInput): PickerEntry[] {
  const assistant = assistantOf(input.agents);
  const note = (agent: AskAgent, fallback: string): string => (agent.role !== undefined && agent.role !== "" ? agent.role : fallback);
  const entry = (agent: AskAgent, fallback: string): PickerEntry => ({
    kind: "agent",
    label: agent.name,
    agent,
    note: note(agent, fallback),
    current: input.current !== null && input.current.id === agent.id,
  });
  const query = (input.query ?? "").trim().toLowerCase();
  if (query !== "") {
    return input.agents
      .filter((agent) => `${agent.name} ${agent.role ?? ""}`.toLowerCase().includes(query))
      .map((agent) => entry(agent, agent === assistant ? ASSISTANT_NOTE : ""));
  }
  const recent: AskAgent[] = [];
  for (const id of input.recents) {
    const agent = findAgent(input.agents, id);
    if (agent === null || recent.includes(agent)) continue;
    if (input.current !== null && agent.id === input.current.id) continue;
    if (input.suggested !== null && agent.id === input.suggested.id) continue;
    recent.push(agent);
    if (recent.length === 3) break;
  }
  const rest = input.agents.filter((agent) => agent !== assistant && agent !== input.suggested && !recent.includes(agent));
  const out: PickerEntry[] = [];
  if (input.suggested !== null) {
    out.push({ kind: "head", label: "Suggested" }, entry(input.suggested, SUGGESTED_NOTE));
  }
  if (recent.length > 0) {
    out.push({ kind: "head", label: "Recent" }, ...recent.map((agent) => entry(agent, "")));
  }
  if (assistant !== null && assistant !== input.suggested) {
    out.push({ kind: "head", label: "Assistant" }, entry(assistant, ASSISTANT_NOTE));
  }
  if (rest.length > 0) {
    out.push({ kind: "head", label: "Agents" }, ...rest.map((agent) => entry(agent, "")));
  }
  return out;
}

/** Indices of the rows a person can land on. */
export function agentIndices(entries: readonly PickerEntry[]): number[] {
  const out: number[] = [];
  entries.forEach((entry, index) => {
    if (entry.kind === "agent") out.push(index);
  });
  return out;
}

export type PickerKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

/** Next row for an arrow key. Wraps. `from` is -1 when nothing is lit. */
export function movePicker(entries: readonly PickerEntry[], from: number, key: PickerKey): number {
  const list = agentIndices(entries);
  if (list.length === 0) return -1;
  if (key === "Home") return list[0] ?? -1;
  if (key === "End") return list[list.length - 1] ?? -1;
  const at = list.indexOf(from);
  if (key === "ArrowDown") return list[at < 0 ? 0 : (at + 1) % list.length] ?? -1;
  return list[at < 0 ? list.length - 1 : (at - 1 + list.length) % list.length] ?? -1;
}

/** The chip text a new thread carries. */
export function aboutLine(context: AskContext | null): string {
  if (context === null) return "";
  return `About ${context.title !== "" ? context.title : context.kind !== "" ? context.kind : "this"}`;
}

export function levelOf(access: AskAccess | boolean | string | undefined): AskAccess {
  if (access === "view" || access === "use" || access === "edit" || access === "manage") return access;
  return access === true ? "edit" : "view";
}

/** Do it needs at least Use: with View the agent can only explain and compare. */
export function modesFor(modes: readonly AskMode[] | undefined, access: AskAccess): AskMode[] {
  const asked: AskMode[] = modes === undefined || modes.length === 0 ? ["chat"] : modes.slice();
  const allowed = access === "view" ? asked.filter((mode) => mode !== "do") : asked;
  return allowed.length === 0 ? ["chat"] : allowed;
}

/** True when a main press must offer a choice between Do it and Chat about it. */
export function offersChoice(modes: readonly AskMode[]): boolean {
  return modes.includes("do") && modes.includes("chat");
}

/** The tooltip and accessible name of the main button. */
export function mainLabel(agent: AskAgent, context: AskContext | null): string {
  return `Ask ${agent.name}${context === null ? "" : ` about ${context.title !== "" ? context.title : context.kind !== "" ? context.kind : "this"}`}`;
}

/** The control narrows (icon only) when the space around it is smaller than this. */
export function isNarrow(parentWidth: number): boolean {
  return parentWidth > 0 && parentWidth < NARROW_PARENT_PX;
}

/** Keeps a panel inside the window with a small margin. */
export function clampPanel(x: number, y: number, width: number, height: number, viewW: number, viewH: number, margin = 6): { left: number; top: number } {
  return {
    left: Math.max(margin, Math.min(x, viewW - width - margin)),
    top: Math.max(margin, Math.min(y, viewH - height - margin)),
  };
}

/** Cmd-J or Ctrl-J, no other modifier. */
export function isAskShortcut(event: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }): boolean {
  return (event.metaKey === true || event.ctrlKey === true) && event.shiftKey !== true && event.altKey !== true && event.key.toLowerCase() === "j";
}
