// Access host calls (ruling 70): the access module's tables are the one source authorize reads. The host folds the log's access events into them, then asks for the snapshot.
//   access.sync          events in log order; each moves the store (a person who joined, a suspension, a resource, a seeded role or grant), the module persists the result and answers the snapshot.
//   access.snapshot      the authorize snapshot built from the store.
// The log is also how a Space seeded outside this module (roles, principals, resources, grants as `role.defined`, `principal.created`, ...) reaches the store. A cursor kept in the
// store makes the replay safe at every boot: an event at or below it is already applied, so a revoke made since is never undone by a restart.
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import type { AccessSnapshot } from "../../kernel/src/authorize/index.ts";
import { isElevatedRole } from "../../kernel/src/authorize/snapshot.ts";
import { AccessStore, EVERYONE, labelOf, storeOf } from "./projections.ts";
import type { AccessCtx, Cond, GrantRec, Level, PKind, Ref, Status, SubjectKind } from "./projections.ts";

export interface LogEvent { seq: number; type: string; payload: unknown }

/** fieldLabels key without a dot: the snapshot skips it, so it carries the cursor without becoming a field label */
const CURSOR = "seed_cursor";

/** the event names access.sync folds; the host sends only these */
export const ACCESS_EVENTS = [
  "role.defined", "principal.created", "principal.role_set", "group.member_added", "resource.created", "grant.created",
  "principal.suspended", "principal.reactivated", "member.removed",
] as const;

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

function pkind(k: unknown): PKind {
  if (k === "agent" || k === "actor" || k === "service") return k;
  if (k === "svc") return "service";
  return "person";
}

function setStatus(store: AccessStore, id: string | undefined, status: Status): boolean {
  const p = id ? store.principals.get(id) : undefined;
  if (!p || p.status === status) return false;
  p.status = status;
  return true;
}

/** Seeded grant rows name an `actor`, `group` or `role`; the module keeps the same words. */
function seededGrant(p: Record<string, unknown>, at: number): GrantRec | null {
  const id = str(p["id"]), subjectId = str(p["subject_id"]), type = str(p["resource_type"]);
  const sk = p["subject_kind"];
  if (!id || !subjectId || !type || (sk !== "actor" && sk !== "group" && sk !== "role")) return null;
  const c = rec(p["conditions"]);
  const conditions: Cond = {};
  if (c["rowFilter"] !== undefined) conditions.rowFilter = c["rowFilter"];
  if (Array.isArray(c["hiddenFields"])) conditions.hiddenFields = c["hiddenFields"].filter((x): x is string => typeof x === "string");
  if (typeof c["notBefore"] === "number" && typeof c["notAfter"] === "number") conditions.window = { from: c["notBefore"], to: c["notAfter"] };
  if (typeof p["expires_at"] === "number") conditions.expiresAt = p["expires_at"];
  const level = p["level"] as Level;
  return {
    id, subject: { kind: sk as SubjectKind, id: subjectId }, resource: { type, id: str(p["resource_id"]) ?? "*" }, level, conditions,
    by: str(p["by"]) ?? "svc_host", createdAt: at,
  };
}

/** The kernel's role names the seed uses, as the ids real joins and the built-in roles carry (rol_*). Anything else gets the prefix. */
const SEED_ROLE: Readonly<Record<string, string>> = { owner: "rol_owner", admin: "rol_admin", member: "rol_member", temp: "rol_guest", guest: "rol_guest", developer: "rol_developer" };
export const roleIdOf = (role: string): string => (role.startsWith("rol_") ? role : SEED_ROLE[role] ?? `rol_${role}`);

/** Move the store by one event. True when something changed. */
export function applyEvent(store: AccessStore, e: LogEvent, at: number): boolean {
  const p = rec(e.payload);
  switch (e.type) {
    case "role.defined": {
      // a Space seeded with the kernel's role names gets the same ids a real join does; a built-in role the store already holds is not defined a second time
      const given = str(p["id"]);
      const id = given ? roleIdOf(given) : undefined;
      if (!id) return false;
      if (store.roles.get(id)?.builtIn) return false;
      const perms = Array.isArray(p["perms"]) ? p["perms"].filter((x): x is string => typeof x === "string") : [];
      store.roles.set(id, { id, name: str(p["name"]) ?? id, builtIn: false, clearance: labelOf(Number(p["clearance"]) || 0), assignableToAgents: true, permissions: perms });
      return true;
    }
    case "principal.created": {
      const id = str(p["id"]) ?? str(p["principalId"]);
      if (!id) return false;
      const seeded = str(p["id"]) !== undefined;
      const have = store.principals.get(id);
      // identity and access announce an account the module already holds: keep what it has
      if (have && !seeded) return false;
      const given = p["status"];
      const status: Status = given === "suspended" || given === "removed" ? given : "active";
      const next = { id, kind: pkind(p["kind"]), name: str(p["name"]) ?? have?.name ?? id, status, createdAt: have?.createdAt ?? at, ...(str(p["owner"]) ? { owner: str(p["owner"])! } : {}) };
      store.principals.set(id, next);
      return true;
    }
    case "principal.role_set": {
      const holder = str(p["holder"]), given = str(p["role"]);
      if (!holder || !given) return false;
      const role = roleIdOf(given);
      const have = store.assignments.get(holder) ?? [];
      if (have.includes(role)) return false;
      store.assignments.set(holder, [...have, role]);
      return true;
    }
    case "group.member_added": {
      const gid = str(p["group"]), mid = str(p["member"]);
      if (!gid || !mid) return false;
      const g = store.groups.get(gid) ?? { id: gid, name: gid === EVERYONE ? "Everyone" : gid, builtIn: gid === EVERYONE, members: [] as Ref[], managers: [] as Ref[] };
      if (g.members.some((m) => m.id === mid)) return false;
      g.members.push({ kind: store.principals.get(mid)?.kind ?? "person", id: mid });
      store.groups.set(gid, g);
      return true;
    }
    case "resource.created": {
      const id = str(p["id"]), type = str(p["type"]);
      if (!id || !type) return false;
      const have = store.resources.get(id);
      store.resources.set(id, {
        id, type, parentId: str(p["parent_id"]) ?? null, label: labelOf(Number(p["label"]) || 0), ownerId: str(p["owner_id"]) ?? null, holds: Number(p["holds"]) || 0,
        ...(have?.row ? { row: have.row } : {}),
      });
      return true;
    }
    case "grant.created": {
      // the module's own shares emit `{ grantId, subject, resource, level }` and already hold the row; only a seeded row has `subject_kind`
      if (p["subject_kind"] === undefined) return false;
      const g = seededGrant(p, at);
      if (!g || store.grants.has(g.id)) return false;
      store.grants.set(g.id, g);
      return true;
    }
    case "principal.suspended": return setStatus(store, str(p["principalId"]), "suspended");
    case "principal.reactivated": return setStatus(store, str(p["principalId"]), "active");
    case "member.removed": return setStatus(store, str(p["personId"]), "removed");
    default: return false;
  }
}

function cursorOf(store: AccessStore): number { return store.fieldLabels.get(CURSOR) ?? 0; }

/**
 * Fold events the store has not seen, in the order given. An event with a negative `seq` did not come from the log (the host's own boot-time resources): it is always applied and
 * never moves the cursor. Objects being created is the common case, so a batch of only `resource.created` writes just those rows; anything else rewrites the tables.
 */
function apply(ctx: AccessCtx, store: AccessStore, events: readonly LogEvent[]): { cursor: number; changed: boolean } {
  let cursor = cursorOf(store), changed = false, onlyResources = true;
  const touched = new Set<string>();
  const at = ctx.now();
  for (const e of events) {
    if (e.seq >= 0 && e.seq <= cursor) continue;
    if (applyEvent(store, e, at)) {
      changed = true;
      if (e.type === "resource.created") { const id = str(rec(e.payload)["id"]); if (id) touched.add(id); } else onlyResources = false;
    }
    if (e.seq >= 0) cursor = e.seq;
  }
  const moved = cursor !== cursorOf(store);
  if (moved) store.fieldLabels.set(CURSOR, cursor);
  if (!changed && !moved) return { cursor, changed };
  store.bump();
  if (changed && !onlyResources) { store.persist(ctx.db); return { cursor, changed }; }
  for (const id of touched) {
    const r = store.resources.get(id);
    if (!r) continue;
    ctx.db.run("DELETE FROM access_resources WHERE id = ?", id);
    ctx.db.run("INSERT INTO access_resources (id,type,parent_id,label,owner_id,holds,row_json) VALUES (?,?,?,?,?,?,?)", r.id, r.type, r.parentId, r.label, r.ownerId, r.holds, r.row ? JSON.stringify(r.row) : null);
  }
  if (moved) {
    ctx.db.run("DELETE FROM access_fields WHERE k = ?", CURSOR);
    ctx.db.run("INSERT INTO access_fields (k,rank) VALUES (?,?)", CURSOR, cursor);
  }
  return { cursor, changed };
}

const GRANTED = new WeakSet<AccessSnapshot>();
/** the Space level each built-in role carries in a Space nothing was seeded in, the same as the seeded roles. Guest (and Temp) get nothing Space-wide: they only hold per-resource grants. */
const BUILT_IN_LEVEL: Readonly<Record<string, "manage" | "edit">> = { rol_owner: "manage", rol_admin: "manage", rol_developer: "edit", rol_member: "edit" };

/**
 * A role carries permissions; the Space-level grant is what lets them act. A role the Space was seeded with (owner, admin, manager, member, temp) arrives with its grants and keeps exactly
 * those. The built-in rol_* roles get their standard level (BUILT_IN_LEVEL). A role made through access.roles.create has none, so one that holds permissions gets an Edit grant on the Space
 * (Manage when it is an elevated role or holds access.manage). A role with no permissions confers nothing.
 */
function withRoleGrants(snap: AccessSnapshot, store: AccessStore, space: string): AccessSnapshot {
  if (GRANTED.has(snap)) return snap;
  GRANTED.add(snap);
  const have = new Set<string>();
  for (const g of store.grants.values()) if (g.subject.kind === "role" && g.resource.type === "space") have.add(g.subject.id);
  for (const r of store.roles.values()) {
    if (have.has(r.id) || !r.id.startsWith("rol_")) continue;
    let level = BUILT_IN_LEVEL[r.id];
    if (!level) {
      if (r.builtIn || r.permissions.length === 0) continue;
      level = isElevatedRole(r.id, r.name) || r.permissions.includes("access.manage") ? "manage" : "edit";
    }
    snap.putGrant({ id: `gr_role_${r.id}`, subject_kind: "role", subject_id: r.id, resource_type: "space", resource_id: space, level, by: "svc_host" });
  }
  return snap;
}

export const hostCalls = {
  /** Fold events the store has not seen and answer the authorize snapshot, in one call so a commit pays for one pass over the tables. */
  "access.sync": (ctx: Ctx, input: { events: LogEvent[] }): AccessSnapshot => {
    const actx = ctx as unknown as AccessCtx;
    const store = storeOf(actx);
    apply(actx, store, input.events);
    return withRoleGrants(store.snapshot(), store, actx.space);
  },
  /** The authorize snapshot as the tables hold it now (a share, a revoke or a role change made by a capability is already there). */
  "access.snapshot": (ctx: Ctx): AccessSnapshot => { const a = ctx as unknown as AccessCtx; const store = storeOf(a); return withRoleGrants(store.snapshot(), store, a.space); },
};

export const consumers = {};
