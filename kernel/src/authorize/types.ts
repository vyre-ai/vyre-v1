// Authorize types (ARCH 4.5, 4.5.1). The 0.6 shapes live on only as the deliberate changes in the 4.5.1 table: effect 'ask' is 'hold', the decision is synchronous, a grant has a level and no action list.
export type Level = "view" | "use" | "edit" | "manage";
export const LEVEL_RANK: Readonly<Record<Level, number>> = Object.freeze({ view: 1, use: 2, edit: 3, manage: 4 });
export const rankOf = (l: Level): number => LEVEL_RANK[l];
export const LEVEL_BY_RANK: readonly Level[] = Object.freeze(["view", "view", "use", "edit", "manage"] as Level[]);

/** 0.6 codes kept (4.5.1), plus the five the v1 rules add, plus `agent_needs_actor` for an agent call with nobody to act for. */
export type ReasonCode =
  | "ok" | "no_grant" | "expired" | "wrong_space" | "needs_approval" | "limit" | "not_a_member" | "revoked" | "unknown_action" | "bad_input" | "not_found" | "not_contained"
  | "role_lacks_permission" | "above_clearance" | "on_hold" | "suspended" | "provider_label" | "agent_needs_actor";

export type PrincipalKind = "person" | "agent" | "svc";
export interface PrincipalRow { id: string; kind: PrincipalKind; owner?: string | null; status: "active" | "suspended" | "removed"; name?: string }
export interface RoleRow { id: string; clearance: number; perms: readonly string[]; name?: string; assignableToAgents?: boolean }
export interface GroupMemberRow { group: string; member: string }
/** `holder` is a person, an agent, a svc or a group id. */
export interface PrincipalRoleRow { holder: string; role: string }

/** Row-filter expressions: the subset that compiles to SQL (ARCH 4.5 "Scope compilation"). */
export type Expr =
  | { op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte"; field: string; value: string | number | boolean | null }
  | { op: "in"; field: string; values: readonly (string | number)[] }
  | { op: "owner_me" }
  | { op: "and" | "or"; args: readonly Expr[] };

export interface Conditions {
  rowFilter?: Expr | undefined;
  hiddenFields?: readonly string[] | undefined;
  notBefore?: number | undefined;
  notAfter?: number | undefined;
}
export type SubjectKind = "actor" | "role" | "group";
/** No `effect` column: there are no explicit deny grants (ARCH 4.5). `resource_id` null means type-wide. */
export interface GrantRow {
  id: string; subject_kind: SubjectKind; subject_id: string; resource_type: string; resource_id: string | null;
  level: Level; conditions?: Conditions | undefined; expires_at?: number | null | undefined; by?: string | undefined;
}
export interface ResourceRow { id: string; type: string; parent_id: string | null; label: number; owner_id: string | null; holds: number }

export type Policy =
  | { key: string; kind: "provider_label"; allow: Readonly<Record<string, number>>; defaultMax?: number | undefined }
  | { key: string; kind: "spend"; meter: string; limitMicros: number; principalKinds?: readonly PrincipalKind[] | undefined }
  | { key: string; kind: "gate"; act: string; approver: string; caps: readonly string[]; humanToo?: boolean | undefined; checker_must_be_person?: boolean | undefined };

export interface ResourceRef { type: string; id: string | null; /** for create: the container the new thing goes into */ parent?: string | undefined }
export type RowCtx = Readonly<Record<string, unknown>>;

export interface Req {
  principal: string;
  actingFor?: string | undefined;
  action: { perm: string | null; level: Level; destructive?: boolean | undefined };
  resource: ResourceRef;
  fields?: readonly string[] | undefined;
  row?: RowCtx | undefined;
  provider?: string | undefined;
  cap?: string | undefined;
  input?: unknown;
  /** spend so far plus this call, in micros, for the spend meters; the gateway reads it from the meter */
  spendMicros?: Readonly<Record<string, number>> | undefined;
  /** the gateway verified an approval token for this exact payload hash; a Gate then lets the call through */
  approved?: boolean | undefined;
  /** build the plain-words trace for the Access checker (a deny always carries its failing step) */
  explain?: boolean | undefined;
  now: number;
}

export interface Step { ok: boolean; text: string }
export interface Scope { level: Level; rowFilter: Expr | null; hiddenFields: readonly string[]; labelCeiling: number }
export type Obligation =
  | { type: "gate"; act: string; approver: string; checker_must_be_person: boolean }
  | { type: "spend"; meter: string }
  | { type: "audit"; class: string };

export interface Decision {
  readonly effect: "allow" | "deny" | "hold";
  readonly reason: ReasonCode;
  readonly steps: readonly Step[];
  readonly scope: Scope | undefined;
  readonly obligations: readonly Obligation[];
  /** `dec_<uuid>`, minted on first read so the hot path allocates no id it never uses */
  readonly decisionId: string;
}
