// What recall put in front of the agent for one message (design: chat "Used N memories", "Show what the agent knew here"). The engine records, per message, the source ids of the facts and
// quotes it handed the model (memory.recall.record); memory.used reads them back for the person whose recall it was, with each fact's text and each quote's exact words read again now, through
// the same access checks, so a fact since deleted or a chat since closed to them is not shown. Only ids are stored here: no text is copied out of a private chat or a person's memory.
import { actorOf, ensure, factOut, makeAccess, orNull, readFact, rowsOf, str, num } from "../projections.ts";
import type { MemCtx } from "../projections.ts";
import { findQuotes } from "./quotes.ts";

const TABLE =
  "CREATE TABLE IF NOT EXISTS memory_recall_log (thread_id TEXT NOT NULL, message_id TEXT NOT NULL, agent_id TEXT, asker TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, PRIMARY KEY (thread_id, message_id, kind, ref))";
const INDEX = "CREATE INDEX IF NOT EXISTS memory_recall_log_at ON memory_recall_log (thread_id, at)";
const ready = new WeakSet<object>();
function tables(ctx: MemCtx): void {
  ensure(ctx.db);
  if (ready.has(ctx.db)) return;
  ctx.db.run(TABLE);
  ctx.db.run(INDEX);
  ready.add(ctx.db);
}

type Line = { kind: "fact" | "quote"; ref: string };

export async function recallRecord(
  ctx: MemCtx,
  input: { threadId: string; messageId: string; agentId?: string; lines: Line[] },
) {
  tables(ctx);
  const me = actorOf(ctx);
  const now = ctx.now();
  let n = 0;
  for (const l of input.lines.slice(0, 50)) {
    ctx.db.run(
      "INSERT OR IGNORE INTO memory_recall_log (thread_id, message_id, agent_id, asker, at, kind, ref) VALUES (?, ?, ?, ?, ?, ?, ?)",
      input.threadId,
      input.messageId,
      input.agentId ?? null,
      me,
      now,
      l.kind,
      l.ref,
    );
    n++;
  }
  return { recorded: n };
}

/** The message the recall was for: the one asked about, or (for the agent's reply) the person's message before it. */
async function triggerOf(ctx: MemCtx, threadId: string, messageId: string): Promise<{ id: string; at: number } | null> {
  const me = actorOf(ctx);
  const own = rowsOf(
    ctx.db,
    "SELECT at FROM memory_recall_log WHERE thread_id = ? AND message_id = ? AND asker = ? LIMIT 1",
    threadId,
    messageId,
    me,
  )[0];
  if (own) return { id: messageId, at: num(own["at"]) };
  // An agent's reply is for the one message that caused it: the message it replies to, else the nearest person's message before it. A reply never borrows the recall of an earlier message
  // (it used to take the latest recall at or before its time, so every later reply showed the lessons put in front of the agent for the first message of the chat).
  type Row = { messageId?: string; threadSeq?: number; author?: { kind?: string }; replyTo?: string };
  let msg: Row | undefined;
  try {
    msg = ((await ctx.call("chat.message.get", { threadId, messageId })) as { message?: Row }).message;
  } catch {
    return null;
  }
  if (!msg || msg.author?.kind === "person") return null;
  let trigger = msg.replyTo;
  if (!trigger && typeof msg.threadSeq === "number") {
    try {
      const before = (await ctx.call("chat.messages.list", { threadId, before: msg.threadSeq, limit: 30 })) as {
        messages?: Row[];
      };
      trigger = (before.messages ?? [])
        .filter((m) => m.author?.kind === "person" && typeof m.threadSeq === "number")
        .sort((a, b) => b.threadSeq! - a.threadSeq!)[0]?.messageId;
    } catch {
      return null;
    }
  }
  if (!trigger) return null;
  const row = rowsOf(
    ctx.db,
    "SELECT at FROM memory_recall_log WHERE thread_id = ? AND message_id = ? AND asker = ? LIMIT 1",
    threadId,
    trigger,
    me,
  )[0];
  return row ? { id: trigger, at: num(row["at"]) } : null;
}

export async function used(ctx: MemCtx, input: { threadId: string; messageId: string }) {
  tables(ctx);
  const t = await triggerOf(ctx, input.threadId, input.messageId);
  if (!t) return { messageId: input.messageId, facts: [], quotes: [] };
  const me = actorOf(ctx);
  const rows = rowsOf(
    ctx.db,
    "SELECT kind, ref, agent_id, at FROM memory_recall_log WHERE thread_id = ? AND message_id = ? AND asker = ? ORDER BY rowid",
    input.threadId,
    t.id,
    me,
  );
  const access = makeAccess(ctx);
  const facts: Array<
    ReturnType<typeof factOut> & { kind?: string; agentId?: string; sourceTitle?: string; by?: string; byKind?: string }
  > = [];
  const titles = new Map<string, string | undefined>();
  const quotes: Awaited<ReturnType<typeof findQuotes>> = [];
  for (const r of rows) {
    if (str(r["kind"]) === "fact") {
      const row = rowsOf(ctx.db, "SELECT * FROM memory_facts WHERE id = ?", str(r["ref"]))[0];
      if (!row) continue;
      const f = readFact(ctx, row);
      if (!(await access.can(f.layer, f.ownerRef, f.agentId, f.projectId, "view", f.audience))) continue;
      const a = orNull(r["agent_id"]);
      let title: string | undefined;
      if ((f.sourceKind === "chat" || f.sourceKind === "channel") && f.sourceRef) {
        if (!titles.has(f.sourceRef)) {
          try {
            titles.set(
              f.sourceRef,
              ((await ctx.call("threads.get", { threadId: f.sourceRef })) as { thread?: { title?: string } }).thread
                ?.title,
            );
          } catch {
            titles.set(f.sourceRef, undefined);
          }
        }
        title = titles.get(f.sourceRef);
      }
      facts.push({
        ...factOut(f),
        ...(f.layer !== "person" && f.sourcePerson
          ? { by: f.sourcePerson, byKind: f.sourcePerson.startsWith("agt_") ? "agent" : "person" }
          : {}),
        ...(f.kind ? { kind: f.kind } : {}),
        ...(a ? { agentId: a } : {}),
        ...(title ? { sourceTitle: title } : {}),
      });
    } else {
      for (const q of await findQuotes(ctx, { ref: str(r["ref"]) }))
        if (await access.showsFrom(q.threadId)) quotes.push(q);
    }
  }
  return { messageId: t.id, at: t.at, facts, quotes };
}
