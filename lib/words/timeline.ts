// What a person reads in an Activity tab: one line per thing that happened, in words, newest first. The goal's server notes, a task's history and a record's log all become the same TimelineEntry here, and the one
// ui/Timeline draws it. Repeats fold ("Checked in 6 times", "No progress for 7 check-ins"), bookkeeping that repeats another line is dropped, a code or an id never shows, and long text is cut at a word with the whole
// of it kept for the "more" that opens it. The failure words are lib/words/failure.ts; ids are lib/id-shapes.ts.
import { withoutRawIds } from "../id-shapes.ts";
import { FAILURE_WORDS, failureClause } from "./failure.ts";
import { expandWords } from "./activity.ts";
import type { ActivityEvent, Viewer } from "./activity.ts";

/** How loud an entry is. Milestone: the story's turns. Checkin: what the agent said. Action: a person or agent did something. Problem: something failed. Beat: a folded run of the same. Quiet: a small system line. */
export type Tier = "milestone" | "checkin" | "action" | "problem" | "beat" | "quiet";
export type TimelineIcon =
  | "flag"
  | "play"
  | "ask"
  | "check"
  | "pulse"
  | "warn"
  | "edit"
  | "plan"
  | "file"
  | "money"
  | "dot";

export interface TimelineEntry {
  id: string;
  at: number;
  /** a folded run: the first and last moment it covers */
  span?: { from: number; to: number };
  tier: Tier;
  icon: TimelineIcon;
  /** who did it, an id the reader's directory knows; an entry the server wrote has none */
  by?: string;
  /** one line, cut at a word */
  title: string;
  /** the rest of the text, whole; shown two lines at a time and opened by "more" */
  detail?: string;
  /** where it leads: a task id, or the id of the message it came from */
  ref?: string;
  /** how many rows were folded into it (one when none) */
  count: number;
  /** the line as one plain sentence for Copy */
  text: string;
}

const TITLE_MAX = 90;

/** The first part of a text that fits one line, cut at a word, and the rest. A text that fits has no rest. */
export function cutAtWord(text: string, max = TITLE_MAX): { head: string; rest?: string } {
  const t = text.trim();
  // the first sentence is the line, unless it is only a word or two ("Done.") or longer than a line
  let stop = -1;
  for (const m of t.matchAll(/[.!?](?=\s|$)/g)) {
    if (m.index! >= 14) {
      stop = m.index!;
      break;
    }
  }
  if (stop >= 0 && stop + 1 <= max && stop + 1 < t.length)
    return { head: t.slice(0, stop + 1), rest: t.slice(stop + 1).trim() };
  if (t.length <= max) return { head: t };
  const cut = t.lastIndexOf(" ", max);
  const at = cut > max * 0.5 ? cut : max;
  return { head: `${t.slice(0, at).replace(/[,;:\s]+$/, "")}…`, rest: t };
}

const CODES = [...Object.keys(FAILURE_WORDS), "host_lost", "turn_timeout", "agent_paused", "agent_gone"].map((k) =>
  k.replace(/\./g, "\\."),
);
const IN_PARENS = new RegExp(`\\s*\\((${CODES.join("|")})\\)`, "g");
const BARE = new RegExp(`\\b(${CODES.join("|")})\\b`, "g");
const SNAKE = /\b[a-z]+(?:_[a-z]+)+\b|\b(?:provider|engine|sandbox|permission|validation)\.[a-z_]+\b/g;

/** A sentence with nothing a person cannot read: a failure code becomes its words, an id goes. */
export function plain(text: string): string {
  let out = text
    .replace(IN_PARENS, (_m, c: string) => `: ${failureClause(c)}`)
    .replace(BARE, (_m, c: string) => failureClause(c));
  out = withoutRawIds(out)
    .replace(SNAKE, " ")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,:;])/g, "$1")
    .trim();
  return out.replace(/\.:/g, ":").replace(/:\s*:/g, ":");
}

/** Every kind a goal's activity row can have, with how loud it is and its mark. A kind the table lacks reads as a quiet line; a test lists the kinds the handlers write and fails on a missing one. */
export const GOAL_KINDS: Readonly<Record<string, { tier: Tier; icon: TimelineIcon }>> = {
  created: { tier: "milestone", icon: "flag" },
  started: { tier: "milestone", icon: "play" },
  ended: { tier: "milestone", icon: "flag" },
  retro: { tier: "milestone", icon: "flag" },
  extended: { tier: "milestone", icon: "edit" },
  checklist: { tier: "milestone", icon: "check" },
  waiting: { tier: "milestone", icon: "ask" },
  answered: { tier: "milestone", icon: "ask" },
  report: { tier: "checkin", icon: "pulse" },
  checkin: { tier: "checkin", icon: "pulse" },
  edit: { tier: "action", icon: "edit" },
  plan: { tier: "action", icon: "plan" },
  step: { tier: "action", icon: "plan" },
  task: { tier: "action", icon: "check" },
  budget: { tier: "action", icon: "money" },
  access: { tier: "action", icon: "dot" },
  error: { tier: "problem", icon: "warn" },
  wake: { tier: "quiet", icon: "dot" },
  reading: { tier: "quiet", icon: "dot" },
  status: { tier: "quiet", icon: "dot" },
  files: { tier: "quiet", icon: "file" },
  folder: { tier: "quiet", icon: "file" },
  overlap: { tier: "quiet", icon: "dot" },
};

const FLAT = /No progress for (\d+) check-in/;
const FAILED_WAKE = /could not check in|did not|stopped answering/i;

interface Cooked extends TimelineEntry {
  kind: string;
  key: string;
}

function cook(row: ActivityEvent, i: number, v: Viewer): Cooked | null {
  const kind = row.kind ?? "";
  const known = GOAL_KINDS[kind] ?? { tier: "quiet" as Tier, icon: "dot" as TimelineIcon };
  const said = plain(expandWords(row.tpl ?? row.text, v));
  if (said === "") return null;
  let tier = known.tier;
  let icon = known.icon;
  // a wake is the first half of a check-in: only one that failed is news; the others are bookkeeping
  if (kind === "wake") {
    if (!FAILED_WAKE.test(said))
      return /could check in again/.test(said) ? { ...base(row, i, said, "quiet", "dot"), kind, key: "wake-ok" } : null;
    tier = "problem";
    icon = "warn";
  }
  // a reading that did not move is never a line; a move is
  if (kind === "reading" && /\b(?:up|down) 0\b|\(\+0 /.test(said)) return null;
  // a status move repeats the line that caused it (the end, the stuck notice)
  if (kind === "status" && /^Moved from /.test(said)) return null;
  if (kind === "reading") tier = "action";
  return {
    ...base(row, i, said, tier, icon),
    kind,
    key: kind === "checkin" ? `${kind}:${said.replace(/\d+/g, "#")}` : `${kind}:${said}`,
  };
}

function base(row: ActivityEvent, i: number, said: string, tier: Tier, icon: TimelineIcon): TimelineEntry {
  const { head, rest } = cutAtWord(said);
  const actor = row.by && !row.by.split(">")[0]!.startsWith("svc_") ? row.by.split(">")[0] : undefined;
  return {
    id: `${row.at}-${row.kind ?? ""}-${i}`,
    at: row.at,
    tier,
    icon,
    ...(actor ? { by: actor } : {}),
    title: head,
    ...(rest ? { detail: rest } : {}),
    ...(row.ref ? { ref: row.ref } : {}),
    count: 1,
    text: said,
  };
}

/** A goal's activity rows (newest first) as the story a person reads: bookkeeping dropped, flat check-ins and repeats folded, nothing a code or an id. */
export function goalTimeline(rows: readonly ActivityEvent[], v: Viewer): TimelineEntry[] {
  const cooked: Cooked[] = [];
  rows.forEach((r, i) => {
    const c = cook(r, i, v);
    if (c) cooked.push(c);
  });
  const out: TimelineEntry[] = [];
  for (let i = 0; i < cooked.length; ) {
    const c = cooked[i]!;
    // a run of check-ins that moved nothing is one line: "No progress for 7 check-ins", 4 to 10 Nov
    if (c.kind === "checkin" && FLAT.test(c.text)) {
      let j = i;
      while (j < cooked.length && cooked[j]!.kind === "checkin" && FLAT.test(cooked[j]!.text)) j++;
      const run = cooked.slice(i, j);
      if (run.length >= 3) {
        const n = Math.max(...run.map((e) => Number(FLAT.exec(e.text)![1])));
        out.push({
          id: `beat-${c.at}`,
          at: c.at,
          span: { from: run[run.length - 1]!.at, to: c.at },
          tier: "beat",
          icon: "pulse",
          ...(c.by ? { by: c.by } : {}),
          title: `No progress for ${n} check-ins`,
          count: run.length,
          text: `No progress for ${n} check-ins.`,
        });
        i = j;
        continue;
      }
    }
    // the same thing again and again, one after another: one line with a count
    let j = i + 1;
    while (j < cooked.length && cooked[j]!.key === c.key) j++;
    if (j - i >= 2) {
      const run = cooked.slice(i, j);
      const n = run.length;
      out.push({
        ...c,
        span: { from: run[n - 1]!.at, to: c.at },
        tier: c.tier === "problem" ? "problem" : c.tier === "checkin" ? "checkin" : "beat",
        title:
          c.kind === "checkin" || c.kind === "report"
            ? `Checked in ${n} times`
            : `${c.title.replace(/\.$/, "")}, ${n} times`,
        count: n,
      });
      i = j;
      continue;
    }
    const { kind: _k, key: _y, ...entry } = c;
    void _k;
    void _y;
    out.push(entry);
    i++;
  }
  return out;
}

/** Entries from a plain list of "who did what" lines (a task's history, a record's log): one action line each, repeats of the same line folded. */
export function actionTimeline(
  lines: readonly {
    id: string;
    at: number;
    by?: string;
    text: string;
    detail?: string;
    ref?: string;
    problem?: boolean;
  }[],
): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const l of lines) {
    const said = plain(l.text);
    if (said === "") continue;
    const { head, rest } = cutAtWord(said);
    const detail = l.detail ? plain(l.detail) : rest;
    const last = out[out.length - 1];
    if (last && last.text === said && last.by === l.by) {
      last.count += 1;
      last.span = { from: l.at, to: last.span?.to ?? last.at };
      last.title = `${head.replace(/\.$/, "")}, ${last.count} times`;
      continue;
    }
    out.push({
      id: l.id,
      at: l.at,
      tier: l.problem ? "problem" : "action",
      icon: l.problem ? "warn" : "dot",
      ...(l.by ? { by: l.by } : {}),
      title: head,
      ...(detail ? { detail } : {}),
      ...(l.ref ? { ref: l.ref } : {}),
      count: 1,
      text: said,
    });
  }
  return out;
}
