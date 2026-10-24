// The transcript store port (ARCH 6.9) and its in-memory form. The chat module keeps the same rows in SQL with an FTS5 index in the same transaction; this is the contract
// the handoff, the summary and the rollover read, and what the tests run against. The store assigns each thread's turn numbers.
import { render } from "./render.ts";
import { redact } from "./sanitize.ts";
import type { NewTurn, Summary, SwitchRow, Turn } from "./types.ts";

export interface Hit { n: number; role: Turn["role"]; snippet: string; score: number }

export interface Transcript {
  append(t: NewTurn): Turn;
  /** Turns of a thread from `from` (default 1), in order. */
  turns(threadId: string, from?: number): Turn[];
  get(threadId: string, n: number): Turn | null;
  count(threadId: string): number;
  summary(threadId: string): Summary | null;
  setSummary(s: Summary): void;
  switches(threadId: string): SwitchRow[];
  recordSwitch(row: SwitchRow): void;
  /** Words of the query found in the thread's text, best first. The chat module answers transcript_search with BM25 and embeddings; this is the lexical floor. */
  find(threadId: string, query: string, limit?: number): Hit[];
  /** chats/<id>/transcript.md from turn `from`. */
  render(threadId: string, o?: { title?: string; from?: number }): string;
}

const words = (s: string): string[] => [...new Set(s.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter((w) => w.length >= 3))];
const textOf = (t: Turn): string => t.parts.flatMap((p) => (p.kind === "text" ? [p.text] : p.kind === "tool_call" ? [p.summary] : [])).join("\n");

export function createTranscript(): Transcript {
  const byThread = new Map<string, Turn[]>();
  const summaries = new Map<string, Summary>();
  const switchRows = new Map<string, SwitchRow[]>();
  const list = (id: string): Turn[] => {
    let t = byThread.get(id);
    if (!t) { t = []; byThread.set(id, t); }
    return t;
  };
  return {
    append(t) {
      const rows = list(t.threadId);
      const turn: Turn = { ...t, n: rows.length + 1, parts: t.parts.map((p) => ({ ...p })), links: t.links.map((l) => ({ ...l })), tokens: { ...t.tokens } };
      rows.push(turn);
      return turn;
    },
    turns: (threadId, from = 1) => list(threadId).filter((t) => t.n >= from),
    get: (threadId, n) => list(threadId)[n - 1] ?? null,
    count: (threadId) => list(threadId).length,
    summary: (threadId) => summaries.get(threadId) ?? null,
    setSummary(s) {
      // A summary only moves forward: an older one never replaces a newer one, and it is redacted like every other text.
      const cur = summaries.get(s.threadId);
      if (cur && cur.upTo > s.upTo) return;
      summaries.set(s.threadId, { ...s, text: redact(s.text).text });
    },
    switches: (threadId) => (switchRows.get(threadId) ?? []).map((r) => ({ ...r })),
    recordSwitch(row) {
      const rows = switchRows.get(row.threadId) ?? [];
      rows.push({ ...row });
      switchRows.set(row.threadId, rows);
    },
    find(threadId, query, limit = 10) {
      const q = words(query);
      if (q.length === 0) return [];
      const rows = list(threadId);
      const hits: Hit[] = [];
      for (const t of rows) {
        const text = textOf(t);
        const have = new Set(words(text));
        const matched = q.filter((w) => have.has(w)).length;
        if (matched === 0) continue;
        const at = text.toLowerCase().indexOf(q.find((w) => have.has(w)) ?? "");
        const start = Math.max(0, at - 40);
        hits.push({ n: t.n, role: t.role, snippet: text.slice(start, start + 160).replace(/\s+/g, " ").trim(), score: matched / q.length + t.n / (rows.length * 1000) });
      }
      return hits.sort((a, b) => b.score - a.score || b.n - a.n).slice(0, limit);
    },
    render: (threadId, o) => render(list(threadId), o),
  };
}
