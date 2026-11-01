// What a question or a plan waits on (DESIGN-chat-system, the rule: every thing waiting on a person is a task). The block in the message is the card; the task is what reaches Needs you, the badges and the
// notifications. The block holds the task's id, a reference, never a copy of its state. Either door decides: the card here, or tasks.act anywhere else, which comes through the same handlers.
import { askerOf, messageBy } from "../projections.ts";
import type { BlockRec, ChatCtx, ThreadRec } from "../projections.ts";

/** What a stale press hears, here and in tasks.act: somebody decided already. */
export const ALREADY_DECIDED = "Already decided.";

const TITLE_CHARS = 200;
const firstLine = (s: string): string => { const l = s.split("\n")[0]!.trim(); return l.length > TITLE_CHARS ? `${l.slice(0, TITLE_CHARS - 1)}...` : l; };

/** The person a question or plan waits on: the one whose turn asked it, else the person who started the thread. Nobody when a thread has no person behind it. */
function personFor(ctx: ChatCtx, t: ThreadRec): string | undefined {
  for (const id of [askerOf(ctx), t.starter]) if (id?.startsWith("usr_")) return id;
  return undefined;
}

const ANSWER_ONLY = [{ key: "answer", label: "Answer", note: "required" }];

interface Ask { kind: "answer" | "approve"; blockId: string; planId?: string; block: { type: string; data: unknown }; title: string; summary: string }

/**
 * Open the task of a question or plan, before the card is written so the card can name it. A failure leaves a card that still works in its chat: the question is asked either way, and the reason goes to the log.
 * An Answer takes words or a pick, never a bare press, so it offers only Answer. A plan keeps the Approve task's own actions.
 */
export async function openAsk(ctx: ChatCtx, t: ThreadRec, a: Ask): Promise<string | undefined> {
  const person = personFor(ctx, t);
  if (!person || !ctx.call) return undefined;
  try {
    const made = (await ctx.call("tasks.create", {
      kind: a.kind, title: firstLine(a.title), summary: a.summary, assigned: { kind: "person", id: person }, source: { kind: "chat", id: t.id }, blocks: [{ type: a.block.type, v: 1, data: a.block.data }],
      notes: { "chat.block": a.blockId, ...(a.planId !== undefined ? { "chat.plan": a.planId } : {}) },
      ...(a.kind === "answer" ? { actions: ANSWER_ONLY } : {}),
      idempotencyKey: `ask:${a.blockId}`,
    })) as { task?: { id?: string } };
    return made.task?.id;
  } catch (e) {
    ctx.log.warn("a question or plan has no task, so it shows only in its chat", { threadId: t.id, blockId: a.blockId, error: e instanceof Error ? e.message : String(e) });
    return undefined;
  }
}

/** The agent that asked hears what was decided as the person's own message, naming it: the ordinary way an agent is told something, on the same account as any reply. It is the one wake, from every door. */
export async function tellAgent(ctx: ChatCtx, t: ThreadRec, block: Pick<BlockRec, "id" | "message">, body: string): Promise<void> {
  if (!ctx.call) return;
  const author = messageBy(ctx.db, block.message)?.author;
  try {
    await ctx.call("chat.post", { threadId: t.id, body, ...(author?.startsWith("agt_") ? { mentions: [{ kind: "agent", id: author }] } : {}), idempotencyKey: `answer_${block.id}` });
  } catch (e) { ctx.log.warn("the agent could not be told what was decided", { threadId: t.id, blockId: block.id, error: e instanceof Error ? e.message : String(e) }); }
}

