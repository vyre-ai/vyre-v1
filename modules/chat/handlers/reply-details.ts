// chat.reply_details: how one agent reply was made, for its hover card and the Details tab (owner, 3 Nov 2026).
// The turn comes from the engine (engine.turn.of_message, which keeps the account, the cost and the tool arguments for the asker and the AI-spend managers), what the agent knew from
// memory (memory.used, which shows each person only what they may read). Both are asked as the caller, so their own rules apply. When no turn was recorded for the reply (a reply from
// before the engine kept them, or one whose turn could not be linked), the tool steps saved on the reply itself are what is left, and the Details say the rest was not recorded.
import { messageBy, raise, threadBy } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { canSpeak } from "./post.ts";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null ? (v as Obj) : {});

/** A failure that only means "nothing here" (no turn recorded, no recall for the message): the reply still has Details, without that part. */
function absent(e: unknown): boolean {
  const code = obj(obj(e)["error"])["code"] ?? obj(e)["code"];
  return code === "validation.not_found" || code === "permission.denied" || (e instanceof Error && /unexpected capability|no calls here/.test(e.message));
}

async function ask<T>(ctx: ChatCtx, cap: string, input: Obj): Promise<T | null> {
  if (!ctx.call) return null;
  try { return (await ctx.call(cap, input)) as T; }
  catch (e) { if (absent(e)) return null; throw e; }
}

/** The steps saved on the reply: each tool call with whether it worked and how long it took, in whole seconds. */
function stepsOf(blocks: Array<Obj>): Array<{ name: string; ok?: boolean; secs?: number }> {
  const out = new Map<string, { name: string; ok?: boolean; secs?: number }>();
  for (const b of blocks) {
    const d = obj(b["data"]);
    const id = typeof d["id"] === "string" ? d["id"] : "";
    if (id === "") continue;
    if (b["type"] === "tool_call") out.set(id, { name: typeof d["name"] === "string" ? d["name"] : "" });
    else if (b["type"] === "tool_result") {
      const s = out.get(id) ?? { name: typeof d["name"] === "string" ? d["name"] : "" };
      if (typeof d["ok"] === "boolean") s.ok = d["ok"];
      if (typeof d["secs"] === "number" && Number.isInteger(d["secs"]) && d["secs"] >= 0) s.secs = d["secs"];
      out.set(id, s);
    }
  }
  return [...out.values()].filter((s) => s.name !== "");
}

export async function replyDetails(ctx: ChatCtx, input: { threadId: string; messageId: string }) {
  const t = threadBy(ctx.db, input.threadId);
  if (!t || !canSpeak(ctx, t)) raise(ctx, "validation.not_found", "That chat does not exist or is not yours to open.");
  const m = messageBy(ctx.db, input.messageId);
  if (!m || m.thread !== t.id) raise(ctx, "validation.not_found", "That message is not in this chat.");
  if (!m.author.startsWith("agt_")) raise(ctx, "validation.bad_input", "Only an agent's reply has details.", { messageId: m.id });
  const [turned, known] = await Promise.all([
    ask<{ turn?: Obj }>(ctx, "engine.turn.of_message", { threadId: t.id, messageId: m.id }),
    ask<{ facts?: Obj[]; quotes?: Obj[] }>(ctx, "memory.used", { threadId: t.id, messageId: m.id }),
  ]);
  const facts = (known?.facts ?? []).map((f) => ({ factId: String(f["factId"] ?? ""), text: String(f["text"] ?? ""), ...(typeof f["sourceTitle"] === "string" ? { sourceTitle: f["sourceTitle"] } : {}) }));
  const quotes = (known?.quotes ?? []).map((q) => ({ ref: String(q["ref"] ?? ""), text: String(q["text"] ?? ""), ...(typeof q["threadTitle"] === "string" ? { threadTitle: q["threadTitle"] } : {}), at: Number(q["at"] ?? 0) }));
  return {
    details: {
      messageId: m.id, threadId: t.id, agentId: m.author, at: m.createdAt,
      ...(turned?.turn ? { turn: turned.turn } : {}),
      ...(known ? { memory: { facts, quotes } } : {}),
      steps: stepsOf(m.blocks),
    },
  };
}
