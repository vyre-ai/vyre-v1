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
  summaryChars: 90,
});

export interface Msg {
  author: string;
  seq: number;
  at: number;
  kind: string;
  person: boolean;
  body: string;
}
export interface Chapter {
  startSeq: number;
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
export function boundaries(msgs: readonly Msg[]): number[] {
  if (msgs.length <= CHAPTERS.min) return [];
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
  return out.length > 1 ? out : [];
}

/** The plain-words title and summary of one chapter: the first request is the title, the last answer is the summary. */
export function extractOf(msgs: readonly Msg[]): { title: string; summary: string } {
  const ask = msgs.find((m) => m.person && m.kind !== "system" && one(m.body) !== "");
  const title = (ask ? heading(titleFromRequest(ask.body) ?? ask.body) : null) ?? "";
  const last = [...msgs].reverse().find((m) => !m.person && m.kind !== "system" && one(m.body) !== "");
  const first = last ? (one(last.body).split(/(?<=[.!?])\s/)[0] ?? "") : "";
  return { title: title || "Earlier", summary: cut(first, CHAPTERS.summaryChars) };
}

export function chaptersOf(
  msgs: readonly Msg[],
  kept: ReadonlyMap<number, { title: string; summary: string; writer: string }>,
): Chapter[] {
  const at = boundaries(msgs);
  return at.map((from, k) => {
    const to = k + 1 < at.length ? at[k + 1]! : msgs.length;
    const part = msgs.slice(from, to);
    const startSeq = msgs[from]!.seq;
    const saved = kept.get(startSeq);
    const ex = saved ? null : extractOf(part);
    return {
      startSeq,
      endSeq: msgs[to - 1]!.seq,
      startAt: msgs[from]!.at,
      count: part.length,
      current: k === at.length - 1,
      title: saved?.title ?? ex!.title,
      summary: saved?.summary ?? ex!.summary,
      by: saved ? (saved.writer === "person" ? "person" : saved.writer === "model" ? "model" : "extract") : "extract",
    };
  });
}

const TABLE =
  'CREATE TABLE IF NOT EXISTS "chat_chapter" ("thread" TEXT NOT NULL, "startSeq" INTEGER NOT NULL, "title" TEXT NOT NULL, "summary" TEXT NOT NULL, "writer" TEXT NOT NULL, "at" INTEGER NOT NULL, PRIMARY KEY ("thread", "startSeq"))';
const ready = new WeakSet<object>();
function ensureTable(ctx: ChatCtx): void {
  if (ready.has(ctx.db)) return;
  ctx.db.run(TABLE);
  ready.add(ctx.db);
}

function messagesOf(ctx: ChatCtx, threadId: string): { msgs: Msg[]; total: number } {
  const t = load(ctx, threadId);
  const floor = Math.floor(readFloor(ctx, t));
  const total = Number(
    ((
      ctx.db.all(
        'SELECT COUNT(*) AS n FROM chat_message WHERE "thread" = ? AND deleted_at IS NULL AND "createdAt" >= ?',
        t.id,
        floor,
      ) as Row[]
    )[0] ?? {})["n"] ?? 0,
  );
  if (total <= CHAPTERS.min) return { msgs: [], total };
  const rows = ctx.db.all(
    'SELECT threadSeq, "createdAt", kind, author, substr(body, 1, 400) AS body FROM chat_message WHERE "thread" = ? AND deleted_at IS NULL AND "createdAt" >= ? ORDER BY threadSeq DESC LIMIT ?',
    t.id,
    floor,
    CHAPTERS.scan,
  ) as Row[];
  rows.reverse();
  return {
    total,
    msgs: rows.map((r) => ({
      author: String(r["author"] ?? ""),
      seq: Number(r["threadSeq"]),
      at: Number(r["createdAt"]),
      kind: String(r["kind"] ?? "text"),
      person: String(r["author"] ?? "").startsWith("usr_"),
      body: String(r["body"] ?? "").startsWith("enc") ? "" : String(r["body"] ?? ""),
    })),
  };
}

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

export async function chaptersRead(ctx: ChatCtx, input: { threadId: string }) {
  const { msgs } = messagesOf(ctx, input.threadId);
  if (msgs.length === 0) return { chapters: [] as Chapter[], wanted: 0 };
  ensureTable(ctx);
  const chapters = chaptersOf(msgs, keptOf(ctx, input.threadId));
  // closed chapters nobody has written yet: the app may ask for them (the open one is never written, it is still going)
  const wanted = chapters.filter((c) => !c.current && c.by === "extract").length;
  return { chapters, wanted };
}

interface Account {
  ref: string;
  driver: string;
  kind?: string | undefined;
}

const SYSTEM =
  "You write a heading for one part of a long chat. Reply with exactly two lines. Line 1: a title of 1 to 3 plain words. Line 2: one short sentence, at most 12 words, that says what was settled or done. No quotes, no ending punctuation on line 1, nothing else.";

async function askModel(
  ctx: ChatCtx,
  account: Account,
  part: readonly Msg[],
): Promise<{ title: string; summary: string } | null> {
  if (!ctx.call) return null;
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
    if (!model) return null;
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
    return title && summary ? { title, summary } : null;
  } catch (e) {
    ctx.log.warn("a chapter was not written by a model", { reason: e instanceof Error ? e.name : "error" });
    return null;
  }
}

/**
 * Heads closed chapters that have no heading yet. The rules (lead, 14 Nov): a model is asked at most ONCE per chapter, when the chapter has closed (a later one has started), never for a chat
 * under the threshold, never for a chapter that already has a row (a model's, a person's, or the plain words kept after a try), and only on an api_key account: a subscription has limits and is
 * never spent on this, and neither is a Space's or another person's account. In a shared chat the account is the asker's and the chapter must have been opened by the asker (its first
 * person message is theirs); otherwise nothing is called and the chapter waits for its own person's next turn. What is sent: up to 12 lines of the chapter (6 first, 6 last), each cut to 220
 * characters, at most 3,000 characters (about 750 tokens in); the answer is two short lines (about 40 tokens), cut to 200 characters. A try that gives nothing (no cheap model, a failing call)
 * keeps the plain words as the chapter's row, so it is never tried again.
 * A stored heading belongs to the chapter that starts at the same first message. A reader whose view starts later (they joined mid-chapter) has a different first message, so they never see a
 * title written from messages before they joined.
 */
export async function chaptersWrite(ctx: ChatCtx, input: { threadId: string; account?: Account | undefined }) {
  const me = askerOf(ctx);
  if (!me.startsWith("usr_")) raise(ctx, "permission.no_grant", "Chapters are written for the person who asked.");
  const { msgs } = messagesOf(ctx, input.threadId);
  if (msgs.length === 0 || !input.account?.ref || !input.account.driver || input.account.kind !== "api_key")
    return { written: 0 };
  ensureTable(ctx);
  const kept = keptOf(ctx, input.threadId);
  const at = boundaries(msgs);
  let written = 0;
  for (let k = 0; k + 1 < at.length && written < 3; k++) {
    const start = msgs[at[k]!]!.seq;
    if (kept.has(start)) continue;
    const part = msgs.slice(at[k]!, at[k + 1]!);
    if (part.find((m) => m.person && m.kind !== "system")?.author !== me) continue;
    const made = await askModel(ctx, input.account, part);
    const row = made ?? { ...extractOf(part), writer: "extract" };
    ctx.db.run(
      'INSERT INTO chat_chapter ("thread", "startSeq", "title", "summary", "writer", "at") VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT("thread", "startSeq") DO NOTHING',
      input.threadId,
      start,
      row.title,
      row.summary,
      made ? "model" : "extract",
      ctx.now(),
    );
    if (made) written++;
  }
  return { written };
}
