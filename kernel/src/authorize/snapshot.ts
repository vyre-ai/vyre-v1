// The in-memory read side of the access projections (ARCH 4.5 "Data it reads"). The kernel fills it from events.db; every mutator bumps `epoch`, and every derived cache is dropped on the bump,
// which is the `access.changed` invalidation. authorize and scopeFor read nothing else, so a decision never touches a module table.
import { rankOf } from "./types.ts";
import type { Conditions, Expr, GrantRow, GroupMemberRow, Level, Policy, PrincipalRoleRow, PrincipalRow, ResourceRow, RoleRow } from "./types.ts";

/** The one source of the roles an agent never holds, whatever the projection says (ARCH 4.5 "Agents"): the plain names (kernel fixtures) and the access module's built-in role ids. */
export const ELEVATED_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "rol_owner", "rol_admin"]);
const ELEVATED_NAMES: ReadonlySet<string> = new Set(["owner", "admin"]);
/** True for a role an agent must never hold: by id, or by the built-in name. */
export const isOwnerRole = (id: string, name?: string): boolean => id === "owner" || id === "rol_owner" || name?.toLowerCase() === "owner";
export const isElevatedRole = (id: string, name?: string): boolean => ELEVATED_ROLES.has(id) || (name !== undefined && ELEVATED_NAMES.has(name.toLowerCase()));

export interface SubjectInfo {
  readonly p: PrincipalRow;
  readonly perms: ReadonlySet<string>;
  readonly clearance: number;
  /** `actor:<id>`, `group:<id>` and `role:<id>` keys a grant's subject can match */
  readonly keys: ReadonlySet<string>;
  readonly roleNames: string;
}

/** A grant with its hot-path fields pre-read. */
export interface GrantRec {
  readonly row: GrantRow;
  readonly key: string;
  readonly rank: number;
  readonly exp: number;       // Infinity when it does not expire
  readonly nb: number;        // notBefore, -Infinity when none
  readonly na: number;        // notAfter, Infinity when none
  readonly filter: Expr | null;
  readonly hidden: readonly string[];
  readonly hasHidden: boolean;
  readonly ceiling: number;
  /** The grant carries the export right. */
  readonly xport: boolean;
}

const NONE: readonly string[] = Object.freeze([]);

export class AccessSnapshot {
  epoch = 0;
  labelNames: string[] = ["Normal", "Sensitive", "Restricted", "Privileged"];
  /** Optional row source for the acl_index build: row values of a resource that has a row filter on an explicit grant. */
  rowSource: ((resourceId: string) => Readonly<Record<string, unknown>> | undefined) | null = null;

  private principals = new Map<string, PrincipalRow>();
  private roles = new Map<string, RoleRow>();
  private holderRoles = new Map<string, string[]>();
  private members = new Map<string, string[]>();        // member -> groups it is directly in
  private grants = new Map<string, GrantRow>();
  private resources = new Map<string, ResourceRow>();
  private fieldLabels = new Map<string, number>();       // `${type}.${field}` -> label
  private policyList: Policy[] = [];

  private infoCache = new Map<string, SubjectInfo | null>();
  /** The earliest end of a permission exception folded into a cached SubjectInfo: past it the cache is dropped, so an exception lapses at its end even before the lapse is written. */
  private infoUntil = Infinity;
  /** The exception rows, read once per change (most Spaces have none, so a SubjectInfo pays nothing for them). */
  private excRows: GrantRow[] | null = null;
  /** Per person, the permissions an Allow exception (their own or a group's) gives them: what an agent acting for them may follow. */
  private exAllowed = new Map<string, Set<string>>();
  /** Permissions some role an agent may hold carries (never Owner or Admin only): an agent never exceeds itself. */
  private agentKeys: Set<string> | null = null;
  /** Time for exception ends; a test sets it. */
  clock: () => number = () => Date.now();
  private grantsOnCache: Map<string, GrantRec[]> | null = null;
  private typeWideCache: Map<string, GrantRec[]> | null = null;
  private chainCache = new Map<string, readonly ResourceRow[] | null>();
  private labelCache = new Map<string, number>();
  private cutCache: Map<string, number> | null = null;
  /** Resource rows read to work out effective labels since the last change (a test reads it to prove each folder is walked once). */
  labelWalks = 0;

  /** `access.changed`: drop every derived view and bump the epoch. A label or a parent changes only through putResource, so the effective labels are dropped with the rest. */
  changed(): void {
    this.epoch++;
    this.infoCache.clear(); this.infoUntil = Infinity; this.excRows = null; this.exAllowed.clear(); this.agentKeys = null; this.chainCache.clear(); this.labelCache.clear(); this.labelWalks = 0;
    this.grantsOnCache = null; this.typeWideCache = null; this.cutCache = null;
  }

  private assistants = new Set<string>();
  putPrincipal(p: PrincipalRow): void { this.principals.set(p.id, this.assistants.has(p.id) ? { ...p, assistant: true } : p); this.changed(); }
  /** Marks an agent as its person's own Assistant, or clears it. */
  setAssistant(id: string, on: boolean): void {
    // remembered apart from the principal: the word can come before the principal does (the agent's birth and its privacy are in one commit)
    if (on) this.assistants.add(id); else this.assistants.delete(id);
    const p = this.principals.get(id);
    if (p && (p.assistant === true) !== on) { this.principals.set(id, { ...p, assistant: on }); this.changed(); }
  }
  putRole(r: RoleRow): void { this.roles.set(r.id, r); this.changed(); }
  addPrincipalRole(r: PrincipalRoleRow): void {
    const l = this.holderRoles.get(r.holder) ?? [];
    if (!l.includes(r.role)) l.push(r.role);
    this.holderRoles.set(r.holder, l); this.changed();
  }
  removePrincipalRole(r: PrincipalRoleRow): void {
    const l = this.holderRoles.get(r.holder);
    if (l) this.holderRoles.set(r.holder, l.filter((x) => x !== r.role));
    this.changed();
  }
  addMember(m: GroupMemberRow): void {
    const l = this.members.get(m.member) ?? [];
    if (!l.includes(m.group)) l.push(m.group);
    this.members.set(m.member, l); this.changed();
  }
  removeMember(m: GroupMemberRow): void {
    const l = this.members.get(m.member);
    if (l) this.members.set(m.member, l.filter((x) => x !== m.group));
    this.changed();
  }
  putGrant(g: GrantRow): void { this.grants.set(g.id, g); this.changed(); }
  revokeGrant(id: string): void { this.grants.delete(id); this.changed(); }
  putResource(r: ResourceRow): void { this.resources.set(r.id, r); this.changed(); }
  setFieldLabel(type: string, field: string, label: number): void { this.fieldLabels.set(`${type}.${field}`, label); this.changed(); }
  setPolicies(p: readonly Policy[]): void { this.policyList = [...p]; this.changed(); }

  principal(id: string): PrincipalRow | undefined { return this.principals.get(id); }
  resource(id: string): ResourceRow | undefined { return this.resources.get(id); }
  policies(): readonly Policy[] { return this.policyList; }
  fieldLabel(type: string, field: string): number { return this.fieldLabels.get(`${type}.${field}`) ?? 0; }
  allResources(): IterableIterator<ResourceRow> { return this.resources.values(); }
  allPrincipals(): IterableIterator<PrincipalRow> { return this.principals.values(); }
  labelName(n: number): string { return this.labelNames[n] ?? `level ${n}`; }

  /** Every group a principal is in, directly or through nested groups. */
  groupsOf(id: string): string[] {
    const out: string[] = [], seen = new Set<string>([id]), queue = [id];
    while (queue.length) {
      for (const g of this.members.get(queue.pop()!) ?? []) if (!seen.has(g)) { seen.add(g); out.push(g); queue.push(g); }
    }
    return out;
  }

  /** Roles of a subject: its own plus its groups' roles; an agent loses owner and admin. Null for an unknown principal. */
  info(id: string): SubjectInfo | null {
    if (this.infoUntil !== Infinity && this.clock() >= this.infoUntil) { this.infoCache.clear(); this.exAllowed.clear(); this.infoUntil = Infinity; }
    const hit = this.infoCache.get(id);
    if (hit !== undefined) return hit;
    const p = this.principals.get(id);
    if (!p) { this.infoCache.set(id, null); return null; }
    const groups = this.groupsOf(id);
    const roleIds = new Set<string>();
    for (const h of [id, ...groups]) for (const r of this.holderRoles.get(h) ?? []) { if (h !== id && isOwnerRole(r, this.roles.get(r)?.name)) continue; roleIds.add(r); }
    const perms = new Set<string>(), names: string[] = [];
    let clearance = 0;
    const keys = new Set<string>([`actor:${id}`]);
    for (const g of groups) keys.add(`group:${g}`);
    for (const rid of roleIds) {
      const r = this.roles.get(rid);
      if (isOwnerRole(rid, r?.name) && p.kind !== "person") continue;
      if (p.kind === "agent" && (isElevatedRole(rid, r?.name) || r?.assignableToAgents === false)) continue;
      if (!r) continue;
      keys.add(`role:${rid}`); names.push(r.name ?? r.id);
      if (r.clearance > clearance) clearance = r.clearance;
      for (const x of r.perms) perms.add(x);
    }
    this.applyExceptions(id, groups, roleIds, perms);
    const info: SubjectInfo = { p, perms, clearance, keys, roleNames: names.join(", ") || "no role" };
    this.infoCache.set(id, info);
    return info;
  }

  /** Live permission exceptions for one subject (person or group id), or for all. */
  exceptions(subjectId?: string): GrantRow[] {
    const now = this.clock(), out: GrantRow[] = [];
    for (const g of this.grants.values()) {
      if (!g.exception || (subjectId !== undefined && g.subject_id !== subjectId)) continue;
      if (g.expires_at !== null && g.expires_at !== undefined && g.expires_at <= now) continue;
      out.push(g);
    }
    return out;
  }

  /** Fold a person's exceptions into the permissions their roles give: their own beat their groups', which beat the role; among peers Allow wins; the Owner keeps everything. */
  private applyExceptions(id: string, groups: readonly string[], roleIds: ReadonlySet<string>, perms: Set<string>): void {
    const p = this.principals.get(id);
    if (!p || p.kind !== "person") return;   // agents follow the person they act for (authorize checks both), never a group's exception of their own
    if (!this.excRows) { this.excRows = []; for (const g of this.grants.values()) if (g.exception) this.excRows.push(g); }
    if (!this.excRows.length) return;
    const now = this.clock();
    const own = new Map<string, "allow" | "deny">(), viaGroup = new Map<string, "allow" | "deny">();
    for (const g of this.excRows) {
      if (!g.exception) continue;
      const end = g.expires_at ?? null;
      if (end !== null && end <= now) continue;
      const mine = g.subject_kind === "actor" && g.subject_id === id, group = g.subject_kind === "group" && groups.includes(g.subject_id);
      if (!mine && !group) continue;
      if (end !== null && end < this.infoUntil) this.infoUntil = end;
      const into = mine ? own : viaGroup;
      for (const k of g.exception.perms) {
        // Ask an admin is held the way a role holds it: the permission is not given (the app shows it read-only with Ask an admin); only the label differs from Not allowed
        const v: "allow" | "deny" = g.exception.effect === "own" ? (g.exception.own?.includes(k) ? "allow" : "deny") : g.exception.effect === "allow" ? "allow" : "deny";
        if (into.get(k) !== "allow") into.set(k, v);
      }
    }
    if (!own.size && !viaGroup.size) return;
    const owner = [...roleIds].some((r) => isOwnerRole(r, this.roles.get(r)?.name));
    for (const [k, e] of viaGroup) if (!own.has(k)) own.set(k, e);
    const allowed = new Set<string>();
    for (const [k, e] of own) { if (e === "allow") { perms.add(k); allowed.add(k); } else if (!owner) perms.delete(k); }
    if (allowed.size) this.exAllowed.set(id, allowed);
  }

  /**
   * May an agent acting for this person use what the person's Allow exception gives them (owner ruling, 3 Nov 2026)? Only a permission some role an agent can hold carries: an agent
   * never exceeds itself, and authorize checks the person too, so it never exceeds them either.
   */
  agentFollows(personId: string, perm: string): boolean {
    if (!this.info(personId)) return false;
    if (!this.exAllowed.get(personId)?.has(perm)) return false;
    if (!this.agentKeys) {
      this.agentKeys = new Set();
      for (const r of this.roles.values()) {
        if (isElevatedRole(r.id, r.name) || isOwnerRole(r.id, r.name) || r.assignableToAgents === false) continue;
        for (const k of r.perms) this.agentKeys.add(k);
      }
    }
    return this.agentKeys.has(perm);
  }

  private buildGrantIndex(): void {
    const on = new Map<string, GrantRec[]>(), tw = new Map<string, GrantRec[]>();
    for (const row of this.grants.values()) {
      if (row.exception) continue;   // a permission exception reaches no resource
      const c: Conditions = row.conditions ?? {};
      const hidden = c.hiddenFields ?? NONE;
      const rec: GrantRec = {
        row, key: `${row.subject_kind}:${row.subject_id}`, rank: rankOf(row.level),
        exp: row.expires_at == null ? Infinity : row.expires_at, nb: c.notBefore ?? -Infinity, na: c.notAfter ?? Infinity,
        filter: c.rowFilter ?? null, hidden, hasHidden: hidden.length > 0,
        ceiling: c.labelCeiling === undefined ? Infinity : Number.isFinite(c.labelCeiling) ? c.labelCeiling : -1,
        xport: c.export === true,
      };
      const [map, k] = row.resource_id === null ? [tw, row.resource_type] as const : [on, row.resource_id] as const;
      const l = map.get(k); if (l) l.push(rec); else map.set(k, [rec]);
    }
    this.grantsOnCache = on; this.typeWideCache = tw;
  }
  grantsOn(resourceId: string): readonly GrantRec[] | undefined { if (!this.grantsOnCache) this.buildGrantIndex(); return this.grantsOnCache!.get(resourceId); }
  typeWide(type: string): readonly GrantRec[] | undefined { if (!this.typeWideCache) this.buildGrantIndex(); return this.typeWideCache!.get(type); }
  allGrantRecs(): GrantRec[] {
    if (!this.grantsOnCache) this.buildGrantIndex();
    return [...this.grantsOnCache!.values(), ...this.typeWideCache!.values()].flat();
  }

  /** How many resources were cut off from this container (Only people added, Only me) and so no longer reach it through the chain. A reader that trusts a container's grants must look at these one by one. */
  cutFrom(container: string): number {
    if (!this.cutCache) {
      const m = new Map<string, number>();
      for (const r of this.resources.values()) if (r.home !== undefined) m.set(r.home, (m.get(r.home) ?? 0) + 1);
      this.cutCache = m;
    }
    return this.cutCache.get(container) ?? 0;
  }

  /**
   * The label that decides who may see a resource: the highest of its own and every folder above it, so a Restricted folder covers what is put in it, moved into it, or was in it before it was
   * labelled. A resource cut off from its container (Only people added, Only me) still carries the container's label: the cut stops grants flowing down, not sensitivity. An unknown id is 0.
   * Memoised per resource until the next change, so a list of n items in one folder reads n rows plus the folder's chain once.
   */
  effectiveLabel(id: string): number {
    const hit = this.labelCache.get(id);
    if (hit !== undefined) return hit;
    const path: ResourceRow[] = [], seen = new Set<string>();
    let cur: string | null = id, top = 0;
    while (cur !== null) {
      const known = this.labelCache.get(cur);
      if (known !== undefined) { top = known; break; }
      if (seen.has(cur)) break;
      seen.add(cur);
      const r = this.resources.get(cur);
      if (!r) break;
      this.labelWalks++;
      path.push(r);
      cur = r.parent_id ?? r.home ?? null;
    }
    for (let i = path.length - 1; i >= 0; i--) { const r = path[i]!; if (r.label > top) top = r.label; this.labelCache.set(r.id, top); }
    return this.labelCache.get(id) ?? 0;
  }

  /** The resource followed by its ancestors up to the root, or null when the resource (or an ancestor) is unknown. A cycle ends the walk. */
  chain(id: string): readonly ResourceRow[] | null {
    const hit = this.chainCache.get(id);
    if (hit !== undefined) return hit;
    const out: ResourceRow[] = [], seen = new Set<string>();
    let cur: string | null = id, ok = true;
    while (cur !== null) {
      if (seen.has(cur)) break;
      seen.add(cur);
      const r = this.resources.get(cur);
      if (!r) { ok = false; break; }
      out.push(r); cur = r.parent_id;
    }
    const res = ok ? out : null;
    this.chainCache.set(id, res);
    return res;
  }
}

export const levelRank = (l: Level): number => rankOf(l);
