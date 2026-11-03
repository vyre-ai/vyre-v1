// The search of the real shell (P-L9_23): CmdKData built from what a signed-in Space gives the shell. Local hits come from the replica's live queries (people and agents, recent chats)
// in the same task as the keystroke; the server is search.query behind the capability caller; Recent is search.recent.list read ahead of the sheet opening.
import type { ShellRuntime } from "../providers/runtime.tsx";
import type { PlaceId } from "../rail/kits.ts";
import { skins, system } from "../../../../../ui/src/tokens/skins.ts";
import { applySkinToWindow } from "../providers/settings-skin.ts";
import type { CmdKData } from "./controller.ts";
import type { CmdAction, Hit, HitKind } from "./model.ts";
import { requestChannelSheet } from "../../places/chats/channels/request.ts";

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
  /** Set away for real (stored, seen by teammates). Left out: the action only shows it here. */
  away?: (on: boolean) => void;
}

const PLACE_OF: Record<HitKind, PlaceId> = {
  person: "chats", agent: "chats", chat: "chats", channel: "chats", inbox: "inbox", record: "records", task: "records",
  file: "files", automation: "automations", app: "apps", setting: "settings", memory: "home",
};

const SKIN = "appearance.skin";

export const placeOfHit = (h: Hit): PlaceId => PLACE_OF[h.kind];
export const hashOfHit = (h: Hit): string => `subject=${h.kind}:${h.id}`;

const matches = (h: Hit, q: string): boolean => `${h.title} ${h.snippet ?? ""}`.toLowerCase().includes(q.toLowerCase());

/** People and agents from the replica's principals, and the chats the sidebar already holds. Empty until the replica has loaded them. */
export function replicaHits(rt: ShellRuntime): readonly Hit[] {
  const out: Hit[] = [];
  const who = rt.principals.getSnapshot();
  if (who.status === "ready") {
    for (const p of who.data) {
      if (p.kind === "person" || p.kind === "agent") out.push({ kind: p.kind, id: p.id, title: p.name, link: `vyre://${p.kind}/${p.id}`, score: 1 });
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

export function gateActions(state: { away: boolean; offline: boolean; terminal?: boolean }, team = true): readonly CmdAction[] {
  return [
    { key: "task.new", title: "New task", icon: "plus" },
    { key: "mail.connect", title: "Connect email", icon: "plus" },
    ...(team ? [{ key: "channel.new", title: "New channel", icon: "plus" }] : []),
    { key: "appearance.skin", title: "Switch skin", icon: "eye" },
    { key: "presence.away", title: state.away ? "Back from away" : "Set yourself away", icon: "clock" },
    { key: "network.offline", title: state.offline ? "Go online" : "Go offline", icon: "x" },
    ...(state.terminal === true ? [{ key: "terminal.open", title: "Open terminal", icon: "terminal" }] : []),
  ];
}

export function createGateSearch(d: GateSearchDeps): CmdKData {
  const { runtime: rt, nav, state } = d;
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
    local: (text, types) => [...replicaHits(rt), ...(text.trim() === "" ? [] : shellHits(state))].filter((h) => (!types || types.includes(h.kind)) && (text === "" || matches(h, text))),
    server: async (text, types) => {
      const out = (await rt.call("search.query", { q: text, ...(types ? { types: [...types] } : {}), limit: 20 })) as { hits: Hit[] };
      return out.hits;
    },
    recent: d.recent,
    actions: (text) => gateActions(state, rt.space.kind === "team").filter((a) => !text || a.title.toLowerCase().includes(text.toLowerCase())),
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
      if (a.key === "presence.away") {
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
    recordOpened: (hit) => { if (shellHitTarget(hit, state)) return; void rt.call("search.recent.record", { kind: hit.kind, itemId: hit.id }).catch(() => undefined); },
  };
}

/** Read Recent ahead of the sheet; resolves to what the Space keeps, or nothing when it cannot answer. */
export async function loadRecent(rt: ShellRuntime): Promise<readonly Hit[]> {
  try { return ((await rt.call("search.recent.list", { limit: 8 })) as { hits: Hit[] }).hits; } catch { return []; }
}
