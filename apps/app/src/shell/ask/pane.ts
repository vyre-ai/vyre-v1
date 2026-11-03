// The Ask pane of a place (owner rule, rc.17): Ask Vyre opens beside the thing it is about, in the place the person pressed it, and never navigates to Chats. Every Ask door in the app (the Ask
// buttons, Cmd-K, the record, file, Vault, Settings and Inbox heads, the start pages) opens the one pane through `openAskPane`; the shell draws it (AskPaneHost) next to the place.
// One pane per place: it stays open while the person moves around inside the place and comes back as it was when they return. The thread behind it is one per thing per person
// (the newest Ask about that thing with that agent), so asking again about the same thing continues it; New starts a fresh one. No React here.
import { currentScreen } from "./screen.ts";
import type { ScreenContext } from "./screen.ts";

/** The side the pane opens on. The Ask buttons sit at the top right of place heads, and the owner confirmed it: the right. Flip it here, and only here. */
export const ASK_SIDE: "right" | "left" = "right";

/** What the pane is about: one object (a record, a file, an automation, a Vault item, a Settings page, an Inbox conversation, a task), as its kind, id and name. */
export interface AskThing { kind: string; id: string; title?: string }

/** What a door asks for. Only `thing` (or null, the place itself) is needed. */
export interface AskRequest {
  thing: AskThing | null;
  /** The agent to ask: "assistant" (the default) is the person's own assistant. */
  agentId?: string;
  /** A ready-made first message that starts a session of its own about the thing (Add to Automations, Build a connector). */
  first?: string;
  /** "Bring this conversation": the chat whose summary a new Ask starts from. */
  bringFrom?: string;
  /** Text put in the composer, not sent. */
  draft?: string;
  /** The quiet line at the top of the pane. A default is said for the thing when absent. */
  hint?: string;
  /** What the agent is told beyond the thing: the actions the place offers, the open screen's title, a selection, the focus skill. Ids and names only, never content. */
  context?: Partial<Omit<ScreenContext, "place">>;
}

export interface AskPaneState extends AskRequest {
  place: string;
  agentId: string;
  /** How many times New was pressed on this thing: each press is a fresh thread. */
  fresh: number;
  /** Bumped by every open, so asking again about the same thing focuses the pane again. */
  seq: number;
}

/** The places with a focus skill of their own (agent/skills/focus-<place>), the same list the screen context uses. */
const FOCUS = new Set(["records", "files", "automations", "vault", "inbox", "apps", "console"]);

const PLACE_TITLE: Readonly<Record<string, string>> = {
  home: "Home", records: "Records", files: "Files", automations: "Automations", vault: "Vault", inbox: "Inbox", settings: "Settings", console: "Console", apps: "Apps", tasks: "Tasks", chats: "Chats",
};
export const placeTitle = (place: string): string => PLACE_TITLE[place] ?? place.charAt(0).toUpperCase() + place.slice(1);

/** The width of the pane is remembered per place (ui/SidePane keeps it under this key). */
export const askPaneKey = (place: string): string => `ask-${place}`;

/** The thread scope of a pane: the thing it is about, else the place itself (`records`/`place`, the scope the Records and Automations panes have always used, so their threads carry on). */
export function askScope(place: string, thing: AskThing | null): { scopeType: string; scopeId: string } {
  if (thing) return { scopeType: thing.kind, scopeId: thing.id };
  return { scopeType: /^[a-z][a-z0-9_]{0,31}$/.test(place) ? place : "place", scopeId: "place" };
}

/** The title an Ask thread is listed under in Chats (Ask history). */
export function askTitle(place: string, thing: AskThing | null): string {
  return thing?.title ? `Ask about ${thing.title}` : `Ask in ${placeTitle(place)}`;
}

/** The chip at the top of the pane: what it is about. Null when it is about the place. */
export function askChip(thing: AskThing | null): string | null {
  if (!thing) return null;
  return thing.title && thing.title !== "" ? thing.title : thing.kind.replace(/_/g, " ");
}

/** The line under the chip. */
export function askLine(s: Pick<AskPaneState, "place" | "thing" | "hint">): string {
  if (s.hint) return s.hint;
  if (s.thing) return `Ask about ${askChip(s.thing)}. I can see it and work on it with you.`;
  return `Ask about anything in ${placeTitle(s.place)}.`;
}

/** What the agent is told with every message sent in the pane: the place, the thing as the open object, and what the door added. Removing the chip drops the thing and what came with it. */
export function askScreen(s: Pick<AskPaneState, "place" | "thing" | "context">): ScreenContext {
  const extra = s.context ?? {};
  const open = s.thing ? [{ type: s.thing.kind, id: s.thing.id, ...(s.thing.title ? { title: s.thing.title } : {}) }] : undefined;
  return {
    place: s.place,
    title: s.thing?.title ? `${placeTitle(s.place)}, ${s.thing.title}` : placeTitle(s.place),
    ...(open ? { open } : {}),
    ...(FOCUS.has(s.place) ? { focus: `focus-${s.place}` } : {}),
    ...extra,
  };
}

/** The key the pane's thread is resolved by: the agent, the scope, an opening message and New. Any change finds (or makes) another thread. */
export function threadKey(s: Pick<AskPaneState, "place" | "thing" | "agentId" | "first" | "fresh">): string {
  const sc = askScope(s.place, s.thing);
  return [s.agentId, sc.scopeType, sc.scopeId, s.first ?? "", String(s.fresh)].join("|");
}

/* ---------- the store: one pane per place ---------- */

const panes = new Map<string, AskPaneState>();
const listeners = new Set<() => void>();
let seq = 0;
const tell = (): void => { for (const l of listeners) l(); };

/** The place the person is in: the one the shell last told the screen context about. */
export function activePlace(): string | null {
  return currentScreen()?.place ?? null;
}

/** Open the pane in `place` (by default the place the person is in) about the request's thing. The same thing with the same agent continues its thread. */
export function openAskPane(req: AskRequest, place: string | null = activePlace()): AskPaneState | null {
  if (place === null) return null;
  const was = panes.get(place);
  const agentId = req.agentId ?? "assistant";
  const same = was !== undefined && was.agentId === agentId && sameThing(was.thing, req.thing) && (was.first ?? "") === (req.first ?? "");
  const next: AskPaneState = { ...req, place, agentId, fresh: same ? was.fresh : 0, seq: ++seq };
  panes.set(place, next);
  tell();
  return next;
}

export function closeAskPane(place: string): void {
  if (!panes.delete(place)) return;
  tell();
}

/** New: a fresh thread about the same thing. Reopening Ask on the thing afterwards continues the new one (the newest). */
export function newAsk(place: string): void {
  const was = panes.get(place);
  if (!was) return;
  const { first: _first, bringFrom: _bring, draft: _draft, ...rest } = was;
  panes.set(place, { ...rest, fresh: was.fresh + 1, seq: ++seq });
  tell();
}

/** The chip's x: the pane is about the place again, and what the door said about the thing goes with it. */
export function dropAskThing(place: string): void {
  const was = panes.get(place);
  if (!was || was.thing === null) return;
  panes.set(place, { place, agentId: was.agentId, thing: null, fresh: 0, seq: ++seq });
  tell();
}

/** The agent dropdown: the same thing, asked of another agent (that agent's thread on it). */
export function switchAskAgent(place: string, agentId: string): void {
  const was = panes.get(place);
  if (!was || was.agentId === agentId) return;
  const { first: _first, ...rest } = was;
  panes.set(place, { ...rest, agentId, fresh: 0, seq: ++seq });
  tell();
}

export function askPaneOf(place: string): AskPaneState | null {
  return panes.get(place) ?? null;
}

export function subscribeAskPane(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Tests start from no panes. */
export function resetAskPanes(): void {
  panes.clear();
  tell();
}

function sameThing(a: AskThing | null, b: AskThing | null): boolean {
  return a === null || b === null ? a === b : a.kind === b.kind && a.id === b.id;
}

/** The thing a screen context names (Cmd-K, Ask Vyre about this): its first open object, else the place. */
export function thingOfScreen(s: ScreenContext | null): AskThing | null {
  const o = s?.open?.[0];
  return o ? { kind: o.type, id: o.id, ...(o.title ? { title: o.title } : {}) } : null;
}
