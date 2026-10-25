// What the shell knows about each Space it can open (spec 2.1, b15): who it is, which Kit and skin it starts with, what waits for you in it.
// The switcher data comes from the `spaces` module (spaces.switcher); the seeds below are the prototype's three, used by tests and screenshots.
import type { PlaceId } from "../rail/kits.ts";

export type SpaceKind = "team" | "personal";

export interface SpaceDef {
  spaceId: string;
  name: string;
  kind: SpaceKind;
  /** The address people see, or where a Personal Space lives. */
  address: string;
  /** Your role in this Space. */
  role: string;
  /** The tile gradient. */
  tint: readonly [string, string];
  /** Which Kit draws the rail (rail/kits.ts). */
  kit: string;
  /** The Space's default skin; a person's own choice wins (3.9). */
  skinDefault: string;
  /** Starred Spaces are pre-opened so switching to them is instant. */
  starred: boolean;
  /** Something in this Space needs you: the red dot on the tile and in the switcher. */
  needsYou: boolean;
  /** console.access in this Space. */
  console: boolean;
  /** Owner or developer: Open Terminal in the switcher menu. */
  terminal: boolean;
  counts: Readonly<Partial<Record<PlaceId, number>>>;
  dots: Readonly<Partial<Record<PlaceId, boolean>>>;
}

export const NORTHWIND: SpaceDef = {
  spaceId: "nw", name: "Northwind", kind: "team", address: "northwind.vyre.run", role: "Owner", tint: ["#6E5CF0", "#9B6BE8"],
  kit: "northwind", skinDefault: "system", starred: true, needsYou: false, console: true, terminal: true,
  counts: { chats: 7 }, dots: { inbox: true, records: true },
};

export const HARBOR: SpaceDef = {
  spaceId: "hb", name: "Harbor Studio", kind: "team", address: "harbor.vyre.run", role: "Member", tint: ["#1F9D8B", "#3BB6A0"],
  kit: "studio", skinDefault: "linen", starred: true, needsYou: true, console: false, terminal: false,
  counts: { chats: 2 }, dots: { inbox: true },
};

export const PERSONAL: SpaceDef = {
  spaceId: "me", name: "Personal", kind: "personal", address: "Only on this computer", role: "Owner", tint: ["#C2762B", "#E0A040"],
  kit: "personal", skinDefault: "system", starred: false, needsYou: false, console: false, terminal: false,
  counts: {}, dots: {},
};

/** The prototype's three seeds, in switcher order (Shift-Cmd-1..3). */
export const SEED_DEFS: readonly SpaceDef[] = [NORTHWIND, HARBOR, PERSONAL];

export function tileGradient(def: SpaceDef): string {
  return `linear-gradient(135deg, ${def.tint[0]}, ${def.tint[1]})`;
}

export function initialOf(def: SpaceDef): string {
  return (def.name.trim()[0] ?? "?").toUpperCase();
}

/** The Spaces other than the open one that need you: they put the red dot on the tile. */
export function othersNeedingYou(spaces: readonly SpaceDef[], openId: string): SpaceDef[] {
  return spaces.filter((s) => s.spaceId !== openId && s.needsYou);
}
