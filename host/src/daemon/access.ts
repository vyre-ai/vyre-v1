// The daemon's access snapshot: the event log folded into the kernel's AccessSnapshot so `authorize` answers for the live Space. Booting reads the whole log once; every commit folds its own events.
// Only the access event types matter here (the same six the seeded Spaces use); the access module's own projections (L7a) can replace this fold without touching the daemon's callers.
import { AccessSnapshot } from "../../../kernel/src/authorize/index.ts";
import type { GrantRow, PrincipalRoleRow, PrincipalRow, ResourceRow, RoleRow } from "../../../kernel/src/authorize/index.ts";

export interface FoldableEvent { type: string; payload: unknown }

function body<T>(e: FoldableEvent): T {
  const p = e.payload;
  if (p instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(p)) as T;
  return p as T;
}

export function foldEvent(snap: AccessSnapshot, e: FoldableEvent): void {
  switch (e.type) {
    case "role.defined": snap.putRole(body<RoleRow>(e)); return;
    case "principal.created": snap.putPrincipal(body<PrincipalRow>(e)); return;
    case "principal.role_set": snap.addPrincipalRole(body<PrincipalRoleRow>(e)); return;
    case "group.member_added": snap.addMember(body<{ group: string; member: string }>(e)); return;
    case "resource.created": snap.putResource(body<ResourceRow>(e)); return;
    case "grant.created": snap.putGrant(body<GrantRow>(e)); return;
    default: return;
  }
}

export function buildAccess(events: readonly FoldableEvent[]): AccessSnapshot {
  const snap = new AccessSnapshot();
  for (const e of events) foldEvent(snap, e);
  return snap;
}

/** The events the access module folds into its store (modules/access/consumers.ts ACCESS_EVENTS). */
const MODULE_EVENTS = new Set([
  "role.defined", "principal.created", "principal.role_set", "group.member_added", "resource.created", "grant.created",
  "principal.suspended", "principal.reactivated", "member.removed",
]);
export const isAccessEvent = (type: string): boolean => MODULE_EVENTS.has(type);
/** Events after which the module's tables may differ from the snapshot the daemon holds: the ones it folds, plus what its own capabilities emit when a role, share, revoke or policy changes. */
export const touchesAccess = (type: string): boolean => MODULE_EVENTS.has(type) || type === "access.changed" || type === "policy.changed" || type.startsWith("grant.");

/** An event as the access module takes it: the payload decoded. */
export function toAccessEvent(e: { seq: number; type: string; payload: unknown; actor?: string }): { seq: number; type: string; payload: unknown; actor?: string } {
  return { seq: e.seq, type: e.type, payload: body<unknown>(e), ...(e.actor !== undefined ? { actor: e.actor } : {}) };
}

/**
 * The live snapshot plus the Space's owner (from the Space resource), kept current by `fold`.
 * Ruling 70: `authorize` answers from the access module's snapshot. `fold` keeps the seed-shaped fold as the snapshot until the module's is adopted (boot, before the first call)
 * and as the answer if the module cannot be reached; `adopt` swaps the module's snapshot in, and `snap` is whichever is current.
 */
export function createAccess(): { readonly snap: AccessSnapshot; fold(e: FoldableEvent): void; owner(): string | null; adopt(s: AccessSnapshot): void; adopted(): boolean } {
  const seeded = new AccessSnapshot();
  let current: AccessSnapshot = seeded, own = false;
  let owner: string | null = null;
  return {
    get snap() { return current; },
    fold(e) {
      foldEvent(seeded, e);
      if (e.type === "resource.created") { const r = body<ResourceRow>(e); if (r.type === "space" && r.owner_id) owner = r.owner_id; }
    },
    owner: () => owner,
    adopt(s) { current = s; own = true; },
    adopted: () => own,
  };
}

/** A member or a guest: a person the Space knows who holds at least one role, or at least one grant (their own, through a group or through a role). The check behind capabilities at level 'member' (ruling 69). */
export function isMemberOrGuest(snap: AccessSnapshot, principalId: string): boolean {
  const me = snap.info(principalId);
  if (!me) return false;
  if (me.roleNames !== "no role") return true;
  for (const g of snap.allGrantRecs()) if (me.keys.has(g.key)) return true;
  return false;
}
