// The five roles as bundles (0.6 kernel/grants/roles.js, contracts roles.d.ts). A membership expands to grants whose `source` is `role:<id>` at the level below; `ROLE_PERMS` is the
// permission table the access projection loads into `role_perms`. Only named capabilities, never wildcards. Per-project overrides may narrow a role, never widen it.
import type { Level } from "./types.ts";

export const ROLE_IDS = Object.freeze(["owner", "admin", "manager", "member", "temp"] as const);
export type RoleId = (typeof ROLE_IDS)[number];
/** 4 for owner down to 0 for temp. */
export const ROLE_RANK: Readonly<Record<RoleId, number>> = Object.freeze(Object.fromEntries(ROLE_IDS.map((id, i) => [id, ROLE_IDS.length - 1 - i])) as Record<RoleId, number>);
/** The roles an owner who hands a Space over may keep. */
export const ROLE_DEMOTE_TO: readonly RoleId[] = Object.freeze(["admin", "manager", "member"] as const);
/** Who may set whom: an owner any role; an admin the roles below admin; nobody else. */
export const ROLE_MAY_SET: Readonly<Record<RoleId, readonly RoleId[]>> = Object.freeze({
  owner: Object.freeze([...ROLE_IDS]), admin: Object.freeze(["manager", "member", "temp"] as RoleId[]), manager: Object.freeze([] as RoleId[]), member: Object.freeze([] as RoleId[]), temp: Object.freeze([] as RoleId[]),
});
export const maySet = (actor: RoleId, target: RoleId): boolean => ROLE_MAY_SET[actor].includes(target);

/** The level a role's grant over a resource carries. A temp grant must name its resources and an expiry. */
export const ROLE_LEVEL: Readonly<Record<RoleId, Level>> = Object.freeze({ owner: "manage", admin: "manage", manager: "edit", member: "edit", temp: "edit" });

const MEMBER = ["memory.read", "records.read", "records.create", "records.update", "records.remove", "records.restore", "events.read", "tasks.request", "tasks.read", "tasks.work", "tasks.decide", "project.reach", "flows.run", "ask.request"];
const MANAGER = [...MEMBER, "grants.list", "rules.list", "rules.get", "rules.test", "rules.propose"];
const ADMIN = [...MANAGER, "flows.define", "memory.file", "memory.retire", "vault.reveal", "records.define", "grants.create", "grants.revoke", "grants.narrow", "grants.role", "grants.member", "grants.invite", "records.import", "files.read", "files.write", "files.restore", "kits.propose", "kits.install", "kits.remove", "rules.set", "rules.enable", "rules.disable", "rules.remove", "service.read", "service.call"];
export const ROLE_PERMS: Readonly<Record<RoleId, readonly string[]>> = Object.freeze({
  // Moving the whole Personal space to My Cloud is the owner's alone: it freezes the space.
  owner: Object.freeze([...ADMIN, "space.upgrade", "space.upgrade_finish", "checkpoint.write", "checkpoint.read"]),
  admin: Object.freeze([...ADMIN]),
  manager: Object.freeze([...MANAGER]),
  member: Object.freeze([...MEMBER]),
  temp: Object.freeze(["records.read", "records.create", "records.update", "tasks.read", "tasks.work"]),
});
