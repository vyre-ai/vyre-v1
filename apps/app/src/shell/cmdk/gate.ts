// The search of the real shell (P-L9_23): CmdKData built from what a signed-in Space gives the shell. Local hits come from the replica's live queries (people and agents, recent chats)
// in the same task as the keystroke; the server is search.query behind the capability caller; Recent is search.recent.list read ahead of the sheet opening.
import { isLocked, lockAvailable, toggleLock } from "../noticeslot/lock-control.ts";
import type { ShellRuntime } from "../providers/runtime.tsx";
import type { PlaceId } from "../rail/kits.ts";
import { skins, system } from "../../../../../ui/src/tokens/skins.ts";
import { applySkinToWindow } from "../providers/settings-skin.ts";
import { listable } from "../reach/reach.ts";
import type { Viewer } from "../reach/reach.ts";
import { livePlace } from "../rail/kits.ts";
import type { CmdKData } from "./controller.ts";
import type { AskAnswer, CmdAction, Hit, HitKind } from "./model.ts";
import { requestChannelSheet } from "../../places/chats/channels/request.ts";
import { offered } from "../session/private-agents.ts";
import { activePlace, openAskPane, placeTitle, thingOfScreen } from "../ask/pane.ts";
import { currentScreen } from "../ask/screen.ts";
import type { ScreenContext } from "../ask/screen.ts";

/** The slice of the hub the search drives. */
export interface GateNav {
  go(place: PlaceId, hash?: string): void;
  newTab(): unknown;
  flash(text: string): void;
  setAway(on: boolean): void;
  setOnline(online: boolean, waiting: number): void;
}

export interface GateSearchDeps {
  runtime: ShellRuntime;
  nav: GateNav;
  /** Whether the person set themself away / offline; the actions read and flip them. `inbox` is false while nothing flows into Inbox (it is off the rail). */
  state: { away: boolean; offline: boolean; terminal?: boolean; inbox?: boolean };
  /** The recent hits read ahead of the sheet (search.recent.list). */
  recent: () => readonly Hit[];
  /** Who is searching and where they can go (reach). A result whose place the viewer cannot open is never listed. Left out: nothing is held back here (tests). */
  viewer?: () => Viewer | null;
  /** Set away for real (stored, seen by teammates). Left out: the action only shows it here. */
  away?: (on: boolean) => void;
}

const PLACE_OF: Record<HitKind, PlaceId> = {
  person: "chats", agent: "chats", chat: "chats", channel: "chats", inbox: "inbox", record: "records", task: "records",
  file: "files", automation: "automations", app: "apps", setting: "settings", memory: "home", note: "chats",
};

const SKIN = "appearance.skin";

export const placeOfHit = (h: Hit): PlaceId => PLACE_OF[h.kind];
/** A note opens in Notes, over the grid (its link is vyre://note/<id>); everything else opens as its subject. */
export const hashOfHit = (h: Hit): string => (h.kind === "note" ? `screen=chats.notes&noteId=${encodeURIComponent(h.id)}` : `subject=${h.kind}:${h.id}`);

const matches = (h: Hit, q: string): boolean => `${h.title} ${h.snippet ?? ""}`.toLowerCase().includes(q.toLowerCase());

/** People and agents from the replica's principals, and the chats the sidebar already holds. Empty until the replica has loaded them. */
export function replicaHits(rt: ShellRuntime): readonly Hit[] {
  const out: Hit[] = [];
  const who = rt.principals.getSnapshot();
  if (who.status === "ready") {
    for (const p of who.data) {
      if ((p.kind === "person" || p.kind === "agent") && offered(p)) out.push({ kind: p.kind, id: p.id, title: p.name, link: `vyre://${p.kind}/${p.id}`, score: 1 });
    }
  }
  const recent = rt.screens.query("chats.sidebar", "recent", { filter: "all" }).getSnapshot();
  if (recent.status === "ready") {
    const data = recent.data as { today?: unknown[]; yesterday?: unknown[]; earlier?: unknown[]; starred?: unknown[] };
    for (const list of [data.starred, data.today, data.yesterday, data.earlier]) {
      for (const item of (list ?? []) as { threadId: string; title: string; kind: string }[]) {
        out.push({ kind: item.kind === "channel" ? "channel" : "chat", id: item.threadId, title: item.title, link: `vyre://chat/${item.threadId}`, score: 0.9 });
      }
    }
  }
  return out;
}

/** Where connecting email, calendars and numbers lives: Settings, Email and calendar. */
export const MAIL_PAGE_HASH = "page=mail";
const INBOX_HIT = "shell:inbox";
const MAIL_HIT = "shell:mail";

/** Inbox and Connect email as results of their own. With nothing connected Inbox is off the rail, and both open the Email and calendar screen in Settings. */
export function shellHits(state: { inbox?: boolean }): readonly Hit[] {
  return [
    { kind: "inbox", id: INBOX_HIT, title: "Inbox", snippet: state.inbox === false ? "Connect email and calendar" : "Mail, texts and calendar", link: "vyre://inbox", score: 0.8 },
    { kind: "setting", id: MAIL_HIT, title: "Connect email", snippet: "Email and calendar", link: "vyre://settings/mail", score: 0.8 },
  ];
}

/** Where a shell result goes: Inbox itself once something flows in, otherwise the connect screen. Null for any other result. */
export function shellHitTarget(hit: Hit, state: { inbox?: boolean }): { place: PlaceId; hash: string } | null {
  if (hit.id === MAIL_HIT || (hit.id === INBOX_HIT && state.inbox === false)) return { place: "settings", hash: MAIL_PAGE_HASH };
  if (hit.id === INBOX_HIT) return { place: "inbox", hash: "" };
  return null;
}

export function gateActions(state: { away: boolean; offline: boolean; terminal?: boolean; lock?: { available: boolean; locked: boolean } }, team = true): readonly CmdAction[] {
  return [
    ...(state.lock?.available ? [{ key: "vault.lock", title: state.lock.locked ? "Unlock" : "Lock Vyre", icon: "lock" }] : []),
    { key: "task.new", title: "New task", icon: "plus" },
    { key: "mail.connect", title: "Connect email", icon: "plus" },
    ...(team ? [{ key: "channel.new", title: "New channel", icon: "plus" }] : []),
    { key: "appearance.skin", title: "Switch skin", icon: "eye" },
    { key: "presence.away", title: state.away ? "Back from away" : "Set yourself away", icon: "clock" },
    { key: "network.offline", title: state.offline ? "Go online" : "Go offline", icon: "x" },
    ...(state.terminal === true ? [{ key: "terminal.open", title: "Open terminal", icon: "terminal" }] : []),
  ];
}

const SPARK = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2"/></svg>';
export const ASK_HERE = "ask.here";

/** Ask Vyre about this: in any place but Chats, the Ask pane opens beside what is on screen (the open object, else the place). */
export function askActions(screen: ScreenContext | null): readonly CmdAction[] {
  if (screen === null || screen.place === "chats") return [];
  const thing = thingOfScreen(screen);
  return [{ key: ASK_HERE, title: thing?.title ? `Ask Vyre about ${thing.title}` : thing ? "Ask Vyre about this" : `Ask Vyre about ${placeTitle(screen.place)}`, icon: SPARK }];
}

/** The press: the pane opens in the place the person is in, with the place's own screen context as what the agent is told. */
export function askHere(screen: ScreenContext | null = currentScreen()): boolean {
  const place = activePlace();
  if (screen === null || place === null || place === "chats") return false;
  const { place: _p, open: _o, ...rest } = screen;
  return openAskPane({ thing: thingOfScreen(screen), context: rest }, place) !== null;
}

/** Keeps the results the viewer can open: a result whose place is not on their rail never shows (reach). */
export function reachable(hits: readonly Hit[], viewer: Viewer | null, state: { inbox?: boolean }): Hit[] {
  if (viewer === null) return [...hits];
  return hits.filter((h) => listable({ kind: h.kind, place: livePlace(shellHitTarget(h, state)?.place ?? placeOfHit(h)) }, viewer));
}

export function createGateSearch(d: GateSearchDeps): CmdKData {
  const { runtime: rt, nav, state } = d;
  const mine = (hits: readonly Hit[]): Hit[] => reachable(hits, d.viewer?.() ?? null, state);
  const online = (): boolean => !state.offline && rt.connection.get() === "online";
  const open = (hit: Hit, opts: { newTab: boolean }): void => {
    if (opts.newTab) nav.newTab();
    const own = shellHitTarget(hit, state);
    if (own) nav.go(own.place, own.hash === "" ? undefined : own.hash);
    else nav.go(placeOfHit(hit), hashOfHit(hit));
  };
  return {
    spaceName: () => rt.space.name,
    scope: () => (online() ? "space" : "device"),
    online,
    // Inbox and Connect email answer a typed word only; the replica's people and chats stay the whole of an empty search
    local: (text, types) => mine([...replicaHits(rt), ...(text.trim() === "" ? [] : shellHits(state))].filter((h) => (!types || types.includes(h.kind)) && (text === "" || matches(h, text)))),
    server: async (text, types) => {
      const out = (await rt.call("search.query", { q: text, ...(types ? { types: [...types] } : {}), limit: 20 })) as { hits: Hit[] };
      return mine(out.hits);
    },
    recent: () => mine(d.recent()),
    actions: (text) => [...askActions(currentScreen()), ...gateActions({ ...state, lock: { available: lockAvailable(), locked: isLocked() } }, rt.space.kind === "team")].filter((a) => !text || a.title.toLowerCase().includes(text.toLowerCase())),
    skins: () => [{ id: system.id, name: system.name }, ...skins.map((s) => ({ id: s.id, name: s.name, swatch: s.palette.accent }))],
    currentSkin: () => (globalThis as { document?: { documentElement?: { getAttribute(k: string): string | null } } }).document?.documentElement?.getAttribute("data-skin") ?? "system",
    previewSkin: () => undefined,
    // it opens where you pressed: the window changes at once, the setting follows, and you stay on the page you are on
    setSkin: (id) => { applySkinToWindow(rt, id); void Promise.resolve(rt.call("settings.set", { key: "appearance.skin", value: id })).catch(() => nav.flash("Could not save the skin")); },
    open,
    copyLink: (hit) => {
      const clip = (globalThis as { navigator?: { clipboard?: { writeText(s: string): Promise<void> } } }).navigator?.clipboard;
      void clip?.writeText(hit.link);
      nav.flash("Link copied");
    },
    runAction: (a) => {
      if (a.key === ASK_HERE) askHere();
      else if (a.key === "vault.lock") toggleLock();
      else if (a.key === "presence.away") {
        state.away = !state.away;
        if (d.away) d.away(state.away);
        else { nav.setAway(state.away); nav.flash(state.away ? "You are set as away" : "Welcome back"); }
      } else if (a.key === "network.offline") {
        state.offline = !state.offline;
        nav.setOnline(!state.offline && rt.connection.get() === "online", 0);
        nav.flash(state.offline ? "Working offline" : "Back online");
      } else if (a.key === "terminal.open") nav.go("chats", `screen=chats.terminal-list&at=${Date.now()}`);
      else if (a.key === "task.new") nav.go("home");
      else if (a.key === "channel.new") { nav.go("chats"); requestChannelSheet("new"); }
      else if (a.key === SKIN) nav.go("settings", "page=appearance");
      else if (a.key === "mail.connect") nav.go("settings", MAIL_PAGE_HASH);
    },
    // Ask the Space: the question is answered on the server from what this person may read, on their own AI account (search.ask); the answer and its sources come back whole and are written onto the page by the sheet
    ask: async (question) => (await rt.call("search.ask", { q: question })) as AskAnswer,
    copyText: (text) => {
      const clip = (globalThis as { navigator?: { clipboard?: { writeText(s: string): Promise<void> } } }).navigator?.clipboard;
      void clip?.writeText(text);
      nav.flash("Answer copied");
    },
    // Continue in a chat: a real chat with the assistant that starts from the question and the answer, opened where the person is
    continueInChat: ({ question, answer }) => {
      const key = `askchat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      void Promise.resolve(rt.call("chat.start", { kind: "chat", agentIds: [rt.assistant.id], title: question.length > 80 ? `${question.slice(0, 77)}...` : question, first: `${question}\n\nWhat the Space says:\n${answer}`, idempotencyKey: key }))
        .then((out) => { const id = (out as { thread?: { threadId?: string } } | null)?.thread?.threadId; if (id) rt.open({ subject: { type: "thread", id } }); else nav.flash("Could not open a chat"); }, () => nav.flash("Could not open a chat"));
    },
    recordOpened: (hit) => { if (shellHitTarget(hit, state)) return; void rt.call("search.recent.record", { kind: hit.kind, itemId: hit.id }).catch(() => undefined); },
  };
}

/** Read Recent ahead of the sheet; resolves to what the Space keeps, or nothing when it cannot answer. */
export async function loadRecent(rt: ShellRuntime): Promise<readonly Hit[]> {
  try { return ((await rt.call("search.recent.list", { limit: 8 })) as { hits: Hit[] }).hits; } catch { return []; }
}
