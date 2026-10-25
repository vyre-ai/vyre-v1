// The conversation's logic, with no renderer (spec 3.2 Chats, 2.5 Chat, 4.13 Agents lead and listen): which messages are on the page (the last 50, older ones stream in),
// how they group into a timeline, how an agent's work folds into "Worked for 14s, 3 steps", who leads and who listens, what a send does while an agent works (queue it, or
// interrupt), and the optimistic message that shows in the same frame as the send.
import type { CapMap } from "../../../../../../generated/types.ts";
import { BLOCK_FALLBACKS, isNativeBlockType } from "../../../../../../ui/src/blocks/registry.ts";
import { applyFallback } from "../../../../../../ui/src/blocks/GenericBlock.tsx";
import { createIncrementalMarkdown } from "../../../../../../ui/src/stream/markdown.ts";
import type { Block as MdBlock } from "../../../../../../ui/src/stream/markdown.ts";
import { route } from "../../../../../../lib/route.ts";

export type Thread = CapMap["threads.get"]["out"]["thread"];
export type Message = CapMap["chat.messages.list"]["out"]["messages"][number];
export type MessageBlock = Message["blocks"][number];
export type ThreadAgent = Thread["agents"][number];
export type Helper = CapMap["chat.helpers.list"]["out"]["helpers"][number];
export type AgentMode = ThreadAgent["mode"];

export interface Clock { now: number; offsetMin: number }

/** Resume any chat: the last 50 messages paint first, older ones stream in as the person scrolls up (V1-SPEC speed budgets). */
export const WINDOW = 50;

/* ---------- which messages are on the page ---------- */

export function byOrder(messages: readonly Message[]): Message[] {
  return messages.slice().sort((a, b) => a.threadSeq - b.threadSeq);
}

export interface Windowed {
  rows: Message[];
  /** Messages the kept copy has that are not mounted. */
  hiddenLocal: number;
}

/** The last `shown` messages in order. `shown` grows by WINDOW each time the person asks for earlier ones. */
export function lastMessages(all: readonly Message[], shown: number): Windowed {
  const ordered = byOrder(all);
  const n = Math.max(1, shown);
  const rows = ordered.length > n ? ordered.slice(ordered.length - n) : ordered;
  return { rows, hiddenLocal: ordered.length - rows.length };
}

/** Merges an older page into what is already kept, dropping repeats (a message that arrived live and again in the page). */
export function mergePages(newer: readonly Message[], older: readonly Message[]): Message[] {
  const seen = new Set(newer.map((m) => m.messageId));
  return byOrder([...older.filter((m) => !seen.has(m.messageId)), ...newer]);
}

/** The cursor for the next older page: the oldest sequence number held. */
export function beforeCursor(all: readonly Message[]): number | null {
  let min = Number.POSITIVE_INFINITY;
  for (const m of all) if (m.threadSeq < min) min = m.threadSeq;
  return Number.isFinite(min) ? min : null;
}

/* ---------- time ---------- */

const DAY = 86_400_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const local = (ts: number, c: Clock): number => ts + c.offsetMin * 60_000;
const dayNumber = (ts: number, c: Clock): number => Math.floor(local(ts, c) / DAY);

export function timeLabel(ts: number, c: Clock): string {
  const d = new Date(local(ts, c));
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

export function dayLabel(ts: number, c: Clock): string {
  const diff = dayNumber(c.now, c) - dayNumber(ts, c);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  const d = new Date(local(ts, c));
  if (diff < 7) return WEEKDAYS[d.getUTCDay()] ?? "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] ?? ""}`;
}

export function dayKey(ts: number, c: Clock): string {
  return `d${dayNumber(ts, c)}`;
}

/* ---------- blocks: the work fold, cards and errors ---------- */

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const dataOf = (b: MessageBlock): Record<string, unknown> => (isRec(b.data) ? b.data : {});

/** A step of an agent's work (a tool call, a page opened, a record read). They fold into one line. */
export const isStep = (b: MessageBlock): boolean => b.type === "step";
/** The shared error shape (V1-SPEC 4.18): what, why, next, trace id. */
export const isErrorBlock = (b: MessageBlock): boolean => b.type === "error";
/** Everything else is a native card: terminal, changeset, question, plan, deploy, file, and so on. */
export const isCard = (b: MessageBlock): boolean => !isStep(b) && !isErrorBlock(b);

export interface StepLine { id: string; title: string; sub: string; state: MessageBlock["state"] }

export function stepLine(b: MessageBlock): StepLine {
  const d = dataOf(b);
  return { id: b.id, title: str(d.title) || b.type.replaceAll("_", " "), sub: str(d.sub), state: b.state };
}

export interface Work { steps: StepLine[]; secs: number; live: boolean; summary: string; now: string }

/** "Worked for 14s, 3 steps" once done; "Working, 2 steps so far" while a step is live. */
export function workOf(m: Message): Work | null {
  const steps = m.blocks.filter(isStep);
  if (steps.length === 0) return null;
  const lines = steps.map(stepLine);
  const live = lines.some((l) => l.state === "live");
  const secs = steps.reduce((n, b) => n + num(dataOf(b).secs), 0);
  const n = lines.length;
  const count = `${n} ${n === 1 ? "step" : "steps"}`;
  const summary = live ? `Working, ${count} so far` : secs > 0 ? `Worked for ${secs}s, ${count}` : `Worked ${count}`;
  const current = [...lines].reverse().find((l) => l.state === "live");
  return { steps: lines, secs, live, summary, now: current ? current.title : "" };
}

export interface CardLine { id: string; type: string; v: number; title: string; sub: string; state: MessageBlock["state"]; data: Record<string, unknown> }

/** A card's title reads from the registry's fallback for a known type and from its own title for any other (a newer version of a known type too). */
export function cardLine(b: MessageBlock): CardLine {
  const d = dataOf(b);
  const fromTemplate = isNativeBlockType(b.type) ? applyFallback(BLOCK_FALLBACKS[b.type], b.data) : "";
  return { id: b.id, type: b.type, v: b.v, title: str(d.title) || fromTemplate || str(d.caption) || b.type.replaceAll("_", " "), sub: str(d.sub), state: b.state, data: d };
}

export interface QuestionOption { id: string; label: string }

/** The options of a question card: single or multi choice, or free text when there are none. */
export function questionOptions(d: Record<string, unknown>): QuestionOption[] {
  const raw = d.options;
  if (!Array.isArray(raw)) return [];
  return raw.map((o, i) => (isRec(o) ? { id: str(o.id) || String(i), label: str(o.label) || str(o.id) } : { id: String(o), label: String(o) })).filter((o) => o.label !== "");
}

export interface PlanStep { id: string; text: string; done: boolean }

export function planSteps(d: Record<string, unknown>): PlanStep[] {
  const raw = d.steps;
  if (!Array.isArray(raw)) return [];
  return raw.map((s, i) => (isRec(s) ? { id: str(s.id) || String(i), text: str(s.text), done: s.done === true } : { id: String(i), text: String(s), done: false }));
}

export interface ErrorRow { code: string; message: string; cause: string; next: { key: string; label: string }[]; retryable: boolean; traceId: string; turnId: string; steps: [string, string][] }

/** The inline error row: what, why, next, Copy trace id, and "What happened?" (steps, durations, machine, model, key used, denials). */
export function errorRow(b: MessageBlock): ErrorRow {
  const d = dataOf(b);
  const next = Array.isArray(d.next) ? d.next.map((n) => (Array.isArray(n) ? { key: str(n[0]), label: str(n[1]) } : isRec(n) ? { key: str(n.key), label: str(n.label) } : { key: "", label: "" })).filter((n) => n.label !== "") : [];
  const steps = Array.isArray(d.steps) ? d.steps.filter((s): s is unknown[] => Array.isArray(s)).map((s): [string, string] => [str(s[0]), str(s[1])]) : [];
  return { code: str(d.code), message: str(d.message) || "Something went wrong", cause: str(d.cause), next, retryable: d.retryable === true, traceId: str(d.traceId) || b.traceId, turnId: str(d.turnId), steps };
}

/** What the report sheet is told about the error row it was opened from: the message and its trace id, so the report reaches the owner with the trace. */
export function reportLabel(message: string, traceId: string): string {
  return traceId === "" ? message : `${message} (trace ${traceId})`;
}

/* ---------- markdown for a message that is not streaming ---------- */

const mdCache = new Map<string, readonly MdBlock[]>();

/** The blocks of a finished body, parsed once per message text. */
export function bodyBlocks(messageId: string, body: string): readonly MdBlock[] {
  const key = `${messageId}\u0000${body.length}\u0000${body.slice(0, 64)}`;
  const hit = mdCache.get(key);
  if (hit) return hit;
  const md = createIncrementalMarkdown();
  md.append(body);
  md.finish();
  const blocks = md.view().blocks;
  if (mdCache.size > 2000) mdCache.clear();
  mdCache.set(key, blocks);
  return blocks;
}

/* ---------- the timeline ---------- */

export type Who = { id: string; name: string; kind: "person" | "agent" };

export interface TimelineCtx {
  meId: string;
  nameOf(id: string): string;
  kindOf(id: string): "person" | "agent";
  clock: Clock;
}

export type Item =
  | { kind: "day"; key: string; label: string }
  | { kind: "event"; key: string; message: Message; text: string; time: string }
  | { kind: "me"; key: string; message: Message; time: string; newgroup: boolean }
  | { kind: "other"; key: string; message: Message; who: Who; time: string; newgroup: boolean };

/** System and quiet messages are one-line events ("Switched to Codex, picked up from the summary and the last 20 turns"). */
export const isEvent = (m: Message): boolean => m.kind === "system" || m.kind === "quiet";

/** Day separators, then each message: a line for an event, a bubble for yours, a header-and-body for anyone else. A header shows when the author changes. */
export function timeline(messages: readonly Message[], ctx: TimelineCtx): Item[] {
  const out: Item[] = [];
  let lastDay = "";
  let prev: Message | null = null;
  for (const m of messages) {
    const dk = dayKey(m.createdAt, ctx.clock);
    if (dk !== lastDay) {
      out.push({ kind: "day", key: dk, label: dayLabel(m.createdAt, ctx.clock) });
      lastDay = dk;
      prev = null;
    }
    const time = timeLabel(m.createdAt, ctx.clock);
    if (isEvent(m)) {
      out.push({ kind: "event", key: m.messageId, message: m, text: m.body, time });
      prev = null;
      continue;
    }
    const newgroup = prev === null || prev.author.id !== m.author.id || prev.author.kind !== m.author.kind;
    if (m.author.id === ctx.meId && m.author.kind === "person") out.push({ kind: "me", key: m.messageId, message: m, time, newgroup });
    else out.push({ kind: "other", key: m.messageId, message: m, who: { id: m.author.id, name: ctx.nameOf(m.author.id), kind: ctx.kindOf(m.author.id) }, time, newgroup });
    prev = m;
  }
  return out;
}

/* ---------- who works, who leads ---------- */

/** Agents that have a live step, or a message still being written (`writing` holds those message ids): the ones the Stop buttons act on. */
export function workingAgents(messages: readonly Message[], writing: ReadonlySet<string> = new Set()): string[] {
  const ids = new Set<string>();
  for (const m of messages) if (m.author.kind === "agent" && (writing.has(m.messageId) || m.blocks.some((b) => b.state === "live"))) ids.add(m.author.id);
  return [...ids];
}

export const leadOf = (t: Thread): ThreadAgent | undefined => t.agents.find((a) => a.mode === "lead");

export interface Face { agentId: string; name: string; mode: AgentMode; watches: boolean; working: boolean; model: string }

/** The faces in the thread header, lead first, each with its mode mark. */
export function faces(t: Thread, nameOf: (id: string) => string, working: readonly string[]): Face[] {
  const list = t.agents.map((a) => ({ agentId: a.agentId, name: nameOf(a.agentId), mode: a.mode, watches: a.watches === true, working: working.includes(a.agentId), model: a.model ?? "" }));
  return list.sort((a, b) => (a.mode === b.mode ? 0 : a.mode === "lead" ? -1 : 1));
}

export function modeTitle(f: Face): string {
  return `${f.name} ${f.mode === "lead" ? "leads: replies to every message" : "is listening: replies when @mentioned"}`;
}

/** Making another agent the lead asks first: one lead per thread, and the old lead keeps listening. */
export function swapNeeded(t: Thread, agentId: string): ThreadAgent | null {
  const lead = leadOf(t);
  return lead && lead.agentId !== agentId ? lead : null;
}

export interface Strip { text: string; tone: "live" | "quiet" }

/** The title for the header: the thread's own title, else the agent or person you talk with. */
export function titleOf(t: Thread, nameOf: (id: string) => string): string {
  if (t.title) return t.title;
  const first = t.agents[0];
  return first ? nameOf(first.agentId) : "Chat";
}

/** The label of the stop control: one agent working, its name; more than one, Stop all. */
export function stopLabel(working: readonly string[], nameOf: (id: string) => string): string {
  if (working.length === 0) return "";
  return working.length === 1 ? `Stop ${nameOf(working[0] ?? "")}` : "Stop all";
}

/* ---------- sending ---------- */

export interface Candidate { id: string; name: string; kind: "person" | "agent" }

/** The people and agents @mentioned in the text, by the first word of their name, as the composer line counts them. */
export function mentionsIn(text: string, candidates: readonly Candidate[]): { kind: "person" | "agent"; id: string }[] {
  const found: { at: number; kind: "person" | "agent"; id: string }[] = [];
  for (const c of candidates) {
    const first = (c.name.trim().split(/\s+/)[0] ?? c.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`(^|[^\\w])@${first}(?![\\p{L}\\p{N}_])`, "iu").exec(text);
    if (m) found.push({ at: m.index + m[0].length, kind: c.kind, id: c.id });
  }
  return found.sort((a, b) => a.at - b.at).map(({ kind, id }) => ({ kind, id }));
}

/** The agents that will answer a message, from the same function the engine uses (lib/route.ts), so the line under the field never disagrees. */
export function respondersFor(t: Thread, mentions: readonly { kind: "person" | "agent"; id: string }[], meId: string): string[] {
  return route({ agents: t.agents.map((a) => ({ id: a.agentId, mode: a.mode })) }, { author: { kind: "person", id: meId }, mentions }).responders;
}

export type SendKind = "queue" | "interrupt";

/** A plain send while an agent works queues for its next step; Interrupt sends it now. With nothing running both are an ordinary send. */
export function sendKind(mode: SendKind, working: boolean): SendKind {
  return working ? mode : "queue";
}

export interface Pending {
  /** Idempotency key of the post; also the key of the row until the server's message replaces it. */
  key: string;
  body: string;
  at: number;
  state: "sending" | "failed";
  /** Filled when chat.post answers; the row hides once the live list carries this message. */
  messageId?: string;
  kind: SendKind;
  mentions: { kind: "person" | "agent"; id: string }[];
  /** Whether an agent was working when it was sent: an interrupt only means something then. */
  working: boolean;
}

export function pendingMessage(p: Pending, meId: string, threadId: string, seq: number): Message {
  return {
    messageId: `pending:${p.key}`, threadId, threadSeq: seq, author: { kind: "person", id: meId }, kind: "text", body: p.body, blocks: [], depth: 0, attachments: [], reactions: [], pinned: false, createdAt: p.at,
  };
}

/** Pending rows to show: those the live list does not carry yet. */
export function stillPending(pending: readonly Pending[], live: readonly Message[]): Pending[] {
  const have = new Set(live.map((m) => m.messageId));
  return pending.filter((p) => p.messageId === undefined || !have.has(p.messageId));
}

/** Queued messages: yours that came after the newest agent step and wait for the agent's next turn. */
export function queuedCount(messages: readonly Message[], meId: string, working: boolean): number {
  if (!working) return 0;
  let n = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) break;
    if (m.author.kind === "person" && m.author.id === meId) n++;
    else if (m.author.kind === "agent") break;
  }
  return n;
}

/** The post for a send: mentions, a retry-safe key, the composer's folder and links. */
export function postInput(threadId: string, body: string, mentions: readonly { kind: "person" | "agent"; id: string }[], key: string, replyTo?: string): CapMap["chat.post"]["in"] {
  return { threadId, body, idempotencyKey: key, ...(mentions.length > 0 ? { mentions: mentions.map((x) => ({ kind: x.kind, id: x.id })) } : {}), ...(replyTo ? { replyTo } : {}) };
}

/** The line under the header while a send waits for the agent's next step. */
export function queueNote(n: number, leadName: string): string {
  if (n <= 0) return "";
  return `${n} ${n === 1 ? "message" : "messages"} queued for ${leadName || "the agent"}'s next step`;
}

/* ---------- the composer line ---------- */

/** What the composer says when nothing is typed: the lead, or that nobody will answer. */
export function whoLine(t: Thread, nameOf: (id: string) => string): string {
  const lead = leadOf(t);
  return lead ? `${nameOf(lead.agentId)} will reply` : "No agent will reply · type @ to ask one";
}

export function placeholderFor(t: Thread, nameOf: (id: string) => string, working = false): string {
  const lead = leadOf(t);
  if (lead && working) return `Queue a message for when ${nameOf(lead.agentId)} finishes…`;
  if (lead) return `Message ${nameOf(lead.agentId)}…`;
  return t.kind === "channel" ? `Message ${titleOf(t, nameOf)}…` : "Message…";
}

/** The model as people say it: "opus" is Opus. Unknown ids print as they are, capitalised. */
export function modelLabel(model: string): string {
  if (model === "") return "Model";
  return model.charAt(0).toUpperCase() + model.slice(1);
}

/** Find in chat: ids of the messages whose text contains the query, oldest first. Case and accents are ignored. */
export function findMatches(messages: readonly Message[], query: string): string[] {
  const q = fold(query.trim());
  if (q === "") return [];
  return collect(messages.filter((m) => !isEvent(m) && fold(m.body).includes(q)), (m) => m.messageId);
}

const fold = (s: string): string => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** "2 of 5" while stepping through matches, "No matches" when there are none. */
export function matchLine(n: number, at: number, query: string): string {
  if (query.trim() === "") return "";
  return n === 0 ? "No matches" : `${at + 1} of ${n}`;
}

export interface Participant { id: string; name: string; kind: "person" | "agent"; role: string }

/** Everyone in the thread for the participants menu: people first, then agents with their mode. */
export function participants(t: Thread, nameOf: (id: string) => string): Participant[] {
  const out: Participant[] = [];
  for (const m of t.members) {
    if (m.kind === "person") out.push({ id: m.id, name: nameOf(m.id), kind: "person", role: "Person" });
  }
  for (const a of t.agents) out.push({ id: a.agentId, name: nameOf(a.agentId), kind: "agent", role: a.mode === "lead" ? "Leads" : "Listening" });
  return out;
}

/** A thread that has closed takes no messages until it is reopened. */
export const isClosed = (t: Thread): boolean => t.closedAt !== undefined;

/** An agent's work thread shows a quiet line saying whose it is. */
export function threadKindNote(t: Thread, nameOf: (id: string) => string): string {
  if (t.kind === "helper") return "Helper chat";
  if (t.kind === "ask") return "Ask pane";
  const starter = t.starter ? nameOf(t.starter) : "";
  return t.kind === "thread" && starter ? `Thread started by ${starter}` : "";
}

/* ---------- the chat-open budget ---------- */

/** The budget: the last 50 messages of a resumed chat, rendered and laid out, in milliseconds (V1-SPEC speed budgets, chat_open). */
export const CHAT_OPEN_BUDGET_MS = 100;
/** Runs that count: one warm-up run is discarded before them (ruling 43). */
export const OPEN_RUNS = 5;

export interface OpenResult { runs: number[]; median: number; worst: number; budget: number; ok: boolean; messages: number }

/** Median of the counted runs, the worst run, and whether the median is inside the budget with exactly the last 50 messages on the page. */
export function summarizeOpen(runs: readonly number[], messages: number, budget = CHAT_OPEN_BUDGET_MS): OpenResult {
  const sorted = [...runs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
  const worst = sorted[sorted.length - 1] ?? Number.POSITIVE_INFINITY;
  return { runs: [...runs], median, worst, budget, ok: messages === WINDOW && sorted.length >= OPEN_RUNS && median < budget, messages };
}

/** What the probe line says: ok, over the budget, or not the last 50 rows (a wrong count is never reported as a slow open). */
export function openVerdict(r: OpenResult): string {
  if (r.messages !== WINDOW) return `WRONG ROW COUNT (${r.messages} of ${WINDOW})`;
  if (r.runs.length < OPEN_RUNS) return `TOO FEW RUNS (${r.runs.length} of ${OPEN_RUNS})`;
  return r.median < r.budget ? "ok" : "OVER BUDGET";
}

/** Builds a list from a list. Written as a function (not `.map`) so a list of JSX is plainly the composition of its parts. */
export function collect<T, U>(list: readonly T[], fn: (item: T, index: number) => U): U[] {
  const out: U[] = [];
  for (const [i, x] of list.entries()) out.push(fn(x, i));
  return out;
}
