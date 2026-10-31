// Chat modes and the per-chat choice of model, effort and account (threads.set_mode, threads.agent.configure). The older plan switch (threads.set_plan_mode, g24a.ts) shares applyMode.
import { CHAT_MODES, agentsOf, askerOf, codeOfMode, raise } from "../projections.ts";
import type { ChatCtx, ChatMode, ThreadRec } from "../projections.ts";
import { load, out, touch } from "./g24a.ts";

/** Switch how much the agents of a chat may do alone. Plan flipping on or off also says so on the older plan event, so a client that only knows plan mode keeps working. */
export function applyMode(ctx: ChatCtx, t: ThreadRec, mode: ChatMode): void {
  if (mode === t.mode) return;
  touch(ctx, t.id, "modePlan = ?", codeOfMode(mode));
  const by = askerOf(ctx);
  ctx.emit("thread.updated", t.id, { threadId: t.id, fields: ["mode"] });
  if ((mode === "plan") !== t.planMode) ctx.emit("thread.plan_mode_changed", t.id, { threadId: t.id, planMode: mode === "plan", by });
}

export async function setThreadMode(ctx: ChatCtx, input: { threadId: string; mode: ChatMode }) {
  const t = load(ctx, input.threadId);
  if (!CHAT_MODES.includes(input.mode)) raise(ctx, "validation.bad_input", "A chat runs Ask first, Auto or Plan.");
  applyMode(ctx, t, input.mode);
  return out(ctx, t.id);
}

const EFFORTS: readonly string[] = ["low", "medium", "high", "max"];
const HANDLE = /^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;

/**
 * Pick the model, provider, effort or account an agent answers with. scope "chat" (default) changes this chat only: it is stored on the agent's row in the thread, which the engine reads before every
 * turn and the account resolver reads as the chat's account. scope "agent" also makes the model and account the agent's own default (agents.update, so the person must be allowed to edit the agent).
 * A null clears a field back to the agent's default; an absent field is left alone.
 */
export async function configureAgent(
  ctx: ChatCtx,
  input: { threadId: string; agentId: string; model?: string | null; provider?: string | null; effort?: string | null; accountRef?: string | null; scope?: "chat" | "agent" },
) {
  const t = load(ctx, input.threadId);
  const scope = input.scope ?? "chat";
  if (scope !== "chat" && scope !== "agent") raise(ctx, "validation.bad_input", "The scope is chat or agent.");
  if (!input.agentId.startsWith("agt_")) raise(ctx, "validation.bad_input", "That is not an agent.", { agentId: input.agentId });
  if (!agentsOf(ctx.db, t.id).some((a) => a.agentId === input.agentId)) raise(ctx, "validation.not_found", "That agent is not in this thread.");
  const text = (k: "model" | "provider" | "accountRef"): string | null | undefined => {
    const v = input[k];
    if (v === undefined || v === null) return v;
    if (typeof v !== "string" || v.trim() === "" || v.length > 200) raise(ctx, "validation.bad_input", `${k} is a short name.`, { field: k });
    return v.trim();
  };
  const model = text("model"), provider = text("provider"), accountRef = text("accountRef");
  const effort = input.effort;
  if (effort !== undefined && effort !== null && !EFFORTS.includes(effort)) raise(ctx, "validation.bad_input", "Effort is low, medium, high or max.", { field: "effort" });
  const sets: Array<[string, string | null]> = [];
  if (model !== undefined) sets.push(["model", model]);
  if (provider !== undefined) sets.push(["provider", provider]);
  if (effort !== undefined) sets.push(["effort", effort]);
  if (accountRef !== undefined) sets.push(["accountRef", accountRef]);
  if (scope === "agent") {
    if (accountRef !== undefined && accountRef !== null && !HANDLE.test(accountRef)) raise(ctx, "validation.bad_input", "An agent default account is a Vault name like #Team_Anthropic_Key.", { field: "accountRef" });
    const patch: Record<string, unknown> = {};
    if (model !== undefined) patch["model"] = model;
    if (accountRef !== undefined) Object.assign(patch, accountRef === null ? { accountPolicy: "asker", accountKey: null } : { accountPolicy: "key", accountKey: accountRef });
    // The agent change goes first: when the person may not edit the agent, nothing in this chat changes either.
    if (Object.keys(patch).length > 0) {
      if (!ctx.call) raise(ctx, "internal.unavailable", "Changing an agent is not available here.");
      await ctx.call("agents.update", { agentId: input.agentId, patch });
    }
  }
  if (sets.length > 0) {
    ctx.db.run(
      `UPDATE chat_thread_agent SET ${sets.map(([k]) => `"${k}" = ?`).join(", ")}, version = version + 1, updated_at = ? WHERE thread = ? AND agentId = ? AND deleted_at IS NULL`,
      ...sets.map(([, v]) => v), ctx.now(), t.id, input.agentId,
    );
    ctx.emit("thread.updated", t.id, { threadId: t.id, fields: ["agents"] });
  }
  return out(ctx, t.id);
}


export const modesHandlers = {
  "threads.set_mode": setThreadMode,
  "threads.agent.configure": configureAgent,
};
