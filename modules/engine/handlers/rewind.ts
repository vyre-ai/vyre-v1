// Rewind (chat gap G36, G37; DESIGN-chat-system item 20): go back to a point in a private chat with an agent.
//   engine.rewind.points  the points a person can go back to: one per turn of an agent that worked in a folder on this computer for them, newest first, with when, how many files and what they had just asked
//   engine.rewind.to       put that agent's folder back as it was at the point, hide the messages after it from the agents (the chat still shows them), forget the engine's own session so it starts from what is left
// What it undoes: the files in the agent's work folder, and what the agents read as history. What it never touches: the messages themselves, anything already sent (email, messages, posts), records and tasks, other
// computers and servers, files outside the work folder. Off in a chat with other people: it is one person's own agent's folder. A person reaches only their own folders (the store is derived from who is calling).
import { points, restore, snapshot, storeOf } from "../checkpoints.ts";
import { liveTurns } from "./bridge.ts";
import { holdTurns } from "../rewind-gate.ts";
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
  /** The point a rewind or an Undo took first: going back to it undoes that one. */
  undo?: boolean;
  /** The folder was read after the agent had begun: the folder "during" the turn, never "before" the message. */
  during?: boolean;
}

const MAX_POINTS = 30;

/** A rewind of this chat that is in force (kind "rewind", the range is folded away for everyone), or one that did not finish (`interrupted`: the files may be half put back, nothing is folded). `undoPointId` only for the person who went back. */
export interface ActiveRewind {
  afterSeq: number;
  uptoSeq: number;
  by: string;
  at: number;
  undoPointId?: string;
  interrupted?: boolean;
}

interface Row {
  rowid: number;
  after_seq: number;
  upto_seq: number;
  by_person: string;
  at: number;
  undo_sha: string | null;
  kind: string;
  state: string;
}

function rowsOf(ctx: EngineCtx, threadId: string): Row[] {
  try {
    return (
      ctx.db.all(
        "SELECT rowid AS rowid, after_seq, upto_seq, by_person, at, undo_sha, kind, state FROM engine_rewind WHERE thread_id = ? ORDER BY at, rowid",
        threadId,
      ) as Array<Record<string, unknown>>
    ).map((r) => ({
      rowid: Number(r["rowid"]),
      after_seq: Number(r["after_seq"]),
      upto_seq: Number(r["upto_seq"]),
      by_person: String(r["by_person"]),
      at: Number(r["at"]),
      undo_sha: r["undo_sha"] === null || r["undo_sha"] === undefined ? null : String(r["undo_sha"]),
      kind: String(r["kind"] ?? "rewind"),
      state: String(r["state"] ?? "done"),
    }));
  } catch {
    return [];
  }
}

/** The points a rewind or an Undo of this chat took first, that can still be gone back to (their row is there). */
const undoable = (ctx: EngineCtx, threadId: string): Set<string> =>
  new Set(
    rowsOf(ctx, threadId)
      .filter((r) => r.undo_sha !== null)
      .map((r) => r.undo_sha!),
  );

const POINT = /^(agt_[A-Za-z0-9_]+)\.([0-9a-f]{40})$/;

interface ThreadOut {
  thread?: { kind?: string; channelId?: string; members?: Array<{ id: string }>; agents?: Array<{ agentId: string }> };
}

/** A chat with agents that is not a channel (one person's, or a few people's). Each person goes back only through their own points: the work folder and the points are per person. */
async function agentChat(
  ctx: EngineCtx,
  threadId: string,
): Promise<{ ok: true; agents: string[] } | { ok: false; why: "not_a_chat" }> {
  const t = ((await ctx.call("threads.get", { threadId })) as ThreadOut).thread;
  if (!t || t.kind !== "chat" || t.channelId !== undefined) return { ok: false, why: "not_a_chat" };
  return { ok: true, agents: (t.agents ?? []).map((a) => a.agentId) };
}

function person(ctx: EngineCtx): string {
  if (ctx.principal.kind !== "person") raise(ctx, "permission.role_lacks_permission", "Only a person goes back.");
  return ctx.principal.id;
}

/** What the engine knows of who is working: a turn of this agent in this chat that has not ended. */
export interface RewindDeps {
  busy?: (threadId: string, agentId: string) => boolean | Promise<boolean>;
  /** Where the agent's turns for this person run: "device" is the person's own computer, which has no points here. */
  placement?: (threadId: string, agentId: string) => Promise<string | undefined>;
  /** For tests: runs after the row is written and before the files are put back (where a crash would cut the act short). */
  beforeRestore?: () => void | Promise<void>;
  /** For tests: how a path is removed. */
  rm?: (p: string) => void;
}

async function turnRunning(ctx: EngineCtx, threadId: string, agentId: string): Promise<boolean> {
  try {
    return (await liveTurns(ctx, { threadId })).turns.some((t) => t.agentId === agentId);
  } catch {
    return false; // no engine bound here: nothing is running
  }
}

async function placementOf(ctx: EngineCtx, threadId: string, agentId: string): Promise<string | undefined> {
  try {
    return (
      (await ctx.call("engine.placement.decide", { threadId, agentId, kind: "message" })) as { placement?: string }
    ).placement;
  } catch {
    return undefined;
  }
}

export async function rewindPoints(ctx: EngineCtx, input: { threadId: string }) {
  return pointsIn(ctx, input, engineHost()?.dataDir);
}

/** The same with the Space's data folder given (the handler reads it from the host seam; a test gives its own). */
export async function pointsIn(
  ctx: EngineCtx,
  input: { threadId: string },
  dataDir: string | undefined,
  deps: RewindDeps = {},
): Promise<{
  available: boolean;
  why?: string;
  ownComputer: boolean;
  points: RewindPoint[];
  active: ActiveRewind[];
}> {
  ensure(ctx.db);
  const who = person(ctx);
  const chat = await agentChat(ctx, input.threadId);
  if (!chat.ok) return { available: false, why: chat.why, ownComputer: false, points: [], active: [] };
  const active = activeIn(ctx, input.threadId, who);
  if (!dataDir) return { available: false, why: "no_folder", ownComputer: false, points: [], active };
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
  const undoSet = undoable(ctx, input.threadId);
  let ownComputer = false;
  for (const agentId of chat.agents) {
    // a turn on the person's own computer takes no point here (nothing of that folder is on this server): the card says so once
    const place = await (deps.placement ?? ((t: string, a: string) => placementOf(ctx, t, a)))(input.threadId, agentId);
    if (place === "device") ownComputer = true;
    let dir: string;
    try {
      dir = workFolder(dataDir, who, input.threadId, agentId);
    } catch {
      continue;
    }
    for (const p of await points({ gitDir: storeOf(dataDir, dir), workDir: dir, limit: MAX_POINTS })) {
      const undo = p.label === "Before going back" && undoSet.has(p.sha);
      const turn = /^(turn|during) \S+ (\S+)$/.exec(p.label);
      // a point with no message behind it (a turn nobody asked in this chat) cannot be gone back to: the range of messages to fold starts at a message
      if (!turn && !undo) continue;
      const msgId = turn?.[2];
      const ask = msgId !== undefined ? said.get(msgId) : undefined;
      out.push({
        pointId: `${agentId}.${p.sha}`,
        agentId,
        at: p.at,
        files: p.files,
        ...(undo ? { undo: true } : {}),
        ...(p.during ? { during: true } : {}),
        ...(msgId && !undo ? { messageId: msgId } : {}),
        ...(ask !== undefined && !undo ? { after: ask.trim().replace(/\s+/g, " ").slice(0, 60) } : {}),
      });
    }
  }
  for (const a of active)
    if (a.undoPointId !== undefined) {
      const sha = a.undoPointId.slice(2);
      const hit = out.find((p) => p.undo === true && p.pointId.endsWith(`.${sha}`));
      if (hit) a.undoPointId = hit.pointId;
      else delete a.undoPointId; // the point is gone (kept 14 days): it cannot be undone any more
    }
  return { available: true, ownComputer, points: out.sort((a, b) => b.at - a.at).slice(0, MAX_POINTS), active };
}

function activeIn(ctx: EngineCtx, threadId: string, who: string): ActiveRewind[] {
  return rowsOf(ctx, threadId)
    .filter((r) => r.undo_sha !== null && ((r.kind === "rewind" && r.state === "done") || r.state === "going back"))
    .map((r) => ({
      afterSeq: r.after_seq,
      uptoSeq: r.upto_seq,
      by: r.by_person,
      at: r.at,
      ...(r.state === "going back" ? { interrupted: true } : {}),
      ...(r.by_person === who ? { undoPointId: `*.${r.undo_sha}` } : {}), // the agent is filled in from the points
    }));
}

/** At start-up: a rewind row still "going back" was cut short (the host stopped between the files and the chat). The row is kept and shown with Undo (activeIn); nothing is hidden for it. Returns how many. */
export function interruptedCount(ctx: EngineCtx): number {
  try {
    return (
      ctx.db.all("SELECT COUNT(*) AS n FROM engine_rewind WHERE state = 'going back'") as Array<Record<string, unknown>>
    )[0]?.["n"] as number;
  } catch {
    return 0;
  }
}

export async function rewind(ctx: EngineCtx, input: { threadId: string; pointId: string }) {
  return rewindIn(ctx, input, engineHost()?.dataDir);
}

/**
 * Go back to a point. THE rule lives here, once, for every caller (chat.rewind only leaves the line in the chat afterwards):
 *   - a person, in a chat with an agent that is not a channel, with Use on it (the same level as posting);
 *   - the point is theirs: it is in their own work folder of that agent;
 *   - the range to fold starts at the point's own message, which must be theirs, and runs to the newest message: the caller does not choose it;
 *   - not while that agent has a turn running in the chat (it races the agent's own writes): "Stop <name> first, then go back".
 * The order is: take the point of now (so it can be undone), write the row as "going back", put the files back, then fold the messages and finish the row. A crash in between leaves the row, which is listed with Undo.
 */
export async function rewindIn(
  ctx: EngineCtx,
  input: { threadId: string; pointId: string },
  dataDir: string | undefined,
  deps: RewindDeps = {},
): Promise<{
  agentId: string;
  at: number;
  restored: number;
  removed: number;
  failed: number;
  failedPaths: string[];
  undoPointId: string;
  undid: boolean;
  during: boolean;
  afterSeq: number;
  uptoSeq: number;
}> {
  ensure(ctx.db);
  const who = person(ctx);
  const chat = await agentChat(ctx, input.threadId);
  if (!chat.ok) raise(ctx, "validation.precondition_failed", "Only a chat with an agent goes back.");
  const m = POINT.exec(input.pointId);
  if (!m || !chat.agents!.includes(m[1]!)) raise(ctx, "validation.not_found", "That point is not in this chat.");
  const [, agentId, sha] = m as unknown as [string, string, string];
  if (!dataDir) raise(ctx, "validation.precondition_failed", "This computer has no folders to go back in.");
  const busy = deps.busy ?? ((t: string, a: string) => turnRunning(ctx, t, a));
  // turn starts of this agent in this chat wait from here until the rewind is over (rewind-gate.ts); then "is it busy" is read, and read again after the point of now is taken
  const release = holdTurns(input.threadId, agentId);
  try {
    return await go(release);
  } finally {
    release();
  }
  async function go(_release: () => void) {
    const stop = async (): Promise<never> => {
      let name = "the agent";
      try {
        name = String(
          ((await ctx.call("agents.get", { agentId })) as { agent?: { name?: string } }).agent?.name || name,
        );
      } catch {
        /* the plain word stands */
      }
      return raise(ctx, "validation.precondition_failed", `Stop ${name} first, then go back.`);
    };
    if (await busy(input.threadId, agentId)) await stop();
    const dir = workFolder(dataDir!, who, input.threadId, agentId);
    const gitDir = storeOf(dataDir!, dir);
    const all = await points({ gitDir, workDir: dir, limit: 500 });
    // a turn's point, or the one a rewind or an Undo took first (so either can itself be undone)
    const point = all.find(
      (p) => p.sha === sha && (/^(turn|during) /.test(p.label) || p.label === "Before going back"),
    );
    if (!point) raise(ctx, "validation.not_found", "That point is not in this chat.");
    const rows = rowsOf(ctx, input.threadId);
    const undone = rows.filter((r) => r.undo_sha === sha);
    let after: number;
    let upto: number;
    if (undone.length > 0) {
      // going back to the point a rewind or an Undo took first: the other way round, over the same range
      after = undone[0]!.after_seq;
      upto = undone[0]!.upto_seq;
    } else {
      const msgId = /^(?:turn|during) \S+ (\S+)$/.exec(point!.label)?.[1];
      if (!msgId) raise(ctx, "validation.not_found", "That point is not in this chat.");
      const msg = (
        (await ctx.call("chat.message.get", { threadId: input.threadId, messageId: msgId })) as {
          message?: { threadSeq: number; author: { id: string }; threadId?: string };
        }
      ).message;
      if (!msg) raise(ctx, "validation.not_found", "That point is not in this chat.");
      if (msg!.author.id !== who)
        raise(ctx, "validation.precondition_failed", "You can only go back to your own message.");
      const list = (await ctx.call("chat.messages.list", { threadId: input.threadId, limit: 5 })) as {
        messages: Array<{ threadSeq: number }>;
      };
      after = Math.max(0, msg!.threadSeq - 1);
      upto = Math.max(after, ...list.messages.map((x) => x.threadSeq));
    }
    const undoing = undone.length > 0 && undone[0]!.kind === "rewind"; // going back to a rewind's own point undoes it
    const newKind = undone.length > 0 ? (undone[0]!.kind === "rewind" ? "undo" : "rewind") : "rewind";
    void undoing;
    // 1. the point of now, so this can be undone; 2. the row, "going back"; 3. the files
    const undoPoint = await snapshot({ gitDir, workDir: dir, label: "Before going back", now: ctx.now() });
    // read again: a turn that started in the gap between the first look and now (it was queued behind this rewind) is running, and would write while the files move
    if (await busy(input.threadId, agentId)) await stop();
    const rowId = Number(
      (
        ctx.db.run(
          "INSERT INTO engine_rewind (thread_id, after_seq, upto_seq, by_person, at, undo_sha, kind, state) VALUES (?, ?, ?, ?, ?, ?, ?, 'going back')",
          input.threadId,
          after,
          upto,
          who,
          ctx.now(),
          undoPoint.sha,
          newKind,
        ) as unknown as { lastInsertRowid?: number | bigint }
      )?.lastInsertRowid ?? 0,
    );
    await deps.beforeRestore?.();
    const r = await restore({
      gitDir,
      workDir: dir,
      sha,
      now: ctx.now(),
      already: undoPoint,
      ...(deps.rm ? { rm: deps.rm } : {}),
    });
    // 4. the chat: the old row goes, the messages are folded (a rewind) or read again (an Undo), and the new row is finished
    try {
      for (const u of undone) ctx.db.run("DELETE FROM engine_rewind WHERE rowid = ?", u.rowid);
      try {
        if (newKind === "rewind") boundEngine(ctx).hide(input.threadId, after, upto);
        else boundEngine(ctx).unhide(input.threadId, after, upto);
      } catch {
        /* the thread is not open here: the range is read when it is */
      }
      ctx.db.run(
        rowId > 0
          ? "UPDATE engine_rewind SET state = 'done' WHERE rowid = ?"
          : "UPDATE engine_rewind SET state = 'done' WHERE thread_id = ? AND undo_sha = ? AND state = 'going back'",
        ...(rowId > 0 ? [rowId] : [input.threadId, undoPoint.sha]),
      );
      forgetSessions(ctx.db, input.threadId, agentId);
      await dropWarmSessions(input.threadId); // the engine's own memory of what was undone goes with its session
    } catch {
      raise(
        ctx,
        "validation.precondition_failed",
        "The files were put back, but the chat could not be updated. Press Undo on the line that says so to bring them back.",
      );
    }
    return {
      agentId,
      at: point!.at,
      restored: r.restored,
      removed: r.removed,
      failed: r.failed,
      failedPaths: r.failedPaths,
      undoPointId: `${agentId}.${undoPoint.sha}`,
      undid: newKind === "undo",
      during: point!.during === true,
      afterSeq: after,
      uptoSeq: upto,
    };
  }
}
