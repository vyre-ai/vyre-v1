// resolveAccount (ARCH 6.4). Who pays: the steerer for the turn their message causes, the starter for everything else (wake-ups included), a routine's setter for a routine.
// Which account (owner ruling 9, Space AI accounts):
//   a pin first: the chat's account, the agent's key, an automation step's key. A pin that cannot pay is passed over with its reason (Resolution.pin).
//   a person's message or a wake of their chat: their own accounts, then the Space accounts kept for team chats (teamChats is only for someone with no own account that can pay), or for goals.
//   an automation step, a goal's turn, or work an agent does with no asker: the Space accounts kept for that (automations, goals, agentWork), then the person's own (a sign-in only with the switch on;
//   an automation step that names a key keeps to it, the Space accounts and its backup).
//   then the agent's own fallback list and the Space's backups.
// Among Space accounts, one fits when its provider lists the turn's model (any fits an Automatic turn), capped ones are passed over, and the cheapest pays (cost.ts). When none that fits can pay a
// team chat or agent work, the cheapest that covers it runs on its own default model (modelFallback) and the chat says so; only a chat whose person pinned the account and the model together fails.
// DECISION: a person's own sign-in always answers their own turns, wherever they run (owner ruling, member keys on the server); "Let the Space run work on my subscription" is only for others and automations.
import { sameProviderFamily } from "./provider.ts";
import type { AccountRow, Attempt, NeedsYou, ResolveReason, ResolveRequest, Resolution, SkipWhy, SpaceUses, Trigger } from "./types.ts";

interface Candidate { ref: string; reason: ResolveReason; pin?: true; space?: true; strict?: true; use?: true }

function payerOf(req: ResolveRequest): { payer: string; reason: "starter" | "steerer" } {
  if (req.trigger === "routine" && req.routineOwner) return { payer: req.routineOwner, reason: "starter" };
  if (req.trigger === "message" && req.steerer && req.steerer !== req.starter) return { payer: req.steerer, reason: "steerer" };
  return { payer: req.starter, reason: "starter" };
}

/** A turn the account's owner asked for themselves: their message, or a wake of their own chat. A routine, a goal or an automation's step is not (a sign-in needs the standing switch for those). */
const ownTurn = (row: AccountRow, req: ResolveRequest, payer: string): boolean => row.mine && row.ownerId === payer && (req.trigger === "message" || req.trigger === "wake");

type Use = keyof SpaceUses;
const USE: Readonly<Record<Trigger, Use>> = { message: "teamChats", wake: "goals", goal: "goals", routine: "agentWork", task: "automations" };

/** Every use on: what the Space AI key paid for before Space accounts (owner, 3 Nov: nothing that ran on it stops). */
const ALL_USES: SpaceUses = { teamChats: { who: "everyone" }, automations: true, goals: true, agentWork: { which: "all" } };

/** The uses of a Space account. The Space AI key from before Space accounts has every use on. */
function usesOf(a: AccountRow): SpaceUses | undefined {
  if (a.mine) return undefined;
  return a.uses ?? (a.spaceKey === true ? ALL_USES : undefined);
}

/** May this Space account pay for this kind of turn, for this person and this agent? */
function covers(a: AccountRow, req: ResolveRequest): boolean {
  const u = usesOf(a);
  if (!u || a.older === true) return false;
  switch (USE[req.trigger]) {
    case "teamChats": return u.teamChats !== undefined && (a.teamChatsForMe ?? (a.spaceKey === true || u.teamChats.who === "everyone"));
    case "automations": return u.automations === true;
    case "goals": return u.goals === true;
    case "agentWork": {
      const which = u.agentWork?.which;
      return which === "all" || (which !== undefined && req.agent.agentId !== undefined && which.includes(req.agent.agentId));
    }
  }
}

/** A Space account fits when its provider lists the model the turn needs; an Automatic turn runs on the account's default. */
const fits = (a: AccountRow, req: ResolveRequest): boolean => req.model === undefined || req.model === "" || (a.models ?? []).includes(req.model);
/** Uses whose turns run on an account's default model when nothing that fits can pay (owner, 3 Nov): a team chat and agent work, and a wake of a chat. Goals and automations keep to their model. */
const SUBSTITUTES: ReadonlySet<Use> = new Set<Use>(["teamChats", "agentWork"]);

/** Why this row cannot pay for this turn, or null when it can. */
export function skipReason(row: AccountRow | undefined, req: ResolveRequest, payer: string, how: { space?: boolean; strict?: boolean; use?: boolean } = {}): SkipWhy | null {
  if (!row) return "unknown";
  if (req.unavailable?.includes(row.ref)) return "failed_this_turn";
  if (req.policy === "company" && (row.mine || row.kind === "subscription")) return "policy_company";
  if (row.mine && row.ownerId !== payer) return "not_yours";
  if (row.kind === "subscription" && req.onServer && !row.spaceMayUse && !ownTurn(row, req, payer)) return "space_may_not_use";
  if (row.status === "expired") return "expired";
  if (row.status === "failed") return "failed";
  // a pick made for this kind of work (an agent's own work, an automation's AI account): a Space account pays only for what its "Used for" says
  if (how.use === true && !row.mine && !covers(row, req)) return "not_used_for";
  if (row.capped === true) return "capped";
  if (how.space === true && !fits(row, req)) return "no_model";
  // the chat's own account and model, chosen together: a list that says it does not serve the model is final
  if (how.strict === true && (row.models?.length ?? 0) > 0 && !fits(row, req)) return "no_model";
  return null;
}

function candidates(req: ResolveRequest, payerReason: "starter" | "steerer", payer: string): Candidate[] {
  const out: Candidate[] = [];
  // the fallbacks someone configured (the agent's ordered list, the Space's backups) keep that reason wherever they land in the order, so moving on to one never stops to ask (switch-on-limit.ts)
  const configured = new Set<string>([...(req.trigger !== "task" ? req.agent.accountFallback ?? [] : []), ...req.backupRefs]);
  const add = (ref: string | undefined, reason: ResolveReason, o: { pin?: true; space?: true; use?: true } = {}): void => {
    if (ref !== undefined && ref !== "" && !out.some((c) => c.ref === ref)) out.push({ ref, reason: configured.has(ref) && o.pin !== true ? "backup_key" : reason, ...o });
  };
  const own = (): void => {
    // the payer's own accounts: subscription sign-ins before keys (already paid for); an older sign-in listed under another row of the provider is not picked on its own
    const mine = req.accounts.filter((a) => a.mine && a.ownerId === payer && a.older !== true && (req.agent.provider === undefined || sameProviderFamily(a.provider, req.agent.provider)));
    for (const a of [...mine.filter((a) => a.kind === "subscription"), ...mine.filter((a) => a.kind === "api_key")]) add(a.ref, payerReason);
  };
  const space = (): void => {
    const kept = req.accounts.map((a, i) => ({ a, i })).filter(({ a }) => covers(a, req));
    kept.sort((x, y) => (x.a.cost ?? 3) - (y.a.cost ?? 3) || x.i - y.i);
    for (const { a } of kept) add(a.ref, payerReason, { space: true });
  };
  if (req.trigger === "task") {
    add(req.stepKey, "step_key", { pin: true });
    if (req.agent.accountPolicy === "key") add(req.agent.accountKey, payerReason, { pin: true });
    space();
    // a step that names no key is the person's own Run: their own accounts after the Space's; a step with a key keeps to it, the Space's and its backup
    if (req.stepKey === undefined && req.agent.accountPolicy !== "key") own();
  } else {
    add(req.threadAccountRef, payerReason, req.modelPinned === true ? { pin: true, strict: true } : { pin: true });
    // the AI account picked for the agent's own work (routines, watchers, helpers): before its chat key, and only a Space account that is kept for this agent's work
    if (req.trigger === "routine") add(req.agent.workKey, payerReason, { pin: true, use: true });
    if (req.agent.accountPolicy === "key") {
      add(req.agent.accountKey, payerReason, { pin: true });
      // an agent pinned to a key goes on down its own ordered fallback list, as configured, before anything else
      for (const f of req.agent.accountFallback ?? []) add(f, "backup_key");
    }
    const chat = req.trigger === "message" || req.trigger === "wake";
    if (chat) { if (req.agent.accountPolicy !== "key") own(); space(); }
    else { space(); if (req.agent.accountPolicy !== "key") own(); }
  }
  // The agent's own ordered fallback list comes before the Space's backups; a task keeps to its step key, the Space accounts and the Space backups.
  if (req.trigger !== "task") for (const f of req.agent.accountFallback ?? []) add(f, "backup_key");
  for (const b of req.backupRefs) add(b, "backup_key");
  return out;
}

const NEXT: Record<"reconnect" | "open_settings" | "use_backup_key", string> = { reconnect: "Sign in again", open_settings: "Open AI settings", use_backup_key: "Use the backup key" };

export function resolveAccount(req: ResolveRequest): Resolution {
  const { payer, reason: payerReason } = payerOf(req);
  const byRef = new Map(req.accounts.map((a) => [a.ref, a] as const));
  const tried: Attempt[] = [];
  let broken: { ref: string; why: "expired" | "failed" } | null = null;
  let policyBlocked = false;
  let pin: Attempt | undefined;
  const misfits: Candidate[] = [];
  const owner = req.trigger === "routine" && req.routineOwner ? req.routineOwner : req.starter;

  for (const c of candidates(req, payerReason, payer)) {
    const row = byRef.get(c.ref);
    const why = skipReason(row, req, payer, { ...(c.space ? { space: true } : {}), ...(c.strict ? { strict: true } : {}), ...(c.use === true || req.useChecked?.includes(c.ref) ? { use: true } : {}) });
    if (why !== null) {
      const at: Attempt = { ref: c.ref, used: false, why };
      tried.push(at);
      if (c.pin && pin === undefined) pin = at;
      // the person chose this account and this model together: it does not serve the model, so nothing else runs the chat
      if (c.strict && why === "no_model") return { accountRef: null, payer: null, reason: "none", allowed: false, tried, unblock: needs(owner, c.ref, "no_account", false), pin: at };
      if (c.space && why === "no_model") misfits.push(c);
      if (why === "policy_company") policyBlocked = true;
      // A payer's own account that is signed out or failing is theirs to fix.
      if ((why === "expired" || why === "failed") && row && row.mine && row.ownerId === payer && broken === null) broken = { ref: c.ref, why };
      continue;
    }
    tried.push({ ref: c.ref, used: true });
    if (c.pin && pin === undefined) pin = { ref: c.ref, used: true };
    const res: Resolution = { accountRef: c.ref, payer, reason: c.reason, allowed: true, tried, ...(pin ? { pin } : {}) };
    if (broken) res.unblock = needs(payer, broken.ref, broken.why, true);
    return res;
  }

  // a team chat or agent work: the cheapest Space account that covers it runs it on its own default model
  const swap = SUBSTITUTES.has(USE[req.trigger]) || req.trigger === "wake" ? misfits[0] : undefined;
  if (swap) {
    tried.push({ ref: swap.ref, used: true });
    const res: Resolution = { accountRef: swap.ref, payer, reason: swap.reason, allowed: true, tried, modelFallback: true, ...(pin ? { pin } : {}) };
    if (broken) res.unblock = needs(payer, broken.ref, broken.why, true);
    return res;
  }
  const why = broken?.why ?? (policyBlocked ? "policy" : "no_account");
  return { accountRef: null, payer: null, reason: "none", allowed: false, tried, unblock: needs(owner, broken?.ref ?? null, why, false), ...(pin ? { pin } : {}) };
}

function needs(to: string, ref: string | null, why: NeedsYou["why"], covered: boolean): NeedsYou {
  const next: NeedsYou["next"] = [];
  if (why === "expired") next.push({ kind: "reconnect", label: NEXT.reconnect });
  else next.push({ kind: "open_settings", label: NEXT.open_settings });
  if (covered) next.push({ kind: "use_backup_key", label: NEXT.use_backup_key });
  return { to, kind: "unblock", ref, why, next };
}
