// The Console Permissions page's model (owner approved, 3 Nov 2026): roles across, the permission catalogue down by area (manifests/permissions.ts, the access engine's own keys), each
// cell what that role gives, and how many of the role's people differ because of an exception. Pure functions over the reads the page makes, so the rules are tested without a screen.
// The engine answers a permission yes or no. A role without it reads "Ask an admin" where its people can ask for it (anyone but a Guest, who works inside what was shared with them), and
// "Not allowed" otherwise. An exception is Allowed or Not allowed on a permission or a whole area, for a person or a group.

import { pairsFor } from "../../../../../lib/own-pairs.ts";

export type Effect = "allow" | "deny" | "own" | "ask";
export type Cell = "allow" | "own" | "ask" | "no";
export interface PermissionDef { key: string; area: string; title: string; risk: string }
export interface RoleLite { id: string; name: string; builtIn: boolean; permissions: readonly string[] }
export interface PersonLite { id: string; name: string; kind: string; status: string; roles: readonly string[]; groups: readonly string[] }
export interface ExceptionLite { exceptionId: string; subject: { kind: "person" | "group"; id: string; name: string }; perms: readonly string[]; own?: readonly string[]; area?: string; effect: Effect; until?: number; why?: string; by: { id: string; name: string }; at: number }

/** The areas of the catalogue in the words the matrix uses, in its order. */
export const AREA_TITLE: Readonly<Record<string, string>> = {
  chats: "Chats and channels", agents: "Agents and computers", automations: "Automations", records: "Records, projects and meetings", files: "Files", vault: "Vault",
  comms: "Calendar, Inbox and sending", sites: "Sites", apps: "Forms and booking pages", ai: "AI models and spend", kits: "Kits", runs: "Runs", terminal: "Terminals",
  server: "Servers", space: "Console, members and access",
};
export const areaTitle = (area: string): string => AREA_TITLE[area] ?? area.charAt(0).toUpperCase() + area.slice(1);
export function areasOf(perms: readonly PermissionDef[]): Array<{ area: string; title: string; perms: PermissionDef[] }> {
  const order = Object.keys(AREA_TITLE);
  const areas = [...new Set(perms.map((p) => p.area))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  return areas.map((area) => ({ area, title: areaTitle(area), perms: perms.filter((p) => p.area === area) }));
}

export const isOwnerRole = (r: Pick<RoleLite, "id" | "name">): boolean => r.id === "rol_owner" || r.name.toLowerCase() === "owner";
export const isGuestRole = (r: Pick<RoleLite, "id" | "name">): boolean => r.id === "rol_guest" || r.name.toLowerCase() === "guest";
/** What a role gives for one permission. */
export function roleCell(r: RoleLite, key: string): Cell {
  if (isOwnerRole(r) || r.permissions.includes(key)) return "allow";
  return isGuestRole(r) ? "no" : "ask";
}
export const CELL_WORD: Readonly<Record<Cell, string>> = { allow: "Allowed", own: "Own only", ask: "Ask an admin", no: "Not allowed" };
export const EFFECT_WORD: Readonly<Record<Effect, string>> = { allow: "Allowed", own: "Own only", ask: "Ask an admin", deny: "Not allowed" };
/** A permission an exception does not give, as a cell: Ask an admin when the exception says so, Not allowed otherwise. */
export const refusedCell = (e: Pick<ExceptionLite, "effect">): Cell => (e.effect === "ask" ? "ask" : "no");
/** An exception's answer for one permission: Own only allows the own part and refuses the Space part. */
export const allowsKey = (e: Pick<ExceptionLite, "effect" | "own">, key: string): boolean => e.effect === "allow" || (e.effect === "own" && (e.own ?? []).includes(key));

/**
 * One area row's word for a set of values (permission key to Allowed or not): all the same; Own only where the area has an own and a Space part (lib/own-pairs.ts) and the own part is
 * allowed while the Space part is not; otherwise mixed (null: the row shows its marks).
 */
export function areaWord(area: string, has: (key: string) => boolean, cells: readonly Cell[]): Cell | null {
  if (cells.every((c) => c === cells[0])) return cells[0] ?? null;
  const pairs = pairsFor({ area });
  if (pairs.length && pairs.every((p) => (p.own === null || has(p.own)) && !has(p.space))) return "own";
  return null;
}
/** Own only is offered only where the chosen area or permission has an own and a Space part. */
export const offersOwnOnly = (sel: { area?: string | undefined; perms?: readonly string[] | undefined }): boolean => pairsFor(sel).length > 0;

/** The built-in roles always shown, in order; custom roles follow when asked for. */
const BUILT_ORDER = ["owner", "admin", "developer", "member", "guest"];
export function columns(roles: readonly RoleLite[], withCustom: boolean): RoleLite[] {
  const built = roles.filter((r) => r.builtIn).sort((a, b) => (BUILT_ORDER.indexOf(a.name.toLowerCase()) + 1 || 9) - (BUILT_ORDER.indexOf(b.name.toLowerCase()) + 1 || 9));
  return withCustom ? [...built, ...roles.filter((r) => !r.builtIn)] : built;
}

/** A person's own exception on a key beats a group's; among peers Allow wins. Null when none applies. */
export function exceptionFor(person: PersonLite, key: string, ex: readonly ExceptionLite[], now: number): ExceptionLite | null {
  const live = ex.filter((e) => e.perms.includes(key) && (e.until === undefined || e.until > now));
  const pick = (list: ExceptionLite[]) => list.find((e) => allowsKey(e, key)) ?? list[0] ?? null;
  return pick(live.filter((e) => e.subject.kind === "person" && e.subject.id === person.id)) ?? pick(live.filter((e) => e.subject.kind === "group" && person.groups.includes(e.subject.id)));
}

/** The people who hold this role themselves and differ from it on this key because of an exception (the count in a cell, the list in its menu). The Owner never differs. */
export function differ(role: RoleLite, key: string, people: readonly PersonLite[], ex: readonly ExceptionLite[], now: number): Array<{ person: PersonLite; ex: ExceptionLite }> {
  if (isOwnerRole(role)) return [];
  const has = role.permissions.includes(key);
  const out: Array<{ person: PersonLite; ex: ExceptionLite }> = [];
  for (const p of people) {
    if (p.kind !== "person" || p.status === "removed" || !p.roles.includes(role.id)) continue;
    const e = exceptionFor(p, key, ex, now);
    if (e && allowsKey(e, key) !== has) out.push({ person: p, ex: e });
  }
  return out;
}

/** Ends offered when adding an exception, as times from now (null: no end). */
export const ENDS: ReadonlyArray<{ key: string; title: string; ms: number | null }> = [
  { key: "none", title: "No end", ms: null }, { key: "day", title: "End of today", ms: -1 }, { key: "week", title: "In a week", ms: 7 * 86_400_000 }, { key: "month", title: "In 30 days", ms: 30 * 86_400_000 },
];
export function endAt(key: string, now: number): number | undefined {
  const e = ENDS.find((x) => x.key === key);
  if (!e || e.ms === null) return undefined;
  if (e.ms === -1) { const d = new Date(now); d.setHours(23, 59, 59, 0); return d.getTime() > now ? d.getTime() : now + 3_600_000; }
  return now + e.ms;
}

/** Values the signed-in admin may give: Not allowed always (a restriction is never more than you hold); Allowed only on keys they hold themselves. */
export function mayGive(effect: Effect, keys: readonly string[], mine: ReadonlySet<string> | undefined, ownKeys: readonly string[] = []): { ok: boolean; why?: string } {
  if (effect === "deny" || !mine) return { ok: true };
  const over = (effect === "own" ? ownKeys : keys).filter((k) => !mine.has(k));
  return over.length ? { ok: false, why: "More than you hold yourself" } : { ok: true };
}

export const dayMonth = (at: number): string => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
/** One exception as a line: "Exception set by Irfad on 3 Nov, until 10 Nov · First week". */
export function exceptionLine(e: ExceptionLite): string {
  return `Exception set by ${e.by.name.split(" ")[0]} on ${dayMonth(e.at)}${e.until !== undefined ? `, until ${dayMonth(e.until)}` : ""}${e.why ? ` · ${e.why}` : ""}`;
}
export function whatOf(e: Pick<ExceptionLite, "area" | "perms">, perms: readonly PermissionDef[]): string {
  if (e.area) return `All of ${areaTitle(e.area)}`;
  if (e.perms.length === 1) return perms.find((p) => p.key === e.perms[0])?.title ?? e.perms[0]!;
  const pairs = pairsFor({ perms: e.perms });
  if (pairs.length && pairs.every((p) => e.perms.includes(p.space))) return pairs.map((p) => p.title.split(":")[0]).join(", ");
  return `${e.perms.length} permissions`;
}
