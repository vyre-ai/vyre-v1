// A held act nobody answered does not wait for ever (owner, 4 Nov 2026: "Two stale approvals from earlier runs"). It expires as "Not sent": after 7 days, or when the chat it was asked in or its task has closed. The hold
// is dropped (the call is never sent), its task closes, and the agent that asked is told through the same denial every other turned-down act gives (gate.denied, which wakes a parked turn). Nothing else is touched.
// The job runs at start and every hour, so approvals left from earlier releases are cleared the first time it runs.
import type { GateCtx, Hold } from "../projections.ts";
import { holdsWhere } from "../projections.ts";
import { dropHold } from "./approve.ts";

export const STALE_MS = 7 * 24 * 3_600_000;
export const NOTE_STALE = "Not sent, it waited 7 days";
export const NOTE_CHAT = "Not sent, the chat it was asked in was closed";
export const NOTE_TASK = "Not sent, its task was closed";

async function closedWhy(ctx: GateCtx, h: Hold): Promise<string | null> {
  if (ctx.now() - h.createdAt >= STALE_MS) return NOTE_STALE;
  if (h.threadId && ctx.call) {
    try {
      const t = ((await ctx.call("threads.get", { threadId: h.threadId })) as { thread?: { closedAt?: unknown } }).thread;
      if (t && t.closedAt !== undefined && t.closedAt !== null) return NOTE_CHAT;
    } catch (e) {
      // a chat that is gone ends its asks; any other failure to read it leaves the hold as it was
      if ((e as { error?: { code?: string } })?.error?.code === "validation.not_found") return NOTE_CHAT;
    }
  }
  if (h.taskId && ctx.call) {
    try {
      const t = ((await ctx.call("tasks.get", { taskId: h.taskId })) as { task?: { state?: string } }).task;
      if (t?.state === "done" || t?.state === "canceled") return NOTE_TASK;
    } catch { /* the task cannot be read: the hold stays */ }
  }
  return null;
}

export async function expireStaleHolds(ctx: GateCtx): Promise<{ dropped: number }> {
  let dropped = 0;
  for (const h of holdsWhere(ctx.db, "state = 'held'")) {
    if (h.sendingAt !== undefined) continue;   // being sent right now
    const why = await closedWhy(ctx, h);
    if (why === null) continue;
    await dropHold(ctx, h, why);
    dropped += 1;
  }
  return { dropped };
}
