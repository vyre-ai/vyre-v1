// The Chats sidebar's reads (design 13 Nov). chats.presence: who is around and which agents work now, composed from devices.presence and engine.now, which answer as the asker; what they refuse the asker, this
// answers nothing for (a guest has no team). A read that is not there, or fails, leaves that half empty: presence is a quiet dot, never a reason for the sidebar to fail.
import { FILTER_CHOICES, railCount, sectionsOf } from "../../../lib/sidebar.ts";
import type { FilterId, Item, SectionId } from "../../../lib/sidebar.ts";
import { askerOf, ensureLast, raise } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { mutedOf } from "./follow.ts";
import { ensureReadTable } from "./g24a.ts";
import { archivedIds } from "./archive-state.ts";

type PresenceOut = { people?: { personId: string; state: string }[] };
type NowOut = { working?: { agentId: string; since: number; threadId?: string }[] };

export async function chatsPresence(ctx: ChatCtx): Promise<{
  people: { personId: string; state: "online" | "away" }[];
  working: { agentId: string; threadId?: string; since: number }[];
}> {
  const call = ctx.call;
  const ask = async <T>(cap: string): Promise<T | null> => {
    if (!call) return null;
    try {
      return (await call(cap, {})) as T;
    } catch {
      return null;
    }
  };
  const [p, w] = await Promise.all([ask<PresenceOut>("devices.presence"), ask<NowOut>("engine.now")]);
  // a chat id leaves this read only for a chat the asker is in: the dot of an agent at work stays, the id of someone else's chat does not
  const asked = (w?.working ?? []).flatMap((x) => (x.threadId ? [x.threadId] : []));
  const mine = new Set<string>();
  if (asked.length > 0) {
    const ids = [...new Set(asked)];
    for (const r of ctx.db.all(
      `SELECT thread FROM chat_thread_member WHERE principal = ? AND deleted_at IS NULL AND thread IN (${ids.map(() => "?").join(", ")})`,
      askerOf(ctx),
      ...ids,
    ) as Record<string, unknown>[])
      mine.add(String(r["thread"]));
  }
  return {
    people: (p?.people ?? []).flatMap((x) =>
      x.state === "online" || x.state === "away" ? [{ personId: x.personId, state: x.state }] : [],
    ),
    working: (w?.working ?? []).map((x) => ({
      agentId: x.agentId,
      ...(x.threadId && mine.has(x.threadId) ? { threadId: x.threadId } : {}),
      since: x.since,
    })),
  };
}

// ---------------------------------------------------------------- chats.sidebar

export const SIDEBAR_PAGE = 50;
export const SIDEBAR_PAGE_MAX = 100;
const FILTER_IDS = FILTER_CHOICES.map((c) => c.id).filter((id) => id !== "all");

/** The one small port for the caller's own pins and mutes. Today's source: the caller's stars (newest first is the order) and the chat module's own mutes; the per-person state module replaces it with no change of shape. */
export interface SideSources {
  /** Item key to its place in the caller's pin order, 0 first. */
  pins(): Promise<Map<string, number>>;
  /** Thread ids the caller muted. */
  /** What the caller muted, by id of any kind (a chat's thread id, a channel, an agent, a person): the ids carry their kind in their prefix. */
  mutedThreads(): Set<string> | Promise<Set<string>>;
}

const PIN_KEY: Record<string, (id: string) => string> = {
  thread: (id) => `c:${id}`,
  channel: (id) => `ch:${id}`,
  project: (id) => `pj:${id}`,
  agent: (id) => `f:${id}`,
};

function todaysSources(ctx: ChatCtx, safe: Safe): SideSources {
  return {
    async pins() {
      const out = new Map<string, number>();
      const r = await safe<{ stars?: { resource: { type: string; id: string }; at: number }[] }>("stars.list", {});
      const stars = [...(r?.stars ?? [])].sort((a, b) => b.at - a.at);
      let n = 0;
      for (const st of stars) {
        const key = PIN_KEY[st.resource.type]?.(st.resource.id);
        if (key !== undefined && !out.has(key)) out.set(key, n++);
      }
      return out;
    },
    async mutedThreads() {
      const out = mutedOf(ctx, askerOf(ctx));
      const r = await safe<{ mutes?: { target: { id: string } }[] }>("notifications.mute.list", {});
      for (const m of r?.mutes ?? []) out.add(m.target.id);
      return out;
    },
  };
}

/**
 * The second implementation behind the port: the per-person state module. Pins come in the person's own manual order (state.list pinned, smaller is higher); mutes stay chat's own until they move; the chat things are the
 * kind chat (a chat, a one-to-one, a channel's own chat: the thing is the thread id). It is not the one in use: `sources` below says which is, and it is the stars-and-mutes one until the state module is on main.
 * Goals, projects and agents are not state things yet, so their pins stay on the stars, after the others.
 */
export function stateSources(
  ctx: ChatCtx,
  safe: Safe,
  channelOf: (threadId: string) => string | undefined,
): SideSources {
  return {
    async pins() {
      const out = new Map<string, number>();
      const r = await safe<{ rows?: { thing: { type: string; id: string }; pin?: number | null }[] }>("state.list", {
        flag: "pinned",
        type: "chat",
        limit: 500,
      });
      let n = 0;
      for (const row of [...(r?.rows ?? [])].sort((a, b) => (a.pin ?? 1e9) - (b.pin ?? 1e9))) {
        const ch = channelOf(row.thing.id);
        out.set(ch ? `ch:${ch}` : `c:${row.thing.id}`, n++);
      }
      for (const [k, i] of await todaysSources(ctx, safe).pins())
        if (!k.startsWith("c:") && !k.startsWith("ch:") && !out.has(k)) out.set(k, n + i);
      return out;
    },
    async mutedThreads() {
      const out = mutedOf(ctx, askerOf(ctx));
      const r = await safe<{ mutes?: { target: { id: string } }[] }>("notifications.mute.list", {});
      for (const m of r?.mutes ?? []) out.add(m.target.id);
      return out;
    },
  };
}

/** Which source answers pins and mutes: ONE line to switch. Today: the caller's stars and chat's own mutes. */
export const PINS_FROM_STATE_MODULE = false;

type Safe = <T>(cap: string, input: Record<string, unknown>) => Promise<T | null>;
const safeOf =
  (ctx: ChatCtx): Safe =>
  async (cap, input) => {
    if (!ctx.call) return null;
    try {
      return (await ctx.call(cap, input)) as never;
    } catch {
      return null;
    }
  };

/** Can this caller start chats? A guest cannot (their role holds no permission): they get only the chats and channels they are in. This is the app's own rule (it hides Team and the new-chat items when whoami lacks chats.private). If whoami cannot be read the caller is treated as a guest: the read fails closed, never open. */
async function canChat(safe: Safe): Promise<boolean> {
  const who = await safe<{ permissions?: string[] }>("identity.whoami", {});
  return who !== null && (who.permissions ?? []).includes("chats.private");
}

const VERB: Record<string, "Allow" | "Review" | "Answer" | "Blocked" | "Sign"> = {
  approve: "Allow",
  answer: "Answer",
  signature: "Sign",
  unblock: "Blocked",
};
/** The words under a goal that is not simply moving: the reason it gives, else what its state means. */
function goalLine(status: string, reason: unknown): string | undefined {
  if (typeof reason === "string" && reason.trim() !== "" && status !== "active") return reason.trim().slice(0, 120);
  return (
    {
      waiting: "Waiting on you",
      stuck: "Stuck",
      paused: "Paused",
      planning: "Planning",
      draft: "Draft",
      done: "Done",
      missed: "Missed",
      stopped: "Stopped",
    } as Record<string, string>
  )[status];
}
const ENDED = new Set(["done", "missed", "stopped"]);

interface RowOut {
  key: string;
  kind: "chat" | "channel" | "project" | "goal" | "person" | "agent";
  title: string;
  faceIds: string[];
  unread: number;
  mentions: number;
  failed: boolean;
  failedLine?: string;
  working: boolean;
  muted: boolean;
  pinned: number | null;
  lastAt: number;
  threadId?: string;
  personId?: string;
  agentId?: string;
  progress?: { done: number; total: number };
  line?: string;
  nextCheckinAt?: number;
  quiet?: boolean;
  ended?: boolean;
  archived?: boolean;
  private?: boolean;
  withPeople?: boolean;
}
type Extra = Omit<
  RowOut,
  "key" | "title" | "unread" | "mentions" | "working" | "muted" | "pinned" | "lastAt" | "failed" | "faceIds"
>;
/** The output row is built only for the rows a page carries (a person with 5,000 chats does not pay for 5,000 objects). */
type SideItem = Item & { extra: Extra; made?: RowOut };

const base = (): Omit<Item, "key" | "kind" | "shape" | "title"> => ({
  faces: [],
  unread: 0,
  mentions: 0,
  muted: false,
  draft: false,
  working: false,
  archived: false,
  ask: false,
  ended: false,
  lastAt: 0,
});

const defaultSources = (ctx: ChatCtx, safe: Safe): SideSources =>
  PINS_FROM_STATE_MODULE
    ? stateSources(ctx, safe, (thread) => {
        const r = ctx.db.all("SELECT id FROM chat_channel WHERE mainThread = ? AND deleted_at IS NULL", thread) as {
          id?: string;
        }[];
        return r[0]?.id === undefined ? undefined : String(r[0].id);
      })
    : todaysSources(ctx, safe);

interface ChatListRow {
  threadId: string;
  title: string;
  agents: string[];
  people: string[];
  unread: number;
  lastAt: number;
  archived: boolean;
  goalId?: string;
}

/**
 * The caller's chats for the sidebar, with SET-BASED reads: a handful of queries for the whole list, however many chats there are, never a few per chat. Newest first by the last message; what chat.recent leaves out stays out (an
 * agent chat nobody has written in is not a chat yet). It reads the same tables as chat.recent and the unread counters; the unread count is one grouped read of the messages after each read cursor.
 */
export function chatList(ctx: ChatCtx, asker: string): ChatListRow[] {
  ensureReadTable(ctx);
  ensureLast(ctx.db);
  const mine = `JOIN chat_thread_member me ON me.thread = t.id AND me.principal = ? AND me.deleted_at IS NULL`;
  const threads = ctx.db.all(
    `SELECT t.id AS id, t.title AS title, t.scopeType AS scopeType, t.scopeId AS scopeId, t.createdAt AS createdAt,
        COALESCE(l.at, (SELECT m.createdAt FROM chat_message m WHERE m.thread = t.id AND m.deleted_at IS NULL ORDER BY m.threadSeq DESC LIMIT 1)) AS lastAt
       FROM chat_thread t ${mine} LEFT JOIN chat_thread_last l ON l.thread = t.id
      WHERE t.deleted_at IS NULL AND t.listed = 1 AND t.closedAt IS NULL AND t.kind = 'chat'`,
    asker,
  ) as Record<string, unknown>[];
  const agents = new Map<string, string[]>();
  for (const r of ctx.db.all(
    `SELECT a.thread AS thread, a.agentId AS agentId FROM chat_thread_agent a
       JOIN chat_thread_member me ON me.thread = a.thread AND me.principal = ? AND me.deleted_at IS NULL WHERE a.deleted_at IS NULL ORDER BY a.rowid`,
    asker,
  ) as Record<string, unknown>[]) {
    const k = String(r["thread"]);
    (agents.get(k) ?? agents.set(k, []).get(k)!).push(String(r["agentId"]));
  }
  const people = new Map<string, string[]>();
  for (const r of ctx.db.all(
    `SELECT m.thread AS thread, m.principal AS principal FROM chat_thread_member m
       JOIN chat_thread t ON t.id = m.thread ${mine} WHERE m.deleted_at IS NULL AND t.kind = 'chat' AND m.principal <> ? AND m.principal NOT LIKE 'agt\\_%' ESCAPE '\\' ORDER BY m.rowid`,
    asker,
    asker,
  ) as Record<string, unknown>[]) {
    const k = String(r["thread"]);
    (people.get(k) ?? people.set(k, []).get(k)!).push(String(r["principal"]));
  }
  const unread = new Map<string, number>();
  for (const r of ctx.db.all(
    `SELECT m.thread AS thread, COUNT(*) AS n FROM chat_message m
       JOIN chat_thread t ON t.id = m.thread ${mine}
       LEFT JOIN chat_thread_read rd ON rd.thread = m.thread AND rd.principal = ?
      WHERE t.kind = 'chat' AND m.deleted_at IS NULL AND m.author <> ? AND m.threadSeq > COALESCE(rd.seq, 0) GROUP BY m.thread`,
    asker,
    asker,
    asker,
  ) as Record<string, unknown>[])
    unread.set(String(r["thread"]), Number(r["n"]));
  const archived = archivedIds(ctx, asker);
  const out: ChatListRow[] = [];
  for (const t of threads) {
    const id = String(t["id"]);
    const a = agents.get(id) ?? [];
    const p = people.get(id) ?? [];
    const last = t["lastAt"] === null || t["lastAt"] === undefined ? null : Number(t["lastAt"]);
    const title = t["title"] === null || t["title"] === undefined ? undefined : String(t["title"]);
    // a chat nobody has written in is not a chat yet: opening an agent makes the thread, and it should not pile up as "New chat" rows
    if (title === undefined && last === null && a.length > 0 && p.length < 1) continue;
    out.push({
      threadId: id,
      title: title ?? "New chat",
      agents: a,
      people: p,
      unread: unread.get(id) ?? 0,
      lastAt: last ?? Number(t["createdAt"] ?? 0),
      archived: archived.has(id),
      ...(t["scopeType"] === "goal" && t["scopeId"] ? { goalId: String(t["scopeId"]) } : {}),
    });
  }
  return out;
}

/**
 * The Everything view's chats WITHOUT reading every chat: SQLite does the sorting and counting and hands back only what the page carries. The sidebar shows the newest first and a person with thousands of chats opens one page, so
 * the cost follows the page, not the number of chats. It returns the newest `want` chats (not pinned, not muted, not a one-to-one, not a goal's), the muted ones once the list reaches its end, every one-to-one (they are the team's rows),
 * and the chats the person pinned; `total` is every chat of the Chats block. Other filters read the whole list (chatList): a filter looks at every row.
 */
export function chatListFast(
  ctx: ChatCtx,
  asker: string,
  o: { pinned: readonly string[]; muted: ReadonlySet<string>; want: number },
): { rows: ChatListRow[]; total: number } {
  ensureReadTable(ctx);
  ensureLast(ctx.db);
  archivedIds(ctx, asker); // makes the archive tables
  const a: unknown[] = [];
  const ask = (): string => (a.push(asker), "?");
  const agentsHere = `EXISTS (SELECT 1 FROM chat_thread_agent g WHERE g.thread = t.id AND g.deleted_at IS NULL)`;
  const humans = () =>
    `(SELECT COUNT(*) FROM chat_thread_member x WHERE x.thread = t.id AND x.deleted_at IS NULL AND x.principal <> ${ask()} AND x.principal NOT LIKE 'agt\\_%' ESCAPE '\\')`;
  const base = () =>
    `FROM chat_thread t JOIN chat_thread_member me ON me.thread = t.id AND me.principal = ${ask()} AND me.deleted_at IS NULL
       LEFT JOIN chat_thread_last l ON l.thread = t.id
      WHERE t.deleted_at IS NULL AND t.listed = 1 AND t.closedAt IS NULL AND t.kind = 'chat'
        AND NOT (t.scopeType = 'goal' AND t.scopeId IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM chat_thread_archive ar WHERE ar.thread = t.id AND ar.principal = ${ask()})`;
  const notDm = () => `AND NOT (NOT ${agentsHere} AND ${humans()} = 1)`;
  const notEmpty = () => `AND NOT (t.title IS NULL AND l.at IS NULL AND ${agentsHere} AND ${humans()} < 1)`;
  const list = (ids: readonly string[]): string => ids.map(() => "?").join(", ");
  const run = (build: () => string, ...tail: unknown[]): Record<string, unknown>[] => {
    a.length = 0;
    const sql = build();
    return ctx.db.all(sql, ...a, ...tail) as Record<string, unknown>[];
  };
  const excl = [...new Set([...o.pinned, ...o.muted])];
  const mutedHere = [...o.muted].filter((m) => !o.pinned.includes(m));
  const notIn = excl.length > 0 ? `AND t.id NOT IN (${list(excl)})` : "";
  const nonMuted = Number(
    run(() => `SELECT COUNT(*) AS n ${base()} ${notDm()} ${notEmpty()} ${notIn}`, ...excl)[0]?.["n"] ?? 0,
  );
  const mutedTotal =
    mutedHere.length === 0
      ? 0
      : Number(
          run(
            () => `SELECT COUNT(*) AS n ${base()} ${notDm()} ${notEmpty()} AND t.id IN (${list(mutedHere)})`,
            ...mutedHere,
          )[0]?.["n"] ?? 0,
        );
  const ids = new Set<string>();
  for (const r of run(
    () =>
      `SELECT t.id AS id ${base()} ${notDm()} ${notEmpty()} ${notIn} ORDER BY COALESCE(l.at, t.createdAt) DESC, t.id LIMIT ?`,
    ...excl,
    Math.max(1, o.want),
  ))
    ids.add(String(r["id"]));
  if (o.want >= nonMuted && mutedHere.length > 0)
    for (const r of run(
      () => `SELECT t.id AS id ${base()} ${notDm()} ${notEmpty()} AND t.id IN (${list(mutedHere)})`,
      ...mutedHere,
    ))
      ids.add(String(r["id"]));
  // every one-to-one: the team's rows
  for (const r of run(() => `SELECT t.id AS id ${base()} AND NOT ${agentsHere} AND ${humans()} = 1`))
    ids.add(String(r["id"]));
  for (const id of o.pinned) ids.add(id);
  return { rows: chatDetails(ctx, asker, [...ids]), total: nonMuted + mutedTotal };
}

/** The rows of these chats (the caller's own: a chat they are not in gives nothing), with their agents, people and unread. */
function chatDetails(ctx: ChatCtx, asker: string, ids: readonly string[]): ChatListRow[] {
  if (ids.length === 0) return [];
  const IN = ids.map(() => "?").join(", ");
  const mine = `JOIN chat_thread_member me ON me.thread = t.id AND me.principal = ? AND me.deleted_at IS NULL`;
  const threads = ctx.db.all(
    `SELECT t.id AS id, t.title AS title, t.scopeType AS scopeType, t.scopeId AS scopeId, t.createdAt AS createdAt, l.at AS lastAt
       FROM chat_thread t ${mine} LEFT JOIN chat_thread_last l ON l.thread = t.id
      WHERE t.deleted_at IS NULL AND t.kind = 'chat' AND t.id IN (${IN})`,
    asker,
    ...ids,
  ) as Record<string, unknown>[];
  const group = (sql: string, ...args: unknown[]): Map<string, string[]> => {
    const m = new Map<string, string[]>();
    for (const r of ctx.db.all(sql, ...args) as Record<string, unknown>[]) {
      const k = String(r["thread"]);
      (m.get(k) ?? m.set(k, []).get(k)!).push(String(r["v"]));
    }
    return m;
  };
  const agents = group(
    `SELECT thread, agentId AS v FROM chat_thread_agent WHERE deleted_at IS NULL AND thread IN (${IN}) ORDER BY rowid`,
    ...ids,
  );
  const people = group(
    `SELECT thread, principal AS v FROM chat_thread_member WHERE deleted_at IS NULL AND principal <> ? AND principal NOT LIKE 'agt\\_%' ESCAPE '\\' AND thread IN (${IN}) ORDER BY rowid`,
    asker,
    ...ids,
  );
  const unread = new Map<string, number>();
  for (const r of ctx.db.all(
    `SELECT m.thread AS thread, COUNT(*) AS n FROM chat_message m
       LEFT JOIN chat_thread_read rd ON rd.thread = m.thread AND rd.principal = ?
      WHERE m.deleted_at IS NULL AND m.author <> ? AND m.threadSeq > COALESCE(rd.seq, 0) AND m.thread IN (${IN}) GROUP BY m.thread`,
    asker,
    asker,
    ...ids,
  ) as Record<string, unknown>[])
    unread.set(String(r["thread"]), Number(r["n"]));
  const archived = archivedIds(ctx, asker);
  return threads.map((t) => {
    const id = String(t["id"]);
    return {
      threadId: id,
      title: t["title"] === null || t["title"] === undefined ? "New chat" : String(t["title"]),
      agents: agents.get(id) ?? [],
      people: people.get(id) ?? [],
      unread: unread.get(id) ?? 0,
      lastAt: t["lastAt"] === null || t["lastAt"] === undefined ? Number(t["createdAt"] ?? 0) : Number(t["lastAt"]),
      archived: archived.has(id),
      ...(t["scopeType"] === "goal" && t["scopeId"] ? { goalId: String(t["scopeId"]) } : {}),
    };
  });
}

/**
 * The channels the caller is IN (the sidebar lists those; a public one they are not in is for Browse), in the Space's order, with their unread: three set-based reads for the whole list. Membership is the only way in, so
 * what a guest sees is exactly the channels they were added to.
 */
export function channelList(ctx: ChatCtx, asker: string): Record<string, unknown>[] {
  ensureReadTable(ctx);
  const rows = ctx.db.all(
    `SELECT c.id AS channelId, c.mainThread AS mainThreadId, c.name AS name, c.visibility AS visibility, c.createdAt AS createdAt
       FROM chat_channel c JOIN chat_thread_member me ON me.thread = c.mainThread AND me.principal = ? AND me.deleted_at IS NULL
      WHERE c.archived = 0 ORDER BY c.createdAt, c.id`,
    asker,
  ) as Record<string, unknown>[];
  const unread = new Map<string, number>();
  for (const r of ctx.db.all(
    `SELECT m.thread AS thread, COUNT(*) AS n FROM chat_message m
       JOIN chat_channel c ON c.mainThread = m.thread AND c.archived = 0
       JOIN chat_thread_member me ON me.thread = m.thread AND me.principal = ? AND me.deleted_at IS NULL
       LEFT JOIN chat_thread_read rd ON rd.thread = m.thread AND rd.principal = ?
      WHERE m.deleted_at IS NULL AND m.author <> ? AND m.threadSeq > COALESCE(rd.seq, 0) GROUP BY m.thread`,
    asker,
    asker,
    asker,
  ) as Record<string, unknown>[])
    unread.set(String(r["thread"]), Number(r["n"]));
  return rows.map((r) => ({ ...r, unread: unread.get(String(r["mainThreadId"])) ?? 0 }));
}

/** How many of the newest chats this call must read: the first page, or up to the end of the page after `more.after`. */
async function wantedChats(
  ctx: ChatCtx,
  asker: string,
  more: { section: string; after?: string; limit?: number } | undefined,
  pins: ReadonlyMap<string, number>,
): Promise<number> {
  const limit = Math.min(more?.limit ?? SIDEBAR_PAGE, SIDEBAR_PAGE_MAX);
  if (more?.section !== "chats" || more.after === undefined) return limit;
  // where the cursor's chat stands in the newest-first list: how many chats are newer, plus its tie-break
  const id = more.after.startsWith("c:") ? more.after.slice(2) : undefined;
  if (id === undefined) return limit;
  ensureLast(ctx.db);
  // a cursor that is not one of the caller's own chats is no cursor: the read answers the first page (it never walks the whole list for a key the caller does not hold)
  const at = ctx.db.all(
    `SELECT COALESCE(l.at, t.createdAt) AS at FROM chat_thread t
       JOIN chat_thread_member me ON me.thread = t.id AND me.principal = ? AND me.deleted_at IS NULL
       LEFT JOIN chat_thread_last l ON l.thread = t.id WHERE t.id = ? AND t.deleted_at IS NULL`,
    asker,
    id,
  ) as Record<string, unknown>[];
  if (at.length === 0) return limit;
  const n = ctx.db.all(
    `SELECT COUNT(*) AS n FROM chat_thread t JOIN chat_thread_member me ON me.thread = t.id AND me.principal = ? AND me.deleted_at IS NULL
       LEFT JOIN chat_thread_last l ON l.thread = t.id
      WHERE t.deleted_at IS NULL AND t.listed = 1 AND t.closedAt IS NULL AND t.kind = 'chat' AND (COALESCE(l.at, t.createdAt) > ? OR (COALESCE(l.at, t.createdAt) = ? AND t.id <= ?))`,
    asker,
    Number(at[0]!["at"]),
    Number(at[0]!["at"]),
    id,
  ) as Record<string, unknown>[];
  return Number(n[0]?.["n"] ?? 0) + limit + pins.size + 5;
}

export async function chatsSidebar(
  ctx: ChatCtx,
  input: { filter?: string; more?: { section: Exclude<SectionId, "needs">; after?: string; limit?: number } },
  sources?: (ctx: ChatCtx, safe: Safe) => SideSources,
) {
  const filter = (input.filter ?? "all") as FilterId;
  if (filter !== "all" && !FILTER_IDS.includes(filter))
    raise(
      ctx,
      "validation.bad_input",
      `"${input.filter}" is not a way to filter the sidebar. Use one of: ${FILTER_IDS.join(", ")}.`,
      { field: "filter" },
    );
  const safe = safeOf(ctx);
  const member = await canChat(safe);
  const src = (sources ?? defaultSources)(ctx, safe);
  const [pins, mentionsOut, needsOut, goalsOut, projectsOut, agentsOut, peopleOut, workingOut] = await Promise.all([
    src.pins(),
    safe<{ counts?: { threadId: string; mentions: number }[] }>("notifications.unseen_by_thread", {}),
    safe<{
      items?: { task: { id: string; title: string; kind: string; blocked?: boolean; createdBy?: string } }[];
      total?: number;
    }>("tasks.needs_you", { limit: 50 }),
    member ? safe<{ goals?: Record<string, any>[] }>("goals.list", { scope: "mine" }) : Promise.resolve(null), // eslint-disable-line @typescript-eslint/no-explicit-any
    member ? safe<{ projects?: Record<string, any>[] }>("projects.list", {}) : Promise.resolve(null), // eslint-disable-line @typescript-eslint/no-explicit-any
    member ? safe<{ agents?: { agentId: string; name: string }[] }>("agents.list", {}) : Promise.resolve(null),
    member
      ? safe<{ principals?: { id: string; name: string; kind?: string; status?: string }[]; next?: string }>(
          "access.principals.list",
          {
            kind: "person",
            status: "active",
            limit: 500,
          },
        )
      : Promise.resolve(null),
    safe<{ working?: { agentId: string; threadId?: string }[] }>("engine.now", {}),
  ]);
  // people past the first 500: the rest of the directory by its cursor (a handful of extra reads only in a Space that big)
  for (let page = 0; peopleOut?.next !== undefined && page < 20; page++) {
    const more = await safe<{
      principals?: { id: string; name: string; kind?: string; status?: string }[];
      next?: string;
    }>("access.principals.list", { kind: "person", status: "active", limit: 500, cursor: peopleOut.next });
    if (!more) break;
    peopleOut.principals = [...(peopleOut.principals ?? []), ...(more.principals ?? [])];
    if (more.next === undefined) delete peopleOut.next;
    else peopleOut.next = more.next;
  }
  const mentions = new Map((mentionsOut?.counts ?? []).map((c) => [c.threadId, c.mentions]));
  const muted = await src.mutedThreads();
  const me = askerOf(ctx);
  const pinOf = (key: string): number | null => pins.get(key) ?? null;
  const items: SideItem[] = [];
  const add = (it: Omit<Item, "ask" | "draft" | "archived" | "ended"> & Partial<Item>, extra: Extra): void => {
    items.push({ ask: false, draft: false, archived: false, ended: false, ...it, extra } as SideItem);
  };
  const outOf = (it: SideItem): RowOut =>
    (it.made ??= {
      key: it.key,
      title: it.title,
      faceIds: it.faces.map((f) => f.id),
      unread: it.unread,
      mentions: it.mentions,
      failed: false,
      working: it.working,
      muted: it.muted,
      pinned: pinOf(it.key),
      lastAt: it.lastAt,
      ...it.extra,
    });

  // chats and one-to-ones: a handful of set-based reads for the whole list
  let chatsTotal: number | undefined;
  const workingThreads = new Set((workingOut?.working ?? []).flatMap((w) => (w.threadId ? [w.threadId] : [])));
  const dmOf = new Map<string, Record<string, any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const wantChats = await wantedChats(ctx, me, input.more, pins);
  const fastList =
    filter === "all"
      ? chatListFast(ctx, me, {
          pinned: [...pins.keys()].filter((k) => k.startsWith("c:")).map((k) => k.slice(2)),
          muted,
          want: wantChats,
        })
      : null;
  chatsTotal = fastList?.total;
  for (const r of fastList?.rows ?? chatList(ctx, me)) {
    if (r.goalId) continue;
    const { threadId, agents, people } = r;
    const key = `c:${threadId}`;
    const common = {
      unread: r.unread,
      mentions: mentions.get(threadId) ?? 0,
      muted: muted.has(threadId),
      working: workingThreads.has(threadId),
      archived: r.archived,
      lastAt: r.lastAt,
    };
    if (agents.length === 0 && people.length === 1) {
      if (!dmOf.has(people[0]!)) dmOf.set(people[0]!, { threadId, ...common });
      continue;
    }
    add(
      {
        key,
        kind: "chat",
        shape: agents.length > 1 ? "group" : "agent",
        title: r.title,
        faces: agents.map((id) => ({ id, name: "" })),
        ...common,
      },
      { kind: "chat", threadId, withPeople: people.length > 0, ...(r.archived ? { archived: true } : {}) },
    );
  }
  // channels (a project's own channel is the project's row)
  const projectChannels = new Set((projectsOut?.projects ?? []).map((p) => String(p["channelId"])));
  const channels = { channels: channelList(ctx, me) };
  for (const c of channels.channels ?? []) {
    if (c["archived"] === true || projectChannels.has(String(c["channelId"]))) continue;
    const key = `ch:${c["channelId"]}`;
    add(
      {
        key,
        kind: "channel",
        shape: "channel",
        title: String(c["name"]),
        unread: Number(c["unread"] ?? 0),
        mentions: mentions.get(String(c["mainThreadId"])) ?? 0,
        muted: muted.has(String(c["mainThreadId"])) || muted.has(String(c["channelId"])),
        working: false,
        lastAt: Number(c["createdAt"] ?? 0),
        faces: [],
      },
      { kind: "channel", threadId: String(c["mainThreadId"]), private: c["visibility"] === "invite" },
    );
  }
  const unreadByChannel = new Map((channels.channels ?? []).map((c) => [String(c["channelId"]), c]));
  for (const p of projectsOut?.projects ?? []) {
    if (p["archivedAt"]) continue;
    const ch = unreadByChannel.get(String(p["channelId"]));
    const key = `pj:${p["projectId"]}`;
    add(
      {
        key,
        kind: "project",
        shape: "project",
        title: String(p["title"]),
        unread: Number(ch?.["unread"] ?? 0),
        mentions: mentions.get(String(ch?.["mainThreadId"])) ?? 0,
        muted: ch ? muted.has(String(ch["mainThreadId"])) : false,
        working: false,
        lastAt: 0,
        faces: [],
      },
      { kind: "project" },
    );
  }
  const inTasks = new Set((needsOut?.items ?? []).map((n) => n.task.title));
  for (const g of goalsOut?.goals ?? []) {
    const status = String(g["status"]);
    const pr = (g["progress"] as { tasksDone?: number; tasks?: number } | undefined) ?? {};
    add(
      {
        key: `g:${g["id"]}`,
        kind: "goal",
        shape: "goal",
        title: String(g["title"]),
        faces: [{ id: String(g["leadAgentId"]), name: "" }],
        unread: 0,
        mentions: 0,
        muted: false,
        working: status === "active",
        ended: ENDED.has(status),
        quiet: status !== "active" && !ENDED.has(status),
        lastAt: Number(g["updatedAt"] ?? 0),
        progress: { done: Number(pr.tasksDone ?? 0), total: Number(pr.tasks ?? 0) },
      },
      {
        kind: "goal",
        // a goal waiting on the person lives in Tasks (its Unblock task is there): its Goals row then says nothing a second time
        ...(!inTasks.has(`Stuck: ${g["title"]}`) && goalLine(status, g["statusReason"])
          ? { line: goalLine(status, g["statusReason"])! }
          : {}),
        ...(g["nextCheckinAt"] && !inTasks.has(`Stuck: ${g["title"]}`)
          ? { nextCheckinAt: Number(g["nextCheckinAt"]) }
          : {}),
        progress: { done: Number(pr.tasksDone ?? 0), total: Number(pr.tasks ?? 0) },
        ...(status !== "active" && !ENDED.has(status) ? { quiet: true } : {}),
        ...(ENDED.has(status) ? { ended: true } : {}),
      },
    );
  }
  // the team: everyone the caller may reach, a one-to-one being that person's row
  for (const p of peopleOut?.principals ?? []) {
    if (
      p.id === me ||
      (p.kind !== undefined && p.kind !== "person") ||
      (p.status !== undefined && p.status !== "active")
    )
      continue;
    const dm = dmOf.get(p.id);
    const key = dm ? `c:${dm["threadId"]}` : `p:${p.id}`;
    add(
      {
        key,
        kind: "person",
        shape: "person",
        title: p.name,
        faces: [{ id: p.id, name: p.name }],
        unread: Number(dm?.["unread"] ?? 0),
        mentions: Number(dm?.["mentions"] ?? 0),
        muted: muted.has(p.id) || (dm ? muted.has(String(dm["threadId"])) : false),
        working: false,
        lastAt: Number(dm?.["lastAt"] ?? 0),
      },
      { kind: "person", personId: p.id, ...(dm ? { threadId: String(dm["threadId"]) } : {}) },
    );
  }
  const agentLast = new Map<string, number>();
  for (const it of items)
    if (it.kind === "chat")
      for (const f of it.faces) agentLast.set(f.id, Math.max(agentLast.get(f.id) ?? 0, it.lastAt));
  const workingAgents = new Set((workingOut?.working ?? []).map((w) => w.agentId));
  for (const a of agentsOut?.agents ?? []) {
    add(
      {
        key: `f:${a.agentId}`,
        kind: "agent",
        shape: "agent",
        title: a.name,
        faces: [{ id: a.agentId, name: a.name }],
        unread: 0,
        mentions: 0,
        muted: muted.has(a.agentId),
        working: workingAgents.has(a.agentId),
        lastAt: agentLast.get(a.agentId) ?? 0,
      },
      { kind: "agent", agentId: a.agentId },
    );
  }
  // failed: the latest turn of the chats this answer carries, in one call (a chat the caller may not open is absent there)
  const carried = new Set<string>();
  const itemOf = new Map(items.map((i) => [i.key, i]));
  const pinOrder = [...pins.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
  let sec = sectionsOf(items, pinOrder, filter);
  for (const id of ["goals", "pinned", "chats", "channels", "team"] as const) {
    const list = sec[id];
    const m = input.more?.section === id ? input.more : undefined;
    const from = m?.after !== undefined ? Math.max(0, list.findIndex((x) => x.key === m.after) + 1) : 0;
    for (const x of list.slice(from, from + Math.min(m?.limit ?? SIDEBAR_PAGE, SIDEBAR_PAGE_MAX))) {
      const tid = itemOf.get(x.key)?.extra.threadId;
      if (tid) carried.add(tid);
    }
  }
  const ids = [...carried].slice(0, 200);
  const states = ids.length
    ? await safe<{ states?: { threadId: string; state: string; failedLine?: string }[] }>("engine.thread_states", {
        threadIds: ids,
      })
    : null;
  const failedBy = new Map(
    (states?.states ?? [])
      .filter((x) => x.state === "failed")
      .map((x) => [x.threadId, x.failedLine ?? "Something went wrong."]),
  );
  for (const it of items) {
    const line = it.extra.threadId ? failedBy.get(it.extra.threadId) : undefined;
    if (line !== undefined) {
      const o = outOf(it);
      o.failed = true;
      o.failedLine = line;
      it.failed = line;
    }
  }
  // what waits on me: the first answer's items, and the full count
  const needs = (needsOut?.items ?? []).map((n) => ({
    taskId: n.task.id,
    title: n.task.title,
    verb: n.task.blocked ? ("Blocked" as const) : (VERB[n.task.kind] ?? ("Review" as const)),
    ...(n.task.createdBy ? { askerId: n.task.createdBy } : {}),
  }));
  const taskItems: Item[] = needs.map((n) => ({
    ...base(),
    key: `n:${n.taskId}`,
    kind: "task",
    shape: "task",
    title: n.title,
    ask: false,
    draft: false,
    archived: false,
    ended: false,
  }));

  // one rule for the sections, shared with the app: precedence, order, filter
  const all: Item[] = [...items, ...taskItems];
  // the tasks only fill Needs you; the other blocks are already worked out, and only the Failed filter depends on what the engine just said
  if (filter === "failed" || filter === "needs") sec = sectionsOf(all, pinOrder, filter);
  const byKey = new Map(items.map((i) => [i.key, i]));
  const section = (id: Exclude<SectionId, "needs">) => {
    const list = sec[id];
    const m = input.more?.section === id ? input.more : undefined;
    const from = m?.after !== undefined ? Math.max(0, list.findIndex((x) => x.key === m.after) + 1) : 0;
    const limit = Math.min(m?.limit ?? SIDEBAR_PAGE, SIDEBAR_PAGE_MAX);
    const page = list.slice(from, from + limit);
    const end = from + page.length;
    const total = id === "chats" && chatsTotal !== undefined ? chatsTotal : list.length;
    return {
      total,
      rows: page.map((x) => outOf(byKey.get(x.key)!)),
      ...(end < total ? { next: page[page.length - 1]!.key } : {}),
    };
  };
  // mentions in chats this page does not carry still count in the rail (the fast listing reads only a page of chats)
  const carriedThreads = new Set(items.flatMap((i) => (i.extra.threadId ? [i.extra.threadId] : [])));
  let unseenElsewhere = 0;
  for (const [tid, n] of mentions) if (!carriedThreads.has(tid) && !muted.has(tid)) unseenElsewhere += n;
  const first = all.find((x) => x.kind !== "task" && x.unread + x.mentions > 0 && !x.muted && !x.archived);
  return {
    needs: { total: Math.max(needsOut?.total ?? 0, needs.length), items: needs },
    goals: section("goals"),
    pinned: section("pinned"),
    chats: section("chats"),
    channels: section("channels"),
    team: section("team"),
    rail: railCount(all) + unseenElsewhere,
    ...(first ? { nextUnread: first.key } : {}),
  };
}

export const sidebarHandlers = { "chats.presence": chatsPresence, "chats.sidebar": chatsSidebar };
