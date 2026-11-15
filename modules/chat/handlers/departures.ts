// What a chat does when someone leaves it for good (hole 10). A thread started by someone who is gone would run every later turn on an account that cannot pay and answer to nobody, and a person left on a
// member list reads as a ghost. So: the person comes off every thread they were in, a thread they started that still has people gets a new owner, and each chat gets one line saying what happened. A deleted
// agent comes off the chats it was in the same way, its past messages stay, and the line is what is left of it. A private chat with nobody else in it stays as it is (retention decides that). At least once:
// a second delivery finds nothing to do.
import { insertMessage, membersOf } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { forgetMentions } from "./pace.ts";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const person = (id: string): boolean => id.startsWith("usr_");

async function nameOf(ctx: ChatCtx, id: string): Promise<string> {
  try {
    return (
      str(
        (
          (await ctx.call("access.principals.get", { principal: { kind: "person", id } })) as {
            principal?: { name?: string };
          } | null
        )?.principal?.name,
      ) || "Someone"
    );
  } catch {
    return "Someone";
  }
}

export async function onPersonLeft(ctx: ChatCtx, event: { payload: { personId?: string } }): Promise<string[]> {
  const gone = event.payload.personId;
  if (typeof gone !== "string" || !person(gone)) return [];
  forgetMentions(ctx, { person: gone }); // memory rule 9: who was mentioned goes with them
  const rows = ctx.db.all(
    `SELECT t."id" AS "id", t."kind" AS "kind", t."starter" AS "starter", t."channelId" AS "channelId", t."parentThreadId" AS "parent" FROM chat_thread t WHERE t."deleted_at" IS NULL
       AND (t."starter" = ? OR EXISTS (SELECT 1 FROM chat_thread_member m WHERE m."thread" = t."id" AND m."principal" = ? AND m."deleted_at" IS NULL))`,
    gone,
    gone,
  ) as Row[];
  if (rows.length === 0) return [];
  const name = await nameOf(ctx, gone);
  const now = ctx.now();
  const touched: string[] = [];
  for (const r of rows) {
    const id = str(r["id"]);
    const others = membersOf(ctx.db, id).filter((p) => person(p) && p !== gone);
    if (others.length === 0) continue; // nobody else here: a private chat of theirs, which the removal plan and retention decide
    const heir = others[0]!;
    ctx.db.run(
      `UPDATE chat_thread_member SET "deleted_at" = ?, "version" = "version" + 1, "updated_at" = ? WHERE "thread" = ? AND "principal" = ? AND "deleted_at" IS NULL`,
      now,
      now,
      id,
      gone,
    );
    const inherits = str(r["starter"]) === gone;
    if (inherits) {
      ctx.db.run(
        `UPDATE chat_thread SET "starter" = ?, "version" = "version" + 1, "updated_at" = ? WHERE "id" = ?`,
        heir,
        now,
        id,
      );
      ctx.db.run(
        `UPDATE chat_thread_member SET "role" = 'owner', "updated_at" = ? WHERE "thread" = ? AND "principal" = ? AND "deleted_at" IS NULL`,
        now,
        id,
        heir,
      );
    }
    // a thread under a chat follows its parent silently: the line belongs to the conversation people read
    if (r["parent"] === null || r["parent"] === undefined)
      insertMessage(ctx, id, {
        author: gone,
        kind: "system",
        body: inherits ? `${name} left. ${await nameOf(ctx, heir)} now owns this chat.` : `${name} left.`,
      });
    ctx.emit("channel.member_removed", gone, {
      personId: gone,
      by: gone,
      threadId: id,
      ...(r["channelId"] ? { channelId: str(r["channelId"]) } : {}),
    });
    if (inherits) ctx.emit("thread.updated", id, { threadId: id, fields: ["starter"], starter: heir });
    touched.push(id);
  }
  return touched;
}

export async function onAgentDeleted(
  ctx: ChatCtx,
  event: { payload: { agentId?: string; name?: string } },
): Promise<string[]> {
  const agent = event.payload.agentId;
  if (typeof agent !== "string" || !agent.startsWith("agt_")) return [];
  const rows = ctx.db.all(
    `SELECT a."thread" AS "thread", t."parentThreadId" AS "parent" FROM chat_thread_agent a LEFT JOIN chat_thread t ON t."id" = a."thread" WHERE a."agentId" = ? AND a."deleted_at" IS NULL`,
    agent,
  ) as Row[];
  const now = ctx.now();
  const name = event.payload.name?.trim() || "An agent";
  const touched: string[] = [];
  for (const r of rows) {
    const id = str(r["thread"]);
    ctx.db.run(
      `UPDATE chat_thread_agent SET "deleted_at" = ?, "version" = "version" + 1, "updated_at" = ? WHERE "thread" = ? AND "agentId" = ? AND "deleted_at" IS NULL`,
      now,
      now,
      id,
      agent,
    );
    if (r["parent"] === null || r["parent"] === undefined)
      insertMessage(ctx, id, { author: agent, kind: "system", body: `${name} was deleted.` });
    ctx.emit("agent.disengaged", id, { threadId: id, agentId: agent, by: agent });
    touched.push(id);
  }
  return touched;
}

/**
 * Someone other than an agent's owner (a manager) took the keyboard of that agent's terminal, or handed it back: the owner is told in their chat with that agent, in one quiet line, and it stays in that chat.
 * Their chat, not a channel: only the people in it read it. The terminal events carry the agent and its owner only when the one acting is not the owner.
 */
export async function onKeyboardTaken(
  ctx: ChatCtx,
  event: { name?: string; payload: { by?: string; agentId?: string; agentName?: string; agentOwner?: string } },
): Promise<string[]> {
  const { by, agentId, agentName, agentOwner } = event.payload;
  if (!by || !agentId || !agentOwner || by === agentOwner || !by.startsWith("usr_")) return [];
  const row = ctx.db.all(
    `SELECT t."id" AS "id" FROM chat_thread t JOIN chat_thread_agent a ON a."thread" = t."id" AND a."agentId" = ? AND a."deleted_at" IS NULL
     WHERE t."kind" = 'chat' AND t."starter" = ? AND t."deleted_at" IS NULL AND t."parentThreadId" IS NULL ORDER BY t."updated_at" DESC LIMIT 1`,
    agentId,
    agentOwner,
  )[0] as Row | undefined;
  if (!row) return [];
  const who = await nameOf(ctx, by);
  const body =
    event.name === "terminal.given_back"
      ? `${who} gave back the keyboard of ${agentName ?? "the agent"}'s terminal.`
      : `${who} took the keyboard of ${agentName ?? "the agent"}'s terminal.`;
  insertMessage(ctx, str(row["id"]), { author: agentId, kind: "system", body });
  return [str(row["id"])];
}
