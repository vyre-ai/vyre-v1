// resolveAccount (ARCH 6.4). Who pays: the steerer for the turn their message causes, the starter for everything else (wake-ups included), a routine's setter for a routine.
// Which account (owner ruling 9, Space AI accounts):
//   a pin first: the chat's account, the agent's key, an automation step's key. A pin that cannot pay is passed over with its reason (Resolution.pin).
//   a person's message or a wake of their chat: their own accounts, then the Space accounts kept for team chats (teamChats is only for someone with no own account that can pay), or for goals.
//   an automation step, a goal's turn, or work an agent does with no asker: the Space accounts kept for that (automations, goals, agentWork), then the person's own (a sign-in only with the switch on;
//   an automation step that names a key keeps to it, the Space accounts and its backup).
//   then the agent's own fallback list and the Space's backups.
// Among Space accounts, one fits when its provider lists the turn's model (any fits an Automatic turn), capped ones are passed over, and the cheapest pays (cost.ts).
// DECISION: a person's own sign-in always answers their own turns, wherever they run (owner ruling, member keys on the server); "Let the Space run work on my subscription" is only for others and automations.
import { sameProviderFamily } from "./provider.ts";
import type { AccountRow, Attempt, NeedsYou, ResolveReason, ResolveRequest, Resolution, SkipWhy, SpaceUses, Trigger } from "./types.ts";

interface Candidate { ref: string; reason: ResolveReason; pin?: true; space?: true }

function payerOf(req: ResolveRequest): { payer: string; reason: "starter" | "steerer" } {
  if (req.trigger === "routine" && req.routineOwner) return { payer: req.routineOwner, reason: "starter" };
  if (req.trigger === "message" && req.steerer && req.steerer !== req.starter) return { payer: req.steerer, reason: "steerer" };
  return { payer: req.starter, reason: "starter" };
}

/** A turn the account's owner asked for themselves: their message, or a wake of their own chat. A routine, a goal or an automation's step is not (a sign-in needs the standing switch for those). */
const ownTurn = (row: AccountRow, req: ResolveRequest, payer: string): boolean => row.mine && row.ownerId === payer && (req.trigger === "message" || req.trigger === "wake");

type Use = keyof SpaceUses;
const USE: Readonly<Record<Trigger, Use>> = { message: "teamChats", wake: "goals", goal: "goals", routine: "agentWork", task: "automations" };

/** The uses of a Space account. The Space AI key from before Space accounts reads as kept for team chats, for everyone. */
function usesOf(a: AccountRow): SpaceUses | undefined {
  if (a.mine) return undefined;
  return a.uses ?? (a.spaceKey === true ? { teamChats: { who: "everyone" } } : undefined);
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

/** Why this row cannot pay for this turn, or null when it can. */
export function skipReason(row: AccountRow | undefined, req: ResolveRequest, payer: string, how: { space?: boolean } = {}): SkipWhy | null {
  if (!row) return "unknown";
  if (req.unavailable?.includes(row.ref)) return "failed_this_turn";
  if (req.policy === "company" && (row.mine || row.kind === "subscription")) return "policy_company";
  if (row.mine && row.ownerId !== payer) return "not_yours";
  if (row.kind === "subscription" && req.onServer && !row.spaceMayUse && !ownTurn(row, req, payer)) return "space_may_not_use";
  if (row.status === "expired") return "expired";
  if (row.status === "failed") return "failed";
  if (row.capped === true) return "capped";
  if (how.space === true && !fits(row, req)) return "no_model";
  return null;
}

function candidates(req: ResolveRequest, payerReason: "starter" | "steerer", payer: string): Candidate[] {
  const out: Candidate[] = [];
  const add = (ref: string | undefined, reason: ResolveReason, o: { pin?: true; space?: true } = {}): void => {
    if (ref !== undefined && ref !== "" && !out.some((c) => c.ref === ref)) out.push({ ref, reason, ...o });
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
    add(req.threadAccountRef, payerReason, { pin: true });
    if (req.agent.accountPolicy === "key") add(req.agent.accountKey, payerReason, { pin: true });
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

  for (const c of candidates(req, payerReason, payer)) {
    const row = byRef.get(c.ref);
    const why = skipReason(row, req, payer, c.space ? { space: true } : {});
    if (why !== null) {
      const at: Attempt = { ref: c.ref, used: false, why };
      tried.push(at);
      if (c.pin && pin === undefined) pin = at;
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

  const owner = req.trigger === "routine" && req.routineOwner ? req.routineOwner : req.starter;
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
