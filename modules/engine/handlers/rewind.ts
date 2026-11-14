// Rewind (chat gap G36, G37; DESIGN-chat-system item 20): go back to a point in a private chat with an agent.
//   engine.rewind.points  the points a person can go back to: one per turn of an agent that worked in a folder on this computer for them, newest first, with when, how many files and what they had just asked
//   engine.rewind.to       put that agent's folder back as it was at the point, hide the messages after it from the agents (the chat still shows them), forget the engine's own session so it starts from what is left
// What it undoes: the files in the agent's work folder, and what the agents read as history. What it never touches: the messages themselves, anything already sent (email, messages, posts), records and tasks, other
// computers and servers, files outside the work folder. Off in a chat with other people: it is one person's own agent's folder. A person reaches only their own folders (the store is derived from who is calling).
import { points, restore, storeOf } from "../checkpoints.ts";
import { forgetSessions } from "../cli-sessions.ts";
import { boundEngine, ensure, raise } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";
import { dropWarmSessions, engineHost } from "../runtime.ts";
import { workFolder } from "../sandbox.ts";

export interface RewindPoint {
  pointId: string;
  agentId: string;
  at: number;
  files: number;
  /** What the person had just said when the turn began: the first words of their message. */
  after?: string;
  /** The message that started that turn. */
  messageId?: string;
  /** The point a rewind took just before it: going back to it undoes that rewind. */
  undo?: boolean;
}

const MAX_POINTS = 30;

const POINT = /^(agt_[A-Za-z0-9_]+)\.([0-9a-f]{40})$/;

interface ThreadOut {
  thread?: { kind?: string; channelId?: string; members?: Array<{ id: string }>; agents?: Array<{ agentId: string }> };
}

/** The undo points of this chat's rewinds that have not been undone. */
function undoable(ctx: EngineCtx, threadId: string): Set<string> {
  try {
    return new Set(
      (
        ctx.db.all(
          "SELECT undo_sha FROM engine_rewind WHERE thread_id = ? AND undo_sha IS NOT NULL",
          threadId,
        ) as Array<Record<string, unknown>>
      ).map((r) => String(r["undo_sha"])),
    );
  } catch {
    return new Set();
  }
}

/** A private chat: a chat of this person and their agents, no channel, nobody else in it. */
async function privateChat(
  ctx: EngineCtx,
  threadId: string,
): Promise<{ ok: true; agents: string[] } | { ok: false; why: "group" | "not_a_chat" }> {
  const t = ((await ctx.call("threads.get", { threadId })) as ThreadOut).thread;
  if (!t || t.kind !== "chat" || t.channelId !== undefined) return { ok: false, why: "not_a_chat" };
  const people = (t.members ?? []).filter((m) => m.id.startsWith("usr_"));
  if (people.length > 1) return { ok: false, why: "group" };
  return { ok: true, agents: (t.agents ?? []).map((a) => a.agentId) };
}

function person(ctx: EngineCtx): string {
  if (ctx.principal.kind !== "person") raise(ctx, "permission.role_lacks_permission", "Only a person goes back.");
  return ctx.principal.id;
}

export async function rewindPoints(ctx: EngineCtx, input: { threadId: string }) {
  return pointsIn(ctx, input, engineHost()?.dataDir);
}

/** The same with the Space's data folder given (the handler reads it from the host seam; a test gives its own). */
export async function pointsIn(
  ctx: EngineCtx,
  input: { threadId: string },
  dataDir: string | undefined,
): Promise<{ available: boolean; why?: string; points: RewindPoint[] }> {
  ensure(ctx.db);
  const who = person(ctx);
  const chat = await privateChat(ctx, input.threadId);
  if (!chat.ok) return { available: false, why: chat.why, points: [] };
  if (!dataDir) return { available: false, why: "no_folder", points: [] };
  // what they said, to name each point by it
  const said = new Map<string, string>();
  try {
    const list = (await ctx.call("chat.messages.list", { threadId: input.threadId, limit: 100 })) as {
      messages: Array<{ messageId: string; author: { id: string }; body: string }>;
    };
    for (const m of list.messages) if (m.author.id === who) said.set(m.messageId, m.body);
  } catch {
    /* the points still list, unnamed */
  }
  const out: RewindPoint[] = [];
  for (const agentId of chat.agents) {
    let dir: string;
    try {
      dir = workFolder(dataDir, who, input.threadId, agentId);
    } catch {
      continue;
    }
    for (const p of await points({ gitDir: storeOf(dataDir, dir), workDir: dir, limit: MAX_POINTS })) {
      const undo = p.label === "Before going back" && undoable(ctx, input.threadId).has(p.sha);
      if (!p.label.startsWith("turn ") && !undo) continue;
      // the point is named by the message that started its turn: "turn <turnId> <messageId>"
      const msgId = /^turn \S+ (\S+)$/.exec(p.label)?.[1];
      const ask = msgId !== undefined ? said.get(msgId) : undefined;
      out.push({
        pointId: `${agentId}.${p.sha}`,
        agentId,
        at: p.at,
        files: p.files,
        ...(undo ? { undo: true } : {}),
        ...(msgId && !undo ? { messageId: msgId } : {}),
        ...(ask !== undefined && !undo ? { after: ask.trim().replace(/\s+/g, " ").slice(0, 60) } : {}),
      });
    }
  }
  return { available: true, points: out.sort((a, b) => b.at - a.at).slice(0, MAX_POINTS) };
}

export async function rewind(
  ctx: EngineCtx,
  input: { threadId: string; pointId: string; afterSeq: number; uptoSeq: number },
) {
  return rewindIn(ctx, input, engineHost()?.dataDir);
}

export async function rewindIn(
  ctx: EngineCtx,
  input: { threadId: string; pointId: string; afterSeq: number; uptoSeq: number },
  dataDir: string | undefined,
): Promise<{ agentId: string; at: number; restored: number; removed: number; undoPointId: string; undid: boolean }> {
  ensure(ctx.db);
  const who = person(ctx);
  const chat = await privateChat(ctx, input.threadId);
  if (!chat.ok)
    raise(
      ctx,
      "validation.precondition_failed",
      chat.why === "group" ? "Going back is off in a chat with other people." : "Only a chat with an agent goes back.",
    );
  const m = POINT.exec(input.pointId);
  if (!m || !chat.agents.includes(m[1]!)) raise(ctx, "validation.not_found", "That point is not in this chat.");
  const [, agentId, sha] = m as unknown as [string, string, string];
  if (input.uptoSeq < input.afterSeq) raise(ctx, "validation.bad_input", "That range is backwards.");
  if (!dataDir) raise(ctx, "validation.precondition_failed", "This computer has no folders to go back in.");
  const dir = workFolder(dataDir!, who, input.threadId, agentId);
  const all = await points({ gitDir: storeOf(dataDir!, dir), workDir: dir, limit: 500 });
  // a turn's point, or the one a rewind took first (so a rewind can itself be undone)
  const point = all.find((p) => p.sha === sha && (p.label.startsWith("turn ") || p.label === "Before going back"));
  if (!point) raise(ctx, "validation.not_found", "That point is not in this chat.");
  const r = await restore({ gitDir: storeOf(dataDir!, dir), workDir: dir, sha, now: ctx.now() });
  // going back to the point a rewind took first undoes that rewind: the messages the agents had stopped reading are read again
  const undone = ctx.db.all(
    "SELECT rowid AS id, after_seq, upto_seq FROM engine_rewind WHERE thread_id = ? AND undo_sha = ?",
    input.threadId,
    sha,
  ) as Array<Record<string, unknown>>;
  if (undone.length > 0) {
    for (const u of undone) {
      ctx.db.run("DELETE FROM engine_rewind WHERE rowid = ?", u["id"]);
      try {
        boundEngine(ctx).unhide(input.threadId, Number(u["after_seq"]), Number(u["upto_seq"]));
      } catch {
        /* the thread is not open here: the ranges are read when it is */
      }
    }
  } else {
    // the agents read the chat as it was at the point: the messages after it are hidden from them (the chat shows them all), and the engine's own session starts again from what is left
    ctx.db.run(
      "INSERT INTO engine_rewind (thread_id, after_seq, upto_seq, by_person, at, undo_sha) VALUES (?, ?, ?, ?, ?, ?)",
      input.threadId,
      input.afterSeq,
      input.uptoSeq,
      who,
      ctx.now(),
      r.undoPoint.sha,
    );
    try {
      boundEngine(ctx).hide(input.threadId, input.afterSeq, input.uptoSeq);
    } catch {
      /* the thread is not open here: the range is read when it is */
    }
  }
  forgetSessions(ctx.db, input.threadId, agentId);
  await dropWarmSessions(input.threadId); // the engine's own memory of what was undone goes with its session
  return {
    agentId,
    at: point!.at,
    restored: r.restored,
    removed: r.removed,
    undoPointId: `${agentId}.${r.undoPoint.sha}`,
    undid: undone.length > 0,
  };
}
