// The quiet line a hook leaves in a chat (lane l-hooks): "Assistant added a hook in this chat: before any email, check the address is in Contacts", and "A hook stopped this: <reason>". One quiet line per
// change or block, carrying one `hook` block with the data an app draws it from. Written by the hooks module only; nothing in it routes to an agent or wakes one.
import { insertMessage, mintId, threadBy, raise } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { canSpeak } from "./post.ts";

export interface HookLineInput {
  threadId: string; body: string; kind: "added" | "changed" | "removed" | "paused" | "resumed" | "blocked" | "failed" | "allowed" | "asked"; hookId?: string; scope?: string; by?: string; byKind?: "admin" | "person" | "agent"; reason?: string; tool?: string; subject?: string; agentId?: string; next?: Array<{ label: string; ask: string }>;
}

export function hookLine(ctx: ChatCtx, input: HookLineInput): { messageId: string } {
  const t = threadBy(ctx.db, input.threadId);
  if (!t || !canSpeak(ctx, t)) raise(ctx, "validation.not_found", "That chat does not exist or is not yours.");
  const body = input.body.replace(/\s+/g, " ").trim().slice(0, 400);
  if (body === "") raise(ctx, "validation.bad_input", "Say what happened to the hook.");
  const data: Record<string, unknown> = { threadId: t.id, kind: input.kind, line: body };
  for (const k of ["hookId", "scope", "by", "byKind"] as const) if (input[k] !== undefined) data[k] = input[k];
  if (input.reason !== undefined) data["reason"] = input.reason.slice(0, 300);
  if (input.tool !== undefined) data["tool"] = input.tool.slice(0, 80);
  if (input.agentId !== undefined) data["agentId"] = input.agentId;
  if (input.next !== undefined) data["next"] = input.next.slice(0, 2);
  if (input.subject !== undefined) data["subject"] = input.subject.slice(0, 200);
  const m = insertMessage(ctx, t.id, { author: ctx.principal.id, kind: "quiet", body, blocks: [{ type: "hook", v: 1, id: mintId("blk", ctx.now()), data, state: "done", traceId: ctx.trace.traceId }] });
  return { messageId: m.id };
}
export const hookLineHandlers = { "chat.hook_line": (ctx: ChatCtx, input: HookLineInput) => hookLine(ctx, input) };
