// @reads /modules/chat/migrations/0001_chat.sql
// Durable rows of the chat module (threads, members, agents, messages, channels, waiting blocks, plans), the one place that hands out per-thread sequence numbers,
// and the row-to-contract mappers the handlers share. Every statement names a chat_* table, which is all ctx.db lets a module touch. The migration file is the one source of the schema.
// Private chats and Ask panes are enc=2 rows (spec 2.5, ARCH 5): the device encrypts, the server stores what it is given, so `enc` is derived from the thread kind and never stored.
import { readFileSync } from "node:fs";
import { fail } from "../../host/src/routes/errors.ts";
import { mintId as mint } from "../../lib/ids.ts";
import type { ErrorCode, EventName } from "../../packages/contracts/src/types.ts";

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
export interface Principal { kind: "person" | "agent" | "actor" | "service"; id: string }

/** The part of the host Ctx these handlers read. A test passes a small object; the host passes the full Ctx. */
export interface ChatCtx {
  space: string;
  principal: Principal;
  actingFor?: string | undefined;
  thread?: string | undefined;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: EventName, subject: string, payload: unknown): unknown;
  call?(cap: string, input: unknown, opts?: { idempotencyKey?: string }): Promise<unknown>;
  log: { warn(msg: string, attrs?: Record<string, unknown>): void };
}

type Row = Record<string, unknown>;
export type ThreadKind = "chat" | "channel" | "thread" | "ask" | "run" | "helper" | "console";
export type Mode = "lead" | "listen";

export function raise(ctx: Pick<ChatCtx, "trace">, code: ErrorCode, message: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { message, ...(details ? { details } : {}) });
}

/** Contract ids are `<prefix>_<lowercase alphanumerics>`. */
export const mintId = (prefix: string, now: number = Date.now()): string => mint(prefix, now).replaceAll("-", "");

const str = (v: unknown): string => String(v);
const optStr = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));
const num = (v: unknown): number => Number(v);
const optNum = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number(v));
const flag = (v: unknown): boolean => v === 1 || v === true || v === "1";

/** Who a stored id is: the contract prefixes say it (usr, agt, act, svc). */
export function refOf(id: string): { kind: Principal["kind"]; id: string } {
  const p = id.slice(0, 4);
  return { kind: p === "agt_" ? "agent" : p === "act_" ? "actor" : p === "svc_" ? "service" : "person", id };
}
/** The person behind a call: the person an agent acts for, else the caller. */
export const askerOf = (ctx: Pick<ChatCtx, "principal" | "actingFor">): string => ctx.actingFor ?? ctx.principal.id;

// ---- schema -----------------------------------------------------------------------------------------------------------------------------------------

const SCHEMA = readFileSync(new URL("./migrations/0001_chat.sql", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter((s) => s.length > 0);
const ready = new WeakSet<object>();

/** Make sure the chat tables exist. One cheap probe per handle; the IF NOT EXISTS statements run only when it fails. */
export function ensure(db: Db): void {
  if (ready.has(db)) return;
  try { db.all("SELECT id FROM chat_plan WHERE id = ?", "probe"); } catch { for (const stmt of SCHEMA) db.run(stmt); }
  ready.add(db);
}

// ---- limits ----------------------------------------------------------------------------------------------------------------------------------------

export const MAX_BODY = 100_000;
export const MAX_MENTIONS = 50;
export const MAX_BLOCKS = 20;
export const DEFAULT_HOPS = 4;
export const MAX_NAME = 80;

/** Agent-to-agent hops before a person must reply: the Policies setting engine.agent_hops, 4 when it cannot be read. */
export async function hopLimit(ctx: ChatCtx): Promise<number> {
  if (!ctx.call) return DEFAULT_HOPS;
  try {
    const out = (await ctx.call("settings.get", { key: "engine.agent_hops" })) as { row?: { value?: unknown } } | null | undefined;
    const v = out?.row?.value;
    return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : DEFAULT_HOPS;
  } catch { return DEFAULT_HOPS; }
}

// ---- threads ----------------------------------------------------------------------------------------------------------------------------------------

export interface ThreadRec {
  id: string; kind: ThreadKind; title?: string; starter?: string; recordId?: string; folderId?: string; scopeType?: string; scopeId?: string; channelId?: string;
  parentThreadId?: string; parentMessageId?: string; listed: boolean; planMode: boolean; createdAt: number; closedAt?: number;
}
export function threadOf(r: Row): ThreadRec {
  const o: ThreadRec = { id: str(r["id"]), kind: str(r["kind"]) as ThreadKind, listed: flag(r["listed"]), planMode: flag(r["modePlan"]), createdAt: num(r["createdAt"]) };
  const set = <K extends keyof ThreadRec>(k: K, v: ThreadRec[K] | undefined): void => { if (v !== undefined) o[k] = v; };
  set("title", optStr(r["title"])); set("starter", optStr(r["starter"])); set("recordId", optStr(r["recordId"])); set("folderId", optStr(r["folderId"]));
  set("scopeType", optStr(r["scopeType"])); set("scopeId", optStr(r["scopeId"])); set("channelId", optStr(r["channelId"]));
  set("parentThreadId", optStr(r["parentThreadId"])); set("parentMessageId", optStr(r["parentMessageId"])); set("closedAt", optNum(r["closedAt"]));
  return o;
}

export function threadBy(db: Db, id: string): ThreadRec | null {
  const r = (db.all("SELECT * FROM chat_thread WHERE id = ? AND deleted_at IS NULL", id) as Row[])[0];
  return r ? threadOf(r) : null;
}

export interface NewThread {
  kind: ThreadKind; title?: string | undefined; starter?: string | undefined; recordId?: string | undefined; folderId?: string | undefined; scopeType?: string | undefined; scopeId?: string | undefined;
  channelId?: string | undefined; parentThreadId?: string | undefined; parentMessageId?: string | undefined; listed: boolean; planMode?: boolean;
}
export function insertThread(ctx: Pick<ChatCtx, "db" | "now">, t: NewThread): ThreadRec {
  const now = ctx.now();
  const id = mintId("thr", now);
  ctx.db.run(
    `INSERT INTO chat_thread (id, kind, title, starter, recordId, folderId, scopeType, scopeId, channelId, parentThreadId, parentMessageId, listed, modePlan, createdAt, closedAt, version, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, NULL)`,
    id, t.kind, t.title ?? null, t.starter ?? null, t.recordId ?? null, t.folderId ?? null, t.scopeType ?? null, t.scopeId ?? null, t.channelId ?? null,
    t.parentThreadId ?? null, t.parentMessageId ?? null, t.listed ? 1 : 0, t.planMode ? 1 : 0, now, now,
  );
  return threadBy(ctx.db, id)!;
}

/** Private chats and Ask panes (and what hangs under them) are enc=2 rows: owner key, end to end. */
export function encOf(db: Db, t: ThreadRec): number {
  let cur: ThreadRec | null = t;
  for (let i = 0; cur && i < 4; i++) {
    if (cur.kind === "chat" || cur.kind === "ask") return 2;
    cur = cur.parentThreadId ? threadBy(db, cur.parentThreadId) : null;
  }
  return 0;
}

// ---- members and agents -----------------------------------------------------------------------------------------------------------------------------

export function membersOf(db: Db, thread: string): string[] {
  return (db.all("SELECT principal FROM chat_thread_member WHERE thread = ? AND deleted_at IS NULL ORDER BY rowid", thread) as Row[]).map((r) => str(r["principal"]));
}
export function isMember(db: Db, thread: string, principal: string): boolean {
  return db.all("SELECT 1 AS x FROM chat_thread_member WHERE thread = ? AND principal = ? AND deleted_at IS NULL", thread, principal).length > 0;
}
export function addMember(ctx: Pick<ChatCtx, "db" | "now">, thread: string, principal: string, role: "owner" | "member" = "member"): void {
  if (isMember(ctx.db, thread, principal)) return;
  const now = ctx.now();
  ctx.db.run(
    "INSERT INTO chat_thread_member (id, thread, principal, role, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, 0, ?, NULL)",
    mintId("thm", now), thread, principal, role, now,
  );
}

export interface AgentRec { agentId: string; mode: Mode; model?: string; provider?: string; effort?: string; accountRef?: string; watches?: boolean }
export function agentsOf(db: Db, thread: string): AgentRec[] {
  return (db.all("SELECT * FROM chat_thread_agent WHERE thread = ? AND deleted_at IS NULL ORDER BY rowid", thread) as Row[]).map((r) => {
    const o: AgentRec = { agentId: str(r["agentId"]), mode: str(r["mode"]) === "lead" ? "lead" : "listen" };
    const model = optStr(r["model"]); if (model !== undefined) o.model = model;
    const provider = optStr(r["provider"]); if (provider !== undefined) o.provider = provider;
    const effort = optStr(r["effort"]); if (effort !== undefined) o.effort = effort;
    const accountRef = optStr(r["accountRef"]); if (accountRef !== undefined) o.accountRef = accountRef;
    if (flag(r["watches"])) o.watches = true;
    return o;
  });
}
export function addAgent(ctx: Pick<ChatCtx, "db" | "now">, thread: string, a: { agentId: string; mode: Mode; model?: string | undefined; provider?: string | undefined; effort?: string | undefined; accountRef?: string | undefined; addedBy: string }): void {
  if (ctx.db.all("SELECT 1 AS x FROM chat_thread_agent WHERE thread = ? AND agentId = ? AND deleted_at IS NULL", thread, a.agentId).length > 0) return;
  const now = ctx.now();
  ctx.db.run(
    `INSERT INTO chat_thread_agent (id, thread, agentId, mode, model, provider, effort, accountRef, addedBy, watches, version, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, NULL)`,
    mintId("tha", now), thread, a.agentId, a.mode, a.model ?? null, a.provider ?? null, a.effort ?? null, a.accountRef ?? null, a.addedBy, now,
  );
}

/** The full thread row of the contract. */
export function threadOut(db: Db, t: ThreadRec): Record<string, unknown> {
  const out: Record<string, unknown> = {
    threadId: t.id, kind: t.kind, listed: t.listed, planMode: t.planMode,
    members: membersOf(db, t.id).map(refOf),
    agents: agentsOf(db, t.id).map((a) => ({ agentId: a.agentId, mode: a.mode, ...(a.model !== undefined ? { model: a.model } : {}), ...(a.provider !== undefined ? { provider: a.provider } : {}), ...(a.effort !== undefined ? { effort: a.effort } : {}), ...(a.accountRef !== undefined ? { accountRef: a.accountRef } : {}), ...(a.watches !== undefined ? { watches: a.watches } : {}) })),
    createdAt: t.createdAt,
  };
  const set = (k: string, v: unknown): void => { if (v !== undefined) out[k] = v; };
  set("title", t.title); set("starter", t.starter); set("channelId", t.channelId); set("parentThreadId", t.parentThreadId); set("parentMessageId", t.parentMessageId);
  set("recordId", t.recordId); set("folderId", t.folderId); set("scopeType", t.scopeType); set("scopeId", t.scopeId); set("closedAt", t.closedAt);
  if (t.kind === "helper") {
    // the address bar of a helper chat: each ancestor, each part a link back
    const path: Array<{ title: string; threadId: string }> = [];
    let cur: ThreadRec | null = t;
    for (let i = 0; cur && i < 8; i++) { path.unshift({ title: cur.title ?? "Chat", threadId: cur.id }); cur = cur.parentThreadId ? threadBy(db, cur.parentThreadId) : null; }
    out["path"] = path;
  }
  return out;
}

// ---- messages ---------------------------------------------------------------------------------------------------------------------------------------

export interface MessageRec {
  id: string; thread: string; seq: number; author: string; kind: "text" | "agent" | "system" | "quiet"; body: string; blocks: Array<Record<string, unknown>>; replyTo?: string;
  via?: { routineOwner: string }; depth: number; attachments: string[]; reactions: Array<{ emoji: string; by: string[] }>; pinned: boolean; editedAt?: number; createdAt: number;
}
const parseJson = <T>(raw: unknown, fallback: T): T => { try { return raw === null || raw === undefined ? fallback : (JSON.parse(str(raw)) as T); } catch { return fallback; } };

export function messageOf(r: Row): MessageRec {
  const o: MessageRec = {
    id: str(r["id"]), thread: str(r["thread"]), seq: num(r["threadSeq"]), author: str(r["author"]), kind: str(r["kind"]) as MessageRec["kind"], body: str(r["body"] ?? ""),
    blocks: parseJson(r["blocks"], []), depth: num(r["depth"] ?? 0), attachments: parseJson(r["attachments"], []), reactions: parseJson(r["reactions"], []), pinned: flag(r["pinned"]), createdAt: num(r["createdAt"]),
  };
  const replyTo = optStr(r["replyTo"]); if (replyTo !== undefined) o.replyTo = replyTo;
  const via = parseJson<{ routineOwner?: string } | null>(r["via"], null); if (via?.routineOwner) o.via = { routineOwner: via.routineOwner };
  const editedAt = optNum(r["editedAt"]); if (editedAt !== undefined) o.editedAt = editedAt;
  return o;
}

export function messageBy(db: Db, id: string): MessageRec | null {
  const r = (db.all("SELECT * FROM chat_message WHERE id = ? AND deleted_at IS NULL", id) as Row[])[0];
  return r ? messageOf(r) : null;
}

/** The message row of the contract. */
export function messageOut(m: MessageRec, enc: number): Record<string, unknown> {
  return {
    messageId: m.id, threadId: m.thread, threadSeq: m.seq, author: refOf(m.author), kind: m.kind, body: m.body, blocks: m.blocks,
    ...(m.replyTo !== undefined ? { replyTo: m.replyTo } : {}), ...(m.via !== undefined ? { via: m.via } : {}), depth: m.depth, attachments: m.attachments, reactions: m.reactions,
    pinned: m.pinned, ...(m.editedAt !== undefined ? { editedAt: m.editedAt } : {}), createdAt: m.createdAt, enc,
  };
}

/** Resume a chat: the last `n` messages (default 50), oldest first, read off the (thread, threadSeq) index with no sort. `before` pages backwards. */
export function lastMessages(db: Db, thread: string, n = 50, before?: number): MessageRec[] {
  const rows = (before === undefined
    ? db.all("SELECT * FROM chat_message WHERE thread = ? AND deleted_at IS NULL ORDER BY threadSeq DESC LIMIT ?", thread, n)
    : db.all("SELECT * FROM chat_message WHERE thread = ? AND threadSeq < ? AND deleted_at IS NULL ORDER BY threadSeq DESC LIMIT ?", thread, before, n)) as Row[];
  return rows.map(messageOf).reverse();
}

/** The newest message of a thread, or null. */
export function lastMessage(db: Db, thread: string): MessageRec | null {
  const r = (db.all("SELECT * FROM chat_message WHERE thread = ? AND deleted_at IS NULL ORDER BY threadSeq DESC LIMIT 1", thread) as Row[])[0];
  return r ? messageOf(r) : null;
}

/** The next sequence number of a thread. Gap-free because it is taken at the last moment, right before the insert, in the same synchronous run. */
export function nextSeq(db: Db, thread: string): number {
  const changed = db.run("UPDATE chat_thread_seq SET last = last + 1 WHERE thread = ?", thread).changes;
  if (changed === 0) {
    // First message of the thread, or a thread whose counter was never made: continue from what is stored.
    const top = optNum((db.all("SELECT MAX(threadSeq) AS top FROM chat_message WHERE thread = ?", thread) as Row[])[0]?.["top"]) ?? 0;
    db.run("INSERT INTO chat_thread_seq (thread, last) VALUES (?, ?)", thread, top + 1);
    return top + 1;
  }
  return num((db.all("SELECT last FROM chat_thread_seq WHERE thread = ?", thread) as Row[])[0]?.["last"]);
}

export interface NewMessage {
  id?: string | undefined; author: string; kind: MessageRec["kind"]; body: string; blocks?: Array<Record<string, unknown>>; replyTo?: string | undefined;
  via?: { routineOwner: string } | undefined; depth?: number; attachments?: string[];
}
/** Insert one message with the next sequence number. Validate everything before this call: it must not fail half way. */
export function insertMessage(ctx: Pick<ChatCtx, "db" | "now">, thread: string, m: NewMessage): MessageRec {
  const now = ctx.now();
  const id = m.id ?? mintId("msg", now);
  const seq = nextSeq(ctx.db, thread);
  ctx.db.run(
    `INSERT INTO chat_message (id, thread, threadSeq, author, kind, body, blocks, replyTo, via, depth, attachments, pinned, reactions, editedAt, createdAt, version, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '[]', NULL, ?, 0, ?, NULL)`,
    id, thread, seq, m.author, m.kind, m.body, JSON.stringify(m.blocks ?? []), m.replyTo ?? null, m.via ? JSON.stringify(m.via) : null, m.depth ?? 0, JSON.stringify(m.attachments ?? []), now, now,
  );
  return messageBy(ctx.db, id)!;
}

// ---- channels ---------------------------------------------------------------------------------------------------------------------------------------

export interface ChannelRec {
  id: string; mainThread: string; name: string; topic?: string; visibility: "public" | "invite"; folderId?: string; recordId?: string; archived: boolean; createdBy?: string; createdAt: number;
}
export function channelOf(r: Row): ChannelRec {
  const o: ChannelRec = { id: str(r["id"]), mainThread: str(r["mainThread"]), name: str(r["name"]), visibility: str(r["visibility"]) === "public" ? "public" : "invite", archived: flag(r["archived"]), createdAt: num(r["createdAt"]) };
  const topic = optStr(r["topic"]); if (topic !== undefined) o.topic = topic;
  const folderId = optStr(r["folderId"]); if (folderId !== undefined) o.folderId = folderId;
  const recordId = optStr(r["recordId"]); if (recordId !== undefined) o.recordId = recordId;
  const createdBy = optStr(r["createdBy"]); if (createdBy !== undefined) o.createdBy = createdBy;
  return o;
}
export function channelBy(db: Db, id: string): ChannelRec | null {
  const r = (db.all("SELECT * FROM chat_channel WHERE id = ?", id) as Row[])[0];
  return r ? channelOf(r) : null;
}
/** The live channel of a record (a Project or Journey channel), or null. */
export function channelOfRecord(db: Db, recordId: string): ChannelRec | null {
  const r = (db.all("SELECT * FROM chat_channel WHERE recordId = ? AND archived = 0 ORDER BY createdAt LIMIT 1", recordId) as Row[])[0];
  return r ? channelOf(r) : null;
}
/** A name compared the way people read it: case and runs of spaces do not make two channels. */
export const nameKey = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();
export function channelByName(db: Db, name: string): ChannelRec | null {
  const r = (db.all("SELECT * FROM chat_channel WHERE nameKey = ? AND archived = 0 LIMIT 1", nameKey(name)) as Row[])[0];
  return r ? channelOf(r) : null;
}

export function insertChannel(ctx: Pick<ChatCtx, "db" | "now">, c: { id?: string; mainThread: string; name: string; topic?: string | undefined; visibility: "public" | "invite"; folderId?: string | undefined; recordId?: string | undefined; createdBy: string }): ChannelRec {
  const now = ctx.now();
  const id = c.id ?? mintId("chn", now);
  ctx.db.run(
    `INSERT INTO chat_channel (id, mainThread, name, nameKey, topic, visibility, folderId, recordId, archived, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    id, c.mainThread, c.name, nameKey(c.name), c.topic ?? null, c.visibility, c.folderId ?? null, c.recordId ?? null, c.createdBy, now, now,
  );
  return channelBy(ctx.db, id)!;
}

/** The channel row of the contract. Read cursors belong to threads.mark_read, so unread is 0 here. */
export function channelOut(db: Db, c: ChannelRec): Record<string, unknown> {
  const t = threadBy(db, c.mainThread);
  return {
    channelId: c.id, mainThreadId: c.mainThread, name: c.name, ...(c.topic !== undefined ? { topic: c.topic } : {}), visibility: c.visibility,
    ...(c.folderId !== undefined ? { folderId: c.folderId } : {}), ...(c.recordId !== undefined ? { recordId: c.recordId } : {}), archived: c.archived,
    members: membersOf(db, c.mainThread).filter((p) => !p.startsWith("agt_")).map(refOf),
    agents: t ? (threadOut(db, t)["agents"] as unknown[]) : [], unread: 0, createdAt: c.createdAt,
  };
}

// ---- waiting blocks and plans -----------------------------------------------------------------------------------------------------------------------

export interface BlockRec { id: string; thread: string; message: string; type: string; state: "waiting" | "done"; data: Record<string, unknown>; answer?: unknown; answeredBy?: string; answeredAt?: number; createdAt: number }
export function blockBy(db: Db, id: string): BlockRec | null {
  const r = (db.all("SELECT * FROM chat_block WHERE id = ?", id) as Row[])[0];
  if (!r) return null;
  const o: BlockRec = { id: str(r["id"]), thread: str(r["thread"]), message: str(r["message"]), type: str(r["type"]), state: str(r["state"]) === "done" ? "done" : "waiting", data: parseJson(r["data"], {}), createdAt: num(r["createdAt"]) };
  if (r["answer"] !== null && r["answer"] !== undefined) o.answer = parseJson<unknown>(r["answer"], null);
  const by = optStr(r["answeredBy"]); if (by !== undefined) o.answeredBy = by;
  const at = optNum(r["answeredAt"]); if (at !== undefined) o.answeredAt = at;
  return o;
}
export function insertBlock(ctx: Pick<ChatCtx, "db" | "now">, b: { id: string; thread: string; message: string; type: string; data: Record<string, unknown> }): void {
  ctx.db.run("INSERT INTO chat_block (id, thread, message, type, state, data, createdAt) VALUES (?, ?, ?, ?, 'waiting', ?, ?)", b.id, b.thread, b.message, b.type, JSON.stringify(b.data), ctx.now());
}

export interface PlanStep { stepId: string; text: string; state: "todo" | "doing" | "done" | "skipped"; detail?: string }
export interface PlanRec { id: string; thread: string; block: string; title: string; state: "proposed" | "approved" | "rejected" | "done"; steps: PlanStep[]; docFileId?: string; createdAt: number }
export function planBy(db: Db, id: string): PlanRec | null {
  const r = (db.all("SELECT * FROM chat_plan WHERE id = ?", id) as Row[])[0];
  if (!r) return null;
  const o: PlanRec = { id: str(r["id"]), thread: str(r["thread"]), block: str(r["block"]), title: str(r["title"]), state: str(r["state"]) as PlanRec["state"], steps: parseJson(r["steps"], []), createdAt: num(r["createdAt"]) };
  const doc = optStr(r["docFileId"]); if (doc !== undefined) o.docFileId = doc;
  return o;
}
export function insertPlan(ctx: Pick<ChatCtx, "db" | "now">, p: { id: string; thread: string; block: string; title: string; steps: PlanStep[]; docFileId?: string | undefined }): void {
  ctx.db.run("INSERT INTO chat_plan (id, thread, block, title, state, steps, docFileId, createdAt) VALUES (?, ?, ?, ?, 'proposed', ?, ?, ?)", p.id, p.thread, p.block, p.title, JSON.stringify(p.steps), p.docFileId ?? null, ctx.now());
}

/** Change one block inside its message's blocks JSON (the answer, the plan state) so a replica reading only messages sees it. */
export function patchBlockInMessage(db: Db, messageId: string, blockId: string, patch: (block: Record<string, unknown>) => Record<string, unknown>): void {
  const m = messageBy(db, messageId);
  if (!m) return;
  const blocks = m.blocks.map((b) => (b["id"] === blockId ? patch(b) : b));
  db.run("UPDATE chat_message SET blocks = ? WHERE id = ?", JSON.stringify(blocks), messageId);
}
