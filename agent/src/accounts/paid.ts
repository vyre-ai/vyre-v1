// Who paid, in a few words for a turn's Details ("Paid by": the account's name, then in grey whose it is). Written from the resolver's decision when the turn ends, and read back from the stored turn.
// The stored reason code (ResolvedAccount.reason and via) is unchanged; only these words are.
import type { AccountKind, Via } from "./types.ts";

export interface PaidBy { name?: string; via?: Via | "own" | "other"; kind: AccountKind; shared?: boolean; spaceKey?: boolean; fellBack?: boolean; cappedFrom?: string; agentName?: string }

/** Whose account it is, in a few words. */
export function ownerWords(a: PaidBy): string {
  if (a.cappedFrom) return `Backup after ${a.cappedFrom} hit its cap`;
  if (a.via === "chat_key") return `${a.agentName ? `${a.agentName}'s` : "The agent's"} own account`;
  if (a.shared === true || a.spaceKey === true || a.via === "space") return a.via === "backup" ? "Space backup account" : "Space account";
  if (a.via === "backup") return "your backup account";
  return a.kind === "subscription" ? "your sign-in" : "your key";
}

/** "OpenCode Go · Space account", "Claude Code · your sign-in". With no name known (an older turn) only the owner words. */
export function payLine(a: PaidBy): string {
  const who = ownerWords(a);
  return a.name ? `${a.name} \u00b7 ${who}` : who;
}

/** The two halves of a stored line, for a screen that draws the name and the owner words apart. A line from before this wording has no separator: the screen shows the account by its own name. */
export function splitPaid(line: string): { name: string; who: string } | null {
  const i = line.indexOf(" \u00b7 ");
  return i < 0 ? null : { name: line.slice(0, i), who: line.slice(i + 3) };
}
