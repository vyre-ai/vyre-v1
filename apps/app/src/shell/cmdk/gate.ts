// The search of the real shell (P-L9_23): CmdKData built from what a signed-in Space gives the shell. Local hits come from the replica's live queries (people and agents, recent chats)
// in the same task as the keystroke; the server is search.query behind the capability caller; Recent is search.recent.list read ahead of the sheet opening.
import type { ShellRuntime } from "../providers/runtime.tsx";
import type { PlaceId } from "../rail/kits.ts";
import { skins } from "../../../../../ui/src/tokens/skins.ts";
import type { CmdKData } from "./controller.ts";
import type { CmdAction, Hit, HitKind } from "./model.ts";

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
  /** Whether the person set themself away / offline; the actions read and flip them. */
  state: { away: boolean; offline: boolean };
  /** The recent hits read ahead of the sheet (search.recent.list). */
  recent: () => readonly Hit[];
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

export function gateActions(state: { away: boolean; offline: boolean }): readonly CmdAction[] {
  return [
    { key: "task.new", title: "New task", icon: "plus" },
    { key: "appearance.skin", title: "Switch skin", icon: "eye" },
    { key: "presence.away", title: state.away ? "Back from away" : "Set yourself away", icon: "clock" },
    { key: "network.offline", title: state.offline ? "Go online" : "Go offline", icon: "x" },
  ];
}

export function createGateSearch(d: GateSearchDeps): CmdKData {
  const { runtime: rt, nav, state } = d;
  const online = (): boolean => !state.offline && rt.connection.get() === "online";
  const open = (hit: Hit, opts: { newTab: boolean }): void => {
    if (opts.newTab) nav.newTab();
    nav.go(placeOfHit(hit), hashOfHit(hit));
  };
  return {
    scope: () => (online() ? "space" : "device"),
    online,
    local: (text, types) => replicaHits(rt).filter((h) => (!types || types.includes(h.kind)) && (text === "" || matches(h, text))),
    server: async (text, types) => {
      const out = (await rt.call("search.query", { q: text, ...(types ? { types: [...types] } : {}), limit: 20 })) as { hits: Hit[] };
      return out.hits;
    },
    recent: d.recent,
    actions: (text) => gateActions(state).filter((a) => !text || a.title.toLowerCase().includes(text.toLowerCase())),
    skins: () => skins.map((s) => ({ id: s.id, name: s.name, swatch: s.palette.accent })),
    currentSkin: () => "system",
    previewSkin: () => undefined,
    setSkin: () => { nav.go("settings", "page=appearance"); nav.flash("Pick the skin under Appearance"); },
    open,
    copyLink: (hit) => {
      const clip = (globalThis as { navigator?: { clipboard?: { writeText(s: string): Promise<void> } } }).navigator?.clipboard;
      void clip?.writeText(hit.link);
      nav.flash("Link copied");
    },
    runAction: (a) => {
      if (a.key === "presence.away") {
        state.away = !state.away;
        nav.setAway(state.away);
        nav.flash(state.away ? "You are set as away" : "Welcome back");
      } else if (a.key === "network.offline") {
        state.offline = !state.offline;
        nav.setOnline(!state.offline && rt.connection.get() === "online", 0);
        nav.flash(state.offline ? "Working offline" : "Back online");
      } else if (a.key === "task.new") nav.go("home");
      else if (a.key === SKIN) nav.go("settings", "page=appearance");
    },
    recordOpened: (hit) => { void rt.call("search.recent.record", { kind: hit.kind, itemId: hit.id }).catch(() => undefined); },
  };
}

/** Read Recent ahead of the sheet; resolves to what the Space keeps, or nothing when it cannot answer. */
export async function loadRecent(rt: ShellRuntime): Promise<readonly Hit[]> {
  try { return ((await rt.call("search.recent.list", { limit: 8 })) as { hits: Hit[] }).hits; } catch { return []; }
}
