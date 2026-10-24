// Grants in the v1 shape (ARCH 4.5.1): `level` (view < use < edit < manage) over a `ResourceRef`, replacing 0.6's `actions[]` over a urn Selector.
// Lifecycle, delegation containment, source, issuer and status are kept from 0.6 kernel/grants/index.js.

export const LEVELS = ["view", "use", "edit", "manage"] as const;
export type Level = (typeof LEVELS)[number];
export const levelRank = (l: Level): number => LEVELS.indexOf(l);

/** `{ type: 'project', id: 'prj_...' }`. A resource is walked up `parent_id` by the access projection; the store takes that walk as a function. */
export interface ResourceRef { type: string; id: string }

export type Subject = { kind: "principal"; id: string } | { kind: "role"; id: string } | { kind: "group"; id: string };

/** What narrows a grant. `rowFilter` is an Expr over `owner`, `label` and record fields; `hiddenFields` names fields the holder cannot read. */
export interface Conditions {
  rowFilter?: unknown;
  hiddenFields?: string[];
  /** Hosts or addresses a link grant is good for. */
  audience?: string[];
}

export type GrantStatus = "active" | "revoked";
export type GrantEffective = "active" | "revoked" | "expired" | "parent_revoked" | "parent_expired";

export interface Grant {
  id: string;
  space: string;
  subject: Subject;
  resource: ResourceRef;
  level: Level;
  conditions: Conditions;
  /** Who gave it. */
  issuer: { kind: "person" | "agent" | "service" | "system"; id: string };
  /** 'direct' | 'role:<id>' | 'link' | 'invite' | 'task:<id>' ... */
  source: string;
  /** A delegated grant stays structurally inside its parent. */
  parent?: string;
  status: GrantStatus;
  created_at: number;
  expires_at?: number;
  revoked_at?: number;
  reason?: string;
}

export interface GrantInput {
  subject: Subject;
  resource: ResourceRef;
  level: Level;
  conditions?: Conditions;
  source: string;
  parent?: string;
  expires_at?: number;
}
