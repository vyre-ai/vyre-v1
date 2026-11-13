// The Chats sidebar's reads (design 13 Nov). chats.presence: who is around and which agents work now, composed from devices.presence and engine.now, which answer as the asker; what they refuse the asker, this
// answers nothing for (a guest has no team). A read that is not there, or fails, leaves that half empty: presence is a quiet dot, never a reason for the sidebar to fail.
import { FILTER_CHOICES, railCount, sectionsOf } from "../../../lib/sidebar.ts";
import type { FilterId, Item, SectionId } from "../../../lib/sidebar.ts";
import { askerOf, raise } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { channelsList } from "./g24b.ts";
import { mutedOf } from "./follow.ts";
import { recentWithUnread } from "./g26.ts";

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
  return {
    people: (p?.people ?? []).flatMap((x) =>
      x.state === "online" || x.state === "away" ? [{ personId: x.personId, state: x.state }] : [],
    ),
    working: (w?.working ?? []).map((x) => ({
      agentId: x.agentId,
      ...(x.threadId ? { threadId: x.threadId } : {}),
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
  mutedThreads(): Set<string>;
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
    mutedThreads: () => mutedOf(ctx, askerOf(ctx)),
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
    mutedThreads: () => mutedOf(ctx, askerOf(ctx)),
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

/** Can this caller start chats? A guest cannot (their role holds no permission): they get only the chats and channels they are in. This is the app's own rule (it hides Team and the new-chat items when whoami lacks chats.private). A hand-built test context with no whoami is a member. */
async function canChat(safe: Safe): Promise<boolean> {
  const who = await safe<{ permissions?: string[] }>("identity.whoami", {});
  return who === null ? true : (who.permissions ?? []).includes("chats.private");
}

const VERB: Record<string, "Allow" | "Review" | "Answer" | "Blocked" | "Sign"> = {
  approve: "Allow",
  answer: "Answer",
  signature: "Sign",
  unblock: "Blocked",
};
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
  quiet?: boolean;
  ended?: boolean;
  archived?: boolean;
  private?: boolean;
  withPeople?: boolean;
}
type SideItem = Item & { out: RowOut };

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
  const [pins, mentionsOut, needsOut, goalsOut, projectsOut, agentsOut, peopleOut] = await Promise.all([
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
      ? safe<{ principals?: { id: string; name: string; kind?: string; status?: string }[] }>(
          "access.principals.list",
          {
            kind: "person",
            status: "active",
            limit: 200,
          },
        )
      : Promise.resolve(null),
  ]);
  const mentions = new Map((mentionsOut?.counts ?? []).map((c) => [c.threadId, c.mentions]));
  const muted = src.mutedThreads();
  const me = askerOf(ctx);
  const pinOf = (key: string): number | null => pins.get(key) ?? null;
  const items: SideItem[] = [];
  const add = (
    it: Omit<Item, "ask" | "draft" | "archived" | "ended"> & Partial<Item>,
    out: Omit<
      RowOut,
      "key" | "title" | "unread" | "mentions" | "working" | "muted" | "pinned" | "lastAt" | "failed" | "faceIds"
    >,
  ): void => {
    const full: Item = { ask: false, draft: false, archived: false, ended: false, ...it } as Item;
    items.push({
      ...full,
      out: {
        key: full.key,
        title: full.title,
        faceIds: full.faces.map((f) => f.id),
        unread: full.unread,
        mentions: full.mentions,
        failed: false,
        working: full.working,
        muted: full.muted,
        pinned: pinOf(full.key),
        lastAt: full.lastAt,
        ...out,
      },
    });
  };

  // chats and one-to-ones from the same listing chat.recent answers
  const recent = (await recentWithUnread(ctx, { max: Number.MAX_SAFE_INTEGER })) as unknown as Record<
    string,
    Record<string, any>[] | string | null
  >; // eslint-disable-line @typescript-eslint/no-explicit-any

  const dmOf = new Map<string, Record<string, any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const sec of ["starred", "today", "yesterday", "earlier", "archived"]) {
    for (const r of (recent[sec] as Record<string, any>[] | undefined) ?? []) {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      if (r["kind"] !== "chat" || r["goalId"]) continue;
      const agents = (r["agents"] as string[]) ?? [];
      const people = (r["people"] as string[] | undefined) ?? [];
      const threadId = String(r["threadId"]);
      const key = `c:${threadId}`;
      const common = {
        unread: Number(r["unread"] ?? 0) + Number(r["repliesUnread"] ?? 0),
        mentions: mentions.get(threadId) ?? 0,
        muted: muted.has(threadId),
        working: r["working"] === true,
        archived: sec === "archived",
        lastAt: Number(r["lastAt"] ?? 0),
      };
      if (agents.length === 0 && people.length === 1) {
        if (!dmOf.has(people[0]!)) dmOf.set(people[0]!, { ...r, ...common });
        continue;
      }
      add(
        {
          key,
          kind: "chat",
          shape: agents.length > 1 ? "group" : "agent",
          title: String(r["title"] ?? ""),
          faces: agents.map((id) => ({ id, name: "" })),
          ...common,
        },
        { kind: "chat", threadId, withPeople: people.length > 0, ...(sec === "archived" ? { archived: true } : {}) },
      );
    }
  }
  // channels (a project's own channel is the project's row)
  const projectChannels = new Set((projectsOut?.projects ?? []).map((p) => String(p["channelId"])));
  // through the pipeline as the caller (it narrows what a guest may list); the module's own function only when there is no pipeline
  const channels = ((await safe<{ channels?: Record<string, any>[] }>("channels.list", {})) ??
    (typeof (ctx as { authorize?: unknown }).authorize === "function"
      ? { channels: [] }
      : await channelsList(ctx, {}))) as { channels?: Record<string, any>[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
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
        muted: muted.has(String(c["mainThreadId"])),
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
        muted: dm ? muted.has(String(dm["threadId"])) : false,
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
  const working = await safe<{ working?: { agentId: string }[] }>("engine.now", {});
  const workingAgents = new Set((working?.working ?? []).map((w) => w.agentId));
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
        muted: false,
        working: workingAgents.has(a.agentId),
        lastAt: agentLast.get(a.agentId) ?? 0,
      },
      { kind: "agent", agentId: a.agentId },
    );
  }
  // failed: the latest turn of the chats this answer carries, in one call (a chat the caller may not open is absent there)
  const carried = new Set<string>();
  const itemOf = new Map(items.map((i) => [i.key, i]));
  for (const id of ["goals", "pinned", "chats", "channels", "team"] as const) {
    const list = sectionsOf(
      items,
      [...pins.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k),
      filter,
    )[id];
    const m = input.more?.section === id ? input.more : undefined;
    const from = m?.after !== undefined ? Math.max(0, list.findIndex((x) => x.key === m.after) + 1) : 0;
    for (const x of list.slice(from, from + Math.min(m?.limit ?? SIDEBAR_PAGE, SIDEBAR_PAGE_MAX))) {
      const tid = itemOf.get(x.key)?.out.threadId;
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
    const line = it.out.threadId ? failedBy.get(it.out.threadId) : undefined;
    if (line !== undefined) {
      it.out.failed = true;
      it.out.failedLine = line;
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
  const pinOrder = [...pins.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
  const all: Item[] = [...items, ...taskItems];
  const sec = sectionsOf(all, pinOrder, filter);
  const byKey = new Map(items.map((i) => [i.key, i]));
  const section = (id: Exclude<SectionId, "needs">) => {
    const list = sec[id];
    const m = input.more?.section === id ? input.more : undefined;
    const from = m?.after !== undefined ? Math.max(0, list.findIndex((x) => x.key === m.after) + 1) : 0;
    const limit = Math.min(m?.limit ?? SIDEBAR_PAGE, SIDEBAR_PAGE_MAX);
    const page = list.slice(from, from + limit);
    const end = from + page.length;
    return {
      total: list.length,
      rows: page.map((x) => byKey.get(x.key)!.out),
      ...(end < list.length ? { next: page[page.length - 1]!.key } : {}),
    };
  };
  const first = all.find((x) => x.kind !== "task" && x.unread + x.mentions > 0 && !x.muted && !x.archived);
  return {
    needs: { total: Math.max(needsOut?.total ?? 0, needs.length), items: needs },
    goals: section("goals"),
    pinned: section("pinned"),
    chats: section("chats"),
    channels: section("channels"),
    team: section("team"),
    rail: railCount(all),
    ...(first ? { nextUnread: first.key } : {}),
  };
}

export const sidebarHandlers = { "chats.presence": chatsPresence, "chats.sidebar": chatsSidebar };
