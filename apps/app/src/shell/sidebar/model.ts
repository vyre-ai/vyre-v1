// The shared place sidebar's rules (spec 3.0): which places have one, how its collapse is remembered on this device, and the phone's two views.
// Pure functions, so the slot, the tests and the places agree. Nothing here touches the server: a collapsed sidebar is a device setting.

/** Storage for this device (the same shape the tab store uses). */
export interface SidebarStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Hidden or shown is one choice per device and person, in every place: the rail stays, the sheet slides away. */
export function collapseKey(deviceId: string, personId: string): string {
  return `vyre.sidebar.v2:${deviceId}:${personId}`;
}

export function readCollapsed(raw: string | null): boolean {
  if (raw === null) return false;
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === "object" && v !== null && (v as { collapsed?: unknown }).collapsed === true;
  } catch {
    return false;
  }
}

export function writeCollapsed(collapsed: boolean): string {
  return JSON.stringify({ v: 1, collapsed });
}

/**
 * The places that put a list in the sidebar column (each draws one with SidebarContent). The shell gives the column its room from the first frame for these, so the page does not start full
 * width and then move aside when the place arrives (r41: the first screen moved 280 px, a layout shift of 0.17).
 */
export const PLACES_WITH_LIST: ReadonlySet<string> = new Set([
  "chats",
  "inbox",
  "records",
  "files",
  "automations",
  "vault",
  "settings",
  "console",
]);

/** What the phone shows for a place with a sidebar: its list first, then one item's body with Back (spec 3.0, the prototype's phone). */
export type PhoneView = "list" | "body";

export function phoneView(hasSidebar: boolean, compact: boolean, bodyOpen: boolean): PhoneView {
  return hasSidebar && compact && !bodyOpen ? "list" : "body";
}

/**
 * On a phone, a link that names a body (an address with something after the place: a screen, an item) opens that body, and Back goes to the list (lead ruling, 24 Nov 2026). The same on
 * every load and every compact width, and from the first frame: the list is never drawn first and swapped for the body. A bare place address, or a hash that names no page, shows the list.
 */
export function linkNamesBody(compact: boolean, hash: string | undefined): boolean {
  return compact && hash !== undefined && /(^|&)(screen|subject)=/.test(hash.replace(/^#/, ""));
}

/**
 * Does a change of the address open the body on a phone? A link does, and so does any address the person did not write by pressing a row (Cmd-K, a notification, a tab switch). The address a place
 * wrote itself for a row just pressed does not: the press already opened the body, and if the person pressed Back before that address was drawn, opening the body again put the item back over the
 * list they had asked for (kinds-b.panes at 760 wide, a channel row then Back). `ownReport`: the place's own report arrived with this change and no link did.
 */
export function hashOpensBody(o: {
  compact: boolean;
  hash: string | undefined;
  hashChanged: boolean;
  ownReport: boolean;
}): boolean {
  return linkNamesBody(o.compact, o.hash) && !(o.hashChanged && o.ownReport);
}

/** Rows whose text contains every word of the query, case-insensitively. An empty query keeps them all. */
export function matchRows<T extends { title: string; note?: string }>(rows: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...rows];
  return rows.filter((r) => {
    const hay = `${r.title} ${r.note ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** A plain loop that builds children from data (the ui-rows lint reads every `.map(` that returns JSX as a list of items that must be ui/Row; the rows here are Rows inside folders). */
export function each<T, R>(items: readonly T[], make: (item: T, index: number) => R): R[] {
  const out: R[] = [];
  for (let i = 0; i < items.length; i++) out.push(make(items[i] as T, i));
  return out;
}
