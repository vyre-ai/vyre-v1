// The in-memory read side of the access projections (ARCH 4.5 "Data it reads"). The kernel fills it from events.db; every mutator bumps `epoch`, and every derived cache is dropped on the bump,
// which is the `access.changed` invalidation. authorize and scopeFor read nothing else, so a decision never touches a module table.
import { rankOf } from "./types.ts";
import type { Conditions, Expr, GrantRow, GroupMemberRow, Level, Policy, PrincipalRoleRow, PrincipalRow, ResourceRow, RoleRow } from "./types.ts";

/** The one source of the roles an agent never holds, whatever the projection says (ARCH 4.5 "Agents"): the plain names (kernel fixtures) and the access module's built-in role ids. */
export const ELEVATED_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "rol_owner", "rol_admin"]);
const ELEVATED_NAMES: ReadonlySet<string> = new Set(["owner", "admin"]);
/** True for a role an agent must never hold: by id, or by the built-in name. */
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
  private grantsOnCache: Map<string, GrantRec[]> | null = null;
  private typeWideCache: Map<string, GrantRec[]> | null = null;
  private chainCache = new Map<string, readonly ResourceRow[] | null>();

  /** `access.changed`: drop every derived view and bump the epoch. */
  changed(): void {
    this.epoch++;
    this.infoCache.clear(); this.chainCache.clear();
    this.grantsOnCache = null; this.typeWideCache = null;
  }

  putPrincipal(p: PrincipalRow): void { this.principals.set(p.id, p); this.changed(); }
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
    const hit = this.infoCache.get(id);
    if (hit !== undefined) return hit;
    const p = this.principals.get(id);
    if (!p) { this.infoCache.set(id, null); return null; }
    const groups = this.groupsOf(id);
    const roleIds = new Set<string>();
    for (const h of [id, ...groups]) for (const r of this.holderRoles.get(h) ?? []) roleIds.add(r);
    const perms = new Set<string>(), names: string[] = [];
    let clearance = 0;
    const keys = new Set<string>([`actor:${id}`]);
    for (const g of groups) keys.add(`group:${g}`);
    for (const rid of roleIds) {
      const r = this.roles.get(rid);
      if (p.kind === "agent" && (isElevatedRole(rid, r?.name) || r?.assignableToAgents === false)) continue;
      if (!r) continue;
      keys.add(`role:${rid}`); names.push(r.name ?? r.id);
      if (r.clearance > clearance) clearance = r.clearance;
      for (const x of r.perms) perms.add(x);
    }
    const info: SubjectInfo = { p, perms, clearance, keys, roleNames: names.join(", ") || "no role" };
    this.infoCache.set(id, info);
    return info;
  }

  private buildGrantIndex(): void {
    const on = new Map<string, GrantRec[]>(), tw = new Map<string, GrantRec[]>();
    for (const row of this.grants.values()) {
      const c: Conditions = row.conditions ?? {};
      const hidden = c.hiddenFields ?? NONE;
      const rec: GrantRec = {
        row, key: `${row.subject_kind}:${row.subject_id}`, rank: rankOf(row.level),
        exp: row.expires_at == null ? Infinity : row.expires_at, nb: c.notBefore ?? -Infinity, na: c.notAfter ?? Infinity,
        filter: c.rowFilter ?? null, hidden, hasHidden: hidden.length > 0,
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
