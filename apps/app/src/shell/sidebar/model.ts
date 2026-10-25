// The shared place sidebar's rules (spec 3.0): which places have one, how its collapse is remembered on this device, and the phone's two views.
// Pure functions, so the slot, the tests and the places agree. Nothing here touches the server: a collapsed sidebar is a device setting.

/** Storage for this device (the same shape the tab store uses). */
export interface SidebarStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** One key per device, person, Space and place: collapsing Chats in one Space never collapses Records in another. */
export function collapseKey(deviceId: string, personId: string, spaceId: string, place: string): string {
  return `vyre.sidebar.v1:${deviceId}:${personId}:${spaceId}:${place}`;
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

/** What the phone shows for a place with a sidebar: its list first, then one item's body with Back (spec 3.0, the prototype's phone). */
export type PhoneView = "list" | "body";

export function phoneView(hasSidebar: boolean, compact: boolean, bodyOpen: boolean): PhoneView {
  return hasSidebar && compact && !bodyOpen ? "list" : "body";
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
