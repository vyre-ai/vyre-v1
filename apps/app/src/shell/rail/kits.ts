// The rail is Kit-defined (spec 2.1 "the rail (Kit-defined)", 3.0): each Space's Kit says which places sit in the top group and which in the bottom group,
// and which place opens first. The Console shows only for a person who holds console.access in that Space. A Personal Space hides Apps (forms, campaigns, sending domains
// are for a team): team-only places stay off its rail (the rc.5 polish rules).
import type { PlaceId } from "../../../../../ui/src/theme/theme.ts";

export type { PlaceId } from "../../../../../ui/src/theme/theme.ts";

export const PLACE_TITLE: Readonly<Record<PlaceId, string>> = {
  home: "Home",
  chats: "Chats",
  inbox: "Inbox",
  records: "Records",
  files: "Files",
  apps: "Apps",
  automations: "Automations",
  vault: "Vault",
  settings: "Settings",
  console: "Console",
  join: "Join",
};

export interface KitDef {
  id: string;
  name: string;
  /** Places above the spacer, in order. */
  top: readonly PlaceId[];
  /** Places below the spacer, in order. */
  bottom: readonly PlaceId[];
  /** The place a Space opens on the first time. A role's kit may choose another first screen. */
  start: PlaceId;
}

export const KITS: Readonly<Record<string, KitDef>> = {
  northwind: {
    id: "northwind",
    name: "Team",
    top: ["chats", "inbox", "records", "files", "automations"],
    bottom: ["apps", "vault", "settings", "console"],
    start: "chats",
  },
  studio: {
    id: "studio",
    name: "Studio",
    top: ["chats", "inbox", "files"],
    bottom: ["apps", "vault", "settings"],
    start: "chats",
  },
  personal: {
    id: "personal",
    name: "Personal",
    top: ["chats", "inbox", "records", "files", "automations"],
    bottom: ["vault", "settings"],
    start: "chats",
  },
};

export const DEFAULT_KIT = "northwind";

/** Home is gone: Chats is the first screen. A link, a saved tab or a screen that still says "home" (the task screens do) lands in Chats with its hash, and Chats draws it. */
export function livePlace(place: PlaceId): PlaceId {
  return place === "home" ? "chats" : place;
}

export function kitById(id: string): KitDef {
  return Object.prototype.hasOwnProperty.call(KITS, id) ? (KITS[id] as KitDef) : (KITS[DEFAULT_KIT] as KitDef);
}

export interface RailEntry {
  place: PlaceId;
  title: string;
  /** Unread or waiting count, shown as a small number. */
  count: number;
  /** A quiet dot: something new, no number. */
  dot: boolean;
}

export interface RailGroups {
  top: readonly RailEntry[];
  bottom: readonly RailEntry[];
}

export interface RailInput {
  kit: KitDef;
  /** console.access in this Space. */
  console: boolean;
  counts: Readonly<Partial<Record<PlaceId, number>>>;
  dots: Readonly<Partial<Record<PlaceId, boolean>>>;
  active: PlaceId;
}

/** The rail for one Space: the Kit's groups, the Console only with access, a dot only on a place you are not looking at. */
export function railFor(input: RailInput): RailGroups {
  const entry = (place: PlaceId): RailEntry => {
    const count = input.counts[place] ?? 0;
    return { place, title: PLACE_TITLE[place], count, dot: count === 0 && input.dots[place] === true && input.active !== place };
  };
  const keep = (place: PlaceId): boolean => place !== "console" || input.console;
  return { top: input.kit.top.filter(keep).map(entry), bottom: input.kit.bottom.filter(keep).map(entry) };
}

/** The rail is the places you can reach; a place outside the Kit (opened from a link) still opens, it just has no rail button. */
export function railPlaces(groups: RailGroups): PlaceId[] {
  return [...groups.top, ...groups.bottom].map((e) => e.place);
}

/** Places with no screen in the signed-in shell: never on a rail, never a tab. "join" is the old "+" at the foot of the rail; Add a Space lives in the Space menu. */
export const NO_SCREEN_PLACES: readonly PlaceId[] = ["join"];
