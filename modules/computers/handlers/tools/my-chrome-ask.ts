// Did the person ask for their own Chrome in this turn? An agent works in the person's real Chrome only when they say so: "in my Chrome", "on my computer", or the "Use my Chrome" choice (which
// the chat posts as the person's own line, "Answered: Use my Chrome"). The ask is read from the thread, not from what the agent claims: the newest line written by the person the agent works for.
// An older ask does not carry over to a later line that does not repeat it, and a negated one ("not in my Chrome") is no ask.
import type { CompCtx } from "../../projections.ts";

const ASK: readonly RegExp[] = [
  /\bmy\s+(?:own\s+|real\s+|personal\s+|actual\s+|regular\s+)?chrome\b/gi,
  /\b(?:in|on|with|using|through|via)\s+my\s+(?:own\s+|real\s+|personal\s+)?browser\b/gi,
  /\bon\s+my\s+(?:own\s+)?(?:computer|mac|laptop|pc|machine|desktop)\b/gi,
  /\bmy\s+open\s+tabs?\b/gi,
  /\bthe\s+tab\s+i\s+(?:have|already\s+have)\s+open\b/gi,
];
const NO = /(?:\b(?:don'?t|do\s+not|dont|never|not|without|no\s+need\s+(?:to|for)|instead\s+of|rather\s+than|stay\s+out\s+of|leave)\b[^.!?\n]{0,25})$/i;

/** Does this line ask for the person's own Chrome? */
export function saidMyChrome(text: string): boolean {
  for (const re of ASK) {
    for (const m of text.matchAll(re)) {
      const before = text.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
      if (!NO.test(before)) return true;
    }
  }
  return false;
}

interface Line { author?: { kind?: string; id?: string }; body?: string; threadSeq?: number }

/** The person asked in the turn this call belongs to. False when there is no chat to read, nobody to ask for, or the newest line from the person does not ask. */
export async function askedThisTurn(ctx: Pick<CompCtx, "call" | "thread" | "actingFor">): Promise<boolean> {
  if (!ctx.thread || !ctx.actingFor) return false;
  try {
    const page = (await ctx.call("chat.messages.list", { threadId: ctx.thread, limit: 12 })) as { messages?: Line[] };
    const mine = (page.messages ?? []).filter((m) => m.author?.kind === "person" && m.author.id === ctx.actingFor);
    const last = mine.reduce<Line | undefined>((a, m) => (a === undefined || (m.threadSeq ?? 0) >= (a.threadSeq ?? 0) ? m : a), undefined);
    return last !== undefined && saidMyChrome(String(last.body ?? ""));
  } catch {
    return false;
  }
}
