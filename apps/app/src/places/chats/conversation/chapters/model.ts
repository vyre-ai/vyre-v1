// Chapters in the message column (gap rows G9, G10, G73; prototype t-session and c-render rFeed). The server says where a long chat's chapters start (chat.chapters). This file folds the
// chat's rows into them: a heading before each chapter, closed chapters hidden behind one line, the current one open. Pure, in row order, one pass: a chat with no chapters comes back as it
// was, the same array, so a short chat pays nothing.
import { timeLabel } from "../model.ts";
import type { Clock } from "../model.ts";

/** One chapter as chat.chapters returns it. */
export interface ChapterInfo {
  startSeq: number;
  endSeq: number;
  startAt: number;
  count: number;
  current: boolean;
  title: string;
  summary: string;
  by: "extract" | "model" | "person";
}

/** The heading row. `open` is whether the chapter's own rows follow it. */
export interface ChapterRow {
  kind: "chapter";
  key: string;
  startSeq: number;
  title: string;
  summary: string;
  time: string;
  count: number;
  open: boolean;
  current: boolean;
}

interface Seqed {
  kind: string;
  message?: { threadSeq: number } | undefined;
  items?: ReadonlyArray<{ kind: string; message?: { threadSeq: number } | undefined }> | undefined;
}

/** The sequence number a row stands at on its own: its message, or the first message an away row holds. A day or hour mark has none. */
export function ownSeq(r: Seqed): number | null {
  return r.message?.threadSeq ?? r.items?.find((x) => x.message !== undefined)?.message?.threadSeq ?? null;
}

/** The sequence number each row stands at: its own, or (for a day or hour mark) the next message below it. Null past the last message. */
function seqsOf<R>(rows: readonly R[], own: (r: R) => number | null): Array<number | null> {
  const out: Array<number | null> = new Array(rows.length).fill(null);
  let next: number | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const s = own(rows[i]!);
    next = s ?? next;
    out[i] = next;
  }
  return out;
}

/** The chapter a sequence number falls in, or undefined. */
export const chapterAt = (chapters: readonly ChapterInfo[], seq: number): ChapterInfo | undefined =>
  chapters.find((c) => seq >= c.startSeq && seq <= c.endSeq);

/** Is this chapter shown open? The current one is, unless a person closed it; any other only when a person opened it. */
export const isOpen = (c: Pick<ChapterInfo, "startSeq" | "current">, flipped: ReadonlySet<number>): boolean =>
  flipped.has(c.startSeq) ? !c.current : c.current;

/**
 * Rows with a heading before each chapter and the rows of closed chapters left out. `flipped` holds the start of every chapter a person pressed (an open one closes, a closed one opens);
 * `reveal` is a message that must be on screen (a find hit, a link, a jump): its chapter opens whatever was pressed.
 */
export function withChapters<R extends { kind: string }>(
  rows: readonly R[],
  own: (r: R) => number | null,
  chapters: readonly ChapterInfo[],
  flipped: ReadonlySet<number>,
  clock: Clock,
  reveal: number | null = null,
): Array<R | ChapterRow> {
  if (chapters.length === 0 || rows.length === 0) return rows as Array<R | ChapterRow>;
  const seqs = seqsOf(rows, own);
  const out: Array<R | ChapterRow> = [];
  let k = -1;
  let open = true;
  for (let i = 0; i < rows.length; i++) {
    const s = seqs[i] ?? null;
    if (s !== null) {
      // the heading goes before the first row at or after a chapter's start: before the day and hour marks of its first message
      while (k + 1 < chapters.length && s >= chapters[k + 1]!.startSeq) {
        k++;
        const c = chapters[k]!;
        open = isOpen(c, flipped) || (reveal !== null && reveal >= c.startSeq && reveal <= c.endSeq);
        out.push({
          kind: "chapter",
          key: `chapter-${c.startSeq}`,
          startSeq: c.startSeq,
          title: c.title,
          summary: c.summary,
          time: timeLabel(c.startAt, clock),
          count: c.count,
          open,
          current: c.current,
        });
      }
    }
    if (k < 0 || open) out.push(rows[i]!);
  }
  return out;
}

/** One dot of the rail. */
export interface Dot {
  startSeq: number;
  title: string;
  summary: string;
  current: boolean;
  /** The chapter the reader is in, by what is open. */
  lit: boolean;
}

/** The rail: one dot per chapter, the current one lit. */
export const railOf = (chapters: readonly ChapterInfo[]): Dot[] =>
  chapters.map((c) => ({
    startSeq: c.startSeq,
    title: c.title,
    summary: c.summary,
    current: c.current,
    lit: c.current,
  }));
