// The grants store: lifecycle (create, narrow, revoke, expire), delegation containment, source/issuer/status (0.6 kernel/grants/index.js) in the v1 shape (level + ResourceRef).
// Pure and synchronous: the access projection owns the rows; this is the logic that decides what may be written to them. `GrantsStore` is the in-memory form the conformance
// tests, the sync replica and the Console "View as" use; the events it returns (`grant.created`, `grant.narrowed`, `grant.revoked`) are what the projection folds.
import { canonical } from "../../../lib/canonical.ts";
import { mintId } from "../../../lib/ids.ts";
import { KernelError } from "../identity/errors.ts";
import { LEVELS, levelRank } from "./types.ts";
import type { Conditions, Grant, GrantEffective, GrantInput, Level, ResourceRef, Subject } from "./types.ts";
import { ROLE_IDS, ROLE_LEVEL, maySet } from "./roles.ts";
import type { RoleId } from "./roles.ts";

export * from "./types.ts";
export * from "./roles.ts";

/** Parents a delegated grant may chain through. */
export const MAX_DEPTH = 3;
const bad = (m: string): KernelError => new KernelError("bad_input", m);
const sameRef = (a: ResourceRef, b: ResourceRef): boolean => a.type === b.type && a.id === b.id;
const sameSubject = (a: Subject, b: Subject): boolean => a.kind === b.kind && a.id === b.id;

export type GrantEvent =
  | { type: "grant.created"; grant: Grant }
  | { type: "grant.narrowed"; id: string; level: Level; conditions: Conditions; resource: ResourceRef; expires_at?: number }
  | { type: "grant.revoked"; id: string; at: number; reason: string; by: string };

export interface GrantsConfig {
  space: string;
  clock?: () => number;
  /** The resource's ancestors, nearest first (the access projection walks `resources.parent_id`). Default: none. */
  ancestorsOf?: (r: ResourceRef) => ResourceRef[];
}

/** The shape of an input, and nothing else. */
export function checkInput(i: GrantInput): void {
  if (!i || typeof i !== "object") throw bad("a grant is an object");
  const s = i.subject;
  if (!s || !["principal", "role", "group"].includes(s.kind) || typeof s.id !== "string" || !s.id) throw bad("a grant names a principal, role or group");
  if (s.kind === "role" && !(ROLE_IDS as readonly string[]).includes(s.id)) throw bad("unknown role");
  if (!i.resource || typeof i.resource.type !== "string" || !i.resource.type || typeof i.resource.id !== "string" || !i.resource.id) throw bad("a grant needs a resource");
  if (!LEVELS.includes(i.level)) throw bad("level is view, use, edit or manage");
  if (typeof i.source !== "string" || !i.source) throw bad("a grant needs a source");
  const c = i.conditions;
  if (c !== undefined) {
    if (c === null || typeof c !== "object") throw bad("conditions is an object");
    const allowed = new Set(["rowFilter", "hiddenFields", "audience"]);
    for (const k of Object.keys(c)) if (!allowed.has(k)) throw bad(`${k} is not a condition`);
    for (const k of ["hiddenFields", "audience"] as const) if (c[k] !== undefined && !(Array.isArray(c[k]) && c[k]!.every((x) => typeof x === "string" && x))) throw bad(`${k} is a list of text`);
  }
  if (i.expires_at !== undefined && !(Number.isFinite(i.expires_at) && i.expires_at > 0)) throw bad("expires_at is a time");
}

/** The row filter a child must carry: the parent's, alone or inside an `and`. */
function filterInside(parent: unknown, child: unknown): boolean {
  if (parent === undefined) return true;
  if (child === undefined) return false;
  if (canonical(parent) === canonical(child)) return true;
  const and = (child as { and?: unknown[] }).and;
  return Array.isArray(and) && and.some((x) => canonical(x) === canonical(parent));
}

export class GrantsStore {
  readonly space: string;
  private clock: () => number;
  private ancestorsOf: (r: ResourceRef) => ResourceRef[];
  private grants = new Map<string, Grant>();

  constructor(cfg: GrantsConfig) {
    this.space = cfg.space;
    this.clock = cfg.clock ?? Date.now;
    this.ancestorsOf = cfg.ancestorsOf ?? (() => []);
  }

  get(id: string): Grant | undefined { return this.grants.get(id); }

  /** active, or why not: its own revoke or expiry, or its parent's. */
  effective(g: Grant, now: number = this.clock()): GrantEffective {
    if (g.status === "revoked") return "revoked";
    if (g.expires_at !== undefined && now >= g.expires_at) return "expired";
    let p = g.parent ? this.grants.get(g.parent) : undefined;
    for (let depth = 0; p && depth <= MAX_DEPTH; depth++, p = p.parent ? this.grants.get(p.parent) : undefined) {
      if (p.status === "revoked") return "parent_revoked";
      if (p.expires_at !== undefined && now >= p.expires_at) return "parent_expired";
    }
    return "active";
  }

  /** Does `child` stay structurally inside `parent`? Same or lower level, the same resource or one beneath it, no later expiry, no fewer hidden fields, a row filter at least as narrow. */
  contains(parent: Pick<Grant, "resource" | "level" | "conditions" | "expires_at">, child: Pick<Grant, "resource" | "level" | "conditions" | "expires_at">): boolean {
    if (levelRank(child.level) > levelRank(parent.level)) return false;
    if (!sameRef(parent.resource, child.resource) && !this.ancestorsOf(child.resource).some((a) => sameRef(a, parent.resource))) return false;
    if (parent.expires_at !== undefined && (child.expires_at === undefined || child.expires_at > parent.expires_at)) return false;
    const ph = parent.conditions.hiddenFields ?? [], ch = new Set(child.conditions.hiddenFields ?? []);
    if (!ph.every((f) => ch.has(f))) return false;
    if (parent.conditions.audience && !(child.conditions.audience && child.conditions.audience.every((a) => parent.conditions.audience!.includes(a)))) return false;
    return filterInside(parent.conditions.rowFilter, child.conditions.rowFilter);
  }

  create(input: GrantInput, issuer: Grant["issuer"]): { grant: Grant; event: GrantEvent } {
    checkInput(input);
    const now = this.clock();
    if (input.expires_at !== undefined && input.expires_at <= now) throw bad("a grant cannot start expired");
    let depth = 0;
    if (input.parent !== undefined) {
      const parent = this.grants.get(input.parent);
      if (!parent) throw new KernelError("not_found", "no such parent grant");
      if (this.effective(parent, now) !== "active") throw new KernelError("revoked", "the parent grant is not active");
      for (let p: Grant | undefined = parent; p?.parent; p = this.grants.get(p.parent)) depth++;
      if (depth + 1 > MAX_DEPTH) throw new KernelError("not_contained", `a grant passes on at most ${MAX_DEPTH} steps`);
      const draft = { resource: input.resource, level: input.level, conditions: input.conditions ?? {}, ...(input.expires_at !== undefined ? { expires_at: input.expires_at } : {}) };
      if (!this.contains(parent, draft)) throw new KernelError("not_contained", "the new grant is not inside its parent");
    }
    const grant: Grant = Object.freeze({
      id: mintId("gr", now), space: this.space, subject: input.subject, resource: input.resource, level: input.level, conditions: input.conditions ?? {}, issuer, source: input.source,
      ...(input.parent !== undefined ? { parent: input.parent } : {}), status: "active" as const, created_at: now, ...(input.expires_at !== undefined ? { expires_at: input.expires_at } : {}),
    });
    this.grants.set(grant.id, grant);
    return { grant, event: { type: "grant.created", grant } };
  }

  /** Narrowing may only make a grant smaller (the same `contains` test against its own earlier self). */
  narrow(id: string, patch: { level?: Level; conditions?: Conditions; resource?: ResourceRef; expires_at?: number }): { grant: Grant; event: GrantEvent } {
    const g = this.grants.get(id);
    if (!g || this.effective(g) !== "active") throw new KernelError("not_found", "no active grant");
    const next: Grant = { ...g, ...(patch.level ? { level: patch.level } : {}), ...(patch.resource ? { resource: patch.resource } : {}), ...(patch.expires_at !== undefined ? { expires_at: patch.expires_at } : {}),
      conditions: { ...g.conditions, ...(patch.conditions ?? {}) } };
    checkInput({ subject: next.subject, resource: next.resource, level: next.level, conditions: next.conditions, source: next.source });
    if (!this.contains(g, next)) throw new KernelError("not_contained", "narrowing may only make a grant smaller");
    const frozen = Object.freeze(next);
    this.grants.set(id, frozen);
    return { grant: frozen, event: { type: "grant.narrowed", id, level: frozen.level, conditions: frozen.conditions, resource: frozen.resource, ...(frozen.expires_at !== undefined ? { expires_at: frozen.expires_at } : {}) } };
  }

  /** Revoke a grant and everything delegated from it. Returns the events, parent first. */
  revoke(id: string, by: string, reason = "revoked"): GrantEvent[] {
    const g = this.grants.get(id);
    if (!g) throw new KernelError("not_found", "no such grant");
    const out: GrantEvent[] = [];
    const now = this.clock();
    const walk = (x: Grant, why: string): void => {
      if (x.status === "revoked") return;
      this.grants.set(x.id, Object.freeze({ ...x, status: "revoked" as const, revoked_at: now, reason: why }));
      out.push({ type: "grant.revoked", id: x.id, at: now, reason: why, by });
      for (const c of [...this.grants.values()]) if (c.parent === x.id) walk(c, "parent revoked");
    };
    walk(g, reason);
    return out;
  }

  /** Grants that reach a subject now, by effective status. */
  forSubject(subject: Subject, now: number = this.clock()): Grant[] {
    return [...this.grants.values()].filter((g) => sameSubject(g.subject, subject) && this.effective(g, now) === "active");
  }

  list(f: { status?: GrantEffective; subject?: Subject; resource?: ResourceRef; source?: string } = {}): Grant[] {
    const now = this.clock();
    return [...this.grants.values()].filter((g) =>
      (!f.status || this.effective(g, now) === f.status) && (!f.subject || sameSubject(g.subject, f.subject)) && (!f.resource || sameRef(g.resource, f.resource)) && (!f.source || g.source === f.source));
  }

  /** The highest level any active grant gives `subject` on `resource` or an ancestor of it; null when none. */
  levelFor(subject: Subject, resource: ResourceRef, now: number = this.clock()): Level | null {
    const chain = [resource, ...this.ancestorsOf(resource)];
    let best = -1;
    for (const g of this.forSubject(subject, now)) if (chain.some((r) => sameRef(r, g.resource))) best = Math.max(best, levelRank(g.level));
    return best < 0 ? null : LEVELS[best]!;
  }

  /**
   * A membership as grants: one per resource, `source` `role:<id>`, at the role's level. A temp member must name resources and an expiry. Changing a role revokes the old role grants first
   * (`setRole`), and only a role that may set the target does it.
   */
  membership(person: string, role: RoleId, resources: ResourceRef[], issuer: Grant["issuer"], o: { expires_at?: number; by_role: RoleId }): GrantEvent[] {
    if (!maySet(o.by_role, role)) throw new KernelError("role_lacks_permission", `a ${o.by_role} cannot make a ${role}`);
    if (role === "temp" && (!resources.length || o.expires_at === undefined)) throw bad("a temp member needs resources and an expiry");
    const events: GrantEvent[] = [];
    for (const g of this.list({ subject: { kind: "principal", id: person } })) if (g.source.startsWith("role:") && g.status === "active") events.push(...this.revoke(g.id, issuer.id, "role changed"));
    for (const r of resources) events.push(this.create({ subject: { kind: "principal", id: person }, resource: r, level: ROLE_LEVEL[role], source: `role:${role}`, ...(o.expires_at !== undefined ? { expires_at: o.expires_at } : {}) }, issuer).event);
    return events;
  }

  /** Fold an event (from the log) into the store: rebuild, or a replica. */
  apply(e: GrantEvent): void {
    if (e.type === "grant.created") this.grants.set(e.grant.id, Object.freeze({ ...e.grant }));
    else if (e.type === "grant.narrowed") { const g = this.grants.get(e.id); if (g) this.grants.set(e.id, Object.freeze({ ...g, level: e.level, conditions: e.conditions, resource: e.resource, ...(e.expires_at !== undefined ? { expires_at: e.expires_at } : {}) })); }
    else { const g = this.grants.get(e.id); if (g && g.status !== "revoked") this.grants.set(e.id, Object.freeze({ ...g, status: "revoked" as const, revoked_at: e.at, reason: e.reason })); }
  }
}
