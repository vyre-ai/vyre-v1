// What a role id or a permission code says in words, for the Access tabs (an id or a dotted capability name is never shown to a person). The permission titles are the catalogue's own (manifests/permissions.ts).
import { permissions } from "../../../../../generated/permissions.ts";
import { areasOf } from "./permissions-model.ts";
import type { PermissionDef } from "./permissions-model.ts";

const DEFS: readonly PermissionDef[] = permissions.map((p) => ({
  key: p.key,
  area: p.area,
  title: p.title,
  risk: p.risk,
}));
const BUILT_IN_ROLE: Readonly<Record<string, string>> = {
  rol_owner: "Owner",
  rol_admin: "Admin",
  rol_member: "Member",
  rol_guest: "Guest",
  rol_developer: "Developer",
};

/** The names of the roles: the Space's list first, then the built-in names; a role neither knows is "A custom role", never its id. */
export function roleWords(ids: readonly string[], roles: readonly { id: string; name: string }[] = []): string {
  const out = ids.map((id) => roles.find((r) => r.id === id)?.name ?? BUILT_IN_ROLE[id] ?? "A custom role");
  return out.join(", ");
}

/** What the held permissions let a person do, by area, each in the catalogue's plain title ("Create agents"); a code the catalogue does not know is left out. */
export function permissionLines(held: readonly string[]): { area: string; title: string; lines: string[] }[] {
  const have = new Set(held);
  return areasOf(DEFS.filter((d) => have.has(d.key)))
    .map((a) => ({ area: a.area, title: a.title, lines: a.perms.map((p) => p.title) }))
    .filter((a) => a.lines.length > 0);
}
