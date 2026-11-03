// The "AI account" choice on an automation and on an agent (owner, 3 Nov; prototype/vyre-v1.html "naai" and the Automations settings AI account): Automatic, or one Space AI account by name. Pure:
// the rows the picker offers from providers.list, whether an account is kept for the kind of work, and the plain words for each. The pick is the account's Vault handle; the Vault's own "Used for" and cap
// (space-ai.ts, providers.uses.set) decide whether it can pay, so the picker only shows what is there and never keeps a list of its own.
import type { Uses } from "./space-ai.ts";

/** The kind of work a pick pays for: an automation's AI steps, or what an agent does with nobody asking (routines, watchers, helpers). */
export type Work = "automations" | "agentWork" | "chats";

/** The part of a providers.list row the picker reads. */
export interface PickRow { id: string; name: string; handle?: string; scope: string; state?: string; spaceKey?: boolean; uses?: Uses; capCents?: number | null; capped?: boolean }

export interface AiOption {
  /** The Vault handle to store; empty is Automatic. */
  value: string;
  label: string;
  /** The row is at its monthly cap now: it can still be picked, the work waits on the backup or on the next account that fits. */
  capped?: boolean;
}

/** Every use on: what the Space AI key from before Space accounts pays for. */
const ALL: Uses = { teamChats: { who: "everyone" }, automations: true, goals: true, agentWork: { which: "all" } };

/** The Space AI accounts in a providers.list answer: shared keys, and the old single Space AI key. Rows with no handle cannot be stored, so they are left out. */
export function spaceAccounts(rows: readonly PickRow[]): PickRow[] {
  return rows.filter((r) => (r.scope === "shared" || r.spaceKey === true) && typeof r.handle === "string" && r.handle !== "");
}

/** Is this Space account kept for this work (and for this agent, when the work is an agent's)? */
export function keptFor(row: PickRow, work: Work, agentId?: string): boolean {
  // the Chat key is an explicit override: any Space account that works may be named for chats
  if (work === "chats") return true;
  const u = row.uses ?? (row.spaceKey === true ? ALL : undefined);
  if (!u) return false;
  if (work === "automations") return u.automations === true;
  const which = u.agentWork?.which;
  if (which === undefined) return false;
  return which === "all" || which.length === 0 || (agentId !== undefined && which.includes(agentId));
}

const WHAT: Readonly<Record<Work, string>> = { automations: "automations", agentWork: "this agent's own work", chats: "chats" };

/** Automatic first, then each Space account that works and is kept for the work (its cap says how far it goes). An account the resolver would refuse is not offered. */
export function aiOptions(rows: readonly PickRow[], work: Work, agentId?: string): AiOption[] {
  const out: AiOption[] = [{ value: "", label: "Automatic" }];
  for (const r of spaceAccounts(rows)) {
    if ((r.state !== undefined && r.state !== "ok") || !keptFor(r, work, agentId)) continue;
    const cap = typeof r.capCents === "number" ? ` (up to $${Math.round(r.capCents / 100)} a month)` : "";
    out.push({ value: r.handle!, label: `${r.name}${cap}`, ...(r.capped === true ? { capped: true } : {}) });
  }
  return out;
}

/** The one plain line when no Space account is kept for the work. */
export const noAccountLine = (work: Work): string => `No Space AI account is kept for ${WHAT[work]} yet. An admin sets one in the Vault, under AI accounts.`;

/** The name to show for a stored handle: the account's name, else the handle as written (an account that has since gone). */
export function aiName(rows: readonly PickRow[], handle: string | undefined): string {
  if (!handle) return "Automatic";
  return rows.find((r) => r.handle === handle || r.id === handle)?.name ?? handle;
}

/** The cheapest-that-fits line under Automatic: which Space accounts it would use today, by name. */
export function automaticLine(rows: readonly PickRow[], work: Work, agentId?: string): string {
  const names = spaceAccounts(rows).filter((r) => r.state === undefined || r.state === "ok").filter((r) => keptFor(r, work, agentId) && r.capped !== true).map((r) => r.name);
  if (names.length === 0) return noAccountLine(work);
  return `Today: ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`}.`;
}

/** The small caption beside a choice: Automatic is the cheapest that fits, an account is a Space AI account, a capped one says so. */
export function aiCaption(handle: string | undefined, rows: readonly PickRow[]): string {
  if (!handle) return "Cheapest that fits";
  const r = rows.find((x) => x.handle === handle || x.id === handle);
  return r?.capped === true ? "Space AI account, at its monthly cap" : "Space AI account";
}
