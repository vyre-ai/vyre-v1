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

// ---- the live access module's own tables
// The access module keeps its roles, groups, principals, grants and resources in access_* tables of modules.db and reads them at boot; the kernel fold above never reaches them, so a seeded
// Space looked empty to access.view_as, access.share and every other access capability ("no such person", "no such resource"). `fillAccessTables` writes the seed there, in the module's
// vocabulary: its five built-in roles (rol_owner, rol_admin, rol_developer, rol_member, rol_guest, permissions from the catalogue) and the seed's roles mapped onto them
// (manager -> developer, temp -> guest), actor grants turned into person or agent grants, numeric labels into label names.
import { PERMISSIONS } from "../../../manifests/permissions.ts";

type Row = Record<string, unknown>;
interface AnyEvent { type: string; payload: unknown }
export interface AccessTableDb { run(sql: string, ...args: unknown[]): unknown }

const body = (e: AnyEvent): Row => (e.payload instanceof Uint8Array ? (JSON.parse(new TextDecoder().decode(e.payload)) as Row) : (e.payload as Row));
const LABELS = ["public", "internal", "confidential", "restricted"] as const;
const ROLE_OF: Record<string, string> = { owner: "rol_owner", admin: "rol_admin", manager: "rol_developer", member: "rol_member", temp: "rol_guest" };
const BUILT_IN = [
  { name: "owner", title: "Owner", clearance: "restricted", agents: false },
  { name: "admin", title: "Admin", clearance: "restricted", agents: false },
  { name: "developer", title: "Developer", clearance: "confidential", agents: true },
  { name: "member", title: "Member", clearance: "internal", agents: true },
  { name: "guest", title: "Guest", clearance: "public", agents: true },
] as const;
const SEED_TIME = 1_790_000_000_000;
const POLICIES: [string, string, unknown][] = [
  ["labels.provider", "provider_label", { allow: { local: 3 }, defaultMax: 1 }],
  ["sharing.public_links", "sharing", "admins"],
  ["sign_in.second_factor", "sign_in", { floor: "optional" }],
  ["retention.default", "retention", { days: 0 }],
  ["vault.ladder", "vault", { order: ["use", "view", "edit", "manage"] }],
];

/** The permission keys of one built-in role: the catalogue column, and every key for the owner. */
const permissionsOf = (name: string): string[] => PERMISSIONS.filter((p) => name === "owner" || p.defaults[name as keyof typeof p.defaults]).map((p) => p.key).sort();

/** Replaces the access module's tables with the seed's contents. Call it on a modules.db whose migrations have run, with the seed's events in order. */
export function fillAccessTables(db: AccessTableDb, events: readonly AnyEvent[]): void {
  for (const t of ["access_roles", "access_groups", "access_principals", "access_assignments", "access_grants", "access_resources", "access_policies", "access_meta"]) db.run(`DELETE FROM ${t}`);
  db.run("INSERT INTO access_meta (id, epoch) VALUES (?, ?)", "space", 1);
  for (const r of BUILT_IN) db.run("INSERT INTO access_roles (id,name,builtIn,clearance,assignableToAgents,permissions,version) VALUES (?,?,?,?,?,?,?)", `rol_${r.name}`, r.title, 1, r.clearance, r.agents ? 1 : 0, JSON.stringify(permissionsOf(r.name)), 1);
  for (const [key, kind, value] of POLICIES) db.run("INSERT INTO access_policies (key,scope,kind,value,updated_at) VALUES (?,?,?,?,?)", key, "space", kind, JSON.stringify(value), SEED_TIME);

  const groups = new Map<string, { name: string; members: { kind: string; id: string }[] }>([["grp_everyone", { name: "Everyone", members: [] }]]);
  const principals = new Map<string, Row>();
  const roles = new Map<string, string[]>();
  const kindOf = (id: string): string => (id.startsWith("agt_") ? "agent" : id.startsWith("svc_") ? "service" : "person");
  for (const e of events) {
    const p = body(e);
    switch (e.type) {
      case "group.created": groups.set(String(p["id"]), { name: String(p["name"]), members: groups.get(String(p["id"]))?.members ?? [] }); break;
      case "group.member_added": {
        const g = groups.get(String(p["group"]));
        if (g) g.members.push({ kind: kindOf(String(p["member"])), id: String(p["member"]) });
        break;
      }
      case "principal.created": principals.set(String(p["id"]), p); break;
      case "principal.role_set": roles.set(String(p["holder"]), [...(roles.get(String(p["holder"])) ?? []), ROLE_OF[String(p["role"])] ?? `rol_${String(p["role"])}`]); break;
      case "resource.created":
        db.run("INSERT OR REPLACE INTO access_resources (id,type,parent_id,label,owner_id,holds,row_json) VALUES (?,?,?,?,?,?,?)", String(p["id"]), String(p["type"]), p["parent_id"] ?? null, LABELS[Number(p["label"] ?? 0)] ?? "public", p["owner_id"] ?? null, Number(p["holds"] ?? 0), null);
        break;
      case "grant.created": {
        const kind = String(p["subject_kind"]), id = String(p["subject_id"]);
        const subjectKind = kind === "actor" ? kindOf(id) : kind;
        const subjectId = kind === "role" ? (ROLE_OF[id] ?? `rol_${id}`) : id;
        db.run("INSERT INTO access_grants (id,subjectKind,subjectId,resourceType,resourceId,level,conditions,expiresAt,by,source,version) VALUES (?,?,?,?,?,?,?,?,?,?,?)", String(p["id"]), subjectKind, subjectId, String(p["resource_type"]), p["resource_id"] ?? "*", String(p["level"]), "{}", null, String(p["by"] ?? "svc_seed"), null, 1);
        break;
      }
      default: break;
    }
  }
  for (const [id, g] of groups) db.run("INSERT INTO access_groups (id,name,members,managers,builtIn,version) VALUES (?,?,?,?,?,?)", id, g.name, JSON.stringify(g.members), "[]", id === "grp_everyone" ? 1 : 0, 1);
  for (const [id, p] of principals) {
    const mine = roles.get(id) ?? [];
    const inGroups = [...groups].filter(([, g]) => g.members.some((m) => m.id === id)).map(([gid]) => gid);
    db.run("INSERT INTO access_principals (id,name,kind,owner,status,roles,groups,title,createdAt,version) VALUES (?,?,?,?,?,?,?,?,?,?)", id, String(p["name"] ?? id), String(p["kind"] ?? kindOf(id)), p["owner"] ?? null, String(p["status"] ?? "active"), JSON.stringify(mine), JSON.stringify(inGroups), null, SEED_TIME, 1);
    for (const r of mine) db.run("INSERT OR IGNORE INTO access_assignments (holder,role_id) VALUES (?,?)", id, r);
  }
}
