// Gate projections (ARCH 4.6, spec 2.14). The held-row store (gate_holds), the rules (gate_rules, one row per act and scope), the effective rule (the strictest of Space policy,
// owner floor and the agent's own rule), the fixed summary line of a hold, and the exact preview blocks.
// Durable tables: migrations/0001_gate_holds.sql. Every statement names only gate_* tables (ctx.db refuses anything else, ARCH B2).
// The ten act kinds below mirror manifests/gate.ts gateActs (frozen, ruling 9); the contract test of this module compares them.
import { isTrustedService } from "../../lib/trust.ts";
import { fail } from "../../host/src/routes/errors.ts";
import { canonical } from "../../lib/canonical.ts";

export type ActKey = "send" | "post" | "pay" | "delete" | "push_protected" | "campaign_launch" | "secret_export" | "site_promote" | "signature_send" | "spend_raise";
export type Risk = "low" | "medium" | "high";
export type Mode = "hold" | "allow";
export type Scope = "space" | "floor" | "agent";
export type HoldState = "held" | "approved" | "denied" | "expired";
export interface PrincipalRef { kind: "person" | "agent" | "actor" | "service"; id: string }
export interface Assignee { kind: "person" | "agent" | "group" | "role" | "automation"; id: string }

export interface ActDef {
  key: ActKey; title: string; risk: Risk; block: string; approvers: string; peopleOnly: boolean; agentOkFor?: Risk; afterHours: number; onTimeout: "drop" | "escalate";
  escalateTo: "delegate" | "role"; emailBackstopHours: number; humanToo: boolean;
}
const act = (key: ActKey, title: string, risk: Risk, block: string, approvers: string, o: Partial<ActDef> = {}): ActDef => ({
  key, title, risk, block, approvers, peopleOnly: true, afterHours: 24, onTimeout: "escalate", escalateTo: "delegate", emailBackstopHours: 4, humanToo: false, ...o,
});
export const ACTS: readonly ActDef[] = [
  act("send", "Send a message", "medium", "doc_excerpt", "asker", { agentOkFor: "low" }),
  act("post", "Post publicly", "medium", "doc_excerpt", "asker", { agentOkFor: "low" }),
  act("pay", "Send money or submit a card", "high", "table", "owner"),
  act("delete", "Delete", "high", "record_card", "asker"),
  act("push_protected", "Push to a protected branch", "high", "diff", "role:admin", { humanToo: true }),
  act("campaign_launch", "Launch a campaign", "high", "table", "role:admin", { humanToo: true }),
  act("secret_export", "Export secrets", "high", "table", "role:admin", { humanToo: true }),
  act("site_promote", "Promote a site to production", "high", "deploy", "role:admin", { humanToo: true }),
  act("signature_send", "Send a document for signature", "high", "file", "role:admin"),
  act("spend_raise", "Raise a spend cap", "medium", "table", "role:admin"),
];
export const actOf = (k: string): ActDef => ACTS.find((a) => a.key === k) ?? ACTS[0]!;

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
export interface CallOpts {
  idempotencyKey?: string;
  /** Re-invoke the parked call with the approval token bound to its payload (the host's Gate resume path). */
  approvalToken?: string;
  /** The principal id of the original caller; the host runs the call as that principal. */
  onBehalfOf?: string;
}
export interface GateCtx {
  space: string;
  principal: { kind: string; id: string };
  actingFor?: string;
  trace: { traceId: string };
  device?: string;
  run?: string;
  now(): number;
  db: Db;
  emit(name: string, subject: string, payload: unknown, opts?: { vis?: string }): { id: string };
  call?(cap: string, input: unknown, opts?: CallOpts): Promise<unknown>;
  authorize?(action: { perm: string | null; level: string }, resource: { type: string; id: string | null }): { effect: string };
  schedule?(at: number | string, cap: string, input: unknown): Promise<string>;
  seal?: { seal(v: Uint8Array, scope: string): { keyId: string; nonce: string; bytes: string }; unseal(s: { keyId: string; nonce: string; bytes: string }): Uint8Array };
  log?: { warn(msg: string, attrs?: Record<string, unknown>): void };
}

type Code = Parameters<typeof fail>[0];
export function raise(ctx: { trace: { traceId: string } }, code: Code, message?: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { ...(message ? { message } : {}), ...(details ? { details } : {}) });
}
export function clean<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
}
export const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function newHoldId(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(14));
  let s = "";
  for (const x of b) s += (x % 36).toString(36);
  return `hld_${s}`;
}
/** sha-256 of the canonical JSON of a value, as hex (Web Crypto: the crypto imports stay in the kernel, boundary B3). */
export async function sha(v: unknown): Promise<string> {
  const d = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(v)));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- policy values (the gate.* settings) ----

export interface Policy { timeoutHours: number; emailBackstopHours: number; draftedByLabel: boolean }
export const POLICY_DEFAULTS: Policy = { timeoutHours: 24, emailBackstopHours: 4, draftedByLabel: true };
export function readPolicy(db: Db): Policy {
  const p: Policy = { ...POLICY_DEFAULTS };
  for (const r of db.all("SELECT policy_key, policy_value FROM gate_policy") as { policy_key: string; policy_value: string }[]) {
    let v: unknown;
    try { v = JSON.parse(r.policy_value); } catch { continue; }
    if (r.policy_key === "gate.timeout_hours" && typeof v === "number" && Number.isInteger(v) && v >= 1) p.timeoutHours = v;
    if (r.policy_key === "gate.email_backstop_hours" && typeof v === "number" && Number.isInteger(v) && v >= 1) p.emailBackstopHours = v;
    if (r.policy_key === "gate.drafted_by_label" && typeof v === "boolean") p.draftedByLabel = v;
  }
  return p;
}

// ---- rules ----

export interface RuleRow {
  act: ActKey; scope: Scope; agentId: string; mode: Mode; approvers?: string; agentOkFor?: Risk; afterHours?: number; onTimeout?: "drop" | "escalate"; escalateTo?: "delegate" | "role"; updatedAt: number;
}
type Raw = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function ruleFrom(r: Raw): RuleRow {
  const o: RuleRow = { act: r.act as ActKey, scope: r.scope as Scope, agentId: (r.agent_id as string) ?? "", mode: r.mode as Mode, updatedAt: num(r.updated_at) ?? 0 };
  const approvers = str(r.approvers); if (approvers) o.approvers = approvers;
  const ok = str(r.agent_ok_for); if (ok) o.agentOkFor = ok as Risk;
  const hours = num(r.after_hours); if (hours !== undefined) o.afterHours = hours;
  const ot = str(r.on_timeout); if (ot) o.onTimeout = ot as "drop" | "escalate";
  const et = str(r.escalate_to); if (et) o.escalateTo = et as "delegate" | "role";
  return o;
}
export function allRules(db: Db, scope?: Scope, agentId?: string): RuleRow[] {
  const rows = db.all("SELECT act, scope, agent_id, mode, approvers, agent_ok_for, after_hours, on_timeout, escalate_to, updated_at FROM gate_rules ORDER BY act, scope, agent_id") as Raw[];
  return rows.map(ruleFrom).filter((r) => (scope === undefined || r.scope === scope) && (agentId === undefined || r.agentId === agentId));
}
export function putRule(db: Db, r: RuleRow): void {
  db.run(
    `INSERT OR REPLACE INTO gate_rules (act, scope, agent_id, mode, approvers, agent_ok_for, after_hours, on_timeout, escalate_to, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    r.act, r.scope, r.agentId, r.mode, r.approvers ?? null, r.agentOkFor ?? null, r.afterHours ?? null, r.onTimeout ?? null, r.escalateTo ?? null, r.updatedAt,
  );
}

export const RISK_RANK: Record<Risk, number> = { low: 0, medium: 1, high: 2 };
export const APPROVER_RANK = (a: string): number => (a === "owner" ? 3 : a.startsWith("role:") ? 2 : 1);
const minRisk = (a: Risk | undefined, b: Risk | undefined): Risk | undefined => (a === undefined ? b : b === undefined ? a : RISK_RANK[a] <= RISK_RANK[b] ? a : b);

export interface Effective {
  hold: boolean; reason: string; approvers: string; peopleOnly: boolean; agentOkFor?: Risk; afterHours: number; onTimeout: "drop" | "escalate"; escalateTo: "delegate" | "role";
  emailBackstopHours: number; sources: { space: Mode; floor?: Mode; agent?: Mode };
}

/** The effective rule for a principal and an act: the strictest of the Space policy, the owner floor and the agent's own rule. An agent rule can only tighten; an `allow` anywhere cannot
 *  loosen a `hold` elsewhere; nothing here reads a local tool-prompt mode, so Auto cannot suppress a Gate hold (spec 2.14). A person's own act skips the Gate unless the act is a human-too kind. */
export function effectiveRule(db: Db, p: PrincipalRef, actKey: string, policy: Policy = readPolicy(db)): Effective {
  const a = actOf(actKey);
  const rows = allRules(db).filter((r) => r.act === a.key);
  const space = rows.find((r) => r.scope === "space");
  const floor = rows.find((r) => r.scope === "floor");
  const agent = p.kind === "agent" ? rows.find((r) => r.scope === "agent" && r.agentId === p.id) : undefined;
  const sSpace: Mode = space?.mode ?? "hold";
  const sources: Effective["sources"] = { space: sSpace, ...(floor ? { floor: floor.mode } : {}), ...(agent ? { agent: agent.mode } : {}) };
  const wants = sSpace === "hold" || floor?.mode === "hold" || agent?.mode === "hold";
  const applies = p.kind !== "person" || a.humanToo;
  const hold = wants && applies;
  const reason = !applies ? "A person's own act does not wait for approval."
    : !wants ? "The Space rule lets this through."
    : floor?.mode === "hold" ? "The owner always asks first."
    : agent?.mode === "hold" && sSpace === "allow" ? "This agent's own rule holds it."
    : "Acts of this kind wait for approval.";
  // approvers: the strictest named by any level
  const named = [floor?.approvers, agent?.approvers, space?.approvers].filter((x): x is string => x !== undefined);
  const approvers = named.reduce((best, x) => (APPROVER_RANK(x) > APPROVER_RANK(best) ? x : best), a.approvers);
  // agents may approve only up to the risk the Space names; an agent's own rule can only lower it
  const base = space?.agentOkFor ?? a.agentOkFor;
  const okFor = minRisk(base, agent?.agentOkFor);
  const peopleOnly = okFor === undefined || RISK_RANK[okFor] < RISK_RANK[a.risk];
  // timing: the Space sets it; the floor and the agent can only shorten
  const spaceHours = space?.afterHours ?? policy.timeoutHours;
  const afterHours = Math.min(...[spaceHours, floor?.afterHours, agent?.afterHours].filter((x): x is number => x !== undefined));
  const dropped = [space?.onTimeout ?? a.onTimeout, floor?.onTimeout, agent?.onTimeout].includes("drop");
  const e: Effective = {
    hold, reason, approvers, peopleOnly, afterHours, onTimeout: dropped ? "drop" : "escalate",
    escalateTo: space?.escalateTo ?? agent?.escalateTo ?? a.escalateTo, emailBackstopHours: Math.min(policy.emailBackstopHours, a.emailBackstopHours), sources,
  };
  if (okFor !== undefined) e.agentOkFor = okFor;
  return e;
}

// ---- holds ----

export interface Hold {
  id: string; act: ActKey; capName: string; capVersion: number; input: unknown; inputHash: string; payloadHash: string; principal: PrincipalRef; actingFor?: string; decisionId: string;
  runId?: string; threadId?: string; taskId: string; state: HoldState; summary: string; approver: Assignee; rule: Effective; createdAt: number; expiresAt: number;
  backstopAt?: number; backstopSchedule?: string; expireSchedule?: string; escalatedAt?: number; sendingAt?: number; decidedAt?: number; decidedBy?: string; possiblySent: boolean; error?: string;
}
const HOLD_COLS = `id, act, cap_name, cap_version, input, input_hash, payload_hash, principal_kind, principal_id, acting_for, decision_id, run_id, thread_id, task_id, state, summary, approver, rule,
  created_at, expires_at, backstop_at, backstop_schedule, expire_schedule, escalated_at, sending_at, decided_at, decided_by, possibly_sent, error`;

function parse<T>(v: unknown, d: T): T {
  if (typeof v !== "string" || !v) return d;
  try { return JSON.parse(v) as T; } catch { return d; }
}
function holdFrom(r: Raw): Hold {
  const h: Hold = {
    id: r.id as string, act: r.act as ActKey, capName: r.cap_name as string, capVersion: num(r.cap_version) ?? 1, input: parse<unknown>(r.input, null), inputHash: r.input_hash as string,
    payloadHash: r.payload_hash as string, principal: { kind: r.principal_kind as PrincipalRef["kind"], id: r.principal_id as string }, decisionId: r.decision_id as string,
    taskId: (r.task_id as string) ?? "", state: r.state as HoldState, summary: r.summary as string, approver: parse<Assignee>(r.approver, { kind: "role", id: "rol_admin" }),
    rule: parse<Effective>(r.rule, effectiveFallback()), createdAt: r.created_at as number, expiresAt: r.expires_at as number, possiblySent: num(r.possibly_sent) === 1,
  };
  const af = str(r.acting_for); if (af) h.actingFor = af;
  const run = str(r.run_id); if (run) h.runId = run;
  const th = str(r.thread_id); if (th) h.threadId = th;
  const b = num(r.backstop_at); if (b !== undefined) h.backstopAt = b;
  const bs = str(r.backstop_schedule); if (bs) h.backstopSchedule = bs;
  const es = str(r.expire_schedule); if (es) h.expireSchedule = es;
  const ea = num(r.escalated_at); if (ea !== undefined) h.escalatedAt = ea;
  const sa = num(r.sending_at); if (sa !== undefined) h.sendingAt = sa;
  const da = num(r.decided_at); if (da !== undefined) h.decidedAt = da;
  const db = str(r.decided_by); if (db) h.decidedBy = db;
  const er = str(r.error); if (er) h.error = er;
  return h;
}
const effectiveFallback = (): Effective => ({ hold: true, reason: "", approvers: "role:admin", peopleOnly: true, afterHours: 24, onTimeout: "escalate", escalateTo: "delegate", emailBackstopHours: 4, sources: { space: "hold" } });

export function findHold(db: Db, id: string): Hold | undefined {
  const rows = db.all(`SELECT ${HOLD_COLS} FROM gate_holds WHERE id = ?`, id) as Raw[];
  return rows[0] ? holdFrom(rows[0]) : undefined;
}
export function getHold(ctx: GateCtx, id: string): Hold {
  const h = findHold(ctx.db, id);
  if (!h) raise(ctx, "permission.not_found", "That hold is not available.");
  return h;
}
export function holdsWhere(db: Db, where = "", ...args: unknown[]): Hold[] {
  return (db.all(`SELECT ${HOLD_COLS} FROM gate_holds${where ? ` WHERE ${where}` : ""} ORDER BY created_at DESC, id DESC`, ...args) as Raw[]).map(holdFrom);
}
const n = (v: unknown): unknown => (v === undefined ? null : v);
export function insertHold(db: Db, h: Hold): void {
  db.run(
    `INSERT INTO gate_holds (${HOLD_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    h.id, h.act, h.capName, h.capVersion, JSON.stringify(h.input ?? null), h.inputHash, h.payloadHash, h.principal.kind, h.principal.id, n(h.actingFor), h.decisionId, n(h.runId), n(h.threadId),
    h.taskId, h.state, h.summary, JSON.stringify(h.approver), JSON.stringify(h.rule), h.createdAt, h.expiresAt, n(h.backstopAt), n(h.backstopSchedule), n(h.expireSchedule), n(h.escalatedAt),
    n(h.sendingAt), n(h.decidedAt), n(h.decidedBy), h.possiblySent ? 1 : 0, n(h.error),
  );
}
/** Write the mutable columns of a hold. */
export function saveHold(db: Db, h: Hold): void {
  db.run(
    `UPDATE gate_holds SET task_id = ?, state = ?, approver = ?, rule = ?, expires_at = ?, backstop_at = ?, backstop_schedule = ?, expire_schedule = ?, escalated_at = ?, sending_at = ?,
       decided_at = ?, decided_by = ?, possibly_sent = ?, error = ? WHERE id = ?`,
    h.taskId, h.state, JSON.stringify(h.approver), JSON.stringify(h.rule), h.expiresAt, n(h.backstopAt), n(h.backstopSchedule), n(h.expireSchedule), n(h.escalatedAt), n(h.sendingAt),
    n(h.decidedAt), n(h.decidedBy), h.possiblySent ? 1 : 0, n(h.error), h.id,
  );
}

export function holdOut(h: Hold): Record<string, unknown> {
  return clean({
    id: h.id, act: h.act, capName: h.capName, taskId: h.taskId, runId: h.runId, principal: h.principal, actingFor: h.actingFor, state: h.state, payloadHash: h.payloadHash,
    createdAt: h.createdAt, expiresAt: h.expiresAt,
  });
}

/** Requester scoping: a hold is its requester's and its approver's. The people who hold the approving role see it through the kernel's grant on its task.
 *  A member's request is never shown to the owner or an admin just because of their role (the owner never approves a member's mail). */
export function mayHandle(ctx: GateCtx, h: Hold): boolean {
  const me = ctx.principal.id;
  if (isTrustedService(ctx.principal)) return true;
  if (h.principal.id === me || h.actingFor === me || ctx.actingFor === h.principal.id) return true;
  if (h.approver.id === me && (h.approver.kind === "person" || h.approver.kind === "agent")) return true;
  if (h.approver.kind === "role" || h.approver.kind === "group") {
    return !!ctx.authorize && !!h.taskId && ctx.authorize({ perm: null, level: "use" }, { type: "task", id: h.taskId }).effect === "allow";
  }
  return false;
}

// ---- summary line and preview ----

const RECIPIENT_KEYS = ["to", "cc", "bcc", "recipients"];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** One fixed line per hold: the act, the capability and how many people or how much money. Never the words: events, notifications and logs carry this line, and a draft is the requester's words. */
export function summaryLine(a: ActDef, capName: string, input: unknown): string {
  const o = isObj(input) ? input : {};
  let recipients = 0;
  for (const k of RECIPIENT_KEYS) {
    const v = o[k];
    if (Array.isArray(v)) recipients += v.length;
    else if (typeof v === "string" && v.length > 0) recipients += 1;
  }
  const parts = [`${a.title} via ${capName}`];
  if (recipients > 0) parts.push(`to ${recipients} ${recipients === 1 ? "recipient" : "recipients"}`);
  const amount = o.amount;
  if (typeof amount === "number" && Number.isFinite(amount)) parts.push(`for ${amount}${typeof o.currency === "string" ? ` ${o.currency.slice(0, 3).toUpperCase()}` : ""}`);
  return cut(parts.join(" "), 120);
}

/** The exact preview (spec 2.14): the whole input, as the act kind's block, so the approver sees what will go out. */
export function previewBlocks(a: ActDef, capName: string, input: unknown): { type: string; v: number; data: unknown }[] {
  return [{ type: a.block, v: 1, data: { act: a.key, cap: capName, input } }];
}

/** Who approves: the strictest rule names a role or the owner, or the asker (the person the agent works for, else the agent's owner). */
export function approverFor(rule: string, asker: string | undefined): Assignee {
  if (rule === "owner") return { kind: "role", id: "rol_owner" };
  if (rule.startsWith("role:")) return { kind: "role", id: `rol_${rule.slice(5)}` };
  return asker ? { kind: "person", id: asker } : { kind: "role", id: "rol_admin" };
}

export function holdIsExpired(h: Hold, now: number): boolean {
  return h.state === "held" && h.sendingAt === undefined && h.expiresAt <= now;
}
