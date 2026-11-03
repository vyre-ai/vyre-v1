// Permission exceptions (owner, 3 Nov 2026: "per person exceptions too ... flexible ... connect it all properly"). A person or a group differs from their role on one permission or a whole
// area: Allowed or Not allowed, with an optional end and a reason. They are grant rows of the access store (no store of their own): a grant whose resource is the exception itself, so it reaches
// no resource chain, carrying `conditions.exception`. The kernel folds them into the permissions a person holds (kernel/src/authorize/snapshot.ts applyExceptions), so every gate reads the
// same answer: the gateway, identity.whoami's permissions and the app's gates.
// Rules: a person's own exception beats a group's, which beats the role; among peers Allow wins; the Owner is never restricted; an admin gives only what they hold; an exception with an end
// lapses on its own (the periodic job below) with an audited row; agents follow the person they act for, because authorize checks the agent and that person both.
import type { AccessCtx } from "../projections.ts";
import type { GrantRec } from "../projections.ts";
import { catalogueSource, nid, raise, storeOf } from "../projections.ts";
import { isOwnerRole } from "../../../kernel/src/authorize/snapshot.ts";
import { ownOnly, pairsFor } from "../../../lib/own-pairs.ts";

export type Effect = "allow" | "deny" | "own" | "ask";
export interface ExceptionIn { subject: { kind: "person" | "group"; id: string }; perms?: string[]; area?: string; effect: Effect; until?: number; why?: string }
export interface ExceptionRow {
  exceptionId: string; subject: { kind: "person" | "group"; id: string; name: string }; perms: string[]; own?: string[]; area?: string; effect: Effect;
  until?: number; why?: string; by: { id: string; name: string }; at: number;
}

/** The catalogue's keys and the area each belongs to (manifests/permissions.ts, the rows of the Console matrix). */
let areaOfKey: Map<string, string> | null = null;
const titleOfKey = new Map<string, string>();
export function catalogueAreas(): Map<string, string> {
  if (areaOfKey) return areaOfKey;
  const m = new Map<string, string>();
  for (const line of catalogueSource().split("\n")) { const x = /^\s*perm\('([^']+)', '([^']+)', '([^']*)'/.exec(line); if (x) { m.set(x[1]!, x[2]!); titleOfKey.set(x[1]!, x[3]!); } }
  areaOfKey = m;
  return m;
}
/** A permission in the catalogue's words ("Build Space automations"), for a sentence a person reads. */
export const permTitle = (key: string): string => { catalogueAreas(); return titleOfKey.get(key) ?? key; };

const isException = (g: GrantRec): boolean => g.conditions.exception !== undefined;
const nameOf = (ctx: AccessCtx, id: string): string => {
  const store = storeOf(ctx);
  return store.principals.get(id)?.name ?? store.groups.get(id)?.name ?? id;
};
function rowOf(ctx: AccessCtx, g: GrantRec): ExceptionRow {
  const x = g.conditions.exception!;
  return {
    exceptionId: g.id, subject: { kind: g.subject.kind === "group" ? "group" : "person", id: g.subject.id, name: nameOf(ctx, g.subject.id) }, perms: [...x.perms], ...(x.own ? { own: [...x.own] } : {}), ...(x.area ? { area: x.area } : {}),
    effect: x.effect, ...(g.conditions.expiresAt !== undefined ? { until: g.conditions.expiresAt } : {}), ...(x.why ? { why: x.why } : {}),
    by: { id: g.by, name: nameOf(ctx, g.by) }, at: x.at ?? g.createdAt,
  };
}
const live = (ctx: AccessCtx, g: GrantRec): boolean => isException(g) && (g.conditions.expiresAt === undefined || g.conditions.expiresAt > ctx.now());

/** Is this principal the Space's Owner (by a role of their own)? The Owner is never restricted. */
function holdsOwner(ctx: AccessCtx, id: string): boolean {
  const store = storeOf(ctx);
  return store.rolesOf(id).some((r) => isOwnerRole(r, store.roles.get(r)?.name));
}

export async function exceptionsList(ctx: AccessCtx, input: { subject?: { kind: "person" | "group"; id: string } }) {
  const store = storeOf(ctx);
  const rows = [...store.grants.values()].filter((g) => live(ctx, g) && (!input.subject || (g.subject.id === input.subject.id)));
  rows.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
  return { exceptions: rows.map((g) => rowOf(ctx, g)) };
}

export async function exceptionsSet(ctx: AccessCtx, input: ExceptionIn & { idempotencyKey?: string }) {
  const store = storeOf(ctx);
  const trace = ctx.trace.traceId;
  const areas = catalogueAreas();
  const subject = input.subject;
  if (subject.kind === "group") { if (!store.groups.has(subject.id)) raise(trace, "validation.not_found", "That group is not in this Space."); }
  else {
    const p = store.principals.get(subject.id);
    if (!p || p.kind !== "person") raise(trace, "validation.not_found", "That person is not in this Space.");
  }
  let perms = [...new Set(input.perms ?? [])];
  let own: string[] | undefined;
  if (input.effect === "own") {
    // Own only: Allow on the own-scope permission, Not allowed on the Space one (lib/own-pairs.ts); only where the action has both parts
    const pairs = pairsFor({ area: input.area, perms });
    if (!pairs.length) raise(trace, "validation.bad_input", "Own only is for an action with a part of their own and a part for the Space.");
    const o = ownOnly(pairs);
    own = o.allow;
    perms = [...new Set([...o.allow, ...o.deny])];
  } else if (input.area) {
    const inArea = [...areas].filter(([, a]) => a === input.area).map(([k]) => k);
    if (!inArea.length) raise(trace, "validation.bad_input", "There is no such area of permissions.");
    perms = [...new Set([...perms, ...inArea])];
  }
  if (!perms.length) raise(trace, "validation.bad_input", "Pick a permission or an area.");
  const unknown = perms.filter((k) => !areas.has(k));
  if (unknown.length) raise(trace, "validation.bad_input", "One of those is not a permission in this Space.");
  // a Guest works inside what was shared with them and cannot ask for more (access.request), so Ask an admin is not theirs to have
  if (input.effect === "ask" && subject.kind === "person" && store.rolesOf(subject.id).length > 0 && store.rolesOf(subject.id).every((r) => r === "rol_guest")) raise(trace, "validation.bad_input", "A Guest can't ask an admin. Choose Not allowed.");
  if (input.until !== undefined && input.until <= ctx.now()) raise(trace, "validation.bad_input", "The end has to be in the future.");
  // the Owner is never restricted
  if (input.effect !== "allow" && subject.kind === "person" && holdsOwner(ctx, subject.id)) raise(trace, "permission.role_lacks_permission", "The Owner can't be restricted.");
  // an admin gives only what they hold: every key allowed here must be one the caller holds now (their own exceptions count)
  const given = input.effect === "allow" ? perms : input.effect === "own" ? (own ?? []) : [];
  if (given.length) {
    const mine = store.snapshot().info(ctx.actingFor ?? ctx.principal.id)?.perms ?? new Set<string>();
    const over = given.filter((k) => !mine.has(k));
    if (over.length) raise(trace, "permission.role_lacks_permission", `You can give only what you hold yourself. You don't hold ${over.length === 1 ? `"${permTitle(over[0]!)}"` : `${over.length} of these`}.`);
  }
  const why = input.why?.trim();
  const g: GrantRec = {
    id: nid("exc"), subject: { kind: subject.kind === "group" ? "group" : "person", id: subject.id }, resource: { type: "exception", id: "" }, level: "view",
    conditions: { exception: { perms: perms.sort(), effect: input.effect, ...(own ? { own } : {}), at: ctx.now(), ...(input.area ? { area: input.area } : {}), ...(why ? { why } : {}) }, ...(input.until !== undefined ? { expiresAt: input.until } : {}) },
    by: ctx.actingFor ?? ctx.principal.id, createdAt: ctx.now(), source: "exception",
  };
  g.resource.id = g.id;
  store.grants.set(g.id, g);
  const row = rowOf(ctx, g);
  ctx.emit("access.exception_set", g.id, { exceptionId: g.id, subject: g.subject, perms: row.perms, effect: row.effect, ...(row.area ? { area: row.area } : {}), ...(row.until !== undefined ? { until: row.until } : {}), by: g.by });
  bumpAndPersist(ctx);
  return { exception: row };
}

export async function exceptionsRemove(ctx: AccessCtx, input: { exceptionId: string }) {
  return drop(ctx, input.exceptionId, false);
}

/** An exception whose end has come: the server removes it (the periodic job below), and the audit log has the row. */
export async function exceptionsLapse(ctx: AccessCtx, input: { exceptionId: string }) {
  if ((ctx as { origin?: string }).origin !== "hook") raise(ctx.trace.traceId, "permission.role_lacks_permission", "Only the server ends an exception at its end.");
  const g = storeOf(ctx).grants.get(input.exceptionId);
  if (!g || !isException(g) || g.conditions.expiresAt === undefined || g.conditions.expiresAt > ctx.now()) return { removed: false };
  return drop(ctx, input.exceptionId, true);
}

function drop(ctx: AccessCtx, id: string, lapsed: boolean) {
  const store = storeOf(ctx);
  const g = store.grants.get(id);
  if (!g || !isException(g)) raise(ctx.trace.traceId, "validation.not_found", "That exception is gone.");
  store.grants.delete(id);
  const x = g.conditions.exception!;
  ctx.emit("access.exception_removed", id, { exceptionId: id, subject: g.subject, perms: [...x.perms], effect: x.effect, lapsed, by: lapsed ? "svc_host" : (ctx.actingFor ?? ctx.principal.id) });
  bumpAndPersist(ctx);
  return { removed: true };
}

function bumpAndPersist(ctx: AccessCtx): void {
  const store = storeOf(ctx);
  store.bump();
  ctx.emit("access.changed", String(store.epoch), { epoch: store.epoch, what: "assignment", by: ctx.principal.id });
  try { store.persist(ctx.db); } catch (e) { store.bump(); throw e; }
}

/**
 * Why a person may or may not do what a permission covers, in plain words (Console Access checker, In the app): the Owner; their own exception; a group's; or their roles. The words name who set
 * an exception and when, and what it overrides.
 */
export async function exceptionsExplain(ctx: AccessCtx, input: { principal: string; perm: string }) {
  const store = storeOf(ctx), trace = ctx.trace.traceId;
  const p = store.principals.get(input.principal);
  if (!p) raise(trace, "validation.not_found", "That person is not in this Space.");
  if (!catalogueAreas().has(input.perm)) raise(trace, "validation.bad_input", "There is no such permission.");
  const snap = store.snapshot();
  const person = p.kind === "agent" && p.owner ? p.owner : p.id;
  const holds = snap.info(person)?.perms.has(input.perm) === true && (person === p.id || snap.info(p.id)?.perms.has(input.perm) === true || snap.agentFollows(person, input.perm));
  const roleIds = new Set(store.rolesOf(person));
  for (const g of store.groups.values()) if (g.members.some((m) => m.id === person)) for (const r of store.rolesOf(g.id)) roleIds.add(r);
  const roles = [...roleIds].map((r) => store.roles.get(r)).filter((r): r is NonNullable<typeof r> => !!r);
  const byRole = roles.find((r) => r.permissions.includes(input.perm));
  const roleWords = byRole ? `${byRole.name}: Allowed` : `${roles.map((r) => r.name).join(", ") || "No role"}: Not allowed`;
  const date = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const first = (id: string) => (store.principals.get(id)?.name ?? id).split(" ")[0]!;
  const ends = (g: GrantRec) => (g.conditions.expiresAt !== undefined ? `, until ${date(g.conditions.expiresAt)}` : "");
  const groupsOfP = new Set([...store.groups.values()].filter((g) => g.members.some((m) => m.id === person)).map((g) => g.id));
  const exc = [...store.grants.values()].filter((g) => live(ctx, g) && g.conditions.exception!.perms.includes(input.perm));
  const own = exc.filter((g) => g.subject.kind !== "group" && g.subject.id === person).sort((a, b) => (a.conditions.exception!.effect === "allow" ? -1 : 1) - (b.conditions.exception!.effect === "allow" ? -1 : 1))[0];
  const viaGroup = exc.filter((g) => g.subject.kind === "group" && groupsOfP.has(g.subject.id)).sort((a, b) => (a.conditions.exception!.effect === "allow" ? -1 : 1) - (b.conditions.exception!.effect === "allow" ? -1 : 1))[0];
  let source: "owner" | "person" | "group" | "role" = "role", words = roleWords, exception: ExceptionRow | undefined;
  if (holdsOwner(ctx, person)) { source = "owner"; words = "The Owner can do everything here."; }
  else if (own) { source = "person"; exception = rowOf(ctx, own); words = `Exception set by ${first(own.by)} on ${date((own.conditions.exception!.at ?? own.createdAt))}${ends(own)}, overrides ${roleWords}.${own.conditions.exception!.why ? ` Reason: ${own.conditions.exception!.why}` : ""}`; }
  else if (viaGroup) { source = "group"; exception = rowOf(ctx, viaGroup); words = `Exception for ${nameOf(ctx, viaGroup.subject.id)}, set by ${first(viaGroup.by)} on ${date((viaGroup.conditions.exception!.at ?? viaGroup.createdAt))}${ends(viaGroup)}, overrides ${roleWords}.${viaGroup.conditions.exception!.why ? ` Reason: ${viaGroup.conditions.exception!.why}` : ""}`; }
  if (person !== p.id) words += ` ${p.name} acts for ${store.principals.get(person)?.name ?? person} and gets the same answer.`;
  return { allowed: holds, source, words, ...(exception ? { exception } : {}) };
}

/** The periodic job: every exception whose end has come lapses through access.exceptions.lapse, one audited row each. */
export async function lapseDue(ctx: AccessCtx & { call?(cap: string, input: unknown): Promise<unknown> }): Promise<string[]> {
  const store = storeOf(ctx);
  const due = [...store.grants.values()].filter((g) => isException(g) && g.conditions.expiresAt !== undefined && g.conditions.expiresAt <= ctx.now()).map((g) => g.id);
  const done: string[] = [];
  for (const id of due) { if (!ctx.call) break; await ctx.call("access.exceptions.lapse", { exceptionId: id }); done.push(id); }
  return done;
}
