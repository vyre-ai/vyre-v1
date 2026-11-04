// The helpers of a chat as one live list (owner, 4 Nov 2026): for each, its state (working, done, needs you, failed, stopped), the step it is on now in plain words, one line of what it found, how long it has
// taken and what it has cost; and Stop all. Steering one is chat.helper.steer. Everything is read from what the engine already keeps: the helper threads, their turns and the live step of the turn being written.
import { oneLine } from "../../../lib/plain-words.ts";
import { ensure } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";
import { liveTurns } from "./bridge.ts";
import { stop } from "./control.ts";

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v ?? 0);
export type HelperState = "working" | "done" | "needs_you" | "failed" | "stopped";
export interface HelperStatus {
  /** Which model, provider and account it runs on, and why; the model it actually used when that was another. */
  provider?: string; accountLabel?: string; model?: string; why?: string; fellBackFrom?: string;
  /** The held request a helper waits on, when it needs a person: the task that Allow, Always allow and Deny answer. */
  holdTaskId?: string;
  threadId: string; title: string; agentId: string; state: HelperState; step?: string; found?: string; startedAt: number; endedAt?: number; elapsedMs: number; tokensIn: number; tokensOut: number; costMicros: number;
}

type HoldMsg = { blocks?: Array<{ type?: string; data?: { state?: string; taskId?: string } }> };
/** The held request a helper's chat ends on: the newest turn status that is waiting with a task. */
export function holdOf(messages: readonly HoldMsg[]): string | undefined {
  return [...messages].reverse().flatMap((m) => [...(m.blocks ?? [])].reverse()).find((b) => b.type === "turn_status" && b.data?.state === "waiting" && typeof b.data.taskId === "string")?.data?.taskId;
}

export async function helpersStatus(ctx: EngineCtx, input: { threadId: string }): Promise<{ helpers: HelperStatus[] }> {
  ensure(ctx.db);
  const listed = (await ctx.call("chat.helpers.list", { threadId: input.threadId })) as { helpers: Array<{ threadId: string; title: string; status: string; agentId: string; startedAt: number; pick?: Record<string, unknown> }> };
  const out: HelperStatus[] = [];
  for (const h of listed.helpers) {
    const turns = ctx.db.all("SELECT model, state, started_at, ended_at, tokens_in, tokens_out, cost_micros FROM engine_turns WHERE thread_id = ? ORDER BY started_at, rowid", h.threadId) as Row[];
    const last = turns.at(-1);
    const live = (await liveTurns(ctx, { threadId: h.threadId }).catch(() => ({ turns: [] as Array<{ step?: string }> }))).turns;
    // the helper's own turns say how it stands: the start line's block is not rewritten when it ends (the report is a second message)
    const lastState = last ? String(last["state"]) : "";
    const state: HelperState = lastState === "waiting" ? "needs_you" : lastState === "completed" ? "done" : lastState === "failed" ? "failed" : lastState === "cancelled" ? "stopped" : h.status === "failed" ? "failed" : "working";
    const now = ctx.now();
    const startedAt = h.startedAt;
    const endedAt = state === "working" || state === "needs_you" ? undefined : last && last["ended_at"] !== null && last["ended_at"] !== undefined ? num(last["ended_at"]) : undefined;
    let found = "";
    if (state === "done") {
      try {
        const ms = ((await ctx.call("chat.messages.list", { threadId: h.threadId })) as { messages: Array<{ author?: { kind?: string }; body?: string }> }).messages;
        found = oneLine([...ms].reverse().find((m) => m.author?.kind === "agent" && (m.body ?? "").trim() !== "")?.body ?? "");
      } catch { /* no words to quote */ }
    }
    let holdTaskId: string | undefined;
    if (state === "needs_you") {
      try {
        const ms = ((await ctx.call("chat.messages.list", { threadId: h.threadId })) as { messages: HoldMsg[] }).messages;
        holdTaskId = holdOf(ms);
      } catch { /* the card then shows in the helper's own chat */ }
    }
    const step = state === "working" ? live.find((l) => l.step)?.step : undefined;
    const pick = h.pick ?? {};
    const used = last ? String(last["model"] ?? "") : "";
    const picked = typeof pick["model"] === "string" ? (pick["model"] as string) : undefined;
    const model = used !== "" && used !== "unknown" ? used : picked;
    const fellBackFrom = picked && used !== "" && used !== "unknown" && used !== picked ? picked : typeof pick["fellBackFrom"] === "string" ? (pick["fellBackFrom"] as string) : undefined;
    out.push({
      ...(typeof pick["provider"] === "string" ? { provider: pick["provider"] as string } : {}), ...(typeof pick["accountLabel"] === "string" ? { accountLabel: pick["accountLabel"] as string } : {}), ...(model ? { model } : {}), ...(typeof pick["why"] === "string" ? { why: pick["why"] as string } : {}), ...(fellBackFrom ? { fellBackFrom } : {}),
      threadId: h.threadId, title: h.title, agentId: h.agentId, state, ...(holdTaskId ? { holdTaskId } : {}), ...(step ? { step } : {}), ...(found ? { found } : {}), startedAt, ...(endedAt !== undefined ? { endedAt } : {}),
      elapsedMs: Math.max(0, (endedAt ?? now) - startedAt), tokensIn: turns.reduce((n, t) => n + num(t["tokens_in"]), 0), tokensOut: turns.reduce((n, t) => n + num(t["tokens_out"]), 0), costMicros: turns.reduce((n, t) => n + num(t["cost_micros"]), 0),
    });
  }
  return { helpers: out };
}

/** Stop every helper still working under a chat. */
export async function helpersStopAll(ctx: EngineCtx, input: { threadId: string }): Promise<{ stopped: number }> {
  const { helpers } = await helpersStatus(ctx, input);
  let stopped = 0;
  for (const h of helpers) if (h.state === "working") stopped += (await stop(ctx, { threadId: h.threadId })).stopped;
  return { stopped };
}

/**
 * Change the model of one helper (owner, 4 Nov 2026): stop what it is doing, then start it again on the account and model the person picked. The restart is chat.helper.restart, which checks the account and the
 * model like a new helper's and gives the brief again; what it spent so far stays on its row, and the new turn is billed to the person as any other.
 */
export async function helpersChangeModel(ctx: EngineCtx, input: { threadId: string; helperId: string; account?: string; model?: string }): Promise<{ restarted: boolean; model: string; account: string; fellBackFrom?: string; spentMicros: number }> {
  ensure(ctx.db);
  const before = (await helpersStatus(ctx, { threadId: input.threadId })).helpers.find((h) => h.threadId === input.helperId);
  if (!before) throw new Error("That helper does not belong to this chat.");
  // the old turn ends first, so the new one is the only one running; a stopped turn reports nothing to the chat above
  await stop(ctx, { threadId: input.helperId }).catch(() => ({ stopped: 0 }));
  const out = (await ctx.call("chat.helper.restart", { threadId: input.helperId, ...(input.account !== undefined ? { account: input.account } : {}), ...(input.model !== undefined ? { model: input.model } : {}) })) as { model: string; account: string; fellBackFrom?: string };
  return { restarted: true, model: out.model, account: out.account, ...(out.fellBackFrom ? { fellBackFrom: out.fellBackFrom } : {}), spentMicros: before?.costMicros ?? 0 };
}
