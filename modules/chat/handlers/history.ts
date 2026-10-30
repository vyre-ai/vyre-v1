// chat.history.search (memory ruling 3, exact recall): word-for-word search over every chat message and every transcript row (turns, tool calls and results, which is what a run step is) that the
// ASKER could open themselves. The asker is the person behind the call: an agent that acts for someone else sees what that someone sees, never what the agent itself sat in on. So a person who
// was not in a private chat never gets a line from it, not even through an agent that was.
//   private chat or Ask pane   the asker is its starter or a member
//   channel and what hangs under it   the asker is a member of the channel (an invite-only channel you are not in is closed, and so is a public one you never joined: recall never reaches further than membership)
//   other threads (run, helper, console)   the asker is the starter or a member
// Sealed bodies (enc2 envelopes) are not text the server holds, so they never match. The answer carries the exact stored words, the author, the time and a link that opens the chat at that moment.
import { askerOf, ensure, membersOf, refOf, threadBy } from "../projections.ts";
import type { ChatCtx, ThreadRec } from "../projections.ts";
import { ensureTranscript } from "./g24d.ts";
import { rootOf } from "./post.ts";

type Row = Record<string, unknown>;

const SCAN_CAP = 12_000;
const BATCH = 1_500;
const MAX_TEXT = 2_000;
const STOP = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was", "one", "our", "out", "has", "have", "him", "his", "how", "its", "may", "new", "now", "old", "see", "two",
  "who", "did", "get", "got", "let", "put", "say", "she", "too", "use", "what", "when", "where", "which", "while", "with", "would", "could", "should", "about", "there", "their", "them", "then",
  "this", "that", "these", "those", "from", "into", "than", "were", "will", "been", "being", "does", "doing", "said", "tell", "told", "remind", "please", "just", "also", "very", "some", "such",
]);

export interface HistoryHit {
  source: "message" | "step";
  /** msg_... for a message; <thread>#<idx> for a transcript row. */
  ref: string;
  messageId?: string;
  threadId: string;
  threadTitle?: string;
  threadKind: string;
  /** The message's number in its thread, or the row's index in the transcript. */
  seq: number;
  role: string;
  author: { kind: "person" | "agent" | "actor" | "service"; id: string };
  text: string;
  truncated?: boolean;
  at: number;
  link: string;
  score: number;
}

/** The words that carry a question: lower-cased, three letters or more (two when it is all there is), no filler. */
export function termsOf(q: string): string[] {
  const all = [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter((w) => w.length >= 2))];
  const keep = all.filter((w) => w.length >= 3 && !STOP.has(w));
  return (keep.length > 0 ? keep : all).slice(0, 12);
}

/** May the asker open this thread and so recall its words? */
export function mayRecall(ctx: Pick<ChatCtx, "db" | "principal" | "actingFor">, t: ThreadRec): boolean {
  const asker = askerOf(ctx);
  const root = rootOf(ctx, t);
  if (root.starter === asker || t.starter === asker) return true;
  if (membersOf(ctx.db, root.id).includes(asker)) return true;
  return membersOf(ctx.db, t.id).includes(asker);
}

const like = (w: string): string => `%${w.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;

function jsonText(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  let v: unknown = raw;
  try { v = JSON.parse(String(raw)); } catch { return String(raw); }
  if (typeof v === "string") return v;
  if (v !== null && typeof v === "object" && typeof (v as Row)["text"] === "string") return String((v as Row)["text"]);
  return JSON.stringify(v);
}

function excerpt(text: string, terms: readonly string[]): { text: string; truncated: boolean } {
  if (text.length <= MAX_TEXT) return { text, truncated: false };
  const low = text.toLowerCase();
  const at = terms.map((w) => low.indexOf(w)).find((i) => i >= 0) ?? 0;
  const from = Math.max(0, at - Math.floor(MAX_TEXT / 4));
  return { text: text.slice(from, from + MAX_TEXT), truncated: true };
}

function scoreOf(text: string, terms: readonly string[], phrase: string): number {
  const low = text.toLowerCase();
  const have = new Set(low.split(/[^\p{L}\p{N}_]+/u));
  const found = terms.filter((w) => have.has(w) || low.includes(w)).length;
  return terms.length === 0 ? 0 : found / terms.length + (phrase.length >= 6 && low.includes(phrase) ? 0.5 : 0);
}

export interface HistoryInput { q?: string; ref?: string; threadId?: string; excludeThreadId?: string; limit?: number; minCoverage?: number }

export async function historySearch(ctx: ChatCtx, input: HistoryInput): Promise<{ hits: HistoryHit[] }> {
  ensure(ctx.db);
  ensureTranscript(ctx.db);
  const limit = Math.min(20, Math.max(1, input.limit ?? 5));
  const may = new Map<string, ThreadRec | null>();
  const open = (id: string): ThreadRec | null => {
    let t = may.get(id);
    if (t === undefined) { const th = threadBy(ctx.db, id); t = th && mayRecall(ctx, th) ? th : null; may.set(id, t); }
    return t;
  };
  if (input.ref !== undefined) return { hits: byRef(ctx, input.ref, open) };

  const q = (input.q ?? "").slice(0, 600);
  const terms = termsOf(q);
  if (terms.length === 0) return { hits: [] };
  const phrase = q.toLowerCase().replace(/\s+/g, " ").trim();
  const need = Math.min(1, Math.max(0, input.minCoverage ?? (terms.length >= 3 ? 0.5 : 1)));
  const where = terms.map(() => "lower(m.body) LIKE ? ESCAPE '\\'").join(" OR ");
  const args = terms.map(like);
  const hits: HistoryHit[] = [];

  for (let off = 0; off < SCAN_CAP; off += BATCH) {
    const rows = ctx.db.all(
      `SELECT m.* FROM chat_message m WHERE m.deleted_at IS NULL AND m.kind IN ('text', 'agent') AND m.body NOT LIKE 'enc2.%' AND (${where})${input.threadId ? " AND m.thread = ?" : ""} ORDER BY m.createdAt DESC LIMIT ? OFFSET ?`,
      ...args, ...(input.threadId ? [input.threadId] : []), BATCH, off,
    ) as Row[];
    for (const r of rows) {
      const thread = String(r["thread"]);
      if (thread === input.excludeThreadId) continue;
      const t = open(thread);
      if (!t) continue;
      const body = String(r["body"] ?? "");
      const s = scoreOf(body, terms, phrase);
      if (s < need) continue;
      const w = excerpt(body, terms);
      hits.push({
        source: "message", ref: String(r["id"]), messageId: String(r["id"]), threadId: thread, ...(t.title ? { threadTitle: t.title } : {}), threadKind: t.kind, seq: Number(r["threadSeq"] ?? 0),
        role: String(r["kind"]) === "agent" ? "agent" : "person", author: refOf(String(r["author"])), text: w.text, ...(w.truncated ? { truncated: true } : {}), at: Number(r["createdAt"] ?? 0),
        link: linkOf(thread, { m: String(r["id"]) }), score: s,
      });
    }
    if (rows.length < BATCH) break;
  }

  // Transcript rows: the tool calls and results of turns are the steps; the user and assistant text rows repeat messages, so only those the messages do not already hold are kept.
  const twhere = terms.map(() => "lower(r.content) LIKE ? ESCAPE '\\'").join(" OR ");
  for (let off = 0; off < SCAN_CAP; off += BATCH) {
    const rows = ctx.db.all(
      `SELECT r.* FROM chat_transcript_row r WHERE (${twhere})${input.threadId ? " AND r.thread = ?" : ""} ORDER BY r.at DESC, r.idx DESC LIMIT ? OFFSET ?`,
      ...args, ...(input.threadId ? [input.threadId] : []), BATCH, off,
    ) as Row[];
    for (const r of rows) {
      const thread = String(r["thread"]);
      if (thread === input.excludeThreadId) continue;
      const t = open(thread);
      if (!t) continue;
      const text = jsonText(r["content"]);
      if (text === "" || /^enc2\./.test(text)) continue;
      const s = scoreOf(text, terms, phrase);
      if (s < need) continue;
      const kind = String(r["kind"]);
      const role = String(r["role"]);
      // what a memory tool answered is memory's own output, not something anyone said: it would only repeat the lines it was built from
      if (/^memory_/.test(String(r["toolName"] ?? ""))) continue;
      const isStep = role === "tool" || kind === "tool_call" || kind === "tool_result";
      const dup = !isStep && hits.some((h) => h.source === "message" && h.threadId === thread && h.text.replace(/\s+/g, " ").trim() === text.replace(/\s+/g, " ").trim());
      if (dup) continue;
      const w = excerpt(text, terms);
      const idx = Number(r["idx"]);
      hits.push({
        source: isStep ? "step" : "message", ref: `${thread}#${idx}`, threadId: thread, ...(t.title ? { threadTitle: t.title } : {}), threadKind: t.kind, seq: idx,
        role: isStep ? `tool${r["toolName"] ? `:${String(r["toolName"])}` : ""}` : role === "user" ? "person" : "agent", author: refOf(String(r["author"] ?? "")), text: w.text, ...(w.truncated ? { truncated: true } : {}),
        at: Number(r["at"] ?? 0), link: linkOf(thread, { step: String(idx) }), score: s,
      });
    }
    if (rows.length < BATCH) break;
  }

  // The same words said twice in one chat (an agent that echoes the person, a turn row that repeats a message) are one line, credited to whoever said them first.
  const firstOf = new Map<string, HistoryHit>();
  for (const h of hits) {
    const k = `${h.threadId}\u0000${h.text.replace(/\s+/g, " ").trim().toLowerCase()}`;
    const at = firstOf.get(k);
    if (!at || h.at < at.at || (h.at === at.at && h.source === "message" && at.source !== "message")) firstOf.set(k, h);
  }
  const unique = [...firstOf.values()];
  unique.sort((a, b) => b.score - a.score || b.at - a.at || a.ref.localeCompare(b.ref));
  return { hits: unique.slice(0, limit) };
}

/** One message or one transcript row by its ref, in full, when the asker may open its chat. */
function byRef(ctx: ChatCtx, ref: string, open: (id: string) => ThreadRec | null): HistoryHit[] {
  const step = /^(thr_[a-z0-9]+)#(\d+)$/.exec(ref);
  if (step) {
    const r = (ctx.db.all("SELECT * FROM chat_transcript_row WHERE thread = ? AND idx = ?", step[1], Number(step[2])) as Row[])[0];
    const t = r ? open(String(r["thread"])) : null;
    if (!r || !t) return [];
    const text = jsonText(r["content"]);
    const kind = String(r["kind"]);
    const isStep = String(r["role"]) === "tool" || kind === "tool_call" || kind === "tool_result";
    return [{
      source: isStep ? "step" : "message", ref, threadId: t.id, ...(t.title ? { threadTitle: t.title } : {}), threadKind: t.kind, seq: Number(r["idx"]), role: isStep ? "tool" : String(r["role"]) === "user" ? "person" : "agent",
      author: refOf(String(r["author"] ?? "")), text: text.slice(0, 20_000), ...(text.length > 20_000 ? { truncated: true } : {}), at: Number(r["at"] ?? 0), link: linkOf(t.id, { step: String(r["idx"]) }), score: 1,
    }];
  }
  const m = (ctx.db.all("SELECT * FROM chat_message WHERE id = ? AND deleted_at IS NULL", ref) as Row[])[0];
  const t = m ? open(String(m["thread"])) : null;
  if (!m || !t) return [];
  const body = String(m["body"] ?? "");
  if (/^enc2\./.test(body)) return [];
  return [{
    source: "message", ref, messageId: ref, threadId: t.id, ...(t.title ? { threadTitle: t.title } : {}), threadKind: t.kind, seq: Number(m["threadSeq"] ?? 0), role: String(m["kind"]) === "agent" ? "agent" : "person",
    author: refOf(String(m["author"])), text: body.slice(0, 20_000), ...(body.length > 20_000 ? { truncated: true } : {}), at: Number(m["createdAt"] ?? 0), link: linkOf(t.id, { m: ref }), score: 1,
  }];
}

/** vyre://thread/<id>?m=<messageId> opens the chat scrolled to that message; ?step=<n> to that transcript row. */
export const linkOf = (threadId: string, q: Record<string, string>): string => `vyre://thread/${threadId}?${new URLSearchParams(q).toString()}`;
