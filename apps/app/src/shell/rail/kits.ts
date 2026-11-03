// The rail is Kit-defined (spec 2.1 "the rail (Kit-defined)", 3.0): each Space's Kit says which places sit in the top group and which in the bottom group,
// and which place opens first. The Console shows only for a person who holds console.access in that Space. Inbox shows only for a person who has something flowing in
// (a mailbox, a calendar or a number of their own; rail/inbox-sources.ts): before that, connecting lives in Settings. A Personal Space hides Apps (forms, sending domains
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
    bottom: ["apps", "vault", "console", "settings"],
    start: "chats",
  },
  studio: {
    id: "studio",
    name: "Studio",
    top: ["chats", "inbox", "files"],
    bottom: ["apps", "vault", "console", "settings"],
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
  /** Places the person's role cannot use (SpaceDef.hidden): not on the rail. */
  hidden?: readonly PlaceId[];
  /** This person has a mailbox, calendar or number flowing in. False takes Inbox off the rail; absent (not known yet) leaves it where the Kit puts it. */
  inbox?: boolean;
  counts: Readonly<Partial<Record<PlaceId, number>>>;
  dots: Readonly<Partial<Record<PlaceId, boolean>>>;
  active: PlaceId;
}

/** The rail for one Space: the Kit's groups, the Console only with access, Inbox only with something flowing in, a dot only on a place you are not looking at. */
export function railFor(input: RailInput): RailGroups {
  const entry = (place: PlaceId): RailEntry => {
    const count = input.counts[place] ?? 0;
    return { place, title: PLACE_TITLE[place], count, dot: count === 0 && input.dots[place] === true && input.active !== place };
  };
  const keep = (place: PlaceId): boolean => (place !== "console" || input.console) && (place !== "inbox" || input.inbox !== false) && !(input.hidden ?? []).includes(place);
  return { top: input.kit.top.filter(keep).map(entry), bottom: input.kit.bottom.filter(keep).map(entry) };
}

/** The phone-width rail: these places are the bar, the rest sit behind More. */
export const PHONE_BAR: readonly PlaceId[] = ["chats", "inbox", "records", "files"];
/** Places a phone never offers (owner ruling, 3 Nov 2026): you chat about Automations and the Console in Chats instead. */
export const NOT_ON_PHONE_PLACES: readonly PlaceId[] = ["automations", "console"];

/** What the phone-width rail's More menu lists: every place off the bar, less the ones the phone does not have. */
export function phoneMore(groups: RailGroups): RailEntry[] {
  return [...groups.top.filter((e) => !PHONE_BAR.includes(e.place)), ...groups.bottom].filter((e) => !NOT_ON_PHONE_PLACES.includes(e.place));
}

/** The rail is the places you can reach; a place outside the Kit (opened from a link) still opens, it just has no rail button. */
export function railPlaces(groups: RailGroups): PlaceId[] {
  return [...groups.top, ...groups.bottom].map((e) => e.place);
}

/** Places with no screen in the signed-in shell: never on a rail, never a tab. "join" is the old "+" at the foot of the rail; Add a Space lives in the Space menu. */
export const NO_SCREEN_PLACES: readonly PlaceId[] = ["join"];
