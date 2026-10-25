// Vault layout: the pure part. What the sidebar counts, which items a section shows, how a row reads (name, field names, "Used 14 min ago") and in what order.
// Types come from the generated capability map. Names and metadata only: no value of any item is ever in these shapes (spec 3.8, 2.17).
import type { CapMap } from "../../../../../../generated/types.ts";

export type Item = CapMap["vault.items.list"]["out"]["items"][number];
export type Folder = CapMap["vault.folders.list"]["out"]["folders"][number];
export type Provider = CapMap["providers.list"]["out"]["providers"][number];
export type Health = CapMap["vault.health"]["out"];
export type ItemKind = Item["kind"];

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
export const MIN_MS = 60_000;

/** What the sidebar can select. A folder carries its id. */
export type Selection =
  | { kind: "all" } | { kind: "providers" } | { kind: "keys" } | { kind: "logins" } | { kind: "cards" }
  | { kind: "health" } | { kind: "requested" } | { kind: "mine" } | { kind: "folder"; folderId: string };

export const ALL: Selection = { kind: "all" };

export const selectionKey = (s: Selection): string => (s.kind === "folder" ? `folder:${s.folderId}` : s.kind);
export const sameSelection = (a: Selection, b: Selection): boolean => selectionKey(a) === selectionKey(b);

const KEY_KINDS: readonly ItemKind[] = ["api_key", "env", "ssh_key"];
const LOGIN_KINDS: readonly ItemKind[] = ["login", "totp"];

export const KIND_LABEL: Record<ItemKind, string> = {
  login: "Login", api_key: "API key", env: "Environment", card: "Card", note: "Note", totp: "One-time code", ssh_key: "SSH key", ai_subscription: "AI subscription", other: "Other",
};

/** The clock every date rule reads (minutes east of UTC for the person's day). */
export interface Clock { now: number }

export interface Counts { all: number; providers: number; keys: number; logins: number; cards: number; mine: number; health: number; requested: number; folders: Map<string, number> }

/** Sidebar counts, worked out once over the whole list. `providerItemIds` are the items that are AI provider connections. */
export function countItems(items: readonly Item[], providerItemIds: ReadonlySet<string>, health: Health | null, requested: number): Counts {
  const c: Counts = { all: items.length, providers: 0, keys: 0, logins: 0, cards: 0, mine: 0, health: health ? health.weak + health.reused + health.stale + health.rotationDue : 0, requested, folders: new Map() };
  for (const it of items) {
    if (providerItemIds.has(it.id) || it.kind === "ai_subscription") c.providers++;
    if (KEY_KINDS.includes(it.kind)) c.keys++;
    if (LOGIN_KINDS.includes(it.kind)) c.logins++;
    if (it.kind === "card") c.cards++;
    if (it.scope === "mine") c.mine++;
    else c.folders.set(it.folderId, (c.folders.get(it.folderId) ?? 0) + 1);
  }
  return c;
}

/** Whether one item belongs to a sidebar selection. */
export function inSelection(it: Item, sel: Selection, providerItemIds: ReadonlySet<string>, healthIds: ReadonlySet<string>): boolean {
  switch (sel.kind) {
    case "all": return true;
    case "providers": return providerItemIds.has(it.id) || it.kind === "ai_subscription";
    case "keys": return KEY_KINDS.includes(it.kind);
    case "logins": return LOGIN_KINDS.includes(it.kind);
    case "cards": return it.kind === "card";
    case "mine": return it.scope === "mine";
    case "health": return healthIds.has(it.id);
    case "folder": return it.folderId === sel.folderId;
    case "requested": return false;
  }
}

/** Most recently used first, then by name, so the list does not shuffle when two rows tie. */
export function byRecent(a: Item, b: Item): number {
  const d = (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
  return d !== 0 ? d : a.name.localeCompare(b.name);
}

/** What the list shows for a selection and a search text: filtered, searched on name and field names (never values), sorted. */
export function visibleItems(items: readonly Item[], sel: Selection, query: string, providerItemIds: ReadonlySet<string>, healthIds: ReadonlySet<string>): Item[] {
  const q = query.trim().toLowerCase();
  const out: Item[] = [];
  for (const it of items) {
    if (!inSelection(it, sel, providerItemIds, healthIds)) continue;
    if (q && !it.name.toLowerCase().includes(q) && !it.handle.toLowerCase().includes(q) && !it.fieldKeys.some((k) => k.toLowerCase().includes(q))) continue;
    out.push(it);
  }
  return out.sort(byRecent);
}

/** "Used 14 min ago", "Used 3 h ago", "Used yesterday", "Used Oct 22", or "Never used". */
export function usedLabel(ts: number | undefined, c: Clock): string {
  if (ts === undefined) return "Never used";
  const d = Math.max(0, c.now - ts);
  if (d < MIN_MS) return "Used just now";
  if (d < HOUR_MS) return `Used ${Math.floor(d / MIN_MS)} min ago`;
  if (d < DAY_MS) return `Used ${Math.floor(d / HOUR_MS)} h ago`;
  if (d < 2 * DAY_MS) return "Used yesterday";
  if (d < 30 * DAY_MS) return `Used ${Math.floor(d / DAY_MS)} days ago`;
  return `Used ${monthDay(ts)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export function monthDay(ts: number): string {
  const x = new Date(ts);
  return `${MONTHS[x.getUTCMonth()]} ${x.getUTCDate()}`;
}

/** "14 min ago", "3 h ago", "Oct 22" for history lines. */
export function agoLabel(ts: number, c: Clock): string {
  const d = Math.max(0, c.now - ts);
  if (d < MIN_MS) return "just now";
  if (d < HOUR_MS) return `${Math.floor(d / MIN_MS)} min ago`;
  if (d < DAY_MS) return `${Math.floor(d / HOUR_MS)} h ago`;
  if (d < 2 * DAY_MS) return "yesterday";
  if (d < 30 * DAY_MS) return `${Math.floor(d / DAY_MS)} days ago`;
  return monthDay(ts);
}

/** The second line of a row: the field names (never values), "Login · USERNAME", or how a provider signs in. */
export function secondLine(it: Item, provider?: Provider): string {
  if (provider) return `${provider.via} · ${provider.scope === "mine" ? "Mine" : "Shared"}`;
  const keys = it.fieldKeys.join(" · ");
  if (it.kind === "login" || it.kind === "card" || it.kind === "totp" || it.kind === "note") return keys ? `${KIND_LABEL[it.kind]} · ${keys}` : KIND_LABEL[it.kind];
  return keys || KIND_LABEL[it.kind];
}

/** Days since the last rotation (or creation), and whether its reminder date has passed. */
export function rotation(it: Item, c: Clock): { days: number; due: boolean; every?: number } | null {
  if (it.rotateEveryDays === undefined) return null;
  const days = Math.floor((c.now - (it.lastRotatedAt ?? it.createdAt)) / DAY_MS);
  return { days, due: days >= it.rotateEveryDays, every: it.rotateEveryDays };
}

/** A small dot marks a row worth a look: a rotation that is due or an item the health check flagged. */
export function needsLook(it: Item, c: Clock, healthIds: ReadonlySet<string>): boolean {
  return healthIds.has(it.id) || (rotation(it, c)?.due ?? false);
}

export function levelWords(level: Item["yourLevel"]): string {
  return level === "manage" ? "manage it" : level === "edit" ? "change it" : level === "view" ? "see it" : "use it";
}

/** The sentence under the name: who holds it and where it sits. Access beyond you is the Share sheet's job (P-L9f_05). */
export function accessLine(it: Item, folder: Folder | undefined): string {
  const where = it.scope === "mine" ? "Mine" : `Shared${folder ? ` › ${folder.name}` : ""}`;
  const lock = it.spaceOnly ? " · Space only" : "";
  return `${it.scope === "mine" ? "Only you can use it" : `You can ${levelWords(it.yourLevel)}`} · ${where}${lock}`;
}

/** One grant on an item, as `access.shares_of` returns it: who, at what level, and through what (a direct grant, a group, the folder, the owner). */
export interface Share { subject: { kind: "person" | "group" | "role" | "agent" | "actor" | "service" | "link"; id: string }; level: "view" | "use" | "edit" | "manage"; through: "direct" | "group" | "role" | "folder" | "owner" }

/** "Intake", "Intake and Research", "Intake, Research and 1 more". */
export function fmtList(names: readonly string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** A person is named by their first name, anything else by its name. */
export function shortName(kind: Share["subject"]["kind"], name: string): string {
  return kind === "person" ? (name.trim().split(/\s+/)[0] ?? name) : name;
}

/**
 * The sentence under the name, from the real grants: "Intake, Research and 1 more can use it · Omar can see it · Maya can change it · Shared › Marketing". You and the owner are left
 * out (you know your own access); with no one else it is the plain line from accessLine.
 */
export function whoLine(it: Item, folder: Folder | undefined, shares: readonly Share[], meId: string, nameOf: (s: Share["subject"]) => string): string {
  const pick = (levels: readonly Share["level"][]): string[] => {
    const out: string[] = [];
    for (const sh of shares) {
      if (sh.through === "owner" || (sh.subject.kind === "person" && sh.subject.id === meId) || !levels.includes(sh.level)) continue;
      out.push(shortName(sh.subject.kind, nameOf(sh.subject)));
    }
    return out;
  };
  const parts: string[] = [];
  const use = pick(["use"]), see = pick(["view"]), change = pick(["edit", "manage"]);
  if (use.length) parts.push(`${fmtList(use)} can use it`);
  if (see.length) parts.push(`${fmtList(see)} can see it`);
  if (change.length) parts.push(`${fmtList(change)} can change it`);
  if (parts.length === 0) return accessLine(it, folder);
  parts.push(it.scope === "mine" ? "Mine" : `Shared${folder ? ` › ${folder.name}` : ""}`);
  return parts.join(" · ");
}

/** A handle for an item: "#Northwind_GoHighLevel". Words are joined with underscores, anything else is dropped. */
export function handleFor(space: string, name: string): string {
  const w = (s: string): string => s.replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean).join("_");
  const n = w(name);
  return n ? `#${w(space) || "Vault"}_${n}` : "";
}

export function hueOf(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
  return (h % 12) * 30;
}

export const letterOf = (name: string): string => (name.trim()[0] ?? "?").toUpperCase();

/** Next index for an arrow key in a list of `count` rows; stays inside the list. */
export function stepIndex(current: number, count: number, dir: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0) return dir === 1 ? 0 : count - 1;
  return Math.max(0, Math.min(count - 1, current + dir));
}
