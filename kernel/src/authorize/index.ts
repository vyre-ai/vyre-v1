// (all four authorize test files import this module)
// authorize (ARCH 4.5): one synchronous function for the gateway, the sync filter, search, the MCP server and the Console Access checker.
// Order: subjects (principal, and the person an agent acts for / the owner a service is capped by) -> per subject: status, role permission, grants or ownership, clearance, holds ->
// intersect the scopes -> policies (provider label, spend, Gate). A deny or hold is a Decision, never a throw.
// Hot path: nothing is allocated for an ordinary person allow beyond the Decision and its Scope; ids are minted on first read; step text is built only for `explain` and on a deny.
import { mintId } from "../../../lib/ids.ts";
import { evalExpr } from "./expr.ts";
import type { AccessSnapshot, GrantRec, SubjectInfo } from "./snapshot.ts";
import { LEVEL_BY_RANK, rankOf } from "./types.ts";
import type { Decision, Expr, Obligation, ReasonCode, Req, ResourceRow, Scope, Step } from "./types.ts";

export { AccessSnapshot, ELEVATED_ROLES } from "./snapshot.ts";
export { scopeFor, toSql, evalPred, aclRows, aclIds, and, or } from "./scope.ts";
export type { Pred, ScopeForReq, ScopeResult, Sql } from "./scope.ts";
export { evalExpr, validateExpr } from "./expr.ts";
export * from "./types.ts";

const EMPTY_STEPS: readonly Step[] = Object.freeze([]);
const EMPTY_OBL: readonly Obligation[] = Object.freeze([]);
const NO_FIELDS: readonly string[] = Object.freeze([]);

class DecisionImpl implements Decision {
  readonly effect: Decision["effect"];
  readonly reason: ReasonCode;
  readonly steps: readonly Step[];
  readonly scope: Scope | undefined;
  readonly obligations: readonly Obligation[];
  private id: string | null = null;
  constructor(effect: Decision["effect"], reason: ReasonCode, steps: readonly Step[], scope: Scope | undefined, obligations: readonly Obligation[]) {
    this.effect = effect; this.reason = reason; this.steps = steps; this.scope = scope; this.obligations = obligations;
  }
  get decisionId(): string { return (this.id ??= mintId("dec")); }
}

const WORDS: Record<string, string> = {
  not_a_member: "is not a member of this Space", suspended: "is suspended", role_lacks_permission: "has no role that allows this",
  no_grant: "has no grant on this and does not own it", expired: "only has a grant that has expired", above_clearance: "is not cleared for how sensitive this is",
  on_hold: "cannot do this while the item is on hold", not_found: "points at something that does not exist", bad_input: "is missing what it needs to be checked",
  agent_needs_actor: "needs a person to act for", provider_label: "Restricted: not available to this provider", limit: "is over a spend limit",
};
function denied(snap: AccessSnapshot, reason: ReasonCode, name: string, steps: Step[] | null): Decision {
  const out = steps ?? [];
  out.push({ ok: false, text: `${name} ${WORDS[reason] ?? reason}` });
  void snap;
  return new DecisionImpl("deny", reason, out, undefined, EMPTY_OBL);
}

const scratch: GrantRec[] = [];
let sawExpired = false, max = 0;
/** Grants in `list` that name this subject, reach the needed level, are live, and whose conditions hold for this request (module state, not a closure: the hot path allocates nothing here). */
function collect(list: readonly GrantRec[], s: SubjectInfo, need: number, req: Req, res: ResourceRow): void {
  const now = req.now, fields = req.fields;
  for (let j = 0; j < list.length; j++) {
    const g = list[j]!;
    if (g.rank < need || !s.keys.has(g.key)) continue;
    if (g.exp <= now) { sawExpired = true; continue; }
    if (now < g.nb || now > g.na) continue;
    if (g.hasHidden && fields) { let hit = false; for (const f of fields) if (g.hidden.includes(f)) { hit = true; break; } if (hit) continue; }
    if (g.filter !== null && (!req.row || !evalExpr(g.filter, req.row, res.owner_id, s.p.id))) continue;
    scratch.push(g);
    if (g.rank > max) max = g.rank;
  }
}
const ownerScope = (clearance: number): Scope => ({ level: "manage", rowFilter: null, hiddenFields: NO_FIELDS, labelCeiling: clearance });

/** A subject's verdict: a Scope, or the ReasonCode it was denied with. */
function evalSubject(snap: AccessSnapshot, s: SubjectInfo, req: Req, res: ResourceRow, chain: readonly ResourceRow[], label: number, steps: Step[] | null): Scope | ReasonCode {
  const p = s.p, perm = req.action.perm;
  if (p.status !== "active") return "suspended";
  // rule 1: a role of its own or of its groups carries the permission. Agents never hold owner or admin (stripped when the SubjectInfo is built).
  if (perm !== null && !s.perms.has(perm)) return "role_lacks_permission";
  if (steps) steps.push({ ok: true, text: `${p.name ?? p.id}: role ${s.roleNames} allows ${perm ?? "this action"}` });
  // owning the thing is owning it; for a create (no id yet) it is owning the container or any container above it: the Space owner can create anywhere in the Space, a member in a record they own
  const isOwner = res.id === "" ? chain.some((r) => r.owner_id === p.id) : res.owner_id === p.id;
  // rule 2: grants on the resource, an ancestor, or the whole type
  const need = rankOf(req.action.level);
  scratch.length = 0; sawExpired = false; max = 0;
  for (let i = 0; i < chain.length; i++) { const l = snap.grantsOn(chain[i]!.id); if (l) collect(l, s, need, req, res); }
  const tw = snap.typeWide(res.type);
  if (tw) collect(tw, s, need, req, res);
  const matched = scratch.length;
  const clearance = s.clearance;
  const ownerOk = isOwner && label <= clearance;
  if (matched === 0 && !ownerOk) return sawExpired ? "expired" : "no_grant";
  if (steps) steps.push({ ok: true, text: matched ? `grant ${scratch[0]!.row.id} (${scratch[0]!.row.level})` : "owner of the resource (Manage)" });
  // rule 3: clearance
  if (label > clearance) return "above_clearance";
  if (steps) steps.push({ ok: true, text: `label ${snap.labelName(label)} within clearance ${snap.labelName(clearance)}` });
  // holds: deny wins only through clearance and holds
  if (req.action.destructive && res.holds > 0) return "on_hold";
  if (isOwner) return ownerScope(clearance);
  if (matched === 1) {
    const g = scratch[0]!;
    return { level: LEVEL_BY_RANK[max]!, rowFilter: g.filter, hiddenFields: g.hidden, labelCeiling: clearance };
  }
  // several grants: levels max, filters OR (a grant without a filter means all rows), hidden only if hidden by every matching grant
  let rowFilter: Expr | null;
  const filters: Expr[] = [];
  let open = false;
  for (let i = 0; i < matched; i++) { const f = scratch[i]!.filter; if (f === null) { open = true; break; } filters.push(f); }
  rowFilter = open ? null : { op: "or", args: filters };
  let hidden: readonly string[] = scratch[0]!.hidden;
  for (let i = 1; i < matched && hidden.length; i++) { const h = scratch[i]!.hidden; hidden = hidden.filter((f) => h.includes(f)); }
  return { level: LEVEL_BY_RANK[max]!, rowFilter, hiddenFields: hidden, labelCeiling: clearance };
}

function intersect(scopes: Scope[]): Scope {
  let level = rankOf(scopes[0]!.level), ceiling = scopes[0]!.labelCeiling;
  const filters: Expr[] = [], hidden = new Set<string>();
  for (const s of scopes) {
    level = Math.min(level, rankOf(s.level)); ceiling = Math.min(ceiling, s.labelCeiling);
    if (s.rowFilter) filters.push(s.rowFilter);
    for (const f of s.hiddenFields) hidden.add(f);
  }
  return { level: LEVEL_BY_RANK[level]!, rowFilter: filters.length === 0 ? null : filters.length === 1 ? filters[0]! : { op: "and", args: filters }, hiddenFields: [...hidden], labelCeiling: ceiling };
}

export function authorize(snap: AccessSnapshot, req: Req): Decision {
  const steps: Step[] | null = req.explain ? [] : null;
  const me = snap.info(req.principal);
  if (!me) return denied(snap, "not_a_member", req.principal, steps);
  const name = me.p.name ?? me.p.id;
  // who else must allow (rule 5: intersection, every subject must allow)
  let others: SubjectInfo[] | null = null;
  const kind = me.p.kind;
  if (kind === "agent") {
    const a = req.actingFor && req.actingFor !== req.principal ? snap.info(req.actingFor) : null;
    if (!a || a.p.kind !== "person") return denied(snap, "agent_needs_actor", name, steps);
    others = [a];
  } else {
    if (kind === "svc") {   // a Service's grants are capped by its owner's, re-checked on every call
      const o = me.p.owner ? snap.info(me.p.owner) : null;
      if (!o) return denied(snap, "not_a_member", name, steps);
      others = [o];
    }
    if (req.actingFor && req.actingFor !== req.principal) {
      const a = snap.info(req.actingFor);
      if (!a) return denied(snap, "not_a_member", req.actingFor, steps);
      if (!others) others = [a]; else if (!others.includes(a)) others.push(a);
    }
  }
  // the resource
  const ref = req.resource;
  let res: ResourceRow, chain: readonly ResourceRow[];
  if (ref.id !== null) {
    const c = snap.chain(ref.id);
    if (!c) return denied(snap, "not_found", name, steps);
    chain = c; res = c[0]!;
  } else {
    if (!ref.parent) return denied(snap, "bad_input", name, steps);
    const c = snap.chain(ref.parent);
    if (!c) return denied(snap, "not_found", name, steps);
    chain = c; res = { id: "", type: ref.type, parent_id: ref.parent, label: c[0]!.label, owner_id: null, holds: 0 };
  }
  let label = res.label;
  if (req.fields) for (const f of req.fields) { const fl = snap.fieldLabel(res.type, f); if (fl > label) label = fl; }

  const first = evalSubject(snap, me, req, res, chain, label, steps);
  if (typeof first === "string") return denied(snap, first, name, steps);
  let scope: Scope = first;
  if (others) {
    const all: Scope[] = [first];
    for (const o of others) {
      const r = evalSubject(snap, o, req, res, chain, label, steps);
      if (typeof r === "string") return denied(snap, r, o.p.name ?? o.p.id, steps);
      all.push(r);
    }
    scope = intersect(all);
  }
  // rule 4: policies, after access
  const pol = snap.policies();
  let obligations: Obligation[] | null = null;
  for (let i = 0; i < pol.length; i++) {
    const p = pol[i]!;
    if (p.kind === "provider_label") {
      if (req.provider && label > (p.allow[req.provider] ?? p.defaultMax ?? Infinity)) return denied(snap, "provider_label", name, steps);
    } else if (p.kind === "spend") {
      if (p.principalKinds && !p.principalKinds.includes(kind)) continue;
      const used = req.spendMicros?.[p.meter];
      if (used !== undefined && used >= p.limitMicros) return denied(snap, "limit", name, steps);
      (obligations ??= []).push({ type: "spend", meter: p.meter });
    } else if (p.kind === "gate") {
      if (kind === "person" && !p.humanToo) continue;       // ordinary human sends skip the Gate
      if (req.approved || !req.cap || !(p.caps.includes(req.cap) || p.caps.includes("*"))) continue;
      (obligations ??= []).push({ type: "gate", act: p.act, approver: p.approver, checker_must_be_person: p.checker_must_be_person ?? true });
    }
  }
  const held = obligations !== null && obligations.some((o) => o.type === "gate");
  return new DecisionImpl(held ? "hold" : "allow", held ? "needs_approval" : "ok", steps ?? EMPTY_STEPS, scope, obligations ?? EMPTY_OBL);
}

/** View as: an admin checks what another person (or agent acting for someone) would get. The viewer needs `access.view_as` and may not look through a higher clearance than their own. Always audited. */
export function viewAs(snap: AccessSnapshot, viewer: string, target: string, req: Omit<Req, "principal">): Decision {
  const v = snap.info(viewer), t = snap.info(target);
  if (!v) return denied(snap, "not_a_member", viewer, null);
  if (v.p.status !== "active") return denied(snap, "suspended", v.p.name ?? viewer, null);
  if (!v.perms.has("access.view_as")) return denied(snap, "role_lacks_permission", v.p.name ?? viewer, null);
  if (!t) return denied(snap, "not_a_member", target, null);
  if (t.clearance > v.clearance) return denied(snap, "above_clearance", v.p.name ?? viewer, null);
  const d = authorize(snap, { ...req, principal: target });
  return new DecisionImpl(d.effect, d.reason, d.steps, d.scope, [...d.obligations, { type: "audit", class: "view_as" }]);
}

/** The 0.6 contract was async; the kernel conformance suite keeps that shape through this adapter only. */
export const authorizeAsync = (snap: AccessSnapshot, req: Req): Promise<Decision> => Promise.resolve(authorize(snap, req));
