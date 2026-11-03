// Accounts for a turn (ARCH 6.4, spec 4.14, 2.17). Every turn runs on the asker's own account unless a team key is pinned. Nothing here holds a secret:
// accounts are named by Vault handle (api keys) or by the Mine item of an ai_subscription sign-in.
export type AccountKind = "api_key" | "subscription";
export type AccountStatus = "ok" | "expired" | "failed" | "untested";
export type AccountsPolicy = "any" | "company";
/**
 * What caused the turn, which says which Space AI accounts may pay (owner ruling 9): a person's message (teamChats), a wake-up or a goal's turn (goals), work an agent does with no asker,
 * a routine, a watcher or a helper (agentWork), an automation's step (task: automations).
 */
export type Trigger = "message" | "wake" | "goal" | "routine" | "task";
/** Which rule chose the account that paid: the chat's pick, the agent's Chat key, the agent's own-work account, a step's account, the asker's own, a Space account kept for the work, or a backup. */
export type Via = "thread" | "chat_key" | "work" | "step" | "own" | "space" | "backup" | "other";
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
  /** The standing switch "Let the Space run work on my subscription": others and automations may use it. The owner's own turns never need it. For a shared key: members with Use may run on it. */
  spaceMayUse: boolean;
  /** The Space AI key: one shared API key an owner or admin set for everyone. Any member's turn falls back to it after their own accounts. */
  spaceKey?: boolean;
  /** An older sign-in of the same provider whose account cannot be read, listed under another row. It still pays when a chat, an agent or a fallback names it; it is never picked on its own. */
  older?: boolean;
  /** A Space AI account: what it may pay for. Absent on Mine accounts. */
  uses?: SpaceUses;
  /** teamChats.who covers the person this list is for. */
  teamChatsForMe?: boolean;
  /** This month's spend reached the account's cap: no turn runs on it until the month turns. */
  capped?: boolean;
  /** The models the account's provider lists (its live list, else the list the Vault kept). A Space account fits a turn when this has the turn's model; any account fits an Automatic turn. */
  models?: readonly string[];
  /** Relative price of a turn on this account, lower is cheaper (cost.ts). Among Space accounts that fit, the cheapest pays. */
  cost?: number;
}

/** What a Space AI account may pay for (owner ruling 9). Each use is off unless named. */
export interface SpaceUses {
  /** A member's own chat, and only when they have no account of their own that can pay: everyone, or the people in these groups. */
  teamChats?: { who: "everyone" | readonly string[] };
  /** Automation steps. */
  automations?: true;
  /** Goal turns and wake-ups. */
  goals?: true;
  /** Work an agent does with no asker (routines, watchers, helpers): every agent, or these. */
  agentWork?: { which: "all" | readonly string[] };
}

export interface AgentAccountConfig {
  /** The agent, so a Space account kept for some agents' work (agentWork.which) can tell. */
  agentId?: string;
  /** 'key': use accountKey (a shared team key, usage logged per actor). 'asker': the payer's own account. */
  accountPolicy: "asker" | "key";
  accountKey?: string;
  /** The ordered fallback list from the agent settings: tried in this order after the chat key (or the asker's own accounts), then the Space backups. */
  accountFallback?: readonly string[];
  /** The AI account picked for the agent's own work (routines, watchers, helpers: turns nobody asked for). A Space account pays only when its "Used for" covers this agent's work and it is under its cap. */
  workKey?: string;
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
  /** The model the turn needs; unset is Automatic (each account's default). */
  model?: string;
  /** The person chose the chat's account and its model together: when that account does not serve the model, the turn fails with no_model rather than run anywhere else. */
  modelPinned?: boolean;
  /** The person picked this model for the chat: it is never swapped for another. When no account can serve it the turn says so (Resolution.noModel). */
  modelPicked?: boolean;
  /** Refs a person picked for this kind of work (an automation's AI account and its backup): each is a Space account that pays only when its "Used for" covers the turn. */
  useChecked?: readonly string[];
  /** Refs that already failed during this turn. */
  unavailable?: readonly string[];
  /** The turn runs on the Space host (not the person's own device). A subscription then needs the standing switch, unless it is the payer's own turn. */
  onServer: boolean;
}

export type SkipWhy = "unknown" | "expired" | "failed" | "policy_company" | "not_yours" | "space_may_not_use" | "failed_this_turn" | "capped" | "no_model" | "not_used_for";
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
  /** Which rule chose the account that paid. */
  via?: Via;
  tried: Attempt[];
  /** A card for Needs you. Present when nothing could run, and also when a backup key covered for a broken account of the payer's. */
  unblock?: NeedsYou;
  /** The account the chat, the agent or the automation step is pinned to, and whether it paid; when it did not, why (the turn fell back past it). */
  pin?: Attempt;
  /** A team chat or agent work that no Space account fitting its model could pay: it runs on this account's default model instead, and the chat says so in one line. */
  modelFallback?: true;
  /** The model the person picked is served by no account that can pay, and nothing was swapped for it. `servedModels` is what the accounts that could pay do serve. */
  noModel?: true;
  servedModels?: string[];
}
