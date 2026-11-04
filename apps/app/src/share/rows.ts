// The rows and the directory the one Access sheet takes, from the access data every place reads (access.shares_of, the Space directory).
import type { CapMap } from "../../../../generated/types.ts";
import type { AccessEntry, ShareRow } from "../../../../ui/src/AccessSheet/index.tsx";

export type SharesOut = CapMap["access.shares_of"]["out"];
export type AccessRow = ShareRow & { through: SharesOut["shares"][number]["through"] };

/**
 * The contract's grants as the sheet's rows: a grant on this item can be raised and removed, the rest come from a group, a role, a folder or the Space above it. `through` keeps which.
 * `resourceId` is the item itself: a group or role it was given to (Everyone) is a grant on the item, not something inherited.
 */
export function shareRows(out: SharesOut, name: (id: string) => string, resourceId?: string): AccessRow[] {
  return out.shares.map((s) => {
    const kind = s.grant.subject.kind;
    return {
      subjectKind: kind === "person" || kind === "group" || kind === "role" || kind === "agent" || kind === "link" ? kind : "agent",
      subjectId: s.grant.subject.id, name: name(s.grant.subject.id), level: s.grant.level,
      via: s.through === "owner" ? "owner" : s.through === "direct" || (resourceId !== undefined && s.grant.resource.id === resourceId) ? "grant" : s.through === "folder" ? "folder" : "space",
      fromFolderId: s.through === "folder" ? s.grant.source ?? null : null,
      ...(s.grant.conditions.export === true ? { canExport: true } : {}), ...(s.grant.conditions.reshare === true ? { canShare: true } : {}),
      through: s.through,
    };
  });
}

export const entries = (list: readonly { id: string; name: string; sub?: string }[], kind: AccessEntry["kind"]): AccessEntry[] => list.map((e) => ({ id: e.id, name: e.name, kind, ...(e.sub ? { sub: e.sub } : {}) }));

/** The people, groups, roles and agents a Space offers, as the sheet's directory. */
export function sheetDirectory(d: { people: readonly { id: string; name: string }[]; groups: readonly { id: string; name: string }[]; roles: readonly { id: string; name: string }[]; agents: readonly { id: string; name: string }[] }) {
  return { people: entries(d.people, "person"), groups: entries(d.groups, "group"), roles: entries(d.roles, "role"), agents: entries(d.agents, "agent") };
}
