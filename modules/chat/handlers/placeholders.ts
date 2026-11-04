// One-time clean-up (owner, 4 Nov 2026): open question cards whose words are a placeholder ("test", example.com, __probe_none__) were thrown into chats by agents; they close as withdrawn and the tasks behind
// them go from Needs you (the tasks module closes a task on block.withdrawn). Nothing else is touched: a question is closed only when probeIn finds a placeholder in its prompt or its options.
import { probeIn } from "../../../lib/probe.ts";
import { ensure, patchBlockInMessage } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";

const FLAG = 'CREATE TABLE IF NOT EXISTS "chat_cleanup_done" ("name" TEXT PRIMARY KEY, "at" INTEGER NOT NULL, "closed" INTEGER NOT NULL)';
const NAME = "placeholder_questions_v1";

export function closePlaceholderQuestions(ctx: ChatCtx, o: { force?: boolean } = {}): { closed: number; ran: boolean } {
  ensure(ctx.db);
  ctx.db.run(FLAG);
  if (!o.force && ctx.db.all('SELECT 1 AS x FROM "chat_cleanup_done" WHERE "name" = ?', NAME).length > 0) return { closed: 0, ran: false };
  const open = ctx.db.all("SELECT id, thread, message, data FROM chat_block WHERE type = 'question' AND state = 'waiting'") as Array<{ id: string; thread: string; message: string; data: string }>;
  let closed = 0;
  for (const b of open) {
    let data: Record<string, unknown>;
    try { data = JSON.parse(b.data) as Record<string, unknown>; } catch { continue; }
    if (probeIn({ prompt: data["prompt"], options: data["options"] }) === null) continue;
    ctx.db.run("UPDATE chat_block SET state = 'done', answer = NULL, answeredBy = NULL, answeredAt = ? WHERE id = ?", ctx.now(), b.id);
    patchBlockInMessage(ctx.db, b.message, b.id, (x) => ({ ...x, state: "done", data: { ...(x["data"] as Record<string, unknown>), withdrawn: true } }));
    ctx.emit("block.withdrawn", b.thread, { threadId: b.thread, blockId: b.id });
    closed += 1;
  }
  ctx.db.run('INSERT OR REPLACE INTO "chat_cleanup_done" ("name", "at", "closed") VALUES (?, ?, ?)', NAME, ctx.now(), closed);
  return { closed, ran: true };
}
