// Access projections (ARCH 4.5). Roles, groups, grants, resources, policies and the authorize snapshot.
// Built-in role columns come from the permission catalogue. The snapshot is the hot path; access.changed drops it.
// Durable tables: migrations/0001_access_core.sql. Authorize never reads a module table except through this snapshot.
import { readFileSync } from "node:fs";
import { fail } from "../../host/src/routes/errors.ts";
import { AccessSnapshot } from "../../kernel/src/authorize/index.ts";
import { isElevatedRole } from "../../kernel/src/authorize/snapshot.ts";
import type { Expr, GrantRow, Policy, PrincipalRow } from "../../kernel/src/authorize/index.ts";

type ProviderPolicy = Extract<Policy, { kind: "provider_label" }>;
type GatePolicy = Extract<Policy, { kind: "gate" }>;

export type Label = "public" | "internal" | "confidential" | "restricted";
export type Level = "view" | "use" | "edit" | "manage";
export type PKind = "person" | "agent" | "actor" | "service";
export type SubjectKind = PKind | "group" | "role" | "link";
export type PolicyKind = "gate" | "spend" | "limit" | "provider_label" | "retention" | "sign_in" | "sharing" | "vault";
export type Status = "invited" | "active" | "suspended" | "removed";

export interface Ref { kind: PKind; id: string }
export interface SubjectRef { kind: SubjectKind; id: string }
export interface ResourceRef { type: string; id: string }
export interface Cond {
  rowFilter?: unknown;
  hiddenFields?: string[];
  labelCeiling?: Label;
  window?: { from: number; to: number };
  expiresAt?: number;
}
export interface RoleRec {
  id: string;
  name: string;
  builtIn: boolean;
  clearance: Label;
  assignableToAgents: boolean;
  permissions: string[];
}
export interface GroupRec { id: string; name: string; builtIn: boolean; members: Ref[]; managers: Ref[] }
export interface PrincipalRec {
  id: string;
  kind: PKind;
  name: string;
  owner?: string;
  status: Status;
  title?: string;
  createdAt: number;
}
export interface GrantRec {
  id: string;
  subject: SubjectRef;
  resource: ResourceRef;
  level: Level;
  conditions: Cond;
  by: string;
  source?: string;
  createdAt: number;
}
export interface ResourceRec {
  id: string;
  type: string;
  parentId: string | null;
  label: Label;
  ownerId: string | null;
  holds: number;
  row?: Record<string, unknown>;
}
export interface PolicyRec { key: string; scope: string; kind: PolicyKind; value: unknown; updatedAt: number }
export interface ActorRec {
  id: string;
  provider: string;
  status: "pending" | "active" | "revoked";
  engineerMcp: boolean;
  tokenHash?: string;
  tokenExpires?: number;
  tokenUsed?: boolean;
  credHash?: string;
  lastSeenAt?: number;
}

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
export interface AccessCtx {
  space: string;
  principal: { kind: string; id: string };
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: string, subject: string, payload: unknown): unknown;
}

type Code = Parameters<typeof fail>[0];
export function raise(traceId: string, code: Code, message?: string): never {
  throw fail(code, traceId, message ? { message } : {});
}

export const LABEL_RANK: Record<Label, number> = { public: 0, internal: 1, confidential: 2, restricted: 3 };
export const LABEL_OF = ["public", "internal", "confidential", "restricted"] as const;
export const EVERYONE = "grp_everyone";
export const ROLE_IDS = ["rol_owner", "rol_admin", "rol_developer", "rol_member", "rol_guest"] as const;
const ROLE_NAMES = ["owner", "admin", "developer", "member", "guest"] as const;
const CLEARANCE: Record<(typeof ROLE_NAMES)[number], Label> = {
  owner: "restricted", admin: "restricted", developer: "confidential", member: "internal", guest: "public",
};
const AGENT_OK: Record<(typeof ROLE_NAMES)[number], boolean> = {
  owner: false, admin: false, developer: true, member: true, guest: true,
};
const OPS = new Set(["eq", "ne", "lt", "lte", "gt", "gte", "in", "owner_me", "and", "or"]);
const TABLES = [
  "access_meta", "access_roles", "access_groups", "access_principals", "access_assignments",
  "access_grants", "access_resources", "access_policies", "access_actors", "access_fields", "access_acl",
];

export function labelRank(l: Label): number { return LABEL_RANK[l]; }
export function labelOf(n: number): Label { return LABEL_OF[Math.max(0, Math.min(3, n))] ?? "public"; }

/** Permission keys per built-in role, from manifests/permissions.ts (the catalogue the generator seeds). */
export function parseCatalogue(src: string): Map<string, string[]> {
  const sets = new Map<string, Set<string>>(ROLE_NAMES.map((r) => [r, new Set()]));
  let seen = 0;
  for (const line of src.split("\n")) {
    const m = /^\s*perm\('([^']+)', '[^']+', '[^']*', '[^']+', \[([^\]]*)\]/.exec(line);
    if (!line.includes("perm('")) continue;
    seen++;
    if (!m) throw new Error(`catalogue line did not parse: ${line.trim()}`);
    const key = m[1]!;
    const who = m[2] ?? "";
    for (const role of ROLE_NAMES) if (role !== "guest" && who.includes(`'${role}'`)) sets.get(role)!.add(key);
    sets.get("owner")!.add(key);
  }
  if (seen < 50) throw new Error(`catalogue parsed ${seen} permissions`);
  return new Map([...sets].map(([k, v]) => [k, [...v].sort()]));
}

let catalogueText: string | null = null;
export function catalogueSource(): string {
  if (catalogueText === null) {
    catalogueText = readFileSync(new URL("../../manifests/permissions.ts", import.meta.url), "utf8");
  }
  return catalogueText;
}

export function nid(prefix: string): string {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return `${prefix}_${s}`;
}

export function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function isExpr(x: unknown): x is Expr {
  return !!x && typeof x === "object" && typeof (x as { op?: unknown }).op === "string" && OPS.has((x as { op: string }).op);
}

export function page<T>(all: readonly T[], cursor?: string, limit?: number): { rows: T[]; next?: string; total: number } {
  const lim = Math.min(500, Math.max(1, limit ?? 50));
  const start = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const rows = all.slice(start, start + lim);
  const out: { rows: T[]; next?: string; total: number } = { rows, total: all.length };
  if (start + rows.length < all.length) out.next = String(start + rows.length);
  return out;
}

function kernelKind(k: PKind): PrincipalRow["kind"] {
  if (k === "agent") return "agent";
  if (k === "service") return "svc";
  return "person";
}
function kernelStatus(s: Status): PrincipalRow["status"] {
  if (s === "active") return "active";
  if (s === "removed") return "removed";
  return "suspended";
}
function subjectKind(k: SubjectKind): "actor" | "group" | "role" {
  if (k === "group") return "group";
  if (k === "role") return "role";
  return "actor";
}

function policyOf(p: PolicyRec): Policy | null {
  const v = p.value;
  const o = v && typeof v === "object" ? v as Record<string, unknown> : {};
  if (p.kind === "provider_label") {
    const allow = o.allow && typeof o.allow === "object" ? o.allow as Record<string, number> : {};
    const out: ProviderPolicy = { key: p.key, kind: "provider_label", allow: { ...allow } };
    if (typeof o.defaultMax === "number") out.defaultMax = o.defaultMax;
    return out;
  }
  if (p.kind === "spend" || p.kind === "limit") {
    if (typeof o.meter !== "string" || typeof o.limitMicros !== "number") return null;
    const kinds = Array.isArray(o.principalKinds)
      ? o.principalKinds.filter((k): k is "person" | "agent" | "svc" => k === "person" || k === "agent" || k === "svc")
      : undefined;
    return { key: p.key, kind: "spend", meter: o.meter, limitMicros: o.limitMicros, ...(kinds && kinds.length ? { principalKinds: kinds } : {}) };
  }
  if (p.kind === "gate") {
    if (typeof o.act !== "string" || typeof o.approver !== "string" || !Array.isArray(o.caps)) return null;
    const out: GatePolicy = { key: p.key, kind: "gate", act: o.act, approver: o.approver, caps: o.caps.filter((c): c is string => typeof c === "string") };
    if (o.humanToo === true) out.humanToo = true;
    if (typeof o.checker_must_be_person === "boolean") out.checker_must_be_person = o.checker_must_be_person;
    return out;
  }
  return null;
}

export class AccessStore {
  epoch = 0;
  catalogue = new Set<string>();
  roles = new Map<string, RoleRec>();
  groups = new Map<string, GroupRec>();
  principals = new Map<string, PrincipalRec>();
  grants = new Map<string, GrantRec>();
  resources = new Map<string, ResourceRec>();
  policies = new Map<string, PolicyRec>();
  actors = new Map<string, ActorRec>();
  assignments = new Map<string, string[]>();
  fieldLabels = new Map<string, number>();
  idem = new Map<string, unknown>();
  private snap: AccessSnapshot | null = null;
  private snapEpoch = -1;

  bump(): void { this.epoch++; this.snap = null; }
  invalidate(): void { this.snap = null; }

  seed(): void {
    const parsed = parseCatalogue(catalogueSource());
    for (const name of ROLE_NAMES) {
      const id = `rol_${name}`;
      const permissions = parsed.get(name) ?? [];
      for (const k of permissions) this.catalogue.add(k);
      this.roles.set(id, {
        id, name: name.charAt(0).toUpperCase() + name.slice(1), builtIn: true,
        clearance: CLEARANCE[name], assignableToAgents: AGENT_OK[name], permissions: [...permissions],
      });
    }
    this.groups.set(EVERYONE, { id: EVERYONE, name: "Everyone", builtIn: true, members: [], managers: [] });
    const t = 1_700_000_000_000;
    this.policies.set(pkey("labels.provider", "space"), {
      key: "labels.provider", scope: "space", kind: "provider_label", updatedAt: t,
      value: { allow: { local: 3 }, defaultMax: 1 },
    });
    this.policies.set(pkey("sharing.public_links", "space"), {
      key: "sharing.public_links", scope: "space", kind: "sharing", value: "admins", updatedAt: t,
    });
    this.policies.set(pkey("sign_in.second_factor", "space"), {
      key: "sign_in.second_factor", scope: "space", kind: "sign_in", value: { floor: "optional" }, updatedAt: t,
    });
    this.policies.set(pkey("retention.default", "space"), {
      key: "retention.default", scope: "space", kind: "retention", value: { days: 0 }, updatedAt: t,
    });
    this.policies.set(pkey("vault.ladder", "space"), {
      key: "vault.ladder", scope: "space", kind: "vault", value: { order: ["use", "view", "edit", "manage"] }, updatedAt: t,
    });
    this.epoch = 1;
    this.snap = null;
  }

  /** Row the checker and scopeFor both read: filter fields, plus label, owner and holds taken from the resource. */
  resourceRow(id: string): Record<string, unknown> | undefined {
    const r = this.resources.get(id);
    if (!r) return undefined;
    return { ...(r.row ?? {}), id: r.id, owner_id: r.ownerId, label: labelRank(r.label), holds: r.holds };
  }

  /** Cached authorize snapshot. Rebuilt only when the epoch moves. */
  snapshot(): AccessSnapshot {
    if (this.snap && this.snapEpoch === this.epoch) return this.snap;
    const snap = new AccessSnapshot();
    snap.labelNames = ["Public", "Internal", "Confidential", "Restricted"];
    for (const r of this.roles.values()) {
      snap.putRole({ id: r.id, clearance: labelRank(r.clearance), perms: r.permissions, name: r.name });
    }
    snap.putRole({ id: "rol_engineer_mcp", clearance: 0, perms: ["engineer.mcp"], name: "Engineer MCP" });
    for (const p of this.principals.values()) {
      const row: PrincipalRow = { id: p.id, kind: kernelKind(p.kind), status: kernelStatus(p.status), name: p.name };
      if (p.owner) row.owner = p.owner;
      snap.putPrincipal(row);
    }
    for (const [holder, roles] of this.assignments) {
      const p = this.principals.get(holder);
      for (const roleId of roles) {
        const role = this.roles.get(roleId);
        if (p?.kind === "agent" && (isElevatedRole(roleId, role?.name) || role?.assignableToAgents === false)) continue;
        snap.addPrincipalRole({ holder, role: roleId });
      }
    }
    for (const a of this.actors.values()) if (a.engineerMcp && a.status === "active") snap.addPrincipalRole({ holder: a.id, role: "rol_engineer_mcp" });
    for (const g of this.groups.values()) for (const m of g.members) snap.addMember({ group: g.id, member: m.id });
    for (const r of this.resources.values()) {
      snap.putResource({
        id: r.id, type: r.type, parent_id: r.parentId, label: labelRank(r.label), owner_id: r.ownerId, holds: r.holds,
      });
    }
    for (const g of this.grants.values()) snap.putGrant(kernelGrant(g));
    for (const [k, n] of this.fieldLabels) {
      const dot = k.indexOf(".");
      if (dot > 0) snap.setFieldLabel(k.slice(0, dot), k.slice(dot + 1), n);
    }
    const policies: Policy[] = [];
    for (const p of this.policies.values()) { const k = policyOf(p); if (k) policies.push(k); }
    snap.setPolicies(policies);
    snap.rowSource = (id) => this.resourceRow(id);
    this.snap = snap;
    this.snapEpoch = this.epoch;
    return snap;
  }

  rolesOf(holder: string): string[] { return this.assignments.get(holder) ?? []; }
  setRoles(holder: string, roles: string[]): void { this.assignments.set(holder, [...new Set(roles)]); }

  holdersOf(roleId: string): Ref[] {
    const out: Ref[] = [];
    const seen = new Set<string>();
    const push = (id: string): void => {
      if (seen.has(id)) return;
      const p = this.principals.get(id);
      if (!p) return;
      seen.add(id);
      out.push({ kind: p.kind, id: p.id });
    };
    for (const [holder, roles] of this.assignments) if (roles.includes(roleId)) {
      if (this.principals.has(holder)) push(holder);
      const g = this.groups.get(holder);
      if (g) for (const m of g.members) push(m.id);
    }
    return out;
  }

  /** Permissions a principal holds from every role except one (group roles included). */
  permsExcept(id: string, skip: string): Set<string> {
    const p = this.principals.get(id);
    const roleIds = new Set<string>(this.rolesOf(id));
    for (const g of this.groups.values()) if (g.members.some((m) => m.id === id)) for (const r of this.rolesOf(g.id)) roleIds.add(r);
    const out = new Set<string>();
    for (const rid of roleIds) {
      if (rid === skip) continue;
      const role = this.roles.get(rid);
      if (!role) continue;
      if (p?.kind === "agent" && (isElevatedRole(rid, role.name) || !role.assignableToAgents)) continue;
      for (const k of role.permissions) out.add(k);
    }
    return out;
  }

  grantsFor(subject: SubjectRef): GrantRec[] {
    return [...this.grants.values()].filter((g) => g.subject.kind === subject.kind && g.subject.id === subject.id);
  }

  persist(db: Db): void {
    for (const t of TABLES) db.run(`DELETE FROM ${t}`);
    db.run("INSERT INTO access_meta (id,epoch) VALUES (?,?)", "space", this.epoch);
    for (const r of this.roles.values()) {
      db.run(
        "INSERT INTO access_roles (id,name,builtIn,clearance,assignableToAgents,permissions,version) VALUES (?,?,?,?,?,?,?)",
        r.id, r.name, r.builtIn ? 1 : 0, r.clearance, r.assignableToAgents ? 1 : 0, JSON.stringify(r.permissions), 1,
      );
    }
    for (const g of this.groups.values()) {
      db.run(
        "INSERT INTO access_groups (id,name,members,managers,builtIn,version) VALUES (?,?,?,?,?,?)",
        g.id, g.name, JSON.stringify(g.members), JSON.stringify(g.managers), g.builtIn ? 1 : 0, 1,
      );
    }
    for (const p of this.principals.values()) {
      const groups = [...this.groups.values()].filter((g) => g.members.some((m) => m.id === p.id)).map((g) => g.id);
      db.run(
        "INSERT INTO access_principals (id,name,kind,owner,status,roles,groups,title,createdAt,version) VALUES (?,?,?,?,?,?,?,?,?,?)",
        p.id, p.name, p.kind, p.owner ?? null, p.status, JSON.stringify(this.rolesOf(p.id)), JSON.stringify(groups), p.title ?? null, p.createdAt, 1,
      );
    }
    for (const [holder, roles] of this.assignments) for (const roleId of roles) {
      db.run("INSERT INTO access_assignments (holder,role_id) VALUES (?,?)", holder, roleId);
    }
    for (const g of this.grants.values()) {
      db.run(
        "INSERT INTO access_grants (id,subjectKind,subjectId,resourceType,resourceId,level,conditions,expiresAt,by,source,version) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        g.id, g.subject.kind, g.subject.id, g.resource.type, g.resource.id, g.level, JSON.stringify(g.conditions), g.conditions.expiresAt ?? null, g.by, g.source ?? null, 1,
      );
    }
    for (const r of this.resources.values()) {
      db.run(
        "INSERT INTO access_resources (id,type,parent_id,label,owner_id,holds,row_json) VALUES (?,?,?,?,?,?,?)",
        r.id, r.type, r.parentId, r.label, r.ownerId, r.holds, r.row ? JSON.stringify(r.row) : null,
      );
    }
    for (const p of this.policies.values()) {
      db.run(
        "INSERT INTO access_policies (key,scope,kind,value,updated_at) VALUES (?,?,?,?,?)",
        p.key, p.scope, p.kind, JSON.stringify(p.value), p.updatedAt,
      );
    }
    for (const a of this.actors.values()) {
      db.run(
        "INSERT INTO access_actors (id,provider,status,engineer,token_hash,token_expires,token_used,cred_hash,last_seen) VALUES (?,?,?,?,?,?,?,?,?)",
        a.id, a.provider, a.status, a.engineerMcp ? 1 : 0, a.tokenHash ?? null, a.tokenExpires ?? null, a.tokenUsed ? 1 : 0, a.credHash ?? null, a.lastSeenAt ?? null,
      );
    }
    for (const [k, n] of this.fieldLabels) db.run("INSERT INTO access_fields (k,rank) VALUES (?,?)", k, n);
  }

  hydrate(db: Db): void {
    this.roles.clear(); this.groups.clear(); this.principals.clear(); this.grants.clear();
    this.resources.clear(); this.policies.clear(); this.actors.clear(); this.assignments.clear(); this.fieldLabels.clear();
    this.catalogue.clear();
    const meta = db.all("SELECT * FROM access_meta") as { epoch: number }[];
    for (const r of db.all("SELECT * FROM access_roles") as Record<string, unknown>[]) {
      const permissions = JSON.parse(String(r.permissions)) as string[];
      const rec: RoleRec = {
        id: String(r.id), name: String(r.name), builtIn: !!r.builtIn, clearance: r.clearance as Label,
        assignableToAgents: !!r.assignableToAgents, permissions,
      };
      this.roles.set(rec.id, rec);
      if (rec.builtIn) for (const k of permissions) this.catalogue.add(k);
    }
    for (const g of db.all("SELECT * FROM access_groups") as Record<string, unknown>[]) {
      this.groups.set(String(g.id), {
        id: String(g.id), name: String(g.name), builtIn: !!g.builtIn,
        members: JSON.parse(String(g.members)) as Ref[], managers: JSON.parse(String(g.managers)) as Ref[],
      });
    }
    for (const p of db.all("SELECT * FROM access_principals") as Record<string, unknown>[]) {
      const rec: PrincipalRec = {
        id: String(p.id), kind: p.kind as PKind, name: String(p.name), status: p.status as Status, createdAt: Number(p.createdAt),
      };
      if (p.owner) rec.owner = String(p.owner);
      if (p.title) rec.title = String(p.title);
      this.principals.set(rec.id, rec);
    }
    for (const a of db.all("SELECT * FROM access_assignments") as { holder: string; role_id: string }[]) {
      const list = this.assignments.get(a.holder) ?? [];
      list.push(a.role_id);
      this.assignments.set(a.holder, list);
    }
    for (const g of db.all("SELECT * FROM access_grants") as Record<string, unknown>[]) {
      const conditions = JSON.parse(String(g.conditions)) as Cond;
      if (g.expiresAt != null && conditions.expiresAt === undefined) conditions.expiresAt = Number(g.expiresAt);
      const rec: GrantRec = {
        id: String(g.id),
        subject: { kind: g.subjectKind as SubjectKind, id: String(g.subjectId) },
        resource: { type: String(g.resourceType), id: String(g.resourceId) },
        level: g.level as Level,
        conditions,
        by: String(g.by),
        createdAt: Number(g.version) || 1,
      };
      if (g.source) rec.source = String(g.source);
      this.grants.set(rec.id, rec);
    }
    for (const r of db.all("SELECT * FROM access_resources") as Record<string, unknown>[]) {
      const rec: ResourceRec = {
        id: String(r.id), type: String(r.type), parentId: r.parent_id == null ? null : String(r.parent_id),
        label: r.label as Label, ownerId: r.owner_id == null ? null : String(r.owner_id), holds: Number(r.holds),
      };
      if (r.row_json) rec.row = JSON.parse(String(r.row_json)) as Record<string, unknown>;
      this.resources.set(rec.id, rec);
    }
    for (const p of db.all("SELECT * FROM access_policies") as Record<string, unknown>[]) {
      const rec: PolicyRec = {
        key: String(p.key), scope: String(p.scope), kind: p.kind as PolicyKind,
        value: JSON.parse(String(p.value)), updatedAt: Number(p.updated_at),
      };
      this.policies.set(pkey(rec.key, rec.scope), rec);
    }
    for (const a of db.all("SELECT * FROM access_actors") as Record<string, unknown>[]) {
      const rec: ActorRec = {
        id: String(a.id), provider: String(a.provider), status: a.status as ActorRec["status"], engineerMcp: !!a.engineer,
      };
      if (a.token_hash) rec.tokenHash = String(a.token_hash);
      if (a.token_expires != null) rec.tokenExpires = Number(a.token_expires);
      if (a.token_used) rec.tokenUsed = true;
      if (a.cred_hash) rec.credHash = String(a.cred_hash);
      if (a.last_seen != null) rec.lastSeenAt = Number(a.last_seen);
      this.actors.set(rec.id, rec);
    }
    for (const f of db.all("SELECT * FROM access_fields") as { k: string; rank: number }[]) this.fieldLabels.set(f.k, Number(f.rank));
    this.epoch = meta[0]?.epoch ?? 1;
    this.snap = null;
    this.snapEpoch = -1;
  }
}

function kernelGrant(g: GrantRec): GrantRow {
  const c = g.conditions;
  const conditions: NonNullable<GrantRow["conditions"]> = {};
  if (isExpr(c.rowFilter)) conditions.rowFilter = c.rowFilter;
  if (c.hiddenFields?.length) conditions.hiddenFields = c.hiddenFields;
  if (c.window) { conditions.notBefore = c.window.from; conditions.notAfter = c.window.to; }
  const row: GrantRow = {
    id: g.id,
    subject_kind: subjectKind(g.subject.kind),
    subject_id: g.subject.id,
    resource_type: g.resource.type,
    resource_id: g.resource.id === "*" ? null : g.resource.id,
    level: g.level,
    conditions,
    expires_at: c.expiresAt ?? null,
    by: g.by,
  };
  return row;
}

export function pkey(key: string, scope: string): string { return `${scope}\n${key}`; }

const STORES = new WeakMap<Db, AccessStore>();

export function storeOf(ctx: AccessCtx): AccessStore {
  let s = STORES.get(ctx.db);
  if (s) return s;
  s = new AccessStore();
  let rows: unknown[] = [];
  try { rows = ctx.db.all("SELECT * FROM access_roles"); } catch { rows = []; }
  if (rows.length) s.hydrate(ctx.db);
  else {
    s.seed();
    try { s.persist(ctx.db); } catch { /* a db that cannot take the tables still serves the memory snapshot */ }
  }
  STORES.set(ctx.db, s);
  return s;
}

export function dropStore(db: Db): void { STORES.delete(db); }

export function changed(ctx: AccessCtx, store: AccessStore, what: "role" | "group" | "membership" | "label" | "actor" | "assignment"): void {
  store.bump();
  ctx.emit("access.changed", String(store.epoch), { epoch: store.epoch, what, by: ctx.principal.id });
  try { store.persist(ctx.db); } catch (e) { store.bump(); throw e; }
}

/** Inline reducers drop the snapshot. Row changes live in the tables the handler writes in the same turn. */
export const inline = {
  "access.changed": (store: AccessStore): void => { store.invalidate(); },
  "grant.created": (store: AccessStore): void => { store.invalidate(); },
  "grant.updated": (store: AccessStore): void => { store.invalidate(); },
  "grant.revoked": (store: AccessStore): void => { store.invalidate(); },
  "policy.changed": (store: AccessStore): void => { store.invalidate(); },
};
export const consumers = {};

export function roleView(store: AccessStore, r: RoleRec): { id: string; name: string; builtIn: boolean; clearance: Label; assignableToAgents: boolean; permissions: string[]; holders: number } {
  return {
    id: r.id, name: r.name, builtIn: r.builtIn, clearance: r.clearance, assignableToAgents: r.assignableToAgents,
    permissions: r.permissions, holders: store.holdersOf(r.id).length,
  };
}

export function groupView(g: GroupRec): GroupRec {
  return { id: g.id, name: g.name, builtIn: g.builtIn, members: g.members.map((m) => ({ kind: m.kind, id: m.id })), managers: g.managers.map((m) => ({ kind: m.kind, id: m.id })) };
}

export function grantView(g: GrantRec): GrantRec {
  const conditions: Cond = {};
  if (g.conditions.rowFilter !== undefined) conditions.rowFilter = g.conditions.rowFilter;
  if (g.conditions.hiddenFields) conditions.hiddenFields = g.conditions.hiddenFields;
  if (g.conditions.labelCeiling) conditions.labelCeiling = g.conditions.labelCeiling;
  if (g.conditions.window) conditions.window = g.conditions.window;
  if (g.conditions.expiresAt !== undefined) conditions.expiresAt = g.conditions.expiresAt;
  const out: GrantRec = {
    id: g.id, subject: { kind: g.subject.kind, id: g.subject.id }, resource: { type: g.resource.type, id: g.resource.id },
    level: g.level, conditions, by: g.by, createdAt: g.createdAt,
  };
  if (g.source) out.source = g.source;
  return out;
}

export function principalView(store: AccessStore, p: PrincipalRec): {
  id: string; kind: PKind; name: string; owner?: string; status: Status; roles: string[]; groups: string[]; title?: string; createdAt: number;
} {
  const groups = [...store.groups.values()].filter((g) => g.members.some((m) => m.id === p.id)).map((g) => g.id);
  const out: { id: string; kind: PKind; name: string; owner?: string; status: Status; roles: string[]; groups: string[]; title?: string; createdAt: number } = {
    id: p.id, kind: p.kind, name: p.name, status: p.status, roles: store.rolesOf(p.id), groups, createdAt: p.createdAt,
  };
  if (p.owner) out.owner = p.owner;
  if (p.title) out.title = p.title;
  return out;
}

export const LABELS: { label: Label; rank: number; providers: "any" | "approved" | "none"; syncToLaptop: boolean }[] = [
  { label: "public", rank: 0, providers: "any", syncToLaptop: true },
  { label: "internal", rank: 1, providers: "any", syncToLaptop: true },
  { label: "confidential", rank: 2, providers: "approved", syncToLaptop: true },
  { label: "restricted", rank: 3, providers: "none", syncToLaptop: false },
];

const DEFAULT_KEYS = new Set(["labels.provider", "sharing.public_links", "sign_in.second_factor", "retention.default", "vault.ladder"]);
export function isDefaultPolicy(key: string): boolean { return DEFAULT_KEYS.has(key); }

export function kindFor(key: string): PolicyKind {
  if (key === "labels.provider" || key.startsWith("label.") || key.startsWith("provider.")) return "provider_label";
  if (key.startsWith("gate.")) return "gate";
  if (key.startsWith("spend.")) return "spend";
  if (key.startsWith("limit.")) return "limit";
  if (key === "retention.default" || key.startsWith("retention.")) return "retention";
  if (key === "sign_in.second_factor" || key.startsWith("sign_in.") || key.startsWith("signin.")) return "sign_in";
  if (key === "sharing.public_links" || key.startsWith("sharing.")) return "sharing";
  if (key === "vault.ladder" || key.startsWith("vault.")) return "vault";
  return "limit";
}
