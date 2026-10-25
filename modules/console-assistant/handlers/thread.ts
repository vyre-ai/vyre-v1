// Console assistant thread, toolset and explain (spec 3.10, ARCH 7.10). The thread is the person's own assistant in a chat thread that follows the Console page.
import { asList, asRow, contextText, ownThread, personOf, raise, str, threadOf, toolsFor } from "../projections.ts";
import type { AssistCtx } from "../projections.ts";

const LEVELS = new Set(["view", "use", "edit", "manage"]);

/** The person's assistant: their own personal agent, the one with the assistant role when there is more than one. */
async function assistantOf(ctx: AssistCtx, personId: string): Promise<string> {
  const out = asRow(await ctx.call("agents.list", { section: "personal", limit: 100 }));
  const mine = asList(out?.["agents"]).filter((a) => str(a["ownerId"]) === personId);
  const pick = mine.find((a) => a["role"] === "assistant") ?? mine[0];
  const id = str(pick?.["agentId"]);
  // until an AI account is connected there is no assistant yet; the pane shows the locked state from this error
  if (!id) return raise(ctx, "validation.precondition_failed", "Your assistant is not set up yet. Connect an AI account first.");
  return id;
}

/** The thread title carries the page, so the pane and the chat list both show where the assistant is looking. */
async function follow(ctx: AssistCtx, threadId: string, page: string): Promise<void> {
  try {
    await ctx.call("threads.update", { threadId, title: `Console: ${page}` });
  } catch (e) {
    // the page context is already stored; a title that lags behind must not stop the person from working
    ctx.log.warn("console assistant could not retitle its thread", { threadId, page, error: e instanceof Error ? e.message : String(e) });
  }
}

export async function assistantOpen(ctx: AssistCtx, input: { page: string; objectRef?: string; idempotencyKey?: string }) {
  const personId = personOf(ctx);
  const now = ctx.now();
  const have = threadOf(ctx, personId);
  if (have) {
    ctx.db.run(`UPDATE console_assistant_thread SET page = ?, object_ref = ?, updated_at = ? WHERE person_id = ?`, input.page, input.objectRef ?? null, now, personId);
    if (have.page !== input.page) await follow(ctx, have.thread_id, input.page);
    return { threadId: have.thread_id };
  }
  const assistantId = await assistantOf(ctx, personId);
  const started = asRow(await ctx.call("chat.start", {
    kind: "ask", agentIds: [assistantId], idempotencyKey: `console-${personId}`, scopeType: "console", scopeId: input.page,
    title: `Console: ${input.page}`, first: contextText(input.page, input.objectRef),
  }));
  const threadId = str(started?.["threadId"]);
  if (!threadId) return raise(ctx, "internal.unexpected", "The chat did not return a thread.");
  ctx.db.run(
    `INSERT INTO console_assistant_thread (person_id, thread_id, assistant_id, page, object_ref, opened_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    personId, threadId, assistantId, input.page, input.objectRef ?? null, now, now,
  );
  return { threadId };
}

export async function contextSet(ctx: AssistCtx, input: { threadId: string; page: string; objectRef?: string }) {
  const t = ownThread(ctx, input.threadId);
  ctx.db.run(`UPDATE console_assistant_thread SET page = ?, object_ref = ?, updated_at = ? WHERE person_id = ?`, input.page, input.objectRef ?? null, ctx.now(), t.person_id);
  if (t.page !== input.page) await follow(ctx, t.thread_id, input.page);
  return { ok: true };
}

export async function assistantTools(ctx: AssistCtx, _input: Record<string, never>) {
  return { tools: toolsFor(ctx) };
}

/** Why a person can or cannot do a thing, in the words of the Access checker. */
export async function explainAccess(ctx: AssistCtx, input: { person: string; action: string; resourceType: string; resourceId: string }) {
  // "edit" is a level; anything else names a permission checked at view level
  const action = LEVELS.has(input.action) ? { level: input.action } : { perm: input.action, level: "view" };
  const out = asRow(await ctx.call("access.check", {
    principal: { kind: "person", id: input.person }, action, resource: { type: input.resourceType, id: input.resourceId },
  }));
  const decision = asRow(out?.["decision"]);
  const effect = decision?.["effect"];
  if (effect !== "allow" && effect !== "deny" && effect !== "hold") return raise(ctx, "internal.unexpected", "The Access checker gave no decision.");
  const steps = asList(decision?.["steps"]).map((s) => str(s["text"])).filter((s): s is string => s !== undefined);
  if (steps.length === 0) steps.push(str(decision?.["reason"]) ?? effect);
  return { effect, steps };
}
