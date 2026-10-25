// P-H_15: the built-in roles get their permissions from the permission catalogue (manifests/permissions.ts), never from a hand-kept list, so schema.manage, records.edit and every permission
// a later packet adds exist the moment the catalogue has them. The kernel does not import manifests (layer rule), so the catalogue is passed in: a Space seed or the access module hands over
// `PERMISSIONS`; this file turns it into the role table.
//   owner    every permission in the catalogue
//   admin    every permission but the ownership ones (handing the Space to someone else stays the owner's alone)
//   manager  the member defaults plus the developer defaults (the seed's builder role)
//   member   the catalogue's member defaults
//   temp     nothing beyond the kernel's own temp bundle (ROLE_PERMS.temp): a temporary person is granted things by name
import type { RoleId } from "../grants/roles.ts";

/** The part of a catalogue row the roles read (PermissionDef in packages/contracts). */
export interface CataloguePerm { key: string; defaults: Readonly<Partial<Record<string, boolean>>> }

/** Permission keys only an owner holds: moving the Space to another person. */
export const OWNERSHIP_PERM = /(^|\.)(transfer_ownership|ownership)(\.|$)/;

const sorted = (s: Iterable<string>): string[] => [...new Set(s)].sort();

/** The catalogue's permissions per role. Pure; the same catalogue gives the same table. */
export function catalogueRolePerms(catalogue: readonly CataloguePerm[]): Record<RoleId, readonly string[]> {
  const keys = catalogue.map((p) => p.key);
  const on = (role: string): string[] => catalogue.filter((p) => p.defaults[role] === true).map((p) => p.key);
  return {
    owner: sorted(keys),
    admin: sorted(keys.filter((k) => !OWNERSHIP_PERM.test(k))),
    manager: sorted([...on("member"), ...on("developer")]),
    member: sorted(on("member")),
    temp: [],
  };
}

/** A role's full permission list: what the kernel already gave it plus what the catalogue gives it. */
export function withCatalogue(base: Readonly<Record<RoleId, readonly string[]>>, catalogue: readonly CataloguePerm[]): Record<RoleId, string[]> {
  const cat = catalogueRolePerms(catalogue);
  const out = {} as Record<RoleId, string[]>;
  for (const id of Object.keys(base) as RoleId[]) out[id] = sorted([...base[id], ...cat[id]]);
  return out;
}
