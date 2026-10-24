// The access projection for the seed: seed events folded into the kernel's AccessSnapshot, so the seed answers `authorize` and `scopeFor` the way a real Space does.
import { AccessSnapshot } from "../../../kernel/src/authorize/index.ts";
import type { GrantRow, PrincipalRoleRow, PrincipalRow, ResourceRow, RoleRow } from "../../../kernel/src/authorize/index.ts";
import type { StoredEvent } from "../../../kernel/src/log/types.ts";

const json = <T,>(e: StoredEvent): T => JSON.parse(new TextDecoder().decode(e.payload)) as T;

export function applyEvent(snap: AccessSnapshot, e: StoredEvent): void {
  switch (e.type) {
    case "role.defined": snap.putRole(json<RoleRow>(e)); return;
    case "principal.created": snap.putPrincipal(json<PrincipalRow>(e)); return;
    case "principal.role_set": snap.addPrincipalRole(json<PrincipalRoleRow>(e)); return;
    case "group.member_added": snap.addMember(json<{ group: string; member: string }>(e)); return;
    case "resource.created": snap.putResource(json<ResourceRow>(e)); return;
    case "grant.created": snap.putGrant(json<GrantRow>(e)); return;
    default: return;   // space.created, group.created: names only
  }
}

export function buildSnapshot(events: readonly StoredEvent[]): AccessSnapshot {
  const snap = new AccessSnapshot();
  for (const e of events) applyEvent(snap, e);
  return snap;
}
