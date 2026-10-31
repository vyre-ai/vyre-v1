// Chat reach (chat UX): the two things that cross thread lines.
//   chat.fork    a new private chat that holds a copy of one chat up to a message, with the same agents and a line that links back
//   chat.search  the words and the meaning of messages across every chat and channel the asker is in, each hit naming its message
// Both read only what the asker may read. A sealed chat (end to end) is not the server's to read: fork refuses it, search leaves it out and says how many.
import {
  agentsOf, askerOf, channelBy, ensure, addAgent, addMember, insertMessage, insertThread, messageBy, messageOf, mintId, raise, refOf, threadBy, threadOut, membersOf,
} from "../projections.ts";
import type { ChatCtx, MessageRec, ThreadRec } from "../projections.ts";
import { canSpeak } from "./post.ts";
import { sealedThread } from "./g26.ts";
import { readFileSync } from "node:fs";
import { ensurePrivate } from "./private.ts";

type Row = Record<string, unknown>;

const FORK_SCHEMA = readFileSync(new URL("../migrations/0003_fork.sql", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").split(";").map((x) => x.trim()).filter((x) => x.length > 0);
const forkReady = new WeakSet<object>();
export function ensureFork(db: ChatCtx["db"]): void {
  if (forkReady.has(db)) return;
  try { db.all("SELECT thread FROM chat_fork WHERE thread = ?", "probe"); } catch { for (const stmt of FORK_SCHEMA) db.run(stmt); }
  forkReady.add(db);
}

/** True when this chat is a copy of one that had other people in it: it stays private to whoever forked it. */
export function privateFork(db: ChatCtx["db"], threadId: string): boolean {
  ensureFork(db);
  return (db.all("SELECT 1 AS x FROM chat_fork WHERE thread = ? AND withOthers = 1", threadId) as Row[]).length > 0;
}

/** How many messages one fork copies. A longer chat is forked from an earlier message. */
export const MAX_FORK = 5000;

function openThread(ctx: ChatCtx, threadId: string): ThreadRec {
  ensure(ctx.db);
  const t = threadBy(ctx.db, threadId);
  if (!t || !canSpeak(ctx, t)) raise(ctx, "validation.not_found", "That chat does not exist or is not yours to open.");
  return t;
}

// ---- fork -------------------------------------------------------------------------------------------------------------------------------------------

const titleOf = (ctx: ChatCtx, t: ThreadRec): string => t.title ?? (t.channelId ? channelBy(ctx.db, t.channelId)?.name : undefined) ?? "Chat";

export async function fork(ctx: ChatCtx, input: { threadId: string; messageId?: string; title?: string }) {
  const src = openThread(ctx, input.threadId);
  ensurePrivate(ctx.db);
  if (sealedThread(ctx, src.id)) {
    raise(ctx, "validation.precondition_failed", "This chat is end-to-end encrypted, so the server cannot copy it. Fork it from a device that holds the key.", { reason: "sealed_thread" });
  }
  const asker = askerOf(ctx);
  ensureFork(ctx.db);
  let upTo: MessageRec | null;
  if (input.messageId !== undefined) {
    upTo = messageBy(ctx.db, input.messageId);
    if (!upTo || upTo.thread !== src.id) raise(ctx, "validation.not_found", "That message is not in this chat.");
  } else {
    const r = (ctx.db.all("SELECT * FROM chat_message WHERE thread = ? AND deleted_at IS NULL ORDER BY threadSeq DESC LIMIT 1", src.id) as Row[])[0];
    upTo = r ? messageOf(r) : null;
  }
  if (!upTo) raise(ctx, "validation.precondition_failed", "There is nothing in this chat to fork yet.");
  const rows = (ctx.db.all("SELECT * FROM chat_message WHERE thread = ? AND threadSeq <= ? AND deleted_at IS NULL ORDER BY threadSeq DESC LIMIT ?", src.id, upTo.seq, MAX_FORK) as Row[]).map(messageOf).reverse();

  const srcTitle = titleOf(ctx, src);
  const t = insertThread(ctx, {
    kind: "chat", title: (input.title?.trim() || `Fork of ${srcTitle}`).slice(0, 120), starter: asker, listed: true, planMode: src.planMode, mode: src.mode,
    ...(src.folderId !== undefined ? { folderId: src.folderId } : {}), ...(src.recordId !== undefined ? { recordId: src.recordId } : {}),
  });
  addMember(ctx, t.id, asker, "owner");
  const others = src.kind === "channel" || src.channelId !== undefined || membersOf(ctx.db, src.id).some((p) => p.startsWith("usr_") && p !== asker);
  ctx.db.run("INSERT OR REPLACE INTO chat_fork (thread, source, withOthers, at) VALUES (?, ?, ?, ?)", t.id, src.id, others ? 1 : 0, ctx.now());
  for (const a of agentsOf(ctx.db, src.id)) addAgent(ctx, t.id, { agentId: a.agentId, mode: a.mode, model: a.model, provider: a.provider, effort: a.effort, accountRef: a.accountRef, addedBy: asker });

  // The first line says where the chat came from and links back; the copies follow, in order, under new ids with the same authors, words, blocks and files.
  insertMessage(ctx, t.id, {
    author: asker, kind: "system", body: `Forked from "${srcTitle}"`,
    blocks: [{ type: "fork_origin", v: 1, id: mintId("blk", ctx.now()), data: { threadId: src.id, messageId: upTo.id, title: srcTitle, at: upTo.createdAt }, state: "done", traceId: ctx.trace.traceId }],
  });
  const ids = new Map<string, string>();
  for (const m of rows) ids.set(m.id, mintId("msg", ctx.now()));
  for (const m of rows) {
    insertMessage(ctx, t.id, {
      id: ids.get(m.id)!, author: m.author, kind: m.kind, body: m.body,
      // a question or plan that was waiting stays a record of what was asked: the answerable one lives in the chat it came from
      blocks: m.blocks.map((b) => (b["state"] === "waiting" ? { ...b, state: "done" } : b)),
      ...(m.replyTo !== undefined && ids.has(m.replyTo) ? { replyTo: ids.get(m.replyTo) } : {}), ...(m.via ? { via: m.via } : {}), depth: m.depth, attachments: m.attachments,
    });
  }
  ctx.emit("thread.started", t.id, { threadId: t.id, kind: t.kind, starter: asker });
  for (const a of agentsOf(ctx.db, t.id)) ctx.emit("agent.engaged", t.id, { threadId: t.id, agentId: a.agentId, mode: a.mode, by: asker });
  return { thread: threadOut(ctx.db, threadBy(ctx.db, t.id)!), copied: rows.length };
}

// ---- search -----------------------------------------------------------------------------------------------------------------------------------------

/**
 * Meaning, as the host gives it: the messages of these chats nearest in meaning to the question, best first, scores 0 to 1. The module has no embedding model of its own; until a host binds one,
 * a search runs on the words alone and says so (`meaning: false`).
 */
export type MeaningIndex = (q: { query: string; threadIds: readonly string[]; limit: number }) => Promise<ReadonlyArray<{ messageId: string; score: number }>>;
let meaning: MeaningIndex | null = null;
export function setMeaningIndex(i: MeaningIndex | null): void { meaning = i; }

const WORD = /[^\p{L}\p{N}]+/u;
const wordsOf = (s: string): string[] => [...new Set(s.toLowerCase().split(WORD).filter((w) => w.length >= 2))].slice(0, 12);
const esc = (w: string): string => w.replace(/[\\%_]/g, (c) => `\\${c}`);
const SCAN = 4000;
/** Messages scored for meaning in one search (the ranker takes at most 200), and the least score that counts as the same meaning. */
const MEANING_POOL = 200;
const MEANING_RECENT = 200;
const MEANING_MIN = 0.35;
const SNIPPET = 180;

/** About 180 characters around the first word found, cut at word edges. */
export function snippetOf(body: string, words: readonly string[]): string {
  const text = body.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  let at = -1;
  for (const w of words) { const i = lower.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; }
  const start = at <= 40 ? 0 : text.indexOf(" ", at - 40) + 1 || at - 40;
  const cut = text.slice(start, start + SNIPPET);
  return `${start > 0 ? "…" : ""}${cut}${start + SNIPPET < text.length ? "…" : ""}`;
}

export async function search(ctx: ChatCtx, input: { q: string; mode?: "keyword" | "meaning" | "hybrid"; threadId?: string; limit?: number }) {
  ensure(ctx.db);
  ensurePrivate(ctx.db);
  const t0 = ctx.now();
  const query = input.q.trim().slice(0, 500);
  const words = wordsOf(query);
  if (words.length === 0) raise(ctx, "validation.bad_input", "Search for at least one word.");
  const mode = input.mode ?? "hybrid";
  const limit = Math.min(50, Math.max(1, input.limit ?? 20));
  const asker = askerOf(ctx);

  // The chats this person is in, and the ones the server may not read.
  let threadIds: string[];
  if (input.threadId !== undefined) threadIds = [openThread(ctx, input.threadId).id];
  else threadIds = (ctx.db.all("SELECT m.thread AS thread FROM chat_thread_member m JOIN chat_thread t ON t.id = m.thread WHERE m.principal = ? AND m.deleted_at IS NULL AND t.deleted_at IS NULL", asker) as Row[]).map((r) => String(r["thread"]));
  const sealed = new Set(threadIds.filter((id) => (ctx.db.all("SELECT 1 AS x FROM chat_private WHERE thread = ?", id) as Row[]).length > 0));
  const readable = threadIds.filter((id) => !sealed.has(id));
  const scope = new Set(readable);

  const found = new Map<string, { m: MessageRec; keyword: number; meaning: number }>();
  const take = (m: MessageRec): { m: MessageRec; keyword: number; meaning: number } => { let f = found.get(m.id); if (!f) { f = { m, keyword: 0, meaning: 0 }; found.set(m.id, f); } return f; };

  if (mode !== "meaning" && readable.length > 0) {
    // every word must appear (a phrase of words in any order); when that finds little, any word counts and the share of words found is the score
    const run = (joiner: "AND" | "OR"): Row[] => {
      const marks = words.map(() => `LOWER(m.body) LIKE ? ESCAPE '\\'`).join(` ${joiner} `);
      const chunk = readable.slice(0, 500);
      return ctx.db.all(
        `SELECT m.* FROM chat_message m WHERE m.deleted_at IS NULL AND m.kind IN ('text', 'agent') AND m.thread IN (${chunk.map(() => "?").join(",")}) AND (${marks}) ORDER BY m.createdAt DESC LIMIT ?`,
        ...chunk, ...words.map((w) => `%${esc(w)}%`), SCAN,
      ) as Row[];
    };
    let rows = run("AND");
    if (rows.length < limit && words.length > 1) rows = [...rows, ...run("OR").filter((r) => !rows.some((x) => x["id"] === r["id"]))];
    for (const r of rows) {
      const m = messageOf(r);
      const lower = m.body.toLowerCase();
      const hit = words.filter((w) => lower.includes(w)).length;
      const exact = lower.includes(query.toLowerCase()) ? 0.25 : 0;
      take(m).keyword = Math.min(1, hit / words.length * 0.75 + exact);
    }
  }
  let usedMeaning = false;
  if (mode !== "keyword" && meaning === null && readable.length > 0 && ctx.call) {
    // meaning from the memory module's ranker: nothing is stored there, the words of messages this person may read are scored against the question and dropped
    try {
      const chunk = readable.slice(0, 500);
      const recent = (ctx.db.all(
        `SELECT * FROM chat_message WHERE deleted_at IS NULL AND kind IN ('text', 'agent') AND body <> '' AND thread IN (${chunk.map(() => "?").join(",")}) ORDER BY createdAt DESC LIMIT ?`, ...chunk, MEANING_RECENT,
      ) as Row[]).map(messageOf);
      const pool = new Map<string, MessageRec>();
      for (const f of found.values()) if (pool.size < MEANING_POOL / 2) pool.set(f.m.id, f.m);
      for (const m of recent) if (pool.size < MEANING_POOL && m.body.trim() !== "") pool.set(m.id, m);
      const list = [...pool.values()];
      if (list.length > 0) {
        const out = (await ctx.call("memory.meaning.rank", { query, candidates: list.map((m) => ({ id: m.id, text: m.body.slice(0, 1000) })) })) as { scores?: Array<{ id: string; score: number }> } | null;
        const scores = out?.scores ?? [];
        if (scores.length > 0) {
          usedMeaning = true;
          for (const sc of scores) {
            const m = pool.get(sc.id);
            if (!m || !scope.has(m.thread) || !(sc.score >= MEANING_MIN)) continue;   // the ranker never widens what this person may read
            take(m).meaning = Math.min(1, sc.score);
          }
        }
      }
    } catch (e) {
      ctx.log.warn("chat.search: the meaning ranker is not available, answering on the words alone", { error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (mode !== "keyword" && meaning !== null && readable.length > 0) {
    try {
      const near = await meaning({ query, threadIds: readable, limit: limit * 3 });
      usedMeaning = true;
      for (const n of near) {
        const row = (ctx.db.all("SELECT * FROM chat_message WHERE id = ? AND deleted_at IS NULL", n.messageId) as Row[])[0];
        if (!row) continue;
        const m = messageOf(row);
        if (!scope.has(m.thread)) continue;   // the index never widens what this person may read
        take(m).meaning = Math.max(0, Math.min(1, n.score));
      }
    } catch (e) {
      ctx.log.warn("chat.search: the meaning index failed, answering on the words alone", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  const scored = [...found.values()].map((f) => ({ ...f, score: usedMeaning ? Math.max(f.keyword, f.meaning) * 0.8 + Math.min(f.keyword, f.meaning) * 0.2 + (f.keyword > 0 && f.meaning > 0 ? 0.1 : 0) : f.keyword }));
  scored.sort((a, b) => b.score - a.score || b.m.createdAt - a.m.createdAt);
  const cache = new Map<string, Record<string, unknown>>();
  const threadInfo = (id: string): Record<string, unknown> => {
    let v = cache.get(id);
    if (!v) {
      const t = threadBy(ctx.db, id)!;
      v = {
        kind: t.kind, ...(t.title !== undefined ? { title: t.title } : {}), ...(t.channelId ? (() => { const n = channelBy(ctx.db, t.channelId!)?.name; return n ? { channelName: n } : {}; })() : {}),
        agentIds: agentsOf(ctx.db, id).map((a) => a.agentId), memberIds: membersOf(ctx.db, id).filter((p) => !p.startsWith("agt_")),
      };
      cache.set(id, v);
    }
    return v;
  };
  const hits = scored.slice(0, limit).map((f) => ({
    messageId: f.m.id, threadId: f.m.thread, threadSeq: f.m.seq, author: refOf(f.m.author), snippet: snippetOf(f.m.body, words), at: f.m.createdAt,
    score: Math.round(Math.min(1, f.score) * 1000) / 1000, found: f.keyword > 0 && f.meaning > 0 ? "both" : f.meaning > 0 ? "meaning" : "keyword", thread: threadInfo(f.m.thread),
  }));
  return { hits, meaning: usedMeaning, sealedChats: sealed.size, tookMs: Math.max(0, ctx.now() - t0) };
}

export const g27Handlers = {
  "chat.fork": fork,
  "chat.search": search,
};
