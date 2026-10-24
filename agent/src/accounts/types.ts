// Accounts for a turn (ARCH 6.4, spec 4.14, 2.17). Every turn runs on the asker's own account unless a team key is pinned. Nothing here holds a secret:
// accounts are named by Vault handle (api keys) or by the Mine item of an ai_subscription sign-in.
export type AccountKind = "api_key" | "subscription";
export type AccountStatus = "ok" | "expired" | "failed" | "untested";
export type AccountsPolicy = "any" | "company";
export type Trigger = "message" | "wake" | "routine" | "task";
export type ResolveReason = "starter" | "steerer" | "step_key" | "backup_key" | "none";

export interface AccountRow {
  /** Vault handle, like #Team_Anthropic_Key. */
  ref: string;
  driver: string;
  /** Provider key, like anthropic. */
  provider: string;
  kind: AccountKind;
  title: string;
  /** A personal account (Mine). Company accounts are shared through the Vault. */
  mine: boolean;
  ownerId: string | null;
  status: AccountStatus;
  lastProbeAt: number | null;
  /** The standing switch "Let the Space run work on my subscription" (subscriptions only). */
  spaceMayUse: boolean;
}

export interface AgentAccountConfig {
  /** 'key': use accountKey (a shared team key, usage logged per actor). 'asker': the payer's own account. */
  accountPolicy: "asker" | "key";
  accountKey?: string;
  /** Provider the agent's model needs, when known. Unset means any. */
  provider?: string;
}

export interface ResolveRequest {
  /** The person who started the thread. Background wake-ups run on their account. */
  starter: string;
  /** The person whose message caused this turn, when it is not a wake or a routine. Anyone who steers pays for their own turns. */
  steerer?: string;
  trigger: Trigger;
  /** Routines act for their setter. */
  routineOwner?: string;
  /** Account pinned for this agent in this thread (engine.set_model). */
  threadAccountRef?: string;
  agent: AgentAccountConfig;
  /** Tasks and Journey agent tasks: the key chosen on the step. */
  stepKey?: string;
  /** Backup keys, best first: the step's backup, then the Space's fallback order. */
  backupRefs: readonly string[];
  policy: AccountsPolicy;
  /** The accounts the paying person can see: their own (Mine) plus the shared ones. */
  accounts: readonly AccountRow[];
  /** Refs that already failed during this turn. */
  unavailable?: readonly string[];
  /** The turn runs on the Space host (not the person's own device). Subscriptions then need the standing switch. */
  onServer: boolean;
}

export type SkipWhy = "unknown" | "expired" | "failed" | "policy_company" | "not_yours" | "space_may_not_use" | "failed_this_turn";
export interface Attempt { ref: string; used: boolean; why?: SkipWhy }

export interface NeedsYou {
  /** Whose Needs you gets the card. */
  to: string;
  kind: "unblock";
  /** The account that is the problem, when there is one. */
  ref: string | null;
  why: "expired" | "failed" | "no_account" | "policy";
  next: Array<{ kind: "reconnect" | "open_settings" | "use_backup_key"; label: string }>;
}

export interface Resolution {
  accountRef: string | null;
  payer: string | null;
  reason: ResolveReason;
  /** True when a usable account was found: the turn can run. */
  allowed: boolean;
  tried: Attempt[];
  /** A card for Needs you. Present when nothing could run, and also when a backup key covered for a broken account of the payer's. */
  unblock?: NeedsYou;
}
