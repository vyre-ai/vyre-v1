// resolveAccount (ARCH 6.4). Who pays: the steerer for the turn their message causes, the starter for everything else (wake-ups included), a routine's setter for a routine.
// Which account: the thread pin, the agent's team key, the payer's own, then the backups. A task uses the step key, then a backup, else it waits in Needs you.
import type { AccountRow, Attempt, NeedsYou, ResolveReason, ResolveRequest, Resolution, SkipWhy } from "./types.ts";

interface Candidate { ref: string; reason: ResolveReason }

function payerOf(req: ResolveRequest): { payer: string; reason: "starter" | "steerer" } {
  if (req.trigger === "routine" && req.routineOwner) return { payer: req.routineOwner, reason: "starter" };
  if (req.trigger === "message" && req.steerer && req.steerer !== req.starter) return { payer: req.steerer, reason: "steerer" };
  return { payer: req.starter, reason: "starter" };
}

const usable = (a: AccountRow): boolean => a.status === "ok" || a.status === "untested";

/** Why this row cannot pay for this turn, or null when it can. */
export function skipReason(row: AccountRow | undefined, req: ResolveRequest, payer: string): SkipWhy | null {
  if (!row) return "unknown";
  if (req.unavailable?.includes(row.ref)) return "failed_this_turn";
  if (req.policy === "company" && (row.mine || row.kind === "subscription")) return "policy_company";
  if (row.mine && row.ownerId !== payer) return "not_yours";
  if (row.kind === "subscription" && req.onServer && !row.spaceMayUse) return "space_may_not_use";
  if (row.status === "expired") return "expired";
  if (row.status === "failed") return "failed";
  return null;
}

function candidates(req: ResolveRequest, payerReason: "starter" | "steerer", payer: string): Candidate[] {
  const out: Candidate[] = [];
  const add = (ref: string | undefined, reason: ResolveReason): void => {
    if (ref !== undefined && ref !== "" && !out.some((c) => c.ref === ref)) out.push({ ref, reason });
  };
  if (req.trigger === "task") {
    add(req.stepKey, "step_key");
  } else {
    add(req.threadAccountRef, payerReason);
    if (req.agent.accountPolicy === "key") add(req.agent.accountKey, payerReason);
    else {
      // The payer's own accounts: subscription sign-ins before keys (already paid for). A shared key is used only when the agent points at it, the thread pins it, or it is a backup.
      const own = req.accounts.filter((a) => a.mine && a.ownerId === payer && (req.agent.provider === undefined || a.provider === req.agent.provider));
      for (const a of [...own.filter((a) => a.kind === "subscription"), ...own.filter((a) => a.kind === "api_key")]) add(a.ref, payerReason);
    }
  }
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

  for (const c of candidates(req, payerReason, payer)) {
    const row = byRef.get(c.ref);
    const why = skipReason(row, req, payer);
    if (why !== null) {
      tried.push({ ref: c.ref, used: false, why });
      if (why === "policy_company") policyBlocked = true;
      // A payer's own account that is signed out or failing is theirs to fix.
      if ((why === "expired" || why === "failed") && row && row.mine && row.ownerId === payer && broken === null) broken = { ref: c.ref, why };
      continue;
    }
    tried.push({ ref: c.ref, used: true });
    const res: Resolution = { accountRef: c.ref, payer, reason: c.reason, allowed: true, tried };
    if (broken) res.unblock = needs(payer, broken.ref, broken.why, true);
    return res;
  }

  const owner = req.trigger === "routine" && req.routineOwner ? req.routineOwner : req.starter;
  const why = broken?.why ?? (policyBlocked ? "policy" : "no_account");
  return { accountRef: null, payer: null, reason: "none", allowed: false, tried, unblock: needs(owner, broken?.ref ?? null, why, false) };
}

function needs(to: string, ref: string | null, why: NeedsYou["why"], covered: boolean): NeedsYou {
  const next: NeedsYou["next"] = [];
  if (why === "expired") next.push({ kind: "reconnect", label: NEXT.reconnect });
  else next.push({ kind: "open_settings", label: NEXT.open_settings });
  if (covered) next.push({ kind: "use_backup_key", label: NEXT.use_backup_key });
  return { to, kind: "unblock", ref, why, next };
}
