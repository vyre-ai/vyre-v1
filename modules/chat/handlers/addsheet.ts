// The Add people and agents sheet, server side (lane l-addsheet, owner approval 4 Nov 2026).
//
//   threads.agent_settings.set   how and when one agent answers in one chat: mode (lead, listen, quiet), When (always, topics, hours), topics, hours, style. The engine's routing reads it (lib/route.ts).
//   threads.agent.create         an agent made for the chat: owned by it, added as listening in one step, removed with the chat (handlers/owned.ts).
//   threads.poke                 one turn for an agent now, even a Listening one, from the last 12 messages, as the poker. An outside agent gets it in its queue.
//   chat.history.page            older messages and tool calls of the chat the agent is working in, 100 at a time, refusing any other chat.
//   threads.outside_agent.add    an outside agent joins with exactly this chat, its project, its files folder and its record, each grant tagged chat:<threadId>; remove takes them all back at once.
//   threads.invite_guest         a guest of this chat only, by email.
//
// Mode keeps its two values for everything that reads a thread (lead, listen). Listening is `listen` with quiet true: the row says it, the engine never routes to a quiet agent but for a poke.
import { addAgent, agentsOf, askerOf, channelBy, encOf, insertMessage, lastMessages, membersOf, messageOut, mintId, raise } from "../projections.ts";
import type { ChatCtx, ThreadRec } from "../projections.ts";
import { agentMayChange, load, out } from "./g24a.ts";
import { readFloor } from "./floor.ts";
import { deliver, mayGovernChannel, rootOf } from "./post.ts";
import { grantsOf, revokeGrants, shareOwnedWithReaders, sourceOf, trashOwned } from "./owned.ts";
import type { Granted } from "./owned.ts";

type Row = Record<string, unknown>;
export type SetMode = "lead" | "listen" | "quiet";
const MAX_AGENTS = 20;
const MAX_TOPICS = 200;
const MAX_NOTE = 500;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const callCode = (e: unknown): string => ((e as { error?: { code?: string }; code?: string } | null)?.error?.code ?? (e as { code?: string } | null)?.code ?? "");

const demoteLead = (ctx: ChatCtx, thread: string, except: string): void => {
  ctx.db.run(`UPDATE chat_thread_agent SET "mode" = 'listen', "version" = "version" + 1, "updated_at" = ? WHERE "thread" = ? AND "agentId" <> ? AND "mode" = 'lead' AND "deleted_at" IS NULL`, ctx.now(), thread, except);
};

/** The engine keeps its own copy of who leads, saved with the chat. Tell it too, so a reopened chat has the same lead (best effort: the chat row above is the truth the next read shows). */
async function tellEngine(ctx: ChatCtx, threadId: string, agentId: string, mode: "lead" | "listen"): Promise<void> {
  if (!ctx.call) return;
  try { await ctx.call("engine.set_mode", { threadId, agentId, mode }); } catch (e) { ctx.log.warn("the engine was not told an agent's new mode", { threadId, agentId, code: callCode(e) }); }
}

// ---- settings ---------------------------------------------------------------------------------------------------------------------------------------

/**
 * Who may change how one agent answers in this chat (owner rule, 4 Nov 2026): the person who added it, the chat's owner, anyone who manages the chat, and the chat's lead agent. An agent that is
 * not the lead changes nothing unless it added the agent itself. Everyone else is told who can.
 */
async function mayAdjust(ctx: ChatCtx, t: ThreadRec, agentId: string): Promise<void> {
  const row = (ctx.db.all("SELECT addedBy FROM chat_thread_agent WHERE thread = ? AND agentId = ? AND deleted_at IS NULL", t.id, agentId) as Row[])[0];
  const adder = typeof row?.["addedBy"] === "string" ? (row["addedBy"] as string) : undefined;
  const p = ctx.principal;
  if (p.kind === "agent") {
    if (p.id === adder || agentsOf(ctx.db, t.id).some((a) => a.agentId === p.id && a.mode === "lead")) return;
  } else {
    const me = askerOf(ctx);
    if (me === adder) return;
    const role = (ctx.db.all("SELECT role FROM chat_thread_member WHERE thread = ? AND principal = ? AND deleted_at IS NULL", t.id, me) as Row[])[0]?.["role"];
    if (String(role) === "owner") return;
    const host = ctx as ChatCtx & { authorize?: (action: { perm: string | null; level: string }, resource: { type: string; id: string | null }) => { effect?: string } };
    const resource = t.channelId !== undefined ? { type: "channel", id: t.channelId } : { type: "thread", id: t.id };
    if (typeof host.authorize === "function" && host.authorize({ perm: null, level: "manage" }, resource).effect === "allow") return;
  }
  const who = adder !== undefined && adder.startsWith("usr_") ? await nameOf(ctx, "person", adder) : "the person who added it";
  raise(ctx, "permission.role_lacks_permission", `Only ${who}, the chat's owner or someone who manages this chat can change how ${await nameOf(ctx, "agent", agentId)} answers.`, { agentId });
}

export async function agentSettingsSet(ctx: ChatCtx, input: {
  threadId: string; agentId: string; mode?: SetMode; when?: "always" | "topics" | "hours"; topics?: string | null; hoursFrom?: string | null; hoursTo?: string | null; style?: "short" | "full";
}) {
  const t = load(ctx, input.threadId);
  if (!input.agentId.startsWith("agt_")) raise(ctx, "validation.bad_input", "That is not an agent.", { agentId: input.agentId });
  const cur = agentsOf(ctx.db, t.id).find((a) => a.agentId === input.agentId);
  if (!cur) raise(ctx, "validation.not_found", "That agent is not in this chat.");
  await mayAdjust(ctx, t, input.agentId);
  if (input.mode !== undefined && input.mode !== "lead" && input.mode !== "listen" && input.mode !== "quiet") raise(ctx, "validation.bad_input", "An agent answers everything, answers when tagged, or listens.", { field: "mode" });
  if (input.when !== undefined && input.when !== "always" && input.when !== "topics" && input.when !== "hours") raise(ctx, "validation.bad_input", "When is always, topics or hours.", { field: "when" });
  if (input.style !== undefined && input.style !== "short" && input.style !== "full") raise(ctx, "validation.bad_input", "Style is short or full.", { field: "style" });
  const clean = (k: "hoursFrom" | "hoursTo"): string | null | undefined => {
    const v = input[k];
    if (v === undefined || v === null) return v;
    if (typeof v !== "string" || !HHMM.test(v)) raise(ctx, "validation.bad_input", "Hours are written 09:00.", { field: k });
    return v;
  };
  let topics: string | null | undefined = input.topics;
  if (typeof topics === "string") {
    topics = topics.replace(/\s+/g, " ").trim();
    if (topics.length > MAX_TOPICS) raise(ctx, "validation.bad_input", `Topics are a few words, at most ${MAX_TOPICS} characters.`, { field: "topics" });
    if (topics === "") topics = null;
  }
  const from = clean("hoursFrom"), to = clean("hoursTo");
  const when = input.when ?? cur.when ?? "always";
  const nextTopics = topics === undefined ? cur.topics ?? null : topics;
  // "Only on topics" with no words yet is a draft (a person is still typing): it is kept, and the agent answers as Always until the topics are filled (lib/route.ts mayAnswerUntagged)
  const nextFrom = from === undefined ? cur.hoursFrom ?? (when === "hours" ? "09:00" : null) : from;
  const nextTo = to === undefined ? cur.hoursTo ?? (when === "hours" ? "17:00" : null) : to;
  const style = input.style ?? cur.style ?? null;

  const mode: SetMode | undefined = input.mode;
  const sets: Array<[string, unknown]> = [["respond", when === "always" ? null : when], ["topics", nextTopics], ["hoursFrom", nextFrom], ["hoursTo", nextTo], ["style", style]];
  if (mode !== undefined) {
    sets.push(["mode", mode === "lead" ? "lead" : "listen"], ["quiet", mode === "quiet" ? 1 : null]);
    if (mode === "lead") demoteLead(ctx, t.id, input.agentId);
  }
  ctx.db.run(
    `UPDATE chat_thread_agent SET ${sets.map(([k]) => `"${k}" = ?`).join(", ")}, "version" = "version" + 1, "updated_at" = ? WHERE "thread" = ? AND "agentId" = ? AND "deleted_at" IS NULL`,
    ...sets.map(([, v]) => v), ctx.now(), t.id, input.agentId,
  );
  ctx.emit("thread.updated", t.id, { threadId: t.id, fields: ["agents"] });
  if (mode !== undefined && (mode === "lead") !== (cur.mode === "lead")) await tellEngine(ctx, t.id, input.agentId, mode === "lead" ? "lead" : "listen");
  return out(ctx, t.id);
}

// ---- an agent the chat makes for itself ------------------------------------------------------------------------------------------------------------

export async function agentCreate(ctx: ChatCtx, input: { threadId: string; name: string; brief?: string; model?: string; mode?: SetMode; idempotencyKey?: string }) {
  const t = load(ctx, input.threadId);
  if (!ctx.call) raise(ctx, "internal.unavailable", "Making an agent is not available here.");
  if (!agentMayChange(ctx, t)) raise(ctx, "permission.role_lacks_permission", "Only the lead agent of a chat adds agents to it.");
  if (t.closedAt !== undefined) raise(ctx, "validation.precondition_failed", "This thread is closed. Reopen it first.");
  if (input.mode !== undefined && input.mode !== "lead" && input.mode !== "listen" && input.mode !== "quiet") raise(ctx, "validation.bad_input", "An agent answers everything, answers when tagged, or listens.", { field: "mode" });
  if (agentsOf(ctx.db, t.id).length >= MAX_AGENTS) raise(ctx, "validation.bad_input", `A chat can have at most ${MAX_AGENTS} agents.`);
  const brief = input.brief?.replace(/\s+/g, " ").trim();
  const key = input.idempotencyKey ?? ctx.trace.traceId;
  const made = (await ctx.call("agents.create", {
    name: input.name, ...(brief ? { role: brief.slice(0, 200) } : {}), ...(input.model ? { model: input.model } : {}), computer: false, threadId: t.id, idempotencyKey: `${key}:agent`,
  }, { idempotencyKey: `${key}:agent` })) as { agent: { agentId: string } };
  const agentId = made.agent.agentId;
  const mode: SetMode = input.mode ?? "listen";
  try {
    if (mode === "lead") demoteLead(ctx, t.id, agentId);
    addAgent(ctx, t.id, { agentId, mode: mode === "lead" ? "lead" : "listen", addedBy: askerOf(ctx), owned: true, quiet: mode === "quiet" });
  } catch (e) {
    await trashOwned(ctx, [agentId]);
    throw e;
  }
  // everyone who can read the chat sees the agent, whoever made it: its people, or the Space for a public channel
  const root = rootOf(ctx, t);
  const channel = root.channelId === undefined ? undefined : channelBy(ctx.db, root.channelId);
  const readers = channel && channel.visibility !== "invite"
    ? [{ kind: "group" as const, id: "space" }]
    : [...new Set([...(root.starter?.startsWith("usr_") ? [root.starter] : []), ...membersOf(ctx.db, root.id).filter((p) => p.startsWith("usr_"))])].map((id) => ({ kind: "person" as const, id }));
  await shareOwnedWithReaders(ctx, t.id, agentId, readers);
  ctx.emit("agent.engaged", t.id, { threadId: t.id, agentId, mode: mode === "lead" ? "lead" : "listen", by: askerOf(ctx) });
  ctx.emit("thread.updated", t.id, { threadId: t.id, fields: ["agents"] });
  if (mode === "lead") await tellEngine(ctx, t.id, agentId, "lead");
  return { ...out(ctx, t.id), agentId };
}

// ---- poke -------------------------------------------------------------------------------------------------------------------------------------------

async function nameOf(ctx: ChatCtx, kind: "person" | "agent", id: string): Promise<string> {
  try {
    if (kind === "agent") return String(((await ctx.call!("agents.get", { agentId: id })) as { agent?: { name?: string } } | null)?.agent?.name || "an agent");
    return String(((await ctx.call!("access.principals.get", { principal: { kind: "person", id } })) as { principal?: { name?: string } } | null)?.principal?.name || "Someone");
  } catch { return kind === "agent" ? "an agent" : "Someone"; }
}

const POKE_WINDOW = 12;

/** The last messages of a chat as plain lines, for an agent that runs outside Vyre: who, what, and the tools used. */
async function windowText(ctx: ChatCtx, t: ThreadRec): Promise<string> {
  const lines: string[] = [];
  const names = new Map<string, string>();
  for (const m of lastMessages(ctx.db, t.id, POKE_WINDOW)) {
    if (!names.has(m.author)) names.set(m.author, await nameOf(ctx, m.author.startsWith("agt_") ? "agent" : "person", m.author));
    const tools = m.blocks.filter((b) => b["type"] === "tool_call").map((b) => String((b["data"] as { name?: unknown } | undefined)?.name ?? "a tool"));
    lines.push(`#${m.seq} ${names.get(m.author)}: ${m.body.replace(/\s+/g, " ").slice(0, 600)}${tools.length > 0 ? ` [used ${tools.join(", ")}]` : ""}`);
  }
  return lines.join("\n");
}

/** May the person (or the agent's person) use this agent? agents.get answers "not found" for one they cannot see, and the Assistant of someone else is one. */
async function mustBeUsable(ctx: ChatCtx, agentId: string): Promise<{ runtime: string; name: string }> {
  try {
    const a = ((await ctx.call!("agents.get", { agentId })) as { agent?: { runtime?: string; name?: string } } | null)?.agent;
    return { runtime: a?.runtime ?? "vyre", name: a?.name ?? "an agent" };
  } catch (e) {
    if (callCode(e) === "validation.not_found" || callCode(e) === "permission.no_grant") raise(ctx, "validation.not_found", "That agent does not exist, or it is not yours to use.", { agentId });
    throw e;
  }
}

export async function poke(ctx: ChatCtx, input: { threadId: string; agentId: string; note?: string }) {
  const t = load(ctx, input.threadId);   // a chat the poker cannot read does not exist for them
  if (!ctx.call) raise(ctx, "internal.unavailable", "Poking is not available here.");
  if (!input.agentId.startsWith("agt_")) raise(ctx, "validation.bad_input", "That is not an agent.", { agentId: input.agentId });
  const by = askerOf(ctx);
  if (!by.startsWith("usr_")) raise(ctx, "permission.no_grant", "A poke is made by a person, or by an agent for the person it works for.");
  const note = input.note?.replace(/\s+/g, " ").trim();
  if (note !== undefined && note.length > MAX_NOTE) raise(ctx, "validation.bad_input", `A poke note is at most ${MAX_NOTE} characters.`, { field: "note" });
  const agent = await mustBeUsable(ctx, input.agentId);
  const outside = agent.runtime === "outside";
  if (outside) {
    const usable = (await ctx.call("agents.outside.usable", { agentId: input.agentId })) as { usable?: boolean } | null;
    if (usable?.usable === false) raise(ctx, "permission.no_grant", "Only the person who connected this agent can give it work.", { agentId: input.agentId });
  }
  if (t.closedAt !== undefined) raise(ctx, "validation.precondition_failed", "This chat is closed. Reopen it first.");
  // an agent that is not in the chat yet joins it as a listener, as an @mention does in a person's own chat; anywhere else it has to be added first
  const here = agentsOf(ctx.db, t.id);
  if (!here.some((a) => a.agentId === input.agentId)) {
    const root = rootOf(ctx, t);
    const open = (t.kind === "chat" && t.channelId === undefined && root.id === t.id) || t.kind === "thread";
    if (!open) raise(ctx, "validation.precondition_failed", "Add the agent to this chat first, then poke it.", { agentId: input.agentId });
    if (here.length >= MAX_AGENTS) raise(ctx, "validation.bad_input", `A chat can have at most ${MAX_AGENTS} agents.`);
    addAgent(ctx, t.id, { agentId: input.agentId, mode: "listen", addedBy: by });
    ctx.emit("agent.engaged", t.id, { threadId: t.id, agentId: input.agentId, mode: "listen", by });
    ctx.emit("thread.updated", t.id, { threadId: t.id, fields: ["agents"] });
  }
  const who = await nameOf(ctx, "person", by);
  const blockId = mintId("blk", ctx.now());
  const m = insertMessage(ctx, t.id, {
    author: by, kind: "quiet", body: `${who} poked ${agent.name}${note ? `: ${note}` : ""}`,
    blocks: [{ type: "poke", v: 1, id: blockId, data: { agentId: input.agentId, by, ...(note ? { note } : {}) }, state: "done", traceId: ctx.trace.traceId }],
  });
  if (outside) {
    // the window goes with the poke, because the agent is not running here: it reads it from its queue and answers through its normal post
    await ctx.call("agents.outside.enqueue", {
      agentId: input.agentId, kind: "mention", threadId: t.id, messageId: m.id, asker: by, title: `Poked by ${who}`,
      text: `${who} poked you in this chat${note ? `: ${note}` : ""}.\nThe last ${POKE_WINDOW} messages:\n${await windowText(ctx, t)}\nAnswer in the chat, as a reply. To read further back, call chat_history_page with before set to the number of the oldest message above.`,
    });
  }
  deliver(ctx, t, m, outside ? [] : [{ kind: "agent", id: input.agentId }], { kind: "person", id: by }, { notify: false, poke: { agentId: input.agentId, by, ...(outside ? { outside: true } : {}) } });
  return { messageId: m.id, delivered: outside ? ("outside_queue" as const) : ("engine" as const) };
}

// ---- reading further back ---------------------------------------------------------------------------------------------------------------------------

export async function historyPage(ctx: ChatCtx, input: { threadId: string; before: number; limit?: number }) {
  const t = load(ctx, input.threadId);
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) raise(ctx, "validation.bad_input", "The limit is a whole number from 1 to 100.", { field: "limit" });
  if (!Number.isInteger(input.before) || input.before < 1) raise(ctx, "validation.bad_input", "Say the number of the oldest message you can see.", { field: "before" });
  // an agent reads back only in the chat it is working in; an outside agent (no working chat in its call) only in a chat it is in
  if (ctx.principal.kind === "agent") {
    const working = ctx.thread;
    const ok = working !== undefined ? working === t.id : agentsOf(ctx.db, t.id).some((a) => a.agentId === ctx.principal.id) || agentsOf(ctx.db, rootOf(ctx, t).id).some((a) => a.agentId === ctx.principal.id);
    if (!ok) raise(ctx, "permission.no_grant", "You can read back only in the chat you are working in.", { threadId: t.id });
  }
  // a person added without earlier messages (or an agent working for them) reads back no further than their start
  const floor = readFloor(ctx, t);
  const page = lastMessages(ctx.db, t.id, limit, input.before).filter((m) => m.createdAt >= floor);
  const first = page[0];
  const hasMore = first !== undefined && (ctx.db.all("SELECT 1 AS x FROM chat_message WHERE thread = ? AND threadSeq < ? AND createdAt >= ? AND deleted_at IS NULL LIMIT 1", t.id, first.seq, floor) as Row[]).length > 0;
  const enc = encOf(ctx.db, t);
  return { messages: page.map((m) => messageOut(m, enc)), hasMore, ...(hasMore && first ? { next: first.seq } : {}) };
}

/** Where the caller's reading of this chat starts, so the engine can tell an agent not to quote what the person never saw. */
export async function readFloorOf(ctx: ChatCtx, input: { threadId: string }) {
  const t = load(ctx, input.threadId);
  const at = readFloor(ctx, t);
  return at > 0 ? { fromAt: at } : {};
}

// ---- an outside agent, scoped to this chat ----------------------------------------------------------------------------------------------------------

/** What an outside agent gets in a chat, and no more: the chat (a channel's chat is the channel), the project it belongs to, its files folder and the record it is about. */
export function scopeOf(ctx: ChatCtx, t: ThreadRec): Granted[] {
  const root = rootOf(ctx, t);
  const channel = root.channelId !== undefined ? ctx.db.all("SELECT * FROM chat_channel WHERE id = ?", root.channelId)[0] as Row | undefined : undefined;
  const list: Granted[] = [];
  const put = (type: string, id: string | undefined, level: string): void => { if (id && !list.some((g) => g.type === type && g.id === id)) list.push({ type, id, level }); };
  // a channel's grants cover its threads; an inline thread or a private chat is the thread itself
  if (t.kind === "thread") put("thread", t.id, "use");
  else if (root.channelId !== undefined) put("channel", root.channelId, "use");
  else put("thread", t.id, "use");
  if (t.scopeType === "project") put("project", t.scopeId, "view");
  put("folder", t.folderId ?? root.folderId ?? (channel?.["folderId"] ? String(channel["folderId"]) : undefined), "edit");
  put("record", t.recordId ?? root.recordId ?? (channel?.["recordId"] ? String(channel["recordId"]) : undefined) ?? (t.scopeType === "record" ? t.scopeId : undefined), "view");
  return list;
}

export async function outsideAgentAdd(ctx: ChatCtx, input: { threadId: string; agentId: string; mode?: SetMode }) {
  const t = load(ctx, input.threadId);
  if (!ctx.call) raise(ctx, "internal.unavailable", "Adding an agent is not available here.");
  if (!input.agentId.startsWith("agt_")) raise(ctx, "validation.bad_input", "That is not an agent.", { agentId: input.agentId });
  if (input.mode !== undefined && input.mode !== "listen" && input.mode !== "quiet") raise(ctx, "validation.bad_input", "An outside agent answers when tagged, or listens.", { field: "mode" });
  if (!agentMayChange(ctx, t)) raise(ctx, "permission.role_lacks_permission", "Only the lead agent of a chat adds agents to it.");
  if (t.closedAt !== undefined) raise(ctx, "validation.precondition_failed", "This thread is closed. Reopen it first.");
  const agent = await mustBeUsable(ctx, input.agentId);
  if (agent.runtime !== "outside") raise(ctx, "validation.precondition_failed", "This is for an agent that runs outside Vyre. Add any other agent with threads.add_agent.", { agentId: input.agentId });
  const usable = (await ctx.call("agents.outside.usable", { agentId: input.agentId })) as { usable?: boolean } | null;
  if (usable?.usable === false) raise(ctx, "permission.no_grant", "Only the person who connected this agent can bring it into a chat.", { agentId: input.agentId });
  if (agentsOf(ctx.db, t.id).length >= MAX_AGENTS && !agentsOf(ctx.db, t.id).some((a) => a.agentId === input.agentId)) raise(ctx, "validation.bad_input", `A chat can have at most ${MAX_AGENTS} agents.`);
  const source = sourceOf(t.id);
  const wanted = scopeOf(ctx, t);
  const done: Granted[] = [];
  try {
    for (const g of wanted) {
      // access.share refuses what the person does not hold themselves (permission.not_contained): the agent never gets more than its person can give
      await ctx.call("access.share", { resource: { type: g.type, id: g.id }, subject: { kind: "agent", id: input.agentId }, level: g.level, source, idempotencyKey: `outside:${t.id}:${input.agentId}:${g.type}:${g.id}` });
      done.push(g);
    }
    if (!agentsOf(ctx.db, t.id).some((a) => a.agentId === input.agentId)) {
      addAgent(ctx, t.id, { agentId: input.agentId, mode: "listen", addedBy: askerOf(ctx), quiet: input.mode === "quiet" });
      ctx.emit("agent.engaged", t.id, { threadId: t.id, agentId: input.agentId, mode: "listen", by: askerOf(ctx) });
    } else if (input.mode !== undefined) {
      ctx.db.run(`UPDATE chat_thread_agent SET "mode" = 'listen', "quiet" = ?, "version" = "version" + 1, "updated_at" = ? WHERE "thread" = ? AND "agentId" = ? AND "deleted_at" IS NULL`, input.mode === "quiet" ? 1 : null, ctx.now(), t.id, input.agentId);
    }
    ctx.db.run(`UPDATE chat_thread_agent SET "grants" = ?, "version" = "version" + 1, "updated_at" = ? WHERE "thread" = ? AND "agentId" = ? AND "deleted_at" IS NULL`, JSON.stringify(done), ctx.now(), t.id, input.agentId);
  } catch (e) {
    // all or nothing: what was given is taken back
    for (const g of done) {
      try { await ctx.call("access.unshare", { resource: { type: g.type, id: g.id }, subject: { kind: "agent", id: input.agentId }, source }); } catch { /* the original error is the one to say */ }
    }
    throw e;
  }
  ctx.emit("thread.updated", t.id, { threadId: t.id, fields: ["agents"] });
  return { ...out(ctx, t.id), granted: done };
}

export async function outsideAgentRemove(ctx: ChatCtx, input: { threadId: string; agentId: string }) {
  const t = load(ctx, input.threadId);
  if (!input.agentId.startsWith("agt_")) raise(ctx, "validation.bad_input", "That is not an agent.", { agentId: input.agentId });
  if (!agentsOf(ctx.db, t.id).some((a) => a.agentId === input.agentId)) raise(ctx, "validation.not_found", "That agent is not in this chat.");
  if (!agentMayChange(ctx, t, input.agentId)) raise(ctx, "permission.role_lacks_permission", "Only the lead agent of a chat removes agents from it.");
  const revoked = await revokeGrants(ctx, t.id, input.agentId, grantsOf(ctx, t.id, input.agentId));
  ctx.db.run(`UPDATE chat_thread_agent SET "deleted_at" = ?, "version" = "version" + 1, "updated_at" = ? WHERE "thread" = ? AND "agentId" = ? AND "deleted_at" IS NULL`, ctx.now(), ctx.now(), t.id, input.agentId);
  ctx.emit("agent.disengaged", t.id, { threadId: t.id, agentId: input.agentId, by: askerOf(ctx) });
  return { ...out(ctx, t.id), revoked };
}

// ---- a guest of this chat only ----------------------------------------------------------------------------------------------------------------------

export async function inviteGuest(ctx: ChatCtx, input: { threadId: string; email: string; level?: "view" | "reply"; idempotencyKey?: string }) {
  const t = load(ctx, input.threadId);
  if (!ctx.call) raise(ctx, "internal.unavailable", "Inviting is not available here.");
  const root = rootOf(ctx, t);
  if (root.kind === "chat" || root.kind === "ask") {
    raise(ctx, "validation.precondition_failed", "A guest is invited to a channel. Make this chat a channel first, then invite them.", { offer: "threads.make_channel", threadId: t.id });
  }
  // a guest is invited to a channel's own chat: its inline threads belong to the channel, so there is no narrower place to give
  if (t.kind !== "channel" || t.channelId === undefined) raise(ctx, "validation.precondition_failed", "Invite the guest to the channel's own chat. An inline thread belongs to its channel.", { threadId: t.id });
  const level = input.level ?? "view";
  if (level !== "view" && level !== "reply") raise(ctx, "validation.bad_input", "A guest can view or reply.", { field: "level" });
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) raise(ctx, "validation.bad_input", "That email address does not look right.", { field: "email" });
  // who may bring someone in: the channel's owner or creator, or whoever governs the channel
  const channel = channelBy(ctx.db, t.channelId);
  const me = askerOf(ctx);
  const role = (ctx.db.all("SELECT role FROM chat_thread_member WHERE thread = ? AND principal = ? AND deleted_at IS NULL", t.id, me) as Row[])[0]?.["role"];
  if (!channel || !(channel.createdBy === me || String(role) === "owner" || mayGovernChannel(ctx, channel.id))) raise(ctx, "permission.no_grant", "Only the owner of this channel, or someone who manages it, invites guests.", { threadId: t.id });
  const made = (await ctx.call("members.invites.guest", { email, scope: { type: "channel", id: channel.id }, level, idempotencyKey: input.idempotencyKey ?? ctx.trace.traceId })) as { invite: { id: string }; link: string };
  return { inviteId: made.invite.id, link: made.link };
}

export const addsheetHandlers = {
  "threads.agent_settings.set": agentSettingsSet,
  "threads.agent.create": agentCreate,
  "threads.poke": poke,
  "chat.history.page": historyPage,
  "chat.read_floor": readFloorOf,
  "threads.outside_agent.add": outsideAgentAdd,
  "threads.outside_agent.remove": outsideAgentRemove,
  "threads.invite_guest": inviteGuest,
};
