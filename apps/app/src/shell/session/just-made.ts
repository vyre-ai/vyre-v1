// A chat this person started a moment ago may not be readable for a moment: the row is written, the read answers "not found" until it lands. That is not a refusal. The session notes every chat.start it
// sends (the one place all of them pass), and a place that is about to say "You can't open this chat" asks here first: a chat made in the last 30 s shows the quiet loading mark and reads again instead.
// (Lane f-newchat's optimistic new-chat view: its PendingChat must not resolve into Conversation's refusal; Conversation already defers to this list for the id the pending view is waiting on.)
export const JUST_MADE_MS = 30_000;
const made = new Map<string, number>();

/** Notes a chat or ask thread this person just started. */
export function noteMade(threadId: string, now: number = Date.now()): void {
  made.set(threadId, now);
  for (const [id, at] of made) if (now - at > JUST_MADE_MS) made.delete(id);
}

/** Was this thread started by this person within the last 30 s? */
export function isJustMade(threadId: string, now: number = Date.now()): boolean {
  const at = made.get(threadId);
  return at !== undefined && now - at <= JUST_MADE_MS;
}

/** The capabilities whose answer is a thread this person has just made: a chat or an ask, a channel (its main thread), and a helper's thread. */
export const MAKES_A_THREAD: readonly string[] = ["chat.start", "channels.create", "chat.helper.start"];

/** What the answer of one of those names: the thread of a chat (`thread`), of a helper (`helper`) or a channel's main thread (`channel.mainThreadId`). */
export function threadOfStart(out: unknown): string | null {
  const o = (out ?? {}) as { thread?: { threadId?: unknown }; helper?: { threadId?: unknown }; channel?: { mainThreadId?: unknown } };
  const id = o.thread?.threadId ?? o.helper?.threadId ?? o.channel?.mainThreadId;
  return typeof id === "string" && id !== "" ? id : null;
}

/** A refused read of a chat this person just started: the row is still landing, so it is pending and not a refusal. Conversation shows its loading mark and reads again. */
export const refusalIsPending = (failure: { code?: string | undefined }, threadId: string, now: number = Date.now()): boolean => {
  const c = failure.code ?? "";
  return (c.startsWith("permission.") || c === "validation.not_found") && isJustMade(threadId, now);
};
