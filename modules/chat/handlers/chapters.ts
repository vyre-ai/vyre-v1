// Chapters of a long chat (lane chat-chapters, 14 Nov 2026). A chat of 40 messages or fewer has none and a read costs one indexed count. Past that the boundaries are worked out on every read from
// the messages themselves, never stored: a "Fresh context" line, a gap of 3 hours, or 80 messages in one go (cut where a person speaks). Each chapter has a title and a one-line summary: the plain
// words of the chat until a cheap model on the account that ran the turn has written them (chat.chapters_write), which the app asks for after the chat opens and which never holds a post.
import { cheapestModel } from "../../../lib/cheap-model.ts";
import type { ListedModel } from "../../../lib/cheap-model.ts";
import { titleFromRequest } from "../../../lib/chat-name.ts";
import { askerOf, raise } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { readFloor } from "./floor.ts";
import { load } from "./g24a.ts";

type Row = Record<string, unknown>;

export const CHAPTERS = Object.freeze({
  /** A chat with this many messages or fewer has no chapters. */
  min: 40,
  /** A gap this long (ms) between two messages starts a chapter. */
  gap: 3 * 3_600_000,
  /** A chapter has at least this many messages before a gap or a size cut can end it. */
  least: 8,
  /** A chapter this long is cut at the next person's message. */
  most: 80,
  /** Only the newest this many messages are read. */
  scan: 6_000,
  /** A failed ask is tried once more no sooner than this, then never. */
  retryMs: 3_600_000,
  summaryChars: 90,
});

export interface Msg {
  author: string;
  id: string;
  seq: number;
  at: number;
  kind: string;
  person: boolean;
  body: string;
}
export interface Chapter {
  startSeq: number;
  startMsg: string;
  endSeq: number;
  startAt: number;
  count: number;
  current: boolean;
  title: string;
  summary: string;
  by: "extract" | "model" | "person";
}

const FRESH = /^fresh context\b/i;
const one = (s: string): string => s.replace(/\s+/g, " ").trim();
const heading = (raw: string): string | null => {
  const w = raw
    .replace(/^(?:title\s*:\s*)/i, "")
    .replace(/^["'`*#\s]+|["'`*.!?:;,\s]+$/g, "")
    .split(/\s+/)
    .filter((x) => x !== "")
    .slice(0, 4);
  return w.length === 0 ? null : `${w[0]![0]!.toUpperCase()}${w.join(" ").slice(1)}`;
};
const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Where the chapters start: pure, in message order. Returns the index of each chapter's first message. */
export function boundaries(msgs: readonly Msg[], min: number = CHAPTERS.min): number[] {
  if (msgs.length <= min) return [];
  const out = [0];
  let from = 0;
  for (let i = 1; i < msgs.length; i++) {
    const m = msgs[i]!;
    const held = i - from;
    const fresh = m.kind === "system" && FRESH.test(m.body);
    const gap = m.at - msgs[i - 1]!.at >= CHAPTERS.gap && held >= CHAPTERS.least;
    const big = held >= CHAPTERS.most && m.person;
    if (fresh || gap || big) {
      out.push(i);
      from = i;
    }
  }
  return out.length > 1 || min === 0 ? out : [];
}

/** The plain-words title and summary of one chapter: the first request is the title, the last answer is the summary. */
export function extractOf(msgs: readonly Msg[]): { title: string; summary: string } {
  const ask = msgs.find((m) => m.person && m.kind !== "system" && one(m.body) !== "");
  const title = (ask ? heading(titleFromRequest(ask.body) ?? ask.body) : null) ?? "";
  const last = [...msgs].reverse().find((m) => !m.person && m.kind !== "system" && one(m.body) !== "");
  const first = last ? (one(last.body).split(/(?<=[.!?])\s/)[0] ?? "") : "";
  return { title: title || "Earlier", summary: cut(first, CHAPTERS.summaryChars) };
}

const EDGE =
  'CREATE TABLE IF NOT EXISTS "chat_chapter_edge" ("thread" TEXT NOT NULL, "startSeq" INTEGER NOT NULL, "startMsg" TEXT NOT NULL, "startAt" INTEGER NOT NULL, "endSeq" INTEGER NOT NULL, "count" INTEGER NOT NULL, "plainTitle" TEXT NOT NULL, "plainSummary" TEXT NOT NULL, "sig" TEXT NOT NULL, "tries" INTEGER NOT NULL DEFAULT 0, "triedAt" INTEGER NOT NULL DEFAULT 0, PRIMARY KEY ("thread", "startSeq"))';
const TABLE =
  'CREATE TABLE IF NOT EXISTS "chat_chapter" ("thread" TEXT NOT NULL, "startSeq" INTEGER NOT NULL, "title" TEXT NOT NULL, "summary" TEXT NOT NULL, "writer" TEXT NOT NULL, "at" INTEGER NOT NULL, PRIMARY KEY ("thread", "startSeq"))';
const ready = new WeakSet<object>();
function ensureTable(ctx: ChatCtx): void {
  if (ready.has(ctx.db)) return;
  ctx.db.run(TABLE);
  ctx.db.run(EDGE);
  ready.add(ctx.db);
}

interface Edge {
  startSeq: number;
  startMsg: string;
  startAt: number;
  endSeq: number;
  count: number;
  plainTitle: string;
  plainSummary: string;
  sig: string;
  tries: number;
  triedAt: number;
}

const toMsg = (r: Row): Msg => ({
  id: String(r["id"]),
  author: String(r["author"] ?? ""),
  seq: Number(r["threadSeq"]),
  at: Number(r["createdAt"]),
  kind: String(r["kind"] ?? "text"),
  person: String(r["author"] ?? "").startsWith("usr_"),
  body: String(r["body"] ?? "").startsWith("enc") ? "" : String(r["body"] ?? ""),
});
const COLS = 'id, threadSeq, "createdAt", kind, author, substr(body, 1, 400) AS body';

/** Messages of a seq range that the reader may see (from their floor), oldest first. */
function rangeOf(ctx: ChatCtx, thread: string, from: number, to: number, floor: number, limit = 400): Msg[] {
  return (
    ctx.db.all(
      `SELECT ${COLS} FROM chat_message WHERE "thread" = ? AND deleted_at IS NULL AND "createdAt" >= ? AND threadSeq >= ? AND threadSeq <= ? ORDER BY threadSeq LIMIT ?`,
      thread,
      floor,
      from,
      to,
      limit,
    ) as Row[]
  ).map(toMsg);
}

const sigOf = (ctx: ChatCtx, thread: string, from: number, to: number): string => {
  const r =
    (
      ctx.db.all(
        'SELECT COUNT(*) AS n, COALESCE(MAX("editedAt"), 0) AS e FROM chat_message WHERE "thread" = ? AND deleted_at IS NULL AND threadSeq >= ? AND threadSeq <= ?',
        thread,
        from,
        to,
      ) as Row[]
    )[0] ?? {};
  return `${Number(r["n"] ?? 0)}:${Number(r["e"] ?? 0)}`;
};

const edgesOf = (ctx: ChatCtx, thread: string): Edge[] =>
  (ctx.db.all('SELECT * FROM chat_chapter_edge WHERE "thread" = ? ORDER BY startSeq', thread) as Row[]).map((r) => ({
    startSeq: Number(r["startSeq"]),
    startMsg: String(r["startMsg"]),
    startAt: Number(r["startAt"]),
    endSeq: Number(r["endSeq"]),
    count: Number(r["count"]),
    plainTitle: String(r["plainTitle"]),
    plainSummary: String(r["plainSummary"]),
    sig: String(r["sig"]),
    tries: Number(r["tries"]),
    triedAt: Number(r["triedAt"]),
  }));

function keptOf(ctx: ChatCtx, threadId: string): Map<number, { title: string; summary: string; writer: string }> {
  const m = new Map<number, { title: string; summary: string; writer: string }>();
  for (const r of ctx.db.all(
    'SELECT "startSeq", "title", "summary", "writer" FROM chat_chapter WHERE "thread" = ?',
    threadId,
  ) as Row[])
    m.set(Number(r["startSeq"]), {
      title: String(r["title"]),
      summary: String(r["summary"]),
      writer: String(r["writer"]),
    });
  return m;
}

/**
 * Closes what has closed: every chapter before the open one is stored once, with its first message, and never worked out again. Only the messages after the last stored chapter are read.
 * Boundaries ignore the reader (the thread's own order), so they are the same for everyone, and nothing here is shown without the visibility check in chaptersRead.
 */
function closeChapters(ctx: ChatCtx, thread: string, edges: Edge[]): { edges: Edge[]; open: Msg[] } {
  const after = edges.length > 0 ? edges[edges.length - 1]!.endSeq : 0;
  const rows = ctx.db.all(
    `SELECT ${COLS} FROM chat_message WHERE "thread" = ? AND deleted_at IS NULL AND threadSeq > ? ORDER BY threadSeq DESC LIMIT ?`,
    thread,
    after,
    CHAPTERS.scan,
  ) as Row[];
  rows.reverse();
  const msgs = rows.map(toMsg);
  const at = boundaries(msgs, edges.length > 0 ? 0 : CHAPTERS.min);
  if (at.length < 2) return { edges, open: msgs };
  const out = [...edges];
  for (let k = 0; k + 1 < at.length; k++) {
    const part = msgs.slice(at[k]!, at[k + 1]!);
    const first = part[0]!;
    const ex = extractOf(part);
    const e: Edge = {
      startSeq: first.seq,
      startMsg: first.id,
      startAt: first.at,
      endSeq: part[part.length - 1]!.seq,
      count: part.length,
      plainTitle: ex.title,
      plainSummary: ex.summary,
      sig: `${part.length}:0`,
      tries: 0,
      triedAt: 0,
    };
    // a seq range holds gaps when messages were deleted: the signature is read from the table, not guessed
    e.sig = sigOf(ctx, thread, e.startSeq, e.endSeq);
    ctx.db.run(
      'INSERT INTO chat_chapter_edge ("thread","startSeq","startMsg","startAt","endSeq","count","plainTitle","plainSummary","sig","tries","triedAt") VALUES (?,?,?,?,?,?,?,?,?,0,0) ON CONFLICT("thread","startSeq") DO NOTHING',
      thread,
      e.startSeq,
      e.startMsg,
      e.startAt,
      e.endSeq,
      e.count,
      e.plainTitle,
      e.plainSummary,
      e.sig,
    );
    out.push(e);
  }
  return { edges: out, open: msgs.slice(at[at.length - 1]!) };
}

/** A closed chapter whose messages changed (one deleted or edited) loses the model's heading: its words may still sit in it. One new ask is allowed. */
function revalidate(ctx: ChatCtx, thread: string, e: Edge): Edge {
  const sig = sigOf(ctx, thread, e.startSeq, e.endSeq);
  if (sig === e.sig) return e;
  const part = rangeOf(ctx, thread, e.startSeq, e.endSeq, 0);
  const ex = extractOf(part);
  ctx.db.run('DELETE FROM chat_chapter WHERE "thread" = ? AND "startSeq" = ?', thread, e.startSeq);
  ctx.db.run(
    'UPDATE chat_chapter_edge SET "sig" = ?, "plainTitle" = ?, "plainSummary" = ?, "count" = ?, "tries" = 0, "triedAt" = 0 WHERE "thread" = ? AND "startSeq" = ?',
    sig,
    ex.title,
    ex.summary,
    part.length,
    thread,
    e.startSeq,
  );
  return { ...e, sig, plainTitle: ex.title, plainSummary: ex.summary, count: part.length, tries: 0, triedAt: 0 };
}

const countOf = (ctx: ChatCtx, thread: string, floor: number): number =>
  Number(
    ((
      ctx.db.all(
        'SELECT COUNT(*) AS n FROM chat_message WHERE "thread" = ? AND deleted_at IS NULL AND "createdAt" >= ?',
        thread,
        floor,
      ) as Row[]
    )[0] ?? {})["n"] ?? 0,
  );

export async function chaptersRead(ctx: ChatCtx, input: { threadId: string }) {
  const t = load(ctx, input.threadId);
  const floor = Math.floor(readFloor(ctx, t));
  ensureTable(ctx);
  const stored = edgesOf(ctx, t.id);
  if (stored.length === 0 && countOf(ctx, t.id, floor) <= CHAPTERS.min) return { chapters: [] as Chapter[], wanted: 0 };
  const { edges, open } = closeChapters(ctx, t.id, stored);
  if (edges.length === 0) return { chapters: [] as Chapter[], wanted: 0 };
  const live = edges.map((e) => revalidate(ctx, t.id, e));
  const kept = keptOf(ctx, t.id);
  const out: Chapter[] = [];
  let wanted = 0;
  for (const e of live) {
    // the heading is shown as written only to a reader who can see every message of the chapter: the first one is the earliest
    const all = floor <= e.startAt;
    const view = all ? null : rangeOf(ctx, t.id, e.startSeq, e.endSeq, floor);
    if (view !== null && view.length === 0) continue;
    const saved = all ? kept.get(e.startSeq) : undefined;
    const ex = view ? extractOf(view) : { title: e.plainTitle, summary: e.plainSummary };
    if (all && !saved && e.tries < 2) wanted++;
    out.push({
      startSeq: view ? view[0]!.seq : e.startSeq,
      startMsg: view ? view[0]!.id : e.startMsg,
      endSeq: e.endSeq,
      startAt: view ? view[0]!.at : e.startAt,
      count: view ? view.length : e.count,
      current: false,
      title: saved?.title ?? ex.title,
      summary: saved?.summary ?? ex.summary,
      by: saved ? (saved.writer === "person" ? "person" : saved.writer === "model" ? "model" : "extract") : "extract",
    });
  }
  const seen = open.filter((m) => m.at >= floor);
  if (seen.length > 0) {
    const ex = extractOf(seen);
    out.push({
      startSeq: seen[0]!.seq,
      startMsg: seen[0]!.id,
      endSeq: seen[seen.length - 1]!.seq,
      startAt: seen[0]!.at,
      count: seen.length,
      current: true,
      title: ex.title,
      summary: ex.summary,
      by: "extract",
    });
  }
  return { chapters: out, wanted };
}

interface Account {
  ref: string;
  driver: string;
  kind?: string | undefined;
}

const SYSTEM =
  "You write a heading for one part of a long chat. Reply with exactly two lines. Line 1: a title of 1 to 3 plain words. Line 2: one short sentence, at most 12 words, that says what was settled or done. No quotes, no ending punctuation on line 1, nothing else.";

/** ok, nomodel (nothing cheap to ask: final) or fail (the call failed: one more try an hour later). */
async function askModel(
  ctx: ChatCtx,
  account: Account,
  part: readonly Msg[],
): Promise<{ r: "ok"; title: string; summary: string } | { r: "nomodel" | "fail" }> {
  if (!ctx.call) return { r: "nomodel" };
  try {
    let listed: ListedModel[] = [];
    try {
      listed =
        (
          (await ctx.call("engine.models.list", { accountRef: account.ref, probe: false })) as {
            models?: ListedModel[];
          }
        ).models ?? [];
    } catch {
      listed = [];
    }
    const model = cheapestModel(account.driver, listed);
    if (!model) return { r: "nomodel" };
    const lines = part
      .filter((m) => m.kind !== "system" && one(m.body) !== "")
      .map((m) => `${m.person ? "Person" : "Agent"}: ${cut(one(m.body), 220)}`);
    const sample = [...lines.slice(0, 6), ...(lines.length > 12 ? ["..."] : []), ...lines.slice(-6)].join("\n");
    const out = (await ctx.call("engine.complete", {
      accountRef: account.ref,
      model,
      system: SYSTEM,
      prompt: sample.slice(0, 3_000),
    })) as { text?: string };
    const [a, b] = String(out.text ?? "")
      .slice(0, 200)
      .split("\n")
      .map((x) => x.trim())
      .filter((x) => x !== "");
    const title = heading(a ?? "");
    const summary = cut(one(b ?? "").replace(/^["']|["']$/g, ""), CHAPTERS.summaryChars);
    return title && summary ? { r: "ok", title, summary } : { r: "fail" };
  } catch (e) {
    ctx.log.warn("a chapter was not written by a model", { reason: e instanceof Error ? e.name : "error" });
    return { r: "fail" };
  }
}

/**
 * Heads closed chapters, each at most once and once more after an hour if the call failed, then never (rows in chat_chapter_edge say so). Only a closed chapter, only on the asker's own api_key
 * account (a subscription, a Space account or someone else's is never called), only for a chapter the asker opened and can see whole. Nothing is asked about the account per turn: a chapter that
 * is not due costs no call, not even models.list. About 750 tokens in (12 lines of 220 characters, 3,000 at most), about 40 out.
 */
export async function chaptersWrite(ctx: ChatCtx, input: { threadId: string; account?: Account | undefined }) {
  const me = askerOf(ctx);
  if (!me.startsWith("usr_")) raise(ctx, "permission.no_grant", "Chapters are written for the person who asked.");
  if (!input.account?.ref || !input.account.driver || input.account.kind !== "api_key") return { written: 0 };
  const t = load(ctx, input.threadId);
  const floor = Math.floor(readFloor(ctx, t));
  ensureTable(ctx);
  const stored = edgesOf(ctx, t.id);
  if (stored.length === 0 && countOf(ctx, t.id, floor) <= CHAPTERS.min) return { written: 0 };
  const { edges } = closeChapters(ctx, t.id, stored);
  const live = edges.map((e) => revalidate(ctx, t.id, e));
  const kept = keptOf(ctx, t.id);
  const now = ctx.now();
  let written = 0;
  for (const e of live) {
    if (written >= 3) break;
    const due = e.tries === 0 || (e.tries === 1 && now - e.triedAt >= CHAPTERS.retryMs);
    if (!due || kept.has(e.startSeq) || floor > e.startAt) continue;
    const part = rangeOf(ctx, t.id, e.startSeq, e.endSeq, floor);
    if (part.find((m) => m.person && m.kind !== "system")?.author !== me) continue;
    // count the try first: a crash or a slow call never makes a second one at once
    ctx.db.run(
      'UPDATE chat_chapter_edge SET "tries" = "tries" + 1, "triedAt" = ? WHERE "thread" = ? AND "startSeq" = ?',
      now,
      t.id,
      e.startSeq,
    );
    const made = await askModel(ctx, input.account, part);
    if (made.r === "nomodel") {
      ctx.db.run('UPDATE chat_chapter_edge SET "tries" = 2 WHERE "thread" = ? AND "startSeq" = ?', t.id, e.startSeq);
      continue;
    }
    if (made.r !== "ok") continue;
    ctx.db.run(
      'INSERT INTO chat_chapter ("thread", "startSeq", "title", "summary", "writer", "at") VALUES (?, ?, ?, ?, \'model\', ?) ON CONFLICT("thread", "startSeq") DO NOTHING',
      t.id,
      e.startSeq,
      made.title,
      made.summary,
      now,
    );
    written++;
  }
  return { written };
}
