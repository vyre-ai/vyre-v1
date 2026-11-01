// The screen context of Ask Vyre (CHAT-DESIGN ruling 3): where the person is, as ids, never content. The shell derives it from the place and the tab hash every time they change, and a message
// sent in an Ask pane carries the latest one, so the agent knows which object "this" is. A place with more to say (rows on screen, a selection, filters) adds to it with `addScreen`.
// The Chats place itself never sets it: an Ask pane is opened from another place, and that place is what the agent should hear about.
import { parseHash } from "../hash/hash.ts";

export interface ScreenObject { type: string; id: string; title?: string }
export interface ScreenContext {
  place: string;
  title?: string;
  open?: ScreenObject[];
  selection?: ScreenObject[];
  filters?: Record<string, string | string[]>;
  rows?: { shown: number; total?: number; sample?: string[] };
  actions?: string[];
  focus?: string;
}

/** The places that have a focus skill of their own (agent/skills/focus-<place>). */
const FOCUS = new Set(["records", "files", "automations", "vault", "inbox", "apps", "console"]);

/** The context a place and its tab hash say: the place, the screen id, and the open object the hash names. */
export function screenFromHash(place: string, hash: string): ScreenContext {
  const t = parseHash(hash);
  return {
    place,
    ...(t.screen ? { title: t.screen } : {}),
    ...(t.subject ? { open: [{ type: t.subject.type, id: t.subject.id }] } : {}),
    ...(FOCUS.has(place) ? { focus: `focus-${place}` } : {}),
  };
}

/** An Ask opened in Chats: the object its address names. Null for any other chat. */
export function screenOfAsk(hash: string): ScreenContext | null {
  const about = parseHash(hash).args["about"];
  const at = about === undefined ? -1 : about.indexOf(":");
  return at > 0 && about !== undefined ? { place: "chats", open: [{ type: about.slice(0, at), id: about.slice(at + 1) }] } : null;
}

let base: ScreenContext | null = null;
let extra: Partial<ScreenContext> = {};
const listeners = new Set<() => void>();

/** The shell says the place or its hash changed. What a place added before is dropped: it described the page the person has left. */
export function setScreenContext(c: ScreenContext | null): void {
  base = c;
  extra = {};
  for (const l of listeners) l();
}

/** A place adds what it knows beyond the hash: the visible rows, a selection, filters, the actions it offers. */
export function addScreen(more: Partial<Omit<ScreenContext, "place">>): void {
  extra = { ...extra, ...more };
  for (const l of listeners) l();
}

export function currentScreen(): ScreenContext | null {
  return base ? { ...base, ...extra, place: base.place } : null;
}

export function subscribeScreen(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** The kind of each thread the Chats place has open, noted when it loads. Only an Ask pane's messages carry the screen: a plain chat is not about a screen. */
const KIND = new Map<string, string>();
export function noteThreadKind(threadId: string, kind: string): void { KIND.set(threadId, kind); }
export const carriesScreen = (threadId: string): boolean => KIND.get(threadId) === "ask";
