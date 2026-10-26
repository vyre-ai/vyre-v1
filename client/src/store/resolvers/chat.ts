// Chat reads from the replica: threads.get, threads.list, chat.messages.list. Thread, member, agent and message rows are synced entities (chat_*), so a conversation opens with no network.
// What the device does not keep is not invented: unread counts and the working pulse are server state, so chat.recent is left to the gateway.
import type { LocalDb, SqlRow } from "../space.ts";
import { MISS, resolver } from "./types.ts";
import { flag, json, num, optNum, optStr, page, principalRef, put, rows, str } from "./util.ts";

const CHAT_ENTITIES = ["thread", "thread_agent", "thread_member", "message"] as const;

function agentsOf(db: LocalDb, thread: string): Array<Record<string, unknown>> {
  return rows(db, `SELECT * FROM "chat_thread_agent" WHERE "thread" = ? AND deleted_at IS NULL ORDER BY rowid`, [thread]).map((r) => {
    const o: Record<string, unknown> = { agentId: str(r["agentId"]), mode: str(r["mode"]) === "lead" ? "lead" : "listen" };
    put(o, "model", optStr(r["model"])); put(o, "provider", optStr(r["provider"])); put(o, "effort", optStr(r["effort"])); put(o, "accountRef", optStr(r["accountRef"]));
    if (flag(r["watches"])) o["watches"] = true;
    return o;
  });
}

function threadOut(db: LocalDb, r: SqlRow): Record<string, unknown> {
  const id = str(r["id"]);
  const o: Record<string, unknown> = {
    threadId: id, kind: str(r["kind"]), listed: flag(r["listed"]), planMode: flag(r["modePlan"]),
    members: rows(db, `SELECT "principal" FROM "chat_thread_member" WHERE "thread" = ? AND deleted_at IS NULL ORDER BY rowid`, [id]).map((m) => principalRef(str(m["principal"]))),
    agents: agentsOf(db, id), createdAt: num(r["createdAt"]),
  };
  put(o, "title", optStr(r["title"])); put(o, "starter", optStr(r["starter"])); put(o, "channelId", optStr(r["channelId"]));
  put(o, "parentThreadId", optStr(r["parentThreadId"])); put(o, "parentMessageId", optStr(r["parentMessageId"])); put(o, "recordId", optStr(r["recordId"])); put(o, "folderId", optStr(r["folderId"]));
  put(o, "scopeType", optStr(r["scopeType"])); put(o, "scopeId", optStr(r["scopeId"])); put(o, "closedAt", optNum(r["closedAt"]));
  const stat = rows(db, `SELECT COUNT(*) AS n, MAX("createdAt") AS last FROM "chat_message" WHERE "thread" = ? AND deleted_at IS NULL`, [id])[0];
  o["replyCount"] = num(stat?.["n"]);
  put(o, "lastMessageAt", optNum(stat?.["last"]));
  if (str(r["kind"]) === "helper") {
    const path: Array<{ title: string; threadId: string }> = [];
    let cur: SqlRow | undefined = r;
    for (let i = 0; cur && i < 8; i++) {
      path.unshift({ title: optStr(cur["title"]) ?? "Chat", threadId: str(cur["id"]) });
      const up = optStr(cur["parentThreadId"]);
      cur = up ? rows(db, `SELECT * FROM "chat_thread" WHERE "id" = ? AND deleted_at IS NULL`, [up])[0] : undefined;
    }
    o["path"] = path;
  }
  return o;
}

export const threadsGet = resolver<{ threadId: string }, { thread: Record<string, unknown> }>({
  cap: "threads.get", entities: CHAT_ENTITIES,
  run(db, input) {
    const r = rows(db, `SELECT * FROM "chat_thread" WHERE "id" = ? AND deleted_at IS NULL`, [input.threadId])[0];
    return r ? { thread: threadOut(db, r) } : MISS;
  },
});

interface ThreadsListIn { kind?: string[]; folderId?: string; recordId?: string; parentThreadId?: string; cursor?: string; limit?: number }

export const threadsList = resolver<ThreadsListIn, { threads: Array<Record<string, unknown>>; next?: string; total?: number }>({
  cap: "threads.list", entities: CHAT_ENTITIES,
  run(db, input) {
    const where = [`t.deleted_at IS NULL`, `t."listed" = 1`];
    const args: Array<string | number> = [];
    if (input.kind?.length) { where.push(`t."kind" IN (${input.kind.map(() => "?").join(",")})`); args.push(...input.kind); }
    if (input.folderId !== undefined) { where.push(`t."folderId" = ?`); args.push(input.folderId); }
    if (input.recordId !== undefined) { where.push(`t."recordId" = ?`); args.push(input.recordId); }
    if (input.parentThreadId !== undefined) { where.push(`t."parentThreadId" = ?`); args.push(input.parentThreadId); }
    const clause = where.join(" AND ");
    const total = num(rows(db, `SELECT COUNT(*) AS n FROM "chat_thread" t WHERE ${clause}`, args)[0]?.["n"]);
    const { offset, limit } = page(input.cursor, input.limit);
    // newest activity first: the last message, else the creation time
    const list = rows(
      db,
      `SELECT t.*, COALESCE((SELECT MAX(m."createdAt") FROM "chat_message" m WHERE m."thread" = t."id" AND m.deleted_at IS NULL), t."createdAt") AS "activity"
         FROM "chat_thread" t WHERE ${clause} ORDER BY "activity" DESC, t."id" LIMIT ? OFFSET ?`,
      [...args, limit, offset],
    );
    const out: { threads: Array<Record<string, unknown>>; next?: string; total?: number } = { threads: list.map((r) => threadOut(db, r)), total };
    if (offset + list.length < total) out.next = String(offset + list.length);
    return out;
  },
});

interface MessagesIn { threadId: string; before?: number; after?: number; limit?: number }

/** enc is 2 for a private chat or Ask pane and anything under one (the device holds the key), 0 elsewhere. */
function encOf(db: LocalDb, threadId: string): number {
  let id: string | undefined = threadId;
  for (let i = 0; id && i < 4; i++) {
    const t: SqlRow | undefined = rows(db, `SELECT "kind", "parentThreadId" FROM "chat_thread" WHERE "id" = ?`, [id])[0];
    if (!t) return 0;
    if (str(t["kind"]) === "chat" || str(t["kind"]) === "ask") return 2;
    id = optStr(t["parentThreadId"]);
  }
  return 0;
}

export const messagesList = resolver<MessagesIn, { messages: Array<Record<string, unknown>>; hasMore: boolean }>({
  cap: "chat.messages.list", entities: ["message", "thread"],
  run(db, input) {
    if (!rows(db, `SELECT 1 AS x FROM "chat_thread" WHERE "id" = ? AND deleted_at IS NULL`, [input.threadId]).length) return MISS;
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const forward = input.after !== undefined;
    const cond = forward ? `AND "threadSeq" > ?` : input.before !== undefined ? `AND "threadSeq" < ?` : "";
    const args: Array<string | number> = [input.threadId, ...(forward ? [input.after as number] : input.before !== undefined ? [input.before] : []), limit + 1];
    const got = rows(db, `SELECT * FROM "chat_message" WHERE "thread" = ? AND deleted_at IS NULL ${cond} ORDER BY "threadSeq" ${forward ? "ASC" : "DESC"} LIMIT ?`, args);
    const hasMore = got.length > limit;
    const window = got.slice(0, limit);
    if (!forward) window.reverse();   // the last 50 first, shown oldest first
    const enc = encOf(db, input.threadId);
    const messages = window.map((r) => {
      const o: Record<string, unknown> = {
        messageId: str(r["id"]), threadId: str(r["thread"]), threadSeq: num(r["threadSeq"]), author: principalRef(str(r["author"])), kind: str(r["kind"]), body: str(r["body"]),
        blocks: json(r["blocks"], []), depth: num(r["depth"]), attachments: json(r["attachments"], []), reactions: json(r["reactions"], []), pinned: flag(r["pinned"]), createdAt: num(r["createdAt"]), enc,
      };
      put(o, "replyTo", optStr(r["replyTo"]));
      const via = json<{ routineOwner?: string } | null>(r["via"], null);
      if (via?.routineOwner) o["via"] = { routineOwner: via.routineOwner };
      put(o, "editedAt", optNum(r["editedAt"]));
      return o;
    });
    return { messages, hasMore };
  },
});
