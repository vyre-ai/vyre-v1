// A long running session (owner, 6 Nov 2026, prototype t-session "rc.22.1 launch night"): one chat that a person and an assistant keep for hours, with a crew in the middle. The pieces that make it readable are pure
// and live here: which chats count as long, the hour marks, the jump points (release tagged, PR merged, task done, a decision), "While you were away" (quiet messages since the person last looked fold into one row,
// the things that need them stay), and what the session Overview in the right pane lists. Nothing here draws or reads the network; the tests drive every rule.
import { timeLabel, workOf } from "../conversation/model.ts";
import type { Clock, Item, Message } from "../conversation/model.ts";

/** A chat is a long session once it has run for hours with real traffic: 40 messages over an hour (the chat loads its last 50, so a full page counts), or three hours with a handful. A short chat keeps the plain timeline. */
export const LONG_MESSAGES = 40;
export const LONG_SPAN_HOURS = 1;
export const LONG_HOURS = 3;
export const LONG_FEW = 8;
/** At least this many quiet items in a row fold into an away row. */
export const AWAY_MIN = 4;
/** A short line from an agent is chatter (a status, an acknowledgement); a longer one is the answer a person reads. */
const CHATTER = 140;

const HOUR = 3_600_000;

export function isLong(messages: readonly Pick<Message, "createdAt">[]): boolean {
  if (messages.length < LONG_FEW) return false;
  let lo = Infinity, hi = -Infinity;
  for (const m of messages) { lo = Math.min(lo, m.createdAt); hi = Math.max(hi, m.createdAt); }
  const span = hi - lo;
  return span >= LONG_HOURS * HOUR || (messages.length >= LONG_MESSAGES && span >= LONG_SPAN_HOURS * HOUR);
}

/* ---------- the hour spine ---------- */

/** "8 PM", "12 AM": the hour of a moment in the clock the chat reads in. */
export function hourLabel(ts: number, c: Clock): string {
  const h = Number(timeLabel(ts, c).slice(0, 2));
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
}
/** "11:48 PM": a time of day the way the prototype writes it. */
export function timeWords(ts: number, c: Clock): string {
  const [h, m] = timeLabel(ts, c).split(":").map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
const hourKey = (ts: number, c: Clock): string => `${Math.floor(ts / HOUR)}:${timeLabel(ts, c).slice(0, 2)}`;

/* ---------- jump points ---------- */

export type JumpKind = "release" | "merged" | "task" | "decision";
export interface Jump { messageId: string; kind: JumpKind; label: string; sub: string; at: number }

const LABEL: Record<JumpKind, string> = { release: "Release tagged", merged: "PR merged", task: "Task done", decision: "Decision" };
const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {});
const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** The words a card or a system line says, to sort it into a jump point. */
function sayings(m: Pick<Message, "body" | "blocks">): { words: string; card?: { lead: string; title: string; target: string } } {
  const lc = m.blocks.find((b) => b.type === "link_card");
  if (lc) {
    const d = rec(lc.data);
    const card = { lead: text(d["lead"]), title: text(d["title"]), target: text(rec(d["target"])["type"]) };
    return { words: `${card.lead} ${card.title} ${text(d["body"])}`, card };
  }
  return { words: m.body };
}

/** A message that marks a moment worth coming back to: a release tagged, a PR merged, a task finished, a decision. Null for everything else. */
export function jumpOf(m: Pick<Message, "messageId" | "kind" | "body" | "blocks" | "pinned" | "createdAt">): Jump | null {
  const { words, card } = sayings(m);
  const make = (kind: JumpKind, sub: string): Jump => ({ messageId: m.messageId, kind, label: LABEL[kind], sub, at: m.createdAt });
  if (card?.target === "fact") return make("decision", card.title);
  if (/\brelease\b.*\b(tagged|published|shipped|cut)\b|\b(tagged|published|shipped|cut)\b.*\brelease\b|\bv?\d+\.\d+\.\d+(-rc\.[\d.]+)?\b.*\btagged\b/i.test(words)) return make("release", card?.title ?? words.replace(/\s+/g, " ").trim().slice(0, 80));
  if (/\bmerged\b/i.test(words) && /(#\d+|\bPR\b|pull request)/i.test(words)) return make("merged", card?.title ?? words.replace(/\s+/g, " ").trim().slice(0, 80));
  if (card?.target === "task" && /\b(done|finished|complete[d]?)\b/i.test(words)) return make("task", card.title);
  if (m.pinned) return make("decision", words.replace(/\s+/g, " ").trim().slice(0, 80));
  return null;
}

export function jumpsOf(messages: readonly Message[]): Jump[] {
  const out: Jump[] = [];
  for (const m of messages) { const j = jumpOf(m); if (j) out.push(j); }
  return out;
}

/* ---------- what needs the person ---------- */

const ASKING = new Set(["plan", "install_plan", "access_request", "key_request", "redact_request", "chrome_held", "crew_result", "held", "approval"]);

/** Does this message wait on the person? An open question, a plan or request to answer, a card with buttons, or an @ of them. */
export function needsPerson(m: Pick<Message, "blocks" | "body">, mentionsMe: (m: Pick<Message, "body">) => boolean = () => false): boolean {
  for (const b of m.blocks) {
    const d = rec(b.data);
    if (b.type === "question") { if (d["answer"] === undefined || d["answer"] === null) return true; continue; }
    if (b.type === "plan") { if (d["state"] === "proposed") return true; continue; }
    if (b.type === "link_card") { if (Array.isArray(d["actions"]) && d["actions"].length > 0) return true; if (d["style"] === "question") return true; continue; }
    if (b.type === "crew_result") { if (d["state"] !== "merged") return true; continue; }
    if (ASKING.has(b.type)) return true;
  }
  return mentionsMe(m);
}

/** Quiet: nobody waits on it and a person need not read it to know where things stand. A person's own words, anything that needs them, a jump point, and an agent's longer answer are never quiet. */
export function isQuiet(m: Message, meId: string, mentionsMe: (m: Pick<Message, "body">) => boolean = () => false): boolean {
  if (m.author.kind === "person" && m.kind !== "system" && m.kind !== "quiet") return false;
  if (needsPerson(m, mentionsMe) || jumpOf(m) !== null) return false;
  if (m.author.id === meId && m.author.kind === "person") return false;
  if (m.kind === "system" || m.kind === "quiet") return true;
  return m.body.trim().length <= CHATTER;
}

/* ---------- the items a long session draws ---------- */

export type SessionItem =
  | Item
  | { kind: "hour"; key: string; label: string }
  | { kind: "jump"; key: string; messageId: string; label: string; sub: string; time: string }
  | { kind: "away"; key: string; items: Item[]; things: number; who: string; helpers: number; needs: number; span: string };

const messageOf = (it: SessionItem): Message | null => (it.kind === "event" || it.kind === "me" || it.kind === "other" ? it.message : null);

export interface SessionOptions {
  meId: string;
  clock: Clock;
  nameOf(id: string): string;
  /** The read cursor when the chat opened (chat.catch_up `since`): messages after it are new to the person. Null when unknown: nothing folds. */
  since: number | null;
  /** When the chat opened: only what arrived before it folds, so a message that lands while the person watches stays where it is. */
  openedAt: number;
  mentionsMe?(m: Pick<Message, "body">): boolean;
}

/** "9:40 to 11:46 PM", or "9:40 PM to 12:10 AM" when the two sides differ. */
function spanWords(a: number, b: number, c: Clock): string {
  const t = (ts: number): string => { const [h, m] = timeLabel(ts, c).split(":").map(Number) as [number, number]; return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}`; };
  const ap = (ts: number): string => (Number(timeLabel(ts, c).slice(0, 2)) < 12 ? "AM" : "PM");
  return ap(a) === ap(b) ? `${t(a)} to ${t(b)} ${ap(b)}` : `${t(a)} ${ap(a)} to ${t(b)} ${ap(b)}`;
}

/**
 * The timeline of a long session: quiet runs since the person last looked become one away row, an hour mark opens each new hour, and a jump row follows each moment worth coming back to. A chat that is not long,
 * or has nothing to add, comes back as it was.
 */
export function sessionItems(items: readonly Item[], messages: readonly Message[], o: SessionOptions): SessionItem[] {
  if (!isLong(messages)) return [...items];
  const mentions = o.mentionsMe ?? ((): boolean => false);
  const unseen = (m: Message): boolean => o.since !== null && m.threadSeq > o.since && m.createdAt < o.openedAt;
  // 1. fold quiet runs of unseen items
  const folded: SessionItem[] = [];
  let run: Item[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    if (run.length < AWAY_MIN) folded.push(...run);
    else {
      const ms = run.map((it) => messageOf(it)!);
      const agents = new Map<string, number>();
      for (const m of ms) if (m.author.kind === "agent") agents.set(m.author.id, (agents.get(m.author.id) ?? 0) + 1);
      const ranked = [...agents.entries()].sort((a, b) => b[1] - a[1]);
      const lead = ranked[0]?.[0];
      const things = ms.reduce((n, m) => n + 1 + (workOf(m)?.steps.length ?? 0), 0);
      folded.push({ kind: "away", key: `away-${ms[0]!.messageId}`, items: run, things, who: lead ? o.nameOf(lead) : "The Space", helpers: Math.max(0, ranked.length - 1), needs: 0, span: spanWords(ms[0]!.createdAt, ms[ms.length - 1]!.createdAt, o.clock) });
    }
    run = [];
  };
  for (const it of items) {
    const m = messageOf(it);
    if ((it.kind === "event" || it.kind === "other") && m && unseen(m) && isQuiet(m, o.meId, mentions)) { run.push(it); continue; }
    flush();
    folded.push(it);
  }
  flush();
  // the count of things that wait on the person goes on the first away row: the ones that stay visible are in the timeline right after it
  const waiting = messages.filter((m) => unseen(m) && needsPerson(m, mentions)).length;
  const first = folded.find((x): x is Extract<SessionItem, { kind: "away" }> => x.kind === "away");
  if (first) first.needs = waiting;
  // 2. hour marks and jump rows
  const out: SessionItem[] = [];
  let lastHour = "";
  for (const it of folded) {
    const m = it.kind === "away" ? messageOf(it.items[0]!) : it.kind === "day" ? null : messageOf(it);
    if (it.kind === "day") { out.push(it); lastHour = ""; continue; }
    if (m) {
      const hk = hourKey(m.createdAt, o.clock);
      if (hk !== lastHour) { out.push({ kind: "hour", key: `hour-${m.messageId}`, label: hourLabel(m.createdAt, o.clock) }); lastHour = hk; }
    }
    const jump = it.kind !== "away" && m ? jumpOf(m) : null;
    // an event that is itself the jump point becomes the jump row; any other message keeps its place and the row follows it
    if (jump && it.kind === "event") { out.push({ kind: "jump", key: `jump-${jump.messageId}`, messageId: jump.messageId, label: jump.label, sub: jump.sub, time: timeWords(jump.at, o.clock) }); continue; }
    out.push(it);
    if (jump) out.push({ kind: "jump", key: `jump-${jump.messageId}`, messageId: jump.messageId, label: jump.label, sub: jump.sub, time: timeWords(jump.at, o.clock) });
  }
  return out;
}

/** "Assistant and 3 helpers did 41 things, 2 need you". */
export function awayWords(a: Pick<Extract<SessionItem, { kind: "away" }>, "who" | "helpers" | "things" | "needs">): string {
  const who = a.helpers > 0 ? `${a.who} and ${a.helpers} ${a.helpers === 1 ? "helper" : "helpers"}` : a.who;
  return `${who} did ${a.things} ${a.things === 1 ? "thing" : "things"}${a.needs > 0 ? `, ${a.needs} ${a.needs === 1 ? "needs" : "need"} you` : ""}`;
}

/* ---------- the session Overview ---------- */

export interface Question { messageId: string; text: string }
export interface SessionSummary {
  /** The session is long: the right pane opens on its Overview. */
  long: boolean;
  /** What the person first asked for, in their words. The goal's own title wins where the chat has a goal. */
  firstAsk: string;
  jumps: Jump[];
  decisions: Jump[];
  questions: Question[];
  /** First and last message times, to say how long the session has run. */
  from: number;
  to: number;
}

export const NO_SESSION: SessionSummary = { long: false, firstAsk: "", jumps: [], decisions: [], questions: [], from: 0, to: 0 };

const oneLine = (s: string, max = 160): string => { const t = s.replace(/\s+/g, " ").trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };

/** Open questions: a question block nobody answered, and a plan nobody decided on. */
export function questionsOf(messages: readonly Message[]): Question[] {
  const out: Question[] = [];
  for (const m of messages) {
    for (const b of m.blocks) {
      const d = rec(b.data);
      if (b.type === "question" && (d["answer"] === undefined || d["answer"] === null) && text(d["prompt"]) !== "") out.push({ messageId: m.messageId, text: oneLine(text(d["prompt"])) });
      else if (b.type === "plan" && d["state"] === "proposed" && text(d["title"]) !== "") out.push({ messageId: m.messageId, text: `Approve the plan: ${oneLine(text(d["title"]), 120)}` });
    }
  }
  return out;
}

export function summaryOf(messages: readonly Message[], meId: string): SessionSummary {
  if (messages.length === 0) return NO_SESSION;
  const jumps = jumpsOf(messages);
  const first = messages.find((m) => m.author.kind === "person" && m.author.id === meId && m.body.trim() !== "");
  return {
    long: isLong(messages), firstAsk: first ? oneLine(first.body, 220) : "", jumps, decisions: jumps.filter((j) => j.kind === "decision"), questions: questionsOf(messages),
    from: messages.reduce((n, m) => Math.min(n, m.createdAt), Infinity), to: messages.reduce((n, m) => Math.max(n, m.createdAt), 0),
  };
}

/** "38% of 1M", from the window the engine resolved for the model. */
export function contextWords(ctx: { used: number; window: number; approximate?: boolean } | null | undefined): string {
  if (!ctx || !(ctx.window > 0)) return "";
  const pct = Math.round((Math.min(ctx.used, ctx.window) / ctx.window) * 100);
  const k = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : `${Math.round(n / 1000)}k`);
  return `${ctx.approximate ? "about " : ""}${pct}% of ${k(ctx.window)}`;
}

/** "4 h 41 min": how long the session has run. */
export function ranWords(from: number, to: number): string {
  const mins = Math.max(0, Math.round((to - from) / 60_000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
