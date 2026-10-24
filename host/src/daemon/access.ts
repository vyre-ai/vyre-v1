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

/** The live snapshot plus the Space's owner (from the Space resource), kept current by `fold`. */
export function createAccess(): { snap: AccessSnapshot; fold(e: FoldableEvent): void; owner(): string | null } {
  const snap = new AccessSnapshot();
  let owner: string | null = null;
  return {
    snap,
    fold(e) {
      foldEvent(snap, e);
      if (e.type === "resource.created") { const r = body<ResourceRow>(e); if (r.type === "space" && r.owner_id) owner = r.owner_id; }
    },
    owner: () => owner,
  };
}
