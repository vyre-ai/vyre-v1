// The rail is Kit-defined (spec 2.1 "the rail (Kit-defined)", 3.0): each Space's Kit says which places sit in the top group and which in the bottom group,
// and which place opens first. The Console shows only for a person who holds console.access in that Space. Personal Spaces keep Apps in the rail:
// the place itself says "Needs a Team Space" (the Personal Space matrix, spec 2.1).
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
  /** The place a Space opens on the first time. */
  start: PlaceId;
}

export const KITS: Readonly<Record<string, KitDef>> = {
  northwind: {
    id: "northwind",
    name: "Team",
    top: ["home", "chats", "inbox", "records", "files"],
    bottom: ["apps", "automations", "vault", "settings", "console", "join"],
    start: "chats",
  },
  studio: {
    id: "studio",
    name: "Studio",
    top: ["home", "chats", "inbox", "files"],
    bottom: ["apps", "vault", "settings", "join"],
    start: "chats",
  },
  personal: {
    id: "personal",
    name: "Personal",
    top: ["home", "chats", "inbox", "records", "files"],
    bottom: ["apps", "automations", "vault", "settings", "join"],
    start: "home",
  },
};

export const DEFAULT_KIT = "northwind";

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
