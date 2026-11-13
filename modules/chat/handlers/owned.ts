// Agents a chat made for itself, and the grants a chat gave an outside agent (lane l-addsheet). Both end with the chat or when the agent is taken out of it.
//   owned     chat_thread_agent.owned = 1: the agent was made with threads.agent.create. It goes to Trash (agents.delete) when the chat is deleted or erased, or when it is removed from the chat, and comes
//             back with threads.restore. A person who may not delete it cannot move it: the call is tolerated, never swallowed (a warning says so).
//   grants    chat_thread_agent.grants: the resources threads.outside_agent.add shared with the agent, each with the source tag chat:<threadId>. Removing the agent takes them back at once.
import { channelBy, ensure, isMember, membersOf, threadBy } from "../projections.ts";
import { canSpeak, rootOf } from "./post.ts";
import type { ChatCtx } from "../projections.ts";
import { oneAtATime } from "../../../lib/one-at-a-time.ts";

type Row = Record<string, unknown>;
export const sourceOf = (threadId: string): string => `chat:${threadId}`;
export interface Granted {
  type: string;
  id: string;
  level: string;
}

const warn = (ctx: ChatCtx, what: string, e: unknown, attrs: Record<string, unknown>): void =>
  ctx.log.warn(what, {
    ...attrs,
    error:
      e instanceof Error
        ? e.message.slice(0, 200)
        : String((e as { error?: { code?: string } } | null)?.error?.code ?? e),
  });

/** The agents these chats made for themselves and still hold. */
export function ownedIn(ctx: ChatCtx, threads: readonly string[]): string[] {
  ensure(ctx.db);
  if (threads.length === 0) return [];
  const marks = threads.map(() => "?").join(", ");
  return [
    ...new Set(
      (
        ctx.db.all(
          `SELECT "agentId" FROM chat_thread_agent WHERE "thread" IN (${marks}) AND "owned" = 1 AND "deleted_at" IS NULL`,
          ...threads,
        ) as Row[]
      ).map((r) => String(r["agentId"])),
    ),
  ];
}

/** Move the agents these chats made to Trash (or back out of it). Answers how many moved. */
export async function trashOwned(ctx: ChatCtx, agents: readonly string[], back = false): Promise<number> {
  if (!ctx.call) return 0;
  let n = 0;
  for (const agentId of agents) {
    try {
      await ctx.call(back ? "agents.restore" : "agents.delete", { agentId });
      n += 1;
    } catch (e) {
      warn(
        ctx,
        back ? "a chat's own agent could not be restored" : "a chat's own agent could not be moved to Trash",
        e,
        { agentId },
      );
    }
  }
  return n;
}

export function grantsOf(ctx: ChatCtx, threadId: string, agentId: string): Granted[] {
  ensure(ctx.db);
  const raw = (
    ctx.db.all(
      `SELECT "grants" FROM chat_thread_agent WHERE "thread" = ? AND "agentId" = ? AND "deleted_at" IS NULL`,
      threadId,
      agentId,
    ) as Row[]
  )[0]?.["grants"];
  try {
    const v = JSON.parse(String(raw ?? "[]")) as unknown;
    return Array.isArray(v) ? (v as Granted[]) : [];
  } catch {
    return [];
  }
}

/** Take back every grant the chat gave this agent, each by its source tag. A failure stops the removal and is said: access never stays behind in silence. Answers how many grants went. */
export async function revokeGrants(
  ctx: ChatCtx,
  threadId: string,
  agentId: string,
  granted: readonly Granted[],
): Promise<number> {
  if (!ctx.call) return 0;
  let revoked = 0;
  for (const g of granted) {
    try {
      const r = (await ctx.call("access.unshare", {
        resource: { type: g.type, id: g.id },
        subject: { kind: "agent", id: agentId },
        source: sourceOf(threadId),
      })) as { revoked?: number } | null;
      revoked += Number(r?.revoked ?? 0);
    } catch (e) {
      warn(ctx, "a grant given to an outside agent could not be taken back", e, {
        threadId,
        agentId,
        resource: `${g.type}:${g.id}`,
      });
      throw e;
    }
  }
  return revoked;
}

// ---- who sees an agent a chat made for itself (owner ruling, 4 Nov 2026) -----------------------------------------------------------------------------------
// An agent follows grants, so the chat grants it: everyone who can read the chat can see it, chat with it and poke it, whoever made it. A person who joins gets the grant, a person who leaves loses it.
// Each grant carries the source tag chat:<threadId>, so taking it back never touches a share someone made by hand. A grant that cannot be made is said in the log and the chat goes on.

type Subject = { kind: "person" | "group"; id: string };

/** Does this person read this chat now: the chat module's own rule, asked as them (the same answer they get when they press it). */
function readsChat(ctx: ChatCtx, threadId: string, person: string): boolean {
  const t = threadBy(ctx.db, threadId);
  if (!t) return false;
  const reader: ChatCtx = { ...ctx, principal: { kind: "person", id: person } };
  delete (reader as { actingFor?: string }).actingFor;
  return canSpeak(reader, t);
}

/** What this chat's source already gives this agent's readers, as keys: "agent:<subject>" on the agent (the agent's own hold on itself is "agent:<agent id>"), "folder:<folder>:<subject>". */
type Held = ReadonlySet<string>;

async function grant(ctx: ChatCtx, threadId: string, agentId: string, subject: Subject, held?: Held): Promise<void> {
  if (!ctx.call) return;
  // checked again where it is written, in the person's queue: a reader read before a removal that ran first in this queue is no longer one, and gets nothing (review S7-1)
  if (subject.kind === "person" && !readsChat(ctx, threadId, subject.id)) return;
  // a sweep that finds the grant already there writes nothing: a quiet day is no audit row and no access sync (review, rounds eleven and twelve)
  if (!held?.has(`agent:${subject.id}`))
    try {
      // a fresh part per real add: a key names this one request, so the same pair shared again after a removal is written again (a key of ids alone replayed the first answer)
      const add = globalThis.crypto.randomUUID();
      await ctx.call(
        "access.share",
        {
          resource: { type: "agent", id: agentId },
          subject,
          level: "view",
          source: sourceOf(threadId),
          idempotencyKey: `own:${threadId}:${agentId}:${subject.id}:${add}`,
        },
        { idempotencyKey: `own:${threadId}:${agentId}:${subject.id}:${add}` },
      );
    } catch (e) {
      warn(ctx, "a chat's own agent could not be shown to a reader of the chat", e, {
        threadId,
        agentId,
        subject: subject.id,
      });
    }
  // the agent's files folder follows a closed chat: its readers keep it by a grant of the same source (the folder is cut off from the Space, followHome). At Edit, what the Member role gave them
  // before: the agent writes its notes there in a turn a reader asked for, and an agent's write is capped by the asker's own access
  if (!homeIsClosed(ctx, threadId)) return;
  const folderId = await folderOf(ctx, agentId);
  if (!folderId || held?.has(`folder:${folderId}:${subject.id}`)) return;
  try {
    const add = globalThis.crypto.randomUUID();
    await ctx.call(
      "access.share",
      {
        resource: { type: "folder", id: folderId },
        subject,
        level: "edit",
        source: sourceOf(threadId),
        idempotencyKey: `ownf:${threadId}:${agentId}:${subject.id}:${add}`,
      },
      { idempotencyKey: `ownf:${threadId}:${agentId}:${subject.id}:${add}` },
    );
  } catch (e) {
    warn(ctx, "a chat's own agent's folder could not be opened to a reader of the chat", e, {
      threadId,
      agentId,
      subject: subject.id,
    });
  }
}

// ---- the files folder of an agent a chat made follows that chat --------------------------------------------------------------------------------------
// What an agent keeps from its work in a chat lands in its own folder (agent/skills/focus-files "Your own folder"). For a chat closed to the Space (a private chat, a thread of an invite-only
// channel) that folder must be closed the same way: cut off from the Space (access audience "added": the Space roles do not reach it; its owner and the Space's owners and admins keep it), and
// open to the chat's readers by grants of the chat's source, which leaving takes back with the agent's own (leaveThreads). An open channel's agent keeps its folder open to the Space.

/** Is this chat closed to the Space: a private chat, or a thread under an invite-only channel. */
export function homeIsClosed(ctx: ChatCtx, threadId: string): boolean {
  const t = threadBy(ctx.db, threadId);
  if (!t) return false;
  const root = rootOf(ctx, t);
  if (root.channelId === undefined) return root.kind === "chat" || root.kind === "ask";
  return channelBy(ctx.db, root.channelId)?.visibility === "invite";
}

async function folderOf(ctx: ChatCtx, agentId: string): Promise<string | undefined> {
  if (!ctx.call) return undefined;
  try {
    return ((await ctx.call("agents.get", { agentId })) as { agent?: { folderId?: string } }).agent?.folderId;
  } catch {
    return undefined;
  }
}

/** The chats that made this agent (its homes). One, unless an older build gave it a second. */
export function homesOf(ctx: ChatCtx, agentId: string): string[] {
  ensure(ctx.db);
  return (
    ctx.db.all(
      `SELECT "thread" FROM chat_thread_agent WHERE "agentId" = ? AND "owned" = 1 AND "deleted_at" IS NULL`,
      agentId,
    ) as Row[]
  ).map((r) => String(r["thread"]));
}

/**
 * Set the agent's folder to follow its chat now: closed to the Space when the chat is, open to the Space when it is not. With more than one home the folder is as private as its most private
 * home: closed when any of them is. Throws when it cannot: a folder left open would be a leak.
 */
export async function followHome(ctx: ChatCtx, threadId: string, agentId: string, held?: Held): Promise<void> {
  if (!ctx.call) return;
  const folderId = await folderOf(ctx, agentId);
  const closed = closedFor(ctx, threadId, agentId);
  // the agent itself follows the chat the same way (owner decision, 12 Nov 2026: reachable only by the chat's readers, those it was shared with, and those who manage it). Cut off from the Space,
  // it keeps its own hold on itself (its routines, its own record) by a grant of the chat's source, written before the cut
  if (closed && !held?.has(`agent:${agentId}`))
    await ctx.call("access.share", {
      resource: { type: "agent", id: agentId },
      subject: { kind: "agent", id: agentId },
      level: "edit",
      source: sourceOf(threadId),
      idempotencyKey: `ownself:${threadId}:${agentId}:${globalThis.crypto.randomUUID()}`,
    });
  if (folderId)
    await ctx.call("access.audience_set", {
      resource: { type: "folder", id: folderId },
      audience: closed ? "added" : "space",
    });
  await ctx.call("access.audience_set", {
    resource: { type: "agent", id: agentId },
    audience: closed ? "added" : "space",
  });
}

/** Is this agent's folder, and the agent, closed: when any of its homes is closed (the most private home wins). */
export function closedFor(ctx: ChatCtx, threadId: string, agentId: string): boolean {
  return [...new Set([threadId, ...homesOf(ctx, agentId)])].some((h) => homeIsClosed(ctx, h));
}

// A person's grants from chats are written and taken back in one queue per person (lib/one-at-a-time.ts): a grant still being written for a newcomer can never land after the same person was
// taken out, because the removal waits for it and then takes it back, and a grant planned after the removal checks the membership first and finds it gone.
const queueOf = (ctx: ChatCtx, person: string): string => `chat:${ctx.space}:${person}`;
const limits = (ctx: ChatCtx) => ({
  onLimit: (key: string, ms: number) =>
    ctx.log.warn("chat: a membership change took too long; the next one runs", { key, limitMs: ms }),
});

/** A new chat agent: shown to each of these readers (a public channel's is the whole Space). `still` says whether a person reader still reads the chat when their grant is written. */
export async function shareOwnedWithReaders(
  ctx: ChatCtx,
  threadId: string,
  agentId: string,
  readers: readonly Subject[],
  still: (person: string) => boolean = () => true,
): Promise<void> {
  for (const s of readers) {
    if (s.kind !== "person") {
      await grant(ctx, threadId, agentId, s);
      continue;
    }
    await oneAtATime(
      queueOf(ctx, s.id),
      async () => {
        if (still(s.id)) await grant(ctx, threadId, agentId, s);
      },
      limits(ctx),
    );
  }
}

/** A person joined the chat: every agent the chat made for itself is shown to them, while they are still in it. */
export async function shareOwnedWith(ctx: ChatCtx, threadId: string, person: string): Promise<void> {
  await oneAtATime(
    queueOf(ctx, person),
    async () => {
      for (const agentId of ownedIn(ctx, [threadId])) {
        if (!isMember(ctx.db, threadId, person)) return;
        await grant(ctx, threadId, agentId, { kind: "person", id: person });
      }
    },
    limits(ctx),
  );
}

/**
 * Bring one agent a chat made in line with who reads that chat now: its folder follows the chat (followHome), and the chat's readers hold the agent and, for a closed chat, its folder by
 * grants of the chat's source. A closed chat's readers are its root's people (and its starter); an open channel's is the Space. Run when a channel's visibility changes and once at start.
 */
export async function convergeAgent(ctx: ChatCtx, threadId: string, agentId: string): Promise<void> {
  const t = threadBy(ctx.db, threadId);
  if (!t || !ctx.call) return;
  const root = rootOf(ctx, t);
  if (homeIsClosed(ctx, threadId)) {
    // the readers' grants first, then the cut: a sweep stopped half way leaves the folder as it was or closed with its readers in, never closed with them out. Run twice, it writes the same
    // grants again (a grant of the same subject, resource and source is updated in place) and sets the same audience
    const readers = [
      ...new Set([
        ...(root.starter?.startsWith("usr_") ? [root.starter] : []),
        ...membersOf(ctx.db, root.id).filter((p) => p.startsWith("usr_")),
      ]),
    ];
    const given = await givenBy(ctx, threadId, agentId);
    for (const person of readers)
      await oneAtATime(
        queueOf(ctx, person),
        async () => {
          await grant(ctx, threadId, agentId, { kind: "person", id: person }, given.held);
        },
        limits(ctx),
      );
    // what this chat gave someone who no longer reads it (a race, or an older version) goes: the sweep heals, not only adds (review S7-1)
    await dropStale(ctx, threadId, given.people);
    await followHome(ctx, threadId, agentId, given.held);
    // a chat that was open gave the whole Space its agent: that goes now (when it is there)
    if (given.held.has("agent:space"))
      try {
        await ctx.call("access.unshare", {
          resource: { type: "agent", id: agentId },
          subject: { kind: "group", id: "space" },
          source: sourceOf(threadId),
        });
      } catch (e) {
        warn(ctx, "an agent a chat made stayed shown to the whole Space after the chat was closed", e, {
          threadId,
          agentId,
        });
        throw e;
      }
  } else if (closedFor(ctx, threadId, agentId)) {
    // an open home of an agent another, closed home made private: the open chat gives the Space nothing (the most private home wins)
    const given = await givenBy(ctx, threadId, agentId);
    await followHome(ctx, threadId, agentId, given.held);
    if (given.held.has("agent:space"))
      try {
        await ctx.call("access.unshare", {
          resource: { type: "agent", id: agentId },
          subject: { kind: "group", id: "space" },
          source: sourceOf(threadId),
        });
      } catch (e) {
        warn(ctx, "an agent with a closed home stayed shown to the whole Space", e, { threadId, agentId });
        throw e;
      }
  } else {
    const given = await givenBy(ctx, threadId, agentId);
    await followHome(ctx, threadId, agentId, given.held);
    await grant(ctx, threadId, agentId, { kind: "group", id: "space" }, given.held);
  }
}

/** The page limit, and how many pages one pass reads: a chat given to more people than this is finished by the next pass (the sweep is daily, and every leave and join keeps it in step). */
const GRANT_PAGE = 500,
  GRANT_PAGES = 20;

/** Every grant of this chat's source, paged and bounded: what it already gives (held, for this agent and its folder) and to which people. */
async function givenBy(
  ctx: ChatCtx,
  threadId: string,
  agentId: string,
): Promise<{ held: Set<string>; people: Set<string> }> {
  const held = new Set<string>(),
    people = new Set<string>();
  if (!ctx.call) return { held, people };
  let cursor: string | undefined;
  for (let page = 0; page < GRANT_PAGES; page++) {
    let out: {
      grants?: Array<{ subject?: { kind?: string; id?: string }; resource?: { type?: string; id?: string } }>;
      next?: string;
    };
    try {
      out = (await ctx.call("access.grants.list", {
        source: sourceOf(threadId),
        limit: GRANT_PAGE,
        ...(cursor ? { cursor } : {}),
      })) as typeof out;
    } catch (e) {
      warn(ctx, "who a chat gave its agent to could not be read", e, { threadId });
      throw e;
    }
    for (const g of out.grants ?? []) {
      const sid = g.subject?.id,
        rid = g.resource?.id;
      if (!sid || !rid) continue;
      if (g.subject?.kind === "person") people.add(sid);
      if (g.resource?.type === "agent" && rid === agentId) held.add(`agent:${sid}`);
      if (g.resource?.type === "folder") held.add(`folder:${rid}:${sid}`);
    }
    if (!out.next) break;
    cursor = out.next;
  }
  return { held, people };
}

/** The person grants of this chat's source held by someone who no longer reads the chat, taken back, each in that person's queue and checked again there. */
async function dropStale(ctx: ChatCtx, threadId: string, people: ReadonlySet<string>): Promise<void> {
  if (!ctx.call) return;
  for (const person of people) {
    if (readsChat(ctx, threadId, person)) continue;
    await oneAtATime(
      queueOf(ctx, person),
      async () => {
        if (readsChat(ctx, threadId, person)) return;
        await ctx.call!("access.unshare", { subject: { kind: "person", id: person }, source: sourceOf(threadId) });
      },
      limits(ctx),
    );
  }
}

/** Every agent the threads of this chat made, brought in line (convergeAgent). */
export async function convergeHome(ctx: ChatCtx, root: string): Promise<void> {
  for (const threadId of familyOf(ctx, root))
    for (const agentId of ownedIn(ctx, [threadId])) await convergeAgent(ctx, threadId, agentId);
}

/** Once at start, and daily: every agent a chat made, in line with its chat (agents and folders made before folders followed their chats are brought in line). */
export async function convergeAllHomes(ctx: ChatCtx): Promise<void> {
  ensure(ctx.db);
  const rows = ctx.db.all(
    `SELECT "thread", "agentId" FROM chat_thread_agent WHERE "owned" = 1 AND "deleted_at" IS NULL`,
  ) as Row[];
  for (const r of rows) {
    try {
      await convergeAgent(ctx, String(r["thread"]), String(r["agentId"]));
    } catch (e) {
      warn(ctx, "an agent a chat made could not be brought in line with its chat", e, {
        threadId: String(r["thread"]),
        agentId: String(r["agentId"]),
      });
    }
  }
}

/** A person came into a chat or a channel: the agents its threads made, in the threads they can now read, are shown to them, and for a closed chat their folders too. */
export async function joinThreads(ctx: ChatCtx, joined: string, person: string): Promise<void> {
  await oneAtATime(
    queueOf(ctx, person),
    async () => {
      const reader: ChatCtx = { ...ctx, principal: { kind: "person", id: person } };
      delete (reader as { actingFor?: string }).actingFor;
      for (const threadId of familyOf(ctx, joined)) {
        const t = threadBy(ctx.db, threadId);
        if (!t || !canSpeak(reader, t) || !homeIsClosed(ctx, threadId)) continue;
        for (const agentId of ownedIn(ctx, [threadId]))
          await grant(ctx, threadId, agentId, { kind: "person", id: person });
      }
    },
    limits(ctx),
  );
}

/** A thread and the threads under it (a channel's main thread and its threads), to the depth threads nest. */
export function familyOf(ctx: ChatCtx, root: string): string[] {
  ensure(ctx.db);
  const out = [root];
  let level = [root];
  for (let depth = 0; depth < 8 && level.length > 0; depth++) {
    const next: string[] = [];
    for (const id of level)
      for (const r of ctx.db.all(`SELECT "id" FROM chat_thread WHERE "parentThreadId" = ?`, id) as Row[])
        next.push(String(r["id"]));
    out.push(...next);
    level = next;
  }
  return [...new Set(out)];
}

/**
 * A person leaves a chat or a channel, or is taken out (`drop` takes away their place in `left`). Their place goes first, so what follows sees them as they will be; then, for `left` and every
 * thread under it, the read path's own check (canSpeak, as that person) says whether they can still read it. A thread they cannot read any more loses what being in it gave them (their view of
 * the agents it made, each grant tagged with that thread) and their own place in it (a reply, a mention or Follow made them a member of an inline thread), so their membership and their access
 * say the same thing. A thread they can still read (an open channel's, or a private chat they stay in) keeps both. All in the person's queue; a grant that cannot be taken back fails the call and
 * gives them their place in `left` back, so access never stays behind in silence. Answers what `drop` answered.
 */
export async function leaveThreads(ctx: ChatCtx, left: string, person: string, drop: () => boolean): Promise<boolean> {
  return oneAtATime(
    queueOf(ctx, person),
    async () => {
      const row = (
        ctx.db.all(
          `SELECT "id" FROM chat_thread_member WHERE "thread" = ? AND "principal" = ? AND "deleted_at" IS NULL`,
          left,
          person,
        ) as Row[]
      )[0]?.["id"];
      const dropped = drop();
      try {
        const reader: ChatCtx = { ...ctx, principal: { kind: "person", id: person } };
        delete (reader as { actingFor?: string }).actingFor;
        const gone = familyOf(ctx, left).filter((id) => {
          const t = threadBy(ctx.db, id);
          return t === null || !canSpeak(reader, t);
        });
        // every grant this thread gave the person (its agents and their folders), by the thread's source
        if (ctx.call)
          for (const threadId of gone)
            if (ownedIn(ctx, [threadId]).length > 0) {
              try {
                await ctx.call("access.unshare", {
                  subject: { kind: "person", id: person },
                  source: sourceOf(threadId),
                });
              } catch (e) {
                warn(ctx, "a chat's own agent could not be taken out of a leaver's sight", e, {
                  threadId,
                  subject: person,
                });
                throw e;
              }
            }
        for (const threadId of gone)
          if (threadId !== left)
            ctx.db.run(
              `UPDATE chat_thread_member SET deleted_at = ?, version = version + 1, updated_at = ? WHERE thread = ? AND principal = ? AND deleted_at IS NULL`,
              ctx.now(),
              ctx.now(),
              threadId,
              person,
            );
      } catch (e) {
        if (dropped && row !== undefined)
          ctx.db.run(
            `UPDATE chat_thread_member SET deleted_at = NULL, version = version + 1, updated_at = ? WHERE "id" = ?`,
            ctx.now(),
            String(row),
          ); // the place in `left` comes back: nothing was left half done in silence
        throw e;
      }
      return dropped;
    },
    limits(ctx),
  );
}

/**
 * A person left these chats, or was taken out: what being in them gave (their view of the agents these chats made for themselves, each grant tagged with its chat) is taken back, and only then is
 * the membership dropped (`drop`), all in the person's queue. A grant that cannot be taken back fails the call and the person stays in, so access never stays behind in silence. A grant the person
 * holds for another reason (a direct share, another chat) carries another source and is not touched. Answers what `drop` answered.
 */
export async function unshareOwnedFrom(
  ctx: ChatCtx,
  threads: string | readonly string[],
  person: string,
  drop: () => boolean = () => true,
): Promise<boolean> {
  const list = typeof threads === "string" ? [threads] : threads;
  return oneAtATime(
    queueOf(ctx, person),
    async () => {
      if (ctx.call) {
        for (const threadId of list)
          if (ownedIn(ctx, [threadId]).length > 0) {
            try {
              await ctx.call("access.unshare", { subject: { kind: "person", id: person }, source: sourceOf(threadId) });
            } catch (e) {
              warn(ctx, "a chat's own agent could not be taken out of a leaver's sight", e, {
                threadId,
                subject: person,
              });
              throw e;
            }
          }
      }
      return drop();
    },
    limits(ctx),
  );
}
