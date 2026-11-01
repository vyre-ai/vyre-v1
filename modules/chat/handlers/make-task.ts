// chat.make_task (rc.9, "Turn that into a task"): one message becomes a task with no form. The title is the message's first line (or the words given), the summary the whole message, the task's
// source and its first block point back at the message, and a "Task created, assigned to Maya" card lands in the thread linking to the task. Assigned to the person named, else the asker. An agent may do
// it for the person it acts for (a mention is enough to ask): the task is the asker's own to give, nothing is widened. Replays are one task (the idempotency key rides to tasks.create).
import { askerOf, ensure, isMember, messageBy, raise } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { load } from "./g24a.ts";
import { postLinkCard } from "./link-card.ts";

const MAX_TITLE = 120;
const MAX_SUMMARY = 4000;

/** The title a message gives a task: its first line without leading mentions, else a plain default. */
export function titleFromMessage(body: string): string {
  const first = (body.trim().split(/\n/)[0] ?? "").replace(/^(@\S+\s*)+/, "").trim();
  return (first || "Follow up on this message").slice(0, MAX_TITLE);
}

export async function makeTask(ctx: ChatCtx, input: { threadId: string; messageId: string; title?: string; assigneeId?: string; idempotencyKey: string }) {
  ensure(ctx.db);
  const t = load(ctx, input.threadId);
  const m = messageBy(ctx.db, input.messageId);
  if (!m || m.thread !== t.id) raise(ctx, "validation.not_found", "That message is not in this chat.");
  if (m.kind === "system" || m.kind === "quiet") raise(ctx, "validation.bad_input", "A task is made from something someone said, not from a notice.");
  const asker = askerOf(ctx);
  const assignee = input.assigneeId ?? asker;
  if (!/^(usr|agt)_/.test(assignee)) raise(ctx, "validation.bad_input", "A task goes to a person or an agent.", { assigneeId: assignee });
  // someone outside the chat does not get its words by way of a task
  if (assignee !== asker && !isMember(ctx.db, t.id, assignee) && !(assignee.startsWith("agt_") && ctx.db.all("SELECT 1 AS x FROM chat_thread_agent WHERE thread = ? AND agentId = ? AND deleted_at IS NULL", t.id, assignee).length > 0)) {
    raise(ctx, "validation.bad_input", "That person is not in this chat.", { assigneeId: assignee });
  }
  if (!ctx.call) raise(ctx, "internal.unavailable", "Tasks are not available just now.");
  const title = (input.title?.trim() || titleFromMessage(m.body)).slice(0, MAX_TITLE);
  const made = (await ctx.call("tasks.create", {
    title, summary: m.body.slice(0, MAX_SUMMARY), assigned: { kind: assignee.startsWith("agt_") ? "agent" : "person", id: assignee }, source: { kind: "chat", id: t.id },
    blocks: [{ type: "chat_message", v: 1, data: { threadId: t.id, messageId: m.id, title } }],
    idempotencyKey: `${input.idempotencyKey}:task`,
  }, { idempotencyKey: `${input.idempotencyKey}:task` })) as { task?: { id?: string } };
  const taskId = made.task?.id;
  if (!taskId) raise(ctx, "internal.unexpected", "The task could not be made.");
  postLinkCard(ctx, t.id, { icon: "task", lead: "Task created", title, who: assignee, target: { type: "task", id: taskId } }, `Task created: ${title}`);
  return { taskId, messageId: m.id };
}
