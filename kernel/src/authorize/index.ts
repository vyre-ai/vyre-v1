// (all four authorize test files import this module)
// authorize (ARCH 4.5): one synchronous function for the gateway, the sync filter, search, the MCP server and the Console Access checker.
// Order: subjects (principal, and the person an agent acts for / the owner a service is capped by) -> per subject: status, role permission, grants or ownership, clearance, holds ->
// intersect the scopes -> policies (provider label, spend, Gate). A deny or hold is a Decision, never a throw.
// Hot path: nothing is allocated for an ordinary person allow beyond the Decision and its Scope; ids are minted on first read; step text is built only for `explain` and on a deny.
import { mintId } from "../../../lib/ids.ts";
import { evalExpr } from "./expr.ts";
import type { AccessSnapshot, GrantRec, SubjectInfo } from "./snapshot.ts";
import { THROUGH_AGENT, THROUGH_ANYONE } from "../../../lib/through-agent.ts";
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
function collect(list: readonly GrantRec[], s: SubjectInfo, need: number, req: Req, res: ResourceRow, label: number): void {
  const now = req.now, fields = req.fields;
  for (let j = 0; j < list.length; j++) {
    const g = list[j]!;
    if (g.rank < need || !s.keys.has(g.key)) continue;
    if (g.exp <= now) { sawExpired = true; continue; }
    if (now < g.nb || now > g.na) continue;
    if (label > g.ceiling) continue;
    if (g.hasHidden && fields) { let hit = false; for (const f of fields) if (g.hidden.includes(f)) { hit = true; break; } if (hit) continue; }
    if (g.filter !== null && (!req.row || !evalExpr(g.filter, req.row, res.owner_id, s.p.id))) continue;
    scratch.push(g);
    if (g.rank > max) max = g.rank;
  }
}
/** Permissions a grant can carry on its own (a person is given them on one thing without a role change). */
const GRANT_PERMS: ReadonlySet<string> = new Set(["records.export"]);
const ownerScope = (clearance: number): Scope => ({ level: "manage", rowFilter: null, hiddenFields: NO_FIELDS, labelCeiling: clearance });

/** A subject's verdict: a Scope, or the ReasonCode it was denied with. */
function evalSubject(snap: AccessSnapshot, s: SubjectInfo, req: Req, res: ResourceRow, chain: readonly ResourceRow[], label: number, steps: Step[] | null): Scope | ReasonCode {
  const p = s.p, perm = req.action.perm;
  if (p.status !== "active") return "suspended";
  // rule 1: a role of its own or of its groups carries the permission. Agents never hold owner or admin (stripped when the SubjectInfo is built).
  const viaGrant = perm !== null && !s.perms.has(perm);
  if (viaGrant && !GRANT_PERMS.has(perm!)) return "role_lacks_permission";
  if (steps) steps.push({ ok: true, text: `${p.name ?? p.id}: role ${s.roleNames} allows ${perm ?? "this action"}` });
  // owning the thing is owning it; for a create (no id yet) it is owning the container or any container above it: the Space owner can create anywhere in the Space, a member in a record they own
  // an owner's assistant acts with its owner's access to what the owner owns, up to Use: "summarize my inbox" works for the person whose mailbox it is, for no one else's. Manage stays with the person.
  // Only mailboxes so far; another kind of private thing joins here when its owner's assistant is decided.
  // A Mine Vault folder is its person's alone (a private root): an agent reaches what is in it only when it acts for that person, up to Use, which is how a chat reads that person's own AI account.
  const root = chain[chain.length - 1];
  const viaMine = p.kind === "agent" && (res.type === "vault_item" || res.type === "vault_folder") && res.id !== "" && req.actingFor !== undefined && root !== undefined && root.type === "vault_folder" && root.parent_id === null && root.owner_id === req.actingFor && rankOf(req.action.level) <= rankOf("use");
  const viaOwner = (p.kind === "agent" && res.type === "mailbox" && res.id !== "" && req.actingFor !== undefined && res.owner_id === req.actingFor && rankOf(req.action.level) <= rankOf("use")) || viaMine;
  const isOwner = res.id === "" ? chain.some((r) => r.owner_id === p.id) : res.owner_id === p.id || viaOwner;
  // rule 2: grants on the resource, an ancestor, or the whole type
  const need = rankOf(req.action.level);
  scratch.length = 0; sawExpired = false; max = 0;
  for (let i = 0; i < chain.length; i++) { const l = snap.grantsOn(chain[i]!.id); if (l) collect(l, s, need, req, res, label); }
  const tw = snap.typeWide(res.type);
  if (tw) collect(tw, s, need, req, res, label);
  const matched = scratch.length;
  // a permission the role lacks may come with the grant (export), or with a setting on the thing itself (anyone who can view may export)
  if (viaGrant) {
    let carried = chain.some((r) => r.export_viewers === true);
    for (let i = 0; i < matched && !carried; i++) if (scratch[i]!.xport) carried = true;
    if (!carried) return "role_lacks_permission";
  }
  const clearance = s.clearance;
  const ownerOk = isOwner && label <= clearance;
  if (matched === 0 && !ownerOk) return sawExpired ? "expired" : "no_grant";
  if (steps) steps.push({ ok: true, text: matched ? `grant ${scratch[0]!.row.id} (${scratch[0]!.row.level})` : "owner of the resource (Manage)" });
  // rule 3: clearance
  if (label > clearance) return "above_clearance";
  if (steps) steps.push({ ok: true, text: `label ${snap.labelName(label)} within clearance ${snap.labelName(clearance)}` });
  // holds: deny wins only through clearance and holds
  if (req.action.destructive && res.holds > 0) return "on_hold";
  if (isOwner) return viaOwner ? { ...ownerScope(clearance), level: "use" } : ownerScope(clearance);
  if (matched === 1) {
    const g = scratch[0]!;
    return { level: LEVEL_BY_RANK[max]!, rowFilter: g.filter, hiddenFields: g.hidden, labelCeiling: Math.min(clearance, g.ceiling) };
  }
  // several grants: levels max, filters OR (a grant without a filter means all rows), hidden only if hidden by every matching grant
  let rowFilter: Expr | null;
  const filters: Expr[] = [];
  let open = false, ceiling = -1;
  for (let i = 0; i < matched; i++) ceiling = Math.max(ceiling, scratch[i]!.ceiling);
  for (let i = 0; i < matched; i++) { const f = scratch[i]!.filter; if (f === null) { open = true; break; } filters.push(f); }
  rowFilter = open ? null : { op: "or", args: filters };
  let hidden: readonly string[] = scratch[0]!.hidden;
  for (let i = 1; i < matched && hidden.length; i++) { const h = scratch[i]!.hidden; hidden = hidden.filter((f) => h.includes(f)); }
  return { level: LEVEL_BY_RANK[max]!, rowFilter, hiddenFields: hidden, labelCeiling: Math.min(clearance, ceiling) };
}

/**
 * Does the agent hold a live Use grant on this vault item (or its folders) that a person approved for its key request, naming who may use it through the agent (owner ruling,
 * 3 Nov 2026)? Then the person it acts for needs no access of their own here, up to Use. A vault item or folder only, never more than Use, and only the asker unless the approver chose
 * anyone.
 */
function throughAgent(snap: AccessSnapshot, agent: SubjectInfo, req: Req, res: ResourceRow, chain: readonly ResourceRow[]): boolean {
  if (res.type !== "vault_item" && res.type !== "vault_folder") return false;
  if (res.id === "" || req.actingFor === undefined || rankOf(req.action.level) > rankOf("use")) return false;
  const need = rankOf(req.action.level), now = req.now;
  for (let i = 0; i < chain.length; i++) {
    const list = snap.grantsOn(chain[i]!.id);
    if (!list) continue;
    for (const g of list) {
      const src = g.row.source;
      if (src === undefined || !src.startsWith(THROUGH_AGENT) || !agent.keys.has(g.key) || g.rank < need) continue;
      if (g.exp <= now || now < g.nb || now > g.na) continue;
      const who = src.slice(THROUGH_AGENT.length);
      if (who === THROUGH_ANYONE || who === req.actingFor) return true;
    }
  }
  return false;
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

/** The provider name an outside agent runs under. Vyre cannot see what model is behind it, whatever the client says, so it reads as the strictest provider a policy names unless the policy names it. */
export const OUTSIDE_PROVIDER = "outside";

/** The highest label a policy lets this provider see. An unnamed provider gets the default, and an outside agent never gets more than the least any provider gets. */
export function providerMax(p: { allow: Readonly<Record<string, number>>; defaultMax?: number | undefined }, provider: string): number {
  const named = p.allow[provider];
  if (named !== undefined) return named;
  if (provider !== OUTSIDE_PROVIDER) return p.defaultMax ?? Infinity;
  return Math.min(...Object.values(p.allow), p.defaultMax ?? Infinity);
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
    if (kind === "svc" || (kind === "actor" && me.p.owner)) {   // a Service's grants, and an outside actor's, are capped by its owner's, re-checked on every call. A visitor (act_anon) has no owner and no grants to cap.
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

  // An agent holds only its own role's permissions, never more through its person or a group (ARCH 4.5: agents never hold Owner or Admin, nor what only they carry). Building Journeys,
  // record types or Space Automations takes a role that carries it, given to the agent by a person.
  const first = evalSubject(snap, me, req, res, chain, label, steps);
  // an agent acting for a person may send from whatever that person may send from: on a mailbox or a number, at Use (the level a send asks for, reading stays as it is), the person's access is the ceiling in place of a grant of the agent's own
  const sendsAs = kind === "agent" && others !== null && (res.type === "mailbox" || res.type === "number") && res.id !== "" && req.action.level === "use" && first === "no_grant";
  if (typeof first === "string" && !sendsAs) return denied(snap, first, name, steps);
  let scope: Scope = typeof first === "string" ? ownerScope(0) : first;
  // a key approved for this agent's request, for the person it acts for (or for anyone who asks it): that person's own access is not needed, up to Use
  if (others && kind === "agent" && typeof first !== "string" && throughAgent(snap, me, req, res, chain)) {
    if (steps) steps.push({ ok: true, text: `${name} may use this for the person it acts for: approved for its key request` });
    others = null;
  }
  if (others) {
    const all: Scope[] = typeof first === "string" ? [] : [first];
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
      if (req.provider && label > providerMax(p, req.provider)) return denied(snap, "provider_label", name, steps);
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
