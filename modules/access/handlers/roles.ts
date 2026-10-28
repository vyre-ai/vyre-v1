// Roles, groups, grants and principals. Role permission changes stage as a diff, then Apply swaps the whole set.
import type { AccessCtx, Cond, GrantRec, GroupRec, PKind, PrincipalRec, Ref, RoleHolder, ResourceRef, RoleRec, SubjectRef } from "../projections.ts";
import {
  changed, EVERYONE, fnv, grantView, groupView, isExpr, nid, page, principalView, raise, roleView, storeOf,
} from "../projections.ts";

type Level = "view" | "use" | "edit" | "manage";
type Label = "public" | "internal" | "confidential" | "restricted";

function normPerms(store: ReturnType<typeof storeOf>, list: string[], trace: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of list) {
    if (!store.catalogue.has(k)) raise(trace, "validation.bad_input", `unknown permission ${k}`);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  out.sort();
  return out;
}

function fingerprint(store: ReturnType<typeof storeOf>, roleId: string): string {
  return store.holdersOf(roleId).map((h) => {
    const other = [...store.permsExcept(h.id, roleId)].sort().join("+");
    return `${h.id}:${other}`;
  }).sort().join("|");
}

function hashOf(store: ReturnType<typeof storeOf>, roleId: string, current: string[], next: string[]): string {
  return fnv(`${roleId}\n${current.join(",")}\n${next.join(",")}\n${fingerprint(store, roleId)}`);
}

function mustRole(store: ReturnType<typeof storeOf>, id: string, trace: string): RoleRec {
  const r = store.roles.get(id);
  if (!r) raise(trace, "validation.not_found", "no such role");
  return r;
}
function mustGroup(store: ReturnType<typeof storeOf>, id: string, trace: string): GroupRec {
  const g = store.groups.get(id);
  if (!g) raise(trace, "validation.not_found", "no such group");
  return g;
}
function mustPrincipal(store: ReturnType<typeof storeOf>, id: string, trace: string) {
  const p = store.principals.get(id);
  if (!p) raise(trace, "validation.not_found", "no such principal");
  return p;
}

function diff(store: ReturnType<typeof storeOf>, role: RoleRec, next: string[]) {
  const gains: { principal: Ref; permission: string }[] = [];
  const losses: { principal: Ref; permission: string }[] = [];
  const nextSet = new Set(next);
  const curSet = new Set(role.permissions);
  for (const h of store.holdersOf(role.id)) {
    const other = store.permsExcept(h.id, role.id);
    for (const k of next) if (!curSet.has(k) && !other.has(k)) gains.push({ principal: h, permission: k });
    for (const k of role.permissions) if (!nextSet.has(k) && !other.has(k)) losses.push({ principal: h, permission: k });
  }
  return { gains, losses, previewHash: hashOf(store, role.id, role.permissions, next) };
}

export async function rolesList(ctx: AccessCtx, input: { cursor?: string; limit?: number }) {
  const store = storeOf(ctx);
  const all = [...store.roles.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map((r) => roleView(store, r));
  const p = page(all, input.cursor, input.limit);
  return { roles: p.rows, total: p.total, ...(p.next ? { next: p.next } : {}) };
}

export async function rolesGet(ctx: AccessCtx, input: { roleId: string }) {
  const store = storeOf(ctx);
  const role = mustRole(store, input.roleId, ctx.trace.traceId);
  return { role: roleView(store, role), holders: store.holdersOf(role.id), directHolders: store.directHoldersOf(role.id) };
}

export async function rolesCreate(ctx: AccessCtx, input: { name: string; cloneFrom?: string; clearance?: Label; assignableToAgents?: boolean; idempotencyKey: string }) {
  const store = storeOf(ctx);
  const key = `roles.create:${input.idempotencyKey}`;
  const hit = store.idem.get(key);
  if (hit) return hit as { role: ReturnType<typeof roleView> };
  const name = input.name.trim();
  if (!name) raise(ctx.trace.traceId, "validation.bad_input", "name is required");
  if ([...store.roles.values()].some((r) => r.name === name)) raise(ctx.trace.traceId, "validation.duplicate", "a role with that name exists");
  let permissions: string[] = [];
  let clearance: Label = input.clearance ?? "internal";
  let assignable = input.assignableToAgents ?? true;
  if (input.cloneFrom) {
    const src = mustRole(store, input.cloneFrom, ctx.trace.traceId);
    permissions = [...src.permissions];
    if (!input.clearance) clearance = src.clearance;
    if (input.assignableToAgents === undefined) assignable = src.assignableToAgents;
  }
  const role: RoleRec = { id: nid("rol"), name, builtIn: false, clearance, assignableToAgents: assignable, permissions };
  store.roles.set(role.id, role);
  changed(ctx, store, "role");
  const out = { role: roleView(store, role) };
  store.idem.set(key, out);
  return out;
}

export async function rolesUpdate(ctx: AccessCtx, input: { roleId: string; name?: string; clearance?: Label; assignableToAgents?: boolean }) {
  const store = storeOf(ctx);
  const role = mustRole(store, input.roleId, ctx.trace.traceId);
  if (role.builtIn) raise(ctx.trace.traceId, "validation.field_locked", "built-in roles are locked except to clone");
  if (input.assignableToAgents === false && store.holdersOf(role.id).some((holder) => holder.kind === "agent")) raise(ctx.trace.traceId, "validation.precondition_failed", "Remove agent holders before making this role human-only");
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) raise(ctx.trace.traceId, "validation.bad_input", "name is required");
    if ([...store.roles.values()].some((r) => r.id !== role.id && r.name === name)) raise(ctx.trace.traceId, "validation.duplicate", "a role with that name exists");
    role.name = name;
  }
  if (input.clearance) role.clearance = input.clearance;
  if (input.assignableToAgents !== undefined) role.assignableToAgents = input.assignableToAgents;
  changed(ctx, store, "role");
  return { role: roleView(store, role) };
}

export async function rolesPreview(ctx: AccessCtx, input: { roleId: string; permissions: string[] }) {
  const store = storeOf(ctx);
  const role = mustRole(store, input.roleId, ctx.trace.traceId);
  if (role.builtIn) raise(ctx.trace.traceId, "validation.field_locked", "built-in columns are locked except to clone");
  const next = normPerms(store, input.permissions, ctx.trace.traceId);
  return diff(store, role, next);
}

export async function rolesApply(ctx: AccessCtx, input: { roleId: string; permissions: string[]; previewHash: string }) {
  const store = storeOf(ctx);
  const role = mustRole(store, input.roleId, ctx.trace.traceId);
  if (role.builtIn) raise(ctx.trace.traceId, "validation.field_locked", "built-in columns are locked except to clone");
  const next = normPerms(store, input.permissions, ctx.trace.traceId);
  const hash = hashOf(store, role.id, role.permissions, next);
  if (hash !== input.previewHash) raise(ctx.trace.traceId, "validation.precondition_failed", "the diff is stale; preview again");
  // One assignment. A stale hash returns before this, so a failed Apply changes nothing.
  role.permissions = next;
  changed(ctx, store, "role");
  return { role: roleView(store, role) };
}

export async function rolesDelete(ctx: AccessCtx, input: { roleId: string }) {
  const store = storeOf(ctx);
  const role = mustRole(store, input.roleId, ctx.trace.traceId);
  if (role.builtIn) raise(ctx.trace.traceId, "validation.field_locked", "built-in roles are locked");
  if (store.holdersOf(role.id).length) raise(ctx.trace.traceId, "validation.precondition_failed", "a role cannot be deleted while held");
  store.roles.delete(role.id);
  for (const [holder, roles] of store.assignments) store.assignments.set(holder, roles.filter((r) => r !== role.id));
  changed(ctx, store, "role");
  return { deleted: true };
}

function elevated(role: RoleRec): boolean {
  return role.id === "rol_owner" || role.id === "rol_admin" || role.name === "Owner" || role.name === "Admin";
}

function roleHolder(store: ReturnType<typeof storeOf>, ref: RoleHolder, trace: string): RoleHolder {
  if (ref.kind === "group") return { kind: "group", id: mustGroup(store, ref.id, trace).id };
  const principal = mustPrincipal(store, ref.id, trace);
  return { kind: principal.kind, id: principal.id };
}
function checkAgentRole(role: RoleRec, trace: string): void {
  if (elevated(role) || !role.assignableToAgents) raise(trace, "validation.precondition_failed", "Agents cannot hold Owner, Admin or human-only roles, including through groups");
}
export async function rolesAssign(ctx: AccessCtx, input: { subject: RoleHolder; roleId: string }) {
  const store = storeOf(ctx);
  const role = mustRole(store, input.roleId, ctx.trace.traceId);
  const holder = roleHolder(store, input.subject, ctx.trace.traceId);
  if (holder.kind === "agent") checkAgentRole(role, ctx.trace.traceId);
  if (holder.kind === "group" && store.groups.get(holder.id)!.members.some((member) => store.principals.get(member.id)?.kind === "agent")) checkAgentRole(role, ctx.trace.traceId);
  const current = store.rolesOf(holder.id);
  if (!current.includes(role.id)) store.setRoles(holder.id, [...current, role.id]);
  changed(ctx, store, "assignment");
  return { roles: store.rolesOf(holder.id) };
}
export async function rolesUnassign(ctx: AccessCtx, input: { subject: RoleHolder; roleId: string }) {
  const store = storeOf(ctx);
  mustRole(store, input.roleId, ctx.trace.traceId);
  const holder = roleHolder(store, input.subject, ctx.trace.traceId);
  store.setRoles(holder.id, store.rolesOf(holder.id).filter((role) => role !== input.roleId));
  changed(ctx, store, "assignment");
  return { roles: store.rolesOf(holder.id) };
}

export async function groupsList(ctx: AccessCtx, input: { q?: string; cursor?: string; limit?: number }) {
  const store = storeOf(ctx);
  const q = input.q?.toLowerCase();
  const all = [...store.groups.values()].filter((g) => !q || g.name.toLowerCase().includes(q)).sort((a, b) => (a.id < b.id ? -1 : 1)).map(groupView);
  const p = page(all, input.cursor, input.limit);
  return { groups: p.rows, total: p.total, ...(p.next ? { next: p.next } : {}) };
}

export async function groupsGet(ctx: AccessCtx, input: { groupId: string }) {
  const store = storeOf(ctx);
  const g = mustGroup(store, input.groupId, ctx.trace.traceId);
  return { group: groupView(g), roles: store.rolesOf(g.id), grants: store.grantsFor({ kind: "group", id: g.id }).map(grantView) };
}

export async function groupsCreate(ctx: AccessCtx, input: { name: string; members?: Ref[]; managers?: Ref[]; idempotencyKey: string }) {
  const store = storeOf(ctx);
  const key = `groups.create:${input.idempotencyKey}`;
  const hit = store.idem.get(key);
  if (hit) return hit as { group: GroupRec };
  const name = input.name.trim();
  if (!name) raise(ctx.trace.traceId, "validation.bad_input", "name is required");
  if ([...store.groups.values()].some((g) => g.name === name)) raise(ctx.trace.traceId, "validation.duplicate", "a group with that name exists");
  const members = (input.members ?? []).map((m) => checkMember(store, m, ctx.trace.traceId));
  const managers = (input.managers ?? []).map((m) => checkManager(store, m, ctx.trace.traceId));
  const group: GroupRec = { id: nid("grp"), name, builtIn: false, members, managers };
  store.groups.set(group.id, group);
  changed(ctx, store, "group");
  const out = { group: groupView(group) };
  store.idem.set(key, out);
  return out;
}

function checkPerson(store: ReturnType<typeof storeOf>, m: Ref, trace: string): Ref {
  const p = mustPrincipal(store, m.id, trace);
  return { kind: p.kind, id: p.id };
}
function checkManager(store: ReturnType<typeof storeOf>, m: Ref, trace: string): Ref {
  const principal = checkPerson(store, m, trace);
  if (principal.kind !== "person") raise(trace, "validation.precondition_failed", "group managers must be people");
  return principal;
}
function checkMember(store: ReturnType<typeof storeOf>, m: Ref, trace: string): Ref {
  const p = checkPerson(store, m, trace);
  if (p.kind !== "person" && p.kind !== "agent") raise(trace, "validation.precondition_failed", "groups hold people and agents only");
  return p;
}

export async function groupsUpdate(ctx: AccessCtx, input: { groupId: string; name?: string; managers?: Ref[] }) {
  const store = storeOf(ctx);
  const g = mustGroup(store, input.groupId, ctx.trace.traceId);
  const managers = input.managers?.map((manager) => checkManager(store, manager, ctx.trace.traceId));
  if (input.name !== undefined && input.name.trim() !== g.name) {
    if (g.builtIn) raise(ctx.trace.traceId, "validation.field_locked", "the built-in group name is locked");
    const name = input.name.trim();
    if (!name) raise(ctx.trace.traceId, "validation.bad_input", "name is required");
    if ([...store.groups.values()].some((x) => x.id !== g.id && x.name === name)) raise(ctx.trace.traceId, "validation.duplicate", "a group with that name exists");
    g.name = name;
  }
  if (managers) g.managers = managers;
  changed(ctx, store, "group");
  return { group: groupView(g) };
}

export async function groupsDelete(ctx: AccessCtx, input: { groupId: string }) {
  const store = storeOf(ctx);
  const g = mustGroup(store, input.groupId, ctx.trace.traceId);
  if (g.builtIn) raise(ctx.trace.traceId, "validation.field_locked", "the Everyone group is built in");
  const doomed = store.grantsFor({ kind: "group", id: g.id });
  for (const grant of doomed) {
    store.grants.delete(grant.id);
    ctx.emit("grant.revoked", grant.id, { grantId: grant.id, subject: grant.subject, resource: grant.resource, reason: "group_deleted" });
  }
  store.groups.delete(g.id);
  store.assignments.delete(g.id);
  changed(ctx, store, "group");
  return { deleted: true };
}

export async function groupsAddMember(ctx: AccessCtx, input: { groupId: string; member: Ref }) {
  const store = storeOf(ctx);
  const g = mustGroup(store, input.groupId, ctx.trace.traceId);
  const member = checkMember(store, input.member, ctx.trace.traceId);
  if (member.kind === "agent") for (const roleId of store.rolesOf(g.id)) {
    const role = store.roles.get(roleId);
    if (role) checkAgentRole(role, ctx.trace.traceId);
  }
  if (!g.members.some((m) => m.id === member.id)) g.members.push(member);
  changed(ctx, store, "membership");
  return { group: groupView(g) };
}

export async function groupsRemoveMember(ctx: AccessCtx, input: { groupId: string; member: Ref }) {
  const store = storeOf(ctx);
  const g = mustGroup(store, input.groupId, ctx.trace.traceId);
  g.members = g.members.filter((m) => m.id !== input.member.id);
  changed(ctx, store, "membership");
  return { group: groupView(g) };
}

export async function defaultsGet(ctx: AccessCtx, _input: Record<string, unknown>) {
  const store = storeOf(ctx);
  const grants = store.grantsFor({ kind: "group", id: EVERYONE }).map((g) => ({ resource: g.resource, level: g.level }));
  return { groupId: EVERYONE, grants };
}

export async function defaultsSet(ctx: AccessCtx, input: { grants: { resource: ResourceRef; level: Level }[] }) {
  const store = storeOf(ctx);
  for (const g of [...store.grants.values()]) if (g.subject.kind === "group" && g.subject.id === EVERYONE) store.grants.delete(g.id);
  const grants: { resource: ResourceRef; level: Level }[] = [];
  for (const g of input.grants) {
    const rec: GrantRec = {
      id: nid("gnt"), subject: { kind: "group", id: EVERYONE }, resource: { type: g.resource.type, id: g.resource.id },
      level: g.level, conditions: {}, by: ctx.principal.id, createdAt: ctx.now(), source: "everyone",
    };
    store.grants.set(rec.id, rec);
    grants.push({ resource: rec.resource, level: rec.level });
  }
  store.bump();
  ctx.emit("access.everyone_defaults_changed", EVERYONE, { grants: grants.length, by: ctx.principal.id });
  ctx.emit("access.changed", String(store.epoch), { epoch: store.epoch, what: "group", by: ctx.principal.id });
  try { store.persist(ctx.db); } catch (e) { store.bump(); throw e; }
  return { groupId: EVERYONE, grants };
}

export async function grantsList(ctx: AccessCtx, input: { resource?: ResourceRef; subject?: SubjectRef; source?: string; cursor?: string; limit?: number }) {
  const store = storeOf(ctx);
  const all = [...store.grants.values()].filter((g) => {
    if (input.resource && (g.resource.type !== input.resource.type || g.resource.id !== input.resource.id)) return false;
    if (input.subject && (g.subject.kind !== input.subject.kind || g.subject.id !== input.subject.id)) return false;
    if (input.source && g.source !== input.source) return false;
    return true;
  }).sort((a, b) => (a.id < b.id ? -1 : 1)).map(grantView);
  const p = page(all, input.cursor, input.limit);
  return { grants: p.rows, total: p.total, ...(p.next ? { next: p.next } : {}) };
}

export async function grantsUpdate(ctx: AccessCtx, input: { grantId: string; level?: Level; conditions?: Cond }) {
  const store = storeOf(ctx);
  const g = store.grants.get(input.grantId);
  if (!g) raise(ctx.trace.traceId, "validation.not_found", "no such grant");
  if (input.level) g.level = input.level;
  if (input.conditions) {
    if (input.conditions.rowFilter !== undefined && input.conditions.rowFilter !== null && !isExpr(input.conditions.rowFilter)) {
      raise(ctx.trace.traceId, "validation.bad_input", "row filter is outside the expression subset");
    }
    g.conditions = input.conditions;
  }
  store.bump();
  const updated: { grantId: string; level: Level; expiresAt?: number } = { grantId: g.id, level: g.level };
  if (g.conditions.expiresAt !== undefined) updated.expiresAt = g.conditions.expiresAt;
  ctx.emit("grant.updated", g.id, updated);
  ctx.emit("access.changed", String(store.epoch), { epoch: store.epoch, what: "assignment", by: ctx.principal.id });
  try { store.persist(ctx.db); } catch (e) { store.bump(); throw e; }
  return { grant: grantView(g) };
}

export async function principalsList(ctx: AccessCtx, input: { kind?: PKind; status?: "invited" | "active" | "suspended" | "removed"; q?: string; cursor?: string; limit?: number }) {
  const store = storeOf(ctx);
  const q = input.q?.toLowerCase();
  const all = [...store.principals.values()].filter((p) => {
    if (input.kind && p.kind !== input.kind) return false;
    if (input.status && p.status !== input.status) return false;
    if (q && !p.name.toLowerCase().includes(q) && !p.id.includes(q)) return false;
    return true;
  }).sort((a, b) => (a.id < b.id ? -1 : 1)).map((p) => principalView(store, p));
  const p = page(all, input.cursor, input.limit);
  return { principals: p.rows, total: p.total, ...(p.next ? { next: p.next } : {}) };
}

export async function principalsGet(ctx: AccessCtx, input: { principal: Ref }) {
  const store = storeOf(ctx);
  return { principal: principalView(store, mustPrincipal(store, input.principal.id, ctx.trace.traceId)) };
}

export async function principalsEffective(ctx: AccessCtx, input: { principal: Ref }) {
  const store = storeOf(ctx);
  const p = mustPrincipal(store, input.principal.id, ctx.trace.traceId);
  const info = store.snapshot().info(p.id);
  const roleIds = new Set(store.rolesOf(p.id));
  for (const g of store.groups.values()) if (g.members.some((m) => m.id === p.id)) for (const r of store.rolesOf(g.id)) roleIds.add(r);
  const grants = [...store.grants.values()].filter((g) => {
    if (g.subject.kind === p.kind && g.subject.id === p.id) return true;
    if (g.subject.kind === "role" && roleIds.has(g.subject.id)) return true;
    if (g.subject.kind === "group" && store.groups.get(g.subject.id)?.members.some((m) => m.id === p.id)) return true;
    return false;
  }).map(grantView);
  const owns = [...store.resources.values()].filter((r) => r.ownerId === p.id).map((r) => ({ type: r.type, id: r.id }));
  return { permissions: info ? [...info.perms].sort() : [], roles: [...roleIds].filter((id) => info?.keys.has(`role:${id}`)).sort(), grants, owns };
}

export function putPrincipal(store: ReturnType<typeof storeOf>, p: { id: string; kind: PKind; name: string; status?: PrincipalRec["status"]; owner?: string; title?: string; createdAt?: number }): void {
  const rec: PrincipalRec = {
    id: p.id, kind: p.kind, name: p.name, status: p.status ?? "active", createdAt: p.createdAt ?? 1_700_000_000_000,
  };
  if (p.owner) rec.owner = p.owner;
  if (p.title) rec.title = p.title;
  store.principals.set(rec.id, rec);
  store.bump();
}
