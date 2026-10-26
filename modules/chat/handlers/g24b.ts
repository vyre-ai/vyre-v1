// Channel management and the channel stream (spec 2.5, 3.2; ARCH 6.1), group b of P-L2_LIVE.
//   channels.get / list              one channel or the list of those I can see, with my unread count
//   channels.join / leave            me in or out of a channel; join takes public channels only
//   channels.update / archive / unarchive   rename, topic, visibility; archived channels take no changes
//   channels.members.* / agents.* / agent_watch.set   who is in the room, which agents listen, which agents act unmentioned
//   channels.stream                  the timeline: messages and Run items, repeated runs of one flow collapsed into one row
//   channels.stream_prefs.*          what I hide (People, Agents, Runs) in one channel
// The access level of each capability was checked on the channel before these run. Read cursors belong to threads.mark_read (table chat_thread_read, made here if it is not there yet).
import {
  MAX_NAME, askerOf, channelBy, channelByName, channelOfRecord, channelOut, ensure, membersOf, agentsOf, isMember, addAgent, addMember, messageOf, nameKey, raise, threadBy, threadOf,
} from "../projections.ts";
import type { ChannelRec, ChatCtx, Db, Mode } from "../projections.ts";

type Row = Record<string, unknown>;
const KINDS = ["people", "agents", "runs"] as const;
type StreamKind = (typeof KINDS)[number];

function tables(db: Db): void {
  db.run("CREATE TABLE IF NOT EXISTS chat_thread_read (thread TEXT NOT NULL, principal TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (thread, principal))");
  db.run("CREATE TABLE IF NOT EXISTS chat_stream_pref (channel TEXT NOT NULL, principal TEXT NOT NULL, hide TEXT NOT NULL, PRIMARY KEY (channel, principal))");
}
function prepare(ctx: ChatCtx): void { ensure(ctx.db); tables(ctx.db); }

function load(ctx: ChatCtx, channelId: string): ChannelRec {
  prepare(ctx);
  const ch = channelBy(ctx.db, channelId);
  if (!ch) raise(ctx, "validation.not_found", "That channel does not exist.");
  return ch;
}
/** A channel that still takes changes. */
function loadLive(ctx: ChatCtx, channelId: string): ChannelRec {
  const ch = load(ctx, channelId);
  if (ch.archived) raise(ctx, "validation.bad_input", "This channel is archived. Bring it back first.");
  return ch;
}

const humans = (db: Db, thread: string): string[] => membersOf(db, thread).filter((p) => !p.startsWith("agt_"));

/** Messages in the main thread after my read cursor that someone else wrote. */
function unreadOf(db: Db, ch: ChannelRec, person: string): number {
  const r = (db.all(
    `SELECT COUNT(*) AS n FROM chat_message m WHERE m.thread = ? AND m.deleted_at IS NULL AND m.author != ?
       AND m.threadSeq > COALESCE((SELECT seq FROM chat_thread_read r WHERE r.thread = ? AND r.principal = ?), 0)`, ch.mainThread, person, ch.mainThread, person,
  ) as Row[])[0];
  return Number(r?.["n"] ?? 0);
}
function row(ctx: ChatCtx, ch: ChannelRec): Record<string, unknown> {
  return { ...channelOut(ctx.db, ch), unread: unreadOf(ctx.db, ch, askerOf(ctx)) };
}
const view = (ctx: ChatCtx, ch: ChannelRec) => ({ channel: row(ctx, ch) });
const refreshed = (ctx: ChatCtx, id: string) => view(ctx, channelBy(ctx.db, id)!);

function cleanName(ctx: ChatCtx, raw: string): string {
  const name = raw.trim().replace(/^#+/, "").trim().replace(/\s+/g, " ");
  if (name === "") raise(ctx, "validation.bad_input", "Give the channel a name.");
  if (name.length > MAX_NAME) raise(ctx, "validation.bad_input", `A channel name can be at most ${MAX_NAME} characters.`);
  return name;
}
function dropMember(ctx: ChatCtx, thread: string, person: string): boolean {
  return ctx.db.run("UPDATE chat_thread_member SET deleted_at = ?, updated_at = ? WHERE thread = ? AND principal = ? AND deleted_at IS NULL", ctx.now(), ctx.now(), thread, person).changes > 0;
}

// ---- read ---------------------------------------------------------------------------------------------------------------------------------------------

export async function channelsGet(ctx: ChatCtx, input: { channelId: string }) {
  return view(ctx, load(ctx, input.channelId));
}

export async function channelsList(ctx: ChatCtx, input: { section?: "personal" | "shared" | "space"; folderId?: string; limit?: number; cursor?: string }) {
  prepare(ctx);
  const asker = askerOf(ctx);
  let offset = 0;
  if (input.cursor !== undefined) {
    if (!/^\d{1,9}$/.test(input.cursor)) raise(ctx, "validation.bad_input", "That page cursor is not one this list gave out.");
    offset = Number(input.cursor);
  }
  const limit = input.limit ?? 100;
  const rows = ctx.db.all("SELECT id FROM chat_channel ORDER BY archived, createdAt, id") as Row[];
  const seen: ChannelRec[] = [];
  for (const r of rows) {
    const ch = channelBy(ctx.db, String(r["id"]))!;
    if (input.folderId !== undefined && ch.folderId !== input.folderId) continue;
    const mine = isMember(ctx.db, ch.mainThread, asker);
    if (ch.visibility === "invite" && !mine) continue;
    const section = ch.visibility === "public" ? "space" : humans(ctx.db, ch.mainThread).length <= 1 ? "personal" : "shared";
    if (input.section !== undefined && input.section !== section) continue;
    seen.push(ch);
  }
  const page = seen.slice(offset, offset + limit);
  const next = offset + limit < seen.length ? String(offset + limit) : undefined;
  return { channels: page.map((c) => row(ctx, c)), total: seen.length, ...(next !== undefined ? { next } : {}) };
}

// ---- me in and out -------------------------------------------------------------------------------------------------------------------------------

export async function channelsJoin(ctx: ChatCtx, input: { channelId: string }) {
  const ch = loadLive(ctx, input.channelId);
  const asker = askerOf(ctx);
  if (!asker.startsWith("usr_")) raise(ctx, "validation.bad_input", "Only a person joins a channel.");
  if (isMember(ctx.db, ch.mainThread, asker)) return view(ctx, ch);
  if (ch.visibility !== "public") raise(ctx, "validation.bad_input", "This channel is invite-only. Ask a member to add you.");
  addMember(ctx, ch.mainThread, asker);
  ctx.emit("channel.member_added", ch.id, { channelId: ch.id, threadId: ch.mainThread, personId: asker, by: asker });
  return view(ctx, ch);
}

export async function channelsLeave(ctx: ChatCtx, input: { channelId: string }) {
  const ch = load(ctx, input.channelId);
  const asker = askerOf(ctx);
  if (dropMember(ctx, ch.mainThread, asker)) ctx.emit("channel.member_removed", ch.id, { channelId: ch.id, threadId: ch.mainThread, personId: asker, by: asker });
  return { ok: true };
}

// ---- the room ------------------------------------------------------------------------------------------------------------------------------------

export async function channelsUpdate(ctx: ChatCtx, input: { channelId: string; name?: string; topic?: string; visibility?: "public" | "invite" }) {
  const ch = loadLive(ctx, input.channelId);
  if (input.name === undefined && input.topic === undefined && input.visibility === undefined) raise(ctx, "validation.bad_input", "Say what to change: the name, the topic or the visibility.");
  const fields: string[] = [];
  const now = ctx.now();
  // Every refusal comes before the first write: a refused call must leave no row changed.
  let name: string | undefined;
  if (input.name !== undefined) {
    name = cleanName(ctx, input.name);
    const other = channelByName(ctx.db, name);
    if (other && other.id !== ch.id) raise(ctx, "validation.bad_input", "A channel with that name already exists.", { name });
  }
  let topic: string | undefined;
  if (input.topic !== undefined) {
    topic = input.topic.trim();
    if (topic.length > 250) raise(ctx, "validation.bad_input", "A topic can be at most 250 characters.");
  }
  if (name !== undefined && name !== ch.name) {
    ctx.db.run("UPDATE chat_channel SET name = ?, nameKey = ?, updatedAt = ? WHERE id = ?", name, nameKey(name), now, ch.id);
    ctx.db.run("UPDATE chat_thread SET title = ?, updated_at = ? WHERE id = ?", name, now, ch.mainThread);
    fields.push("name");
  }
  if (topic !== undefined && topic !== (ch.topic ?? "")) { ctx.db.run("UPDATE chat_channel SET topic = ?, updatedAt = ? WHERE id = ?", topic === "" ? null : topic, now, ch.id); fields.push("topic"); }
  if (input.visibility !== undefined && input.visibility !== ch.visibility) {
    ctx.db.run("UPDATE chat_channel SET visibility = ?, updatedAt = ? WHERE id = ?", input.visibility, now, ch.id);
    fields.push("visibility");
  }
  if (fields.length > 0) ctx.emit("channel.updated", ch.id, { channelId: ch.id, fields });
  return refreshed(ctx, ch.id);
}

export async function channelsArchive(ctx: ChatCtx, input: { channelId: string }) {
  const ch = load(ctx, input.channelId);
  if (!ch.archived) {
    ctx.db.run("UPDATE chat_channel SET archived = 1, updatedAt = ? WHERE id = ?", ctx.now(), ch.id);
    ctx.emit("channel.archived", ch.id, { channelId: ch.id });
  }
  return refreshed(ctx, ch.id);
}

export async function channelsUnarchive(ctx: ChatCtx, input: { channelId: string }) {
  const ch = load(ctx, input.channelId);
  if (ch.archived) {
    // The name and the record may have been taken while it slept.
    const named = channelByName(ctx.db, ch.name);
    if (named && named.id !== ch.id) raise(ctx, "validation.bad_input", "Another channel has this name now. Rename one of them first.", { name: ch.name });
    const rec = ch.recordId !== undefined ? channelOfRecord(ctx.db, ch.recordId) : null;
    if (rec && rec.id !== ch.id) raise(ctx, "validation.bad_input", "That record has a channel again.", { recordId: ch.recordId });
    ctx.db.run("UPDATE chat_channel SET archived = 0, updatedAt = ? WHERE id = ?", ctx.now(), ch.id);
    ctx.emit("channel.unarchived", ch.id, { channelId: ch.id });
  }
  return refreshed(ctx, ch.id);
}

export async function channelsMembersAdd(ctx: ChatCtx, input: { channelId: string; personIds: string[]; level?: string }) {
  const ch = loadLive(ctx, input.channelId);
  const ids: string[] = [];
  for (const id of input.personIds) {
    if (!id.startsWith("usr_")) raise(ctx, "validation.bad_input", "That is not a person.", { id });
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) raise(ctx, "validation.bad_input", "Pick at least one person.");
  const by = askerOf(ctx);
  for (const personId of ids) {
    if (isMember(ctx.db, ch.mainThread, personId)) continue;
    addMember(ctx, ch.mainThread, personId);
    ctx.emit("channel.member_added", ch.id, { channelId: ch.id, threadId: ch.mainThread, personId, by });
  }
  return refreshed(ctx, ch.id);
}

export async function channelsMembersRemove(ctx: ChatCtx, input: { channelId: string; personId: string }) {
  const ch = loadLive(ctx, input.channelId);
  if (!input.personId.startsWith("usr_")) raise(ctx, "validation.bad_input", "That is not a person.", { id: input.personId });
  if (dropMember(ctx, ch.mainThread, input.personId)) ctx.emit("channel.member_removed", ch.id, { channelId: ch.id, threadId: ch.mainThread, personId: input.personId, by: askerOf(ctx) });
  return refreshed(ctx, ch.id);
}

export async function channelsAgentsAdd(ctx: ChatCtx, input: { channelId: string; agentId: string; mode?: Mode }) {
  const ch = loadLive(ctx, input.channelId);
  if (!input.agentId.startsWith("agt_")) raise(ctx, "validation.bad_input", "That is not an agent.", { id: input.agentId });
  if (agentsOf(ctx.db, ch.mainThread).length >= 20 && !agentsOf(ctx.db, ch.mainThread).some((a) => a.agentId === input.agentId)) raise(ctx, "validation.bad_input", "A channel can have at most 20 agents.");
  if (!agentsOf(ctx.db, ch.mainThread).some((a) => a.agentId === input.agentId)) {
    const mode: Mode = input.mode ?? "listen";
    const by = askerOf(ctx);
    addAgent(ctx, ch.mainThread, { agentId: input.agentId, mode, addedBy: by });
    ctx.emit("channel.agent_added", ch.id, { channelId: ch.id, agentId: input.agentId, mode });
    ctx.emit("agent.engaged", ch.mainThread, { threadId: ch.mainThread, agentId: input.agentId, mode, by });
  }
  return refreshed(ctx, ch.id);
}

export async function channelsAgentsRemove(ctx: ChatCtx, input: { channelId: string; agentId: string }) {
  const ch = loadLive(ctx, input.channelId);
  const changed = ctx.db.run("UPDATE chat_thread_agent SET deleted_at = ?, updated_at = ? WHERE thread = ? AND agentId = ? AND deleted_at IS NULL", ctx.now(), ctx.now(), ch.mainThread, input.agentId).changes;
  if (changed > 0) {
    ctx.emit("channel.agent_removed", ch.id, { channelId: ch.id, agentId: input.agentId });
    ctx.emit("agent.disengaged", ch.mainThread, { threadId: ch.mainThread, agentId: input.agentId, by: askerOf(ctx) });
  }
  return refreshed(ctx, ch.id);
}

export async function channelsAgentWatchSet(ctx: ChatCtx, input: { channelId: string; agentId: string; watches: boolean }) {
  const ch = loadLive(ctx, input.channelId);
  const a = agentsOf(ctx.db, ch.mainThread).find((x) => x.agentId === input.agentId);
  if (!a) raise(ctx, "validation.not_found", "That agent is not in this channel.", { agentId: input.agentId });
  if ((a.watches === true) !== input.watches) {
    ctx.db.run("UPDATE chat_thread_agent SET watches = ?, updated_at = ? WHERE thread = ? AND agentId = ? AND deleted_at IS NULL", input.watches ? 1 : 0, ctx.now(), ch.mainThread, input.agentId);
    ctx.emit("channel.agent_watch_changed", ch.id, { channelId: ch.id, agentId: input.agentId, watches: input.watches, by: askerOf(ctx) });
  }
  return refreshed(ctx, ch.id);
}

// ---- the stream ----------------------------------------------------------------------------------------------------------------------------------

function prefsOf(db: Db, channel: string, principal: string): StreamKind[] {
  const r = (db.all("SELECT hide FROM chat_stream_pref WHERE channel = ? AND principal = ?", channel, principal) as Row[])[0];
  let list: unknown[] = [];
  try { list = r ? (JSON.parse(String(r["hide"])) as unknown[]) : []; } catch { list = []; }
  return KINDS.filter((k) => list.includes(k));
}

export async function channelsStreamPrefsGet(ctx: ChatCtx, input: { channelId: string }) {
  const ch = load(ctx, input.channelId);
  return { hide: prefsOf(ctx.db, ch.id, askerOf(ctx)) };
}

export async function channelsStreamPrefsSet(ctx: ChatCtx, input: { channelId: string; hide: string[] }) {
  const ch = load(ctx, input.channelId);
  for (const k of input.hide) if (!(KINDS as readonly string[]).includes(k)) raise(ctx, "validation.bad_input", "You can hide people, agents or runs.", { kind: k });
  const hide = KINDS.filter((k) => input.hide.includes(k));
  ctx.db.run("INSERT OR REPLACE INTO chat_stream_pref (channel, principal, hide) VALUES (?, ?, ?)", ch.id, askerOf(ctx), JSON.stringify(hide));
  return { hide };
}

interface Entry { at: number; run?: { runId: string; name?: string; durationMs?: number }; message?: { id: string; authorKind: "person" | "agent" | "actor" } }
const authorKindOf = (id: string): "person" | "agent" | "actor" => (id.startsWith("agt_") ? "agent" : id.startsWith("act_") ? "actor" : "person");

export async function channelsStream(ctx: ChatCtx, input: { channelId: string; before?: number; limit?: number; show?: string[]; expand?: string[] }) {
  const ch = load(ctx, input.channelId);
  const main = threadBy(ctx.db, ch.mainThread);
  if (!main) raise(ctx, "validation.not_found", "That channel has no timeline.");
  const show = new Set(input.show ?? []);
  const hidden = prefsOf(ctx.db, ch.id, askerOf(ctx)).filter((k) => !show.has(k));
  const expand = new Set(input.expand ?? []);
  const limit = input.limit ?? 50;

  // A Run shows as one row of its own, so the system line chat.start wrote for it is left out.
  const runs = (ctx.db.all("SELECT * FROM chat_thread WHERE parentThreadId = ? AND kind = 'run' AND deleted_at IS NULL ORDER BY createdAt, id LIMIT 1000", main.id) as Row[]).map(threadOf);
  const lines = new Set(runs.map((r) => r.parentMessageId));
  const msgs = (ctx.db.all("SELECT * FROM chat_message WHERE thread = ? AND deleted_at IS NULL ORDER BY threadSeq DESC LIMIT 1000", main.id) as Row[]).map(messageOf).reverse();

  let entries: Entry[] = [
    ...msgs.filter((m) => !lines.has(m.id)).map((m): Entry => ({ at: m.createdAt, message: { id: m.id, authorKind: authorKindOf(m.author) } })),
    ...runs.map((r): Entry => ({
      at: r.createdAt,
      run: { runId: r.scopeId ?? r.id, ...(r.title !== undefined ? { name: r.title } : {}), ...(r.closedAt !== undefined ? { durationMs: Math.max(0, r.closedAt - r.createdAt) } : {}) },
    })),
  ].sort((a, b) => a.at - b.at);
  entries = entries.filter((e) => {
    if (e.run) return !hidden.includes("runs");
    if (e.message!.authorKind === "agent") return !hidden.includes("agents");
    return !hidden.includes("people");
  });
  if (input.before !== undefined) entries = entries.filter((e) => e.at < input.before!);

  // Runs of one flow that sit next to each other become one row.
  const items: Array<Record<string, unknown>> = [];
  const st: { open: { key: string; list: NonNullable<Entry["run"]>[]; at: number } | null } = { open: null };
  const flush = (): void => {
    const o = st.open;
    if (!o) return;
    if (o.list.length === 1) {
      const r = o.list[0]!;
      items.push({ kind: "run", at: o.at, runId: r.runId, ...(r.name !== undefined ? { name: r.name } : {}), ...(r.durationMs !== undefined ? { durationMs: r.durationMs } : {}) });
    } else {
      items.push({ kind: "run_group", at: o.at, count: o.list.length, groupKey: o.key, runIds: o.list.map((r) => r.runId), ...(o.list[0]!.name !== undefined ? { name: o.list[0]!.name } : {}) });
    }
    st.open = null;
  };
  for (const e of entries) {
    if (e.message) { flush(); items.push({ kind: "message", at: e.at, messageId: e.message.id, authorKind: e.message.authorKind }); continue; }
    const run = e.run!;
    const key = run.name !== undefined ? `flow:${nameKey(run.name)}` : undefined;
    if (key === undefined || expand.has(key)) { flush(); st.open = { key: key ?? run.runId, list: [run], at: e.at }; flush(); continue; }
    if (st.open && st.open.key === key) { st.open.list.push(run); st.open.at = e.at; continue; }
    flush();
    st.open = { key, list: [run], at: e.at };
  }
  flush();

  const page = items.slice(Math.max(0, items.length - limit));
  return {
    items: page, hasMore: items.length > page.length,
    counts: { people: humans(ctx.db, main.id).length, agents: agentsOf(ctx.db, main.id).length, runs: runs.length },
    hidden,
  };
}

export const g24bHandlers = {
  "channels.get": channelsGet,
  "channels.list": channelsList,
  "channels.join": channelsJoin,
  "channels.leave": channelsLeave,
  "channels.update": channelsUpdate,
  "channels.archive": channelsArchive,
  "channels.unarchive": channelsUnarchive,
  "channels.members.add": channelsMembersAdd,
  "channels.members.remove": channelsMembersRemove,
  "channels.agents.add": channelsAgentsAdd,
  "channels.agents.remove": channelsAgentsRemove,
  "channels.agent_watch.set": channelsAgentWatchSet,
  "channels.stream": channelsStream,
  "channels.stream_prefs.get": channelsStreamPrefsGet,
  "channels.stream_prefs.set": channelsStreamPrefsSet,
};
