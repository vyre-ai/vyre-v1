// Learning after every turn (owner ruling 3 Nov 2026): when a turn completes, the engine hands the chat to memory.capture with reason "turn" and the account the turn ran on, in the background, so
// the reply never waits for it. The pass reads what the asker said since their last pass and, for each thing worth keeping, decides against the person's related facts: add, update (the old
// fact is closed with an end date and the new one replaces it, so its history keeps the old version), close (no longer true) or ignore, the way Mem0 and Supermemory decide at write time.
// Every fact links to the chat line it came from.
// Who pays: the asker's own account that ran the turn, on the cheapest model it offers (learn-model.ts). A turn paid by someone else's account learns by rules; the Space AI key pays only
// because the turn itself ran on it. Each person has a daily quota (learn-quota.ts) that a pass never crosses; at the quota, when the provider says slow down, or with no model to call, the pass
// uses the free rules (heuristicExtract) instead, silently.
// Privacy: in a chat with other people only the asker's own lines are read, and only what they say about themselves is kept, in their own private layer; other people's words are never
// stored in someone's private memory. A chat with "Don't remember this chat" on teaches nothing, by model or by rules.
// DECISION: two seams stay open for sibling lanes. Where a learned fact lands (lane l-profile: the person's Private profile) is `target`; what a fact learned in a shared chat carries about its
//   audience (lane l-chatleaks) is `audience`. Sealing to the person's key (lane l-memkeys) is insertFact's own (sealText), so it applies here unchanged.
import { IMPORTED_PREAMBLE } from "../../../lib/recall-intent.ts";
import { emitAccepted, emitLearned, emitProposed, insertFact, normal } from "../factcore.ts";
import { cheapestModel } from "../learn-model.ts";
import { HOWS, correctionOf, groundedIn, lessonsOn, writeLesson } from "../lessons.ts";
import type { How } from "../lessons.ts";
import type { ListedModel } from "../learn-model.ts";
import {
  accountFailed, accountOf, accountServed, capsOf, chatForgotten, countRulePass, cursorOf, isLimitError, learnTables, localDay, MODEL_TTL_MS, moveCursor, rememberModel, reservationFor, reserve,
  settle, timezoneOf, usageOf,
} from "../learn-quota.ts";
import { trail, whoIs } from "../trail.ts";
import type { Who } from "../trail.ts";
import { actorOf, autoMergeKinds, bm25, ensure, mintId, num, raise, readFact, rowsOf } from "../projections.ts";
import type { Fact, FactStatus, Layer, MemCtx, SourceKind } from "../projections.ts";
import { heuristicExtract } from "./facts.ts";
import { kindOf, placeOf, privateIntent } from "../place.ts";
import type { Place } from "../place.ts";
import { postNoted, writeSharedWith } from "../shared.ts";
import { chatAudience } from "../../../lib/audience.ts";
import type { Audience } from "../../../lib/audience.ts";
import type { CaptureMessage } from "./facts.ts";

// ---- seams for the sibling lanes

export interface LearnTarget { layer: Layer; ownerRef: string; agentId: string | null; projectId: string | null }
export interface LearnSeams {
  /** Where a fact learned about the asker lands. Default: their own person layer, kept by the agent that learned it. */
  target(i: { asker: string; agentId: string | null; threadId: string }): LearnTarget;
  /** Links a fact learned in a chat carries about who heard it said. Default: in a shared chat, the chat it was said in. */
  audience(i: { threadId: string; shared: boolean; people: string[] }): Array<[string, string]>;
}
const DEFAULT_SEAMS: LearnSeams = {
  target: ({ asker, agentId }) => ({ layer: "person", ownerRef: asker, agentId, projectId: null }),
  audience: ({ threadId, shared }) => (shared ? [["heard_in", threadId]] : []),
};
let seams: LearnSeams = DEFAULT_SEAMS;
/** A sibling lane binds its own target or audience rule here; null puts the defaults back. */
export function setLearnSeams(s: Partial<LearnSeams> | null): void { seams = s ? { ...DEFAULT_SEAMS, ...s } : DEFAULT_SEAMS; }

// ---- the one hook: may memory learn from this chat?

/** The chat fields shouldLearn reads: the thread setting `memory.off` (lane l-decisions' composer switch sets it, at the top of the thread or under its settings). */
export interface LearnThread { "memory.off"?: unknown; settings?: Record<string, unknown> | null }
/**
 * "Don't remember this chat" (owner decision D11): false when the thread setting `memory.off` is true, or when memory's own switch (memory.chat_learning.set) is off.
 * Every learning path asks this first, the pass after a turn and capture at chat end, and when it says no nothing is read and nothing is written.
 */
export function shouldLearn(ctx: Pick<MemCtx, "db">, threadId: string, thread?: LearnThread | null): boolean {
  if (thread?.["memory.off"] === true || thread?.settings?.["memory.off"] === true) return false;
  return !chatForgotten(ctx, threadId).off;
}

// ---- the model pass

export interface TurnAccount { ref: string; driver: string; kind?: string; payer?: string; spaceKey?: boolean }
export interface LearnIn { threadId: string; reason: "turn"; turnId?: string; agentId?: string; account?: TurnAccount }
export interface LearnOut {
  proposed: number; merged: number; updated?: number; closed?: number; via?: "model" | "rules" | "none"; skipped?: "forgotten" | "off" | "nothing_new";
}

export const LEARN_KINDS: ReadonlySet<string> = new Set(["preference", "profile", "decision", "deadline", "relationship", "note"]);
/** In a chat with other people, the rules keep only what a person says about themselves ("I prefer", "my X is"): decisions, deadlines and notes there are the group's, not theirs. */
const SELF_KINDS: ReadonlySet<string> = new Set(["preference", "profile"]);
const MAX_LINE_CHARS = 1_200;
const MAX_PROMPT_LINES_CHARS = 8_000;
const RELATED_MATCHED = 12;
const RELATED_TOTAL = 20;

export const LEARN_SYSTEM = "You keep one person's private memory. You are given what we already know about them (id: fact) and the lines of a chat since you last looked. " +
  "Decide what is worth remembering for later chats: who they are, how they like work done, the people, clients, dates and decisions they deal with. " +
  "Answer with one JSON object and nothing else: {\"ops\":[...]}. Each op is one of: " +
  "{\"op\":\"add\",\"line\":N,\"text\":a short fact that reads well on its own,\"kind\":\"preference\"|\"profile\"|\"decision\"|\"deadline\"|\"relationship\"|\"note\"}; " +
  "{\"op\":\"update\",\"id\":a known id,\"line\":N,\"text\":the fact as it is now} when a line changes something we know; " +
  "{\"op\":\"close\",\"id\":a known id,\"line\":N} when a line says something we know is no longer true. " +
  "Learn only from lines marked You; N is that line's number. Skip questions, small talk, one-off requests and anything you are unsure of. Use only ids you were given. " +
  "When nothing is worth keeping answer {\"ops\":[]}.";

/** What a pass is also told when the person keeps lessons (setting memory.lessons): a line that corrects the agent becomes a short rule for next time. */
export const LESSON_SYSTEM = " When a You line corrects what the Agent just did (it edits or rewrites the Agent's draft, says no, undoes or refuses something, asks for it another way), also add " +
  "{\"op\":\"lesson\",\"line\":N,\"text\":the rule the Agent should follow next time, one short sentence using only words from the chat,\"how\":\"edit\"|\"refuse\"|\"reverse\"|\"rewrite\"}. " +
  "A lesson is about how the Agent should work for this person, never a fact about someone else.";

export interface LearnOp { op: "add" | "update" | "close" | "lesson"; line: number; text?: string; kind?: string; id?: string; how?: How }
/** The ops in a model's answer: the first JSON object in the text, each op checked for the fields it needs. Anything else is dropped. */
export function parseOps(text: string): LearnOp[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let obj: unknown;
  try { obj = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  const list = (obj as { ops?: unknown }).ops;
  if (!Array.isArray(list)) return [];
  const out: LearnOp[] = [];
  for (const o of list as Array<Record<string, unknown>>) {
    const line = typeof o["line"] === "number" ? o["line"] : Number(o["line"]);
    if (!Number.isInteger(line)) continue;
    const words = typeof o["text"] === "string" ? o["text"].trim() : "";
    const id = typeof o["id"] === "string" ? o["id"] : "";
    const kind = typeof o["kind"] === "string" && LEARN_KINDS.has(o["kind"]) ? o["kind"] : "note";
    if (o["op"] === "add" && words.length >= 3) out.push({ op: "add", line, text: words.slice(0, 300), kind });
    else if (o["op"] === "update" && id !== "" && words.length >= 3) out.push({ op: "update", line, id, text: words.slice(0, 300) });
    else if (o["op"] === "close" && id !== "") out.push({ op: "close", line, id });
    else if (o["op"] === "lesson" && words.length >= 8) out.push({ op: "lesson", line, text: words.slice(0, 200), how: typeof o["how"] === "string" && HOWS.has(o["how"]) ? (o["how"] as How) : "rewrite" });
  }
  return out;
}

interface Line { n: number; mine: boolean; m: CaptureMessage & { threadSeq?: number } }

export function promptOf(i: { today: string; shared: boolean; known: Fact[]; lines: Line[] }): string {
  const out = [`Today is ${i.today}.`];
  if (i.shared) out.push("Other people are in this chat. Keep only what this person says about themselves, never a fact about anyone else in the chat.");
  out.push("", "What we already know:");
  if (i.known.length === 0) out.push("(nothing yet)");
  for (const f of i.known) out.push(`- ${f.id}: ${f.text.replace(/\s+/g, " ")}`);
  out.push("", "The chat since you last looked:");
  for (const l of i.lines) out.push(`[${l.n}] ${l.mine ? "You" : "Agent"}: ${l.m.body.replace(/\s+/g, " ").slice(0, MAX_LINE_CHARS)}`);
  return out.join("\n");
}

const ACKS = /^(?:ok(?:ay)?|k|thanks?|thank you|thx|ty|yes|yep|yeah|no|nope|sure|great|cool|nice|done|perfect|good|fine|got it|sounds good|lgtm|please|go ahead|do it)[\s.!]*$/i;
const worthAPass = (lines: Line[]): boolean => lines.some((l) => l.mine && l.m.body.trim().length >= 12 && !ACKS.test(l.m.body.trim()));
/** A body that is still an envelope (modules/chat/handlers/private.ts) cannot be read here. */
const sealedBody = (m: CaptureMessage): boolean => Boolean(m.enc) && /^enc2\.\d+\./.test(m.body);

type CaptureMode = "auto" | "propose" | "auto_low_risk" | "off";
export async function modeOf(ctx: MemCtx, agentId: string | null): Promise<CaptureMode | null> {
  if (!agentId) return null;
  try {
    const m = ((await ctx.call("agents.get", { agentId })) as { agent?: { captureMode?: string } }).agent?.captureMode;
    return m === "off" || m === "propose" || m === "auto_low_risk" || m === "auto" ? m : null;
  } catch { return null; }
}

interface ThreadIn extends LearnThread { kind?: string; agents?: Array<{ agentId: string; mode: string }>; members?: Array<{ kind?: string; id?: string }> }

/**
 * The model this account learns with: the one remembered for it, else the cheapest on its saved list. The list is read passively (probe: false): a learning pass never asks the vendor,
 * so it can never mark the account failing for the person's next turn. A list that cannot be read is asked again in an hour.
 */
async function modelFor(ctx: MemCtx, acct: TurnAccount, now: number): Promise<string | null> {
  const known = accountOf(ctx, acct.ref);
  if (known.model !== null && now - known.modelAt < (known.model === "-" ? MODEL_TTL_MS / 12 : MODEL_TTL_MS)) return known.model === "-" ? null : known.model;
  let listed: ListedModel[] = [];
  try { listed = ((await ctx.call("engine.models.list", { accountRef: acct.ref, probe: false })) as { models?: ListedModel[] }).models ?? []; } catch { listed = []; }
  const pick = cheapestModel(acct.driver, listed);
  rememberModel(ctx, acct.ref, pick ?? "-", now);
  return pick;
}

interface Tally { proposed: number; merged: number; updated: number; closed: number }

export async function learnTurn(ctx: MemCtx, input: LearnIn): Promise<LearnOut> {
  ensure(ctx.db);
  learnTables(ctx.db);
  const none = (skipped?: LearnOut["skipped"]): LearnOut => ({ proposed: 0, merged: 0, via: "none", ...(skipped ? { skipped } : {}) });
  // only a person learns about themselves: the engine hands the chat over as the person whose turn it was
  if (ctx.principal.kind !== "person") raise(ctx, "permission.no_grant", "Learning runs for the person whose turn it was.");
  const asker = actorOf(ctx);
  if (!shouldLearn(ctx, input.threadId)) return none("forgotten");
  const t = ((await ctx.call("threads.get", { threadId: input.threadId })) as { thread?: ThreadIn }).thread ?? {};
  if (!shouldLearn(ctx, input.threadId, t)) return none("forgotten");
  if (t.kind === "run") return none("off");   // a routine's run: nothing a person said
  const agentId = input.agentId ?? (t.agents?.find((a) => a.mode === "lead") ?? t.agents?.[0])?.agentId ?? null;
  const mode = await modeOf(ctx, agentId);
  if (mode === "off") return none("off");
  const people = [...new Set((t.members ?? []).filter((m) => m.kind === "person" && m.id).map((m) => m.id as string))];
  const shared = t.kind === "channel" || t.kind === "thread" || people.filter((p) => p !== asker).length > 0;

  // what is new since this person's last pass; the cursor moves before any slow step, so two passes that end together never read the same lines
  const from = cursorOf(ctx, input.threadId, asker);
  const page = (await ctx.call("chat.messages.list", { threadId: input.threadId, ...(from >= 0 ? { after: from } : {}), limit: 200 })) as { messages: Array<CaptureMessage & { threadSeq?: number }> };
  const seen = cursorOf(ctx, input.threadId, asker);   // read again: a pass that ended meanwhile may have taken some of these
  const fresh = page.messages.filter((m) => num(m.threadSeq) > seen).sort((a, b) => num(a.threadSeq) - num(b.threadSeq));
  if (fresh.length === 0) return none("nothing_new");
  moveCursor(ctx, input.threadId, asker, Math.max(...fresh.map((m) => num(m.threadSeq))));
  const lines: Line[] = [];
  let chars = 0;
  for (const m of fresh) {
    if (sealedBody(m) || IMPORTED_PREAMBLE.test(String(m.body ?? ""))) continue;
    // a system or quiet line (a "Noted" line, a card) is the product talking, even when it is posted under a person's name
    if ((m as { kind?: string }).kind === "system" || (m as { kind?: string }).kind === "quiet") continue;
    const mine = m.author.kind === "person" && m.author.id === asker;
    // other people's lines never reach the pass: what they said is not this person's to keep
    if (!mine && m.author.kind !== "agent") continue;
    if (chars > MAX_PROMPT_LINES_CHARS) break;
    chars += Math.min(m.body.length, MAX_LINE_CHARS);
    lines.push({ n: lines.length + 1, mine, m });
  }
  if (!worthAPass(lines)) return none("nothing_new");
  const mineOnly = lines.filter((l) => l.mine).map((l) => l.m);

  const kinds = mode === "propose" ? [] : await autoMergeKinds(ctx);
  const statusFor = (kind: string): FactStatus => (mode === "auto" || kinds.includes(kind) ? "current" : "proposed");
  // rule 8: what a person says in a place other people read is that place's memory, not their private one; their own one-to-one chats stay private
  const place = shared && agentId ? await placeOf(ctx, input.threadId) : null;
  const heard = place ? await chatAudience((cap, i) => ctx.call(cap, i), input.threadId) : null;
  const target = place && agentId ? { layer: "agent" as const, ownerRef: agentId, agentId, projectId: null } : seams.target({ asker, agentId, threadId: input.threadId });
  const audience = seams.audience({ threadId: input.threadId, shared, people });
  const who: Who = agentId ? { actor: agentId, kind: "agent" } : whoIs(ctx);
  const sourceKind: SourceKind = t.kind === "channel" ? "channel" : "chat";
  const known = liveFacts(ctx, target);
  const keepLessons = await lessonsOn(ctx);
  const w: Writer = { ctx, threadId: input.threadId, target, audience, who, sourceKind, statusFor, low: (kind) => kinds.includes(kind), known, mode, lessons: keepLessons, shared, agentId, said: new Map(lines.map((l) => [l.m.messageId, String(l.m.body ?? "")])), ...(place && heard ? { place, heard } : {}) };
  const tally: Tally = { proposed: 0, merged: 0, updated: 0, closed: 0 };

  const tz = await timezoneOf(ctx);
  const { day } = localDay(ctx.now(), tz);
  const taught = new Set<string>();
  const ran = await modelPass(ctx, input, { asker, day, shared, lines, known: relatedOf(known, mineOnly), w, tally, taught });
  if (!ran) {
    // the free rules: the quota is spent, the account is paused or out, or no cheap model is there
    countRulePass(ctx, asker, day);
    for (const c of heuristicExtract(mineOnly)) {
      // in a place others read, the asker's own lines of every kind become the place's memory (the kinds a model keeps are the model's call); elsewhere only what they say about themselves
      if (shared && !place && !SELF_KINDS.has(c.kind)) continue;
      addFact(w, { text: c.text, kind: c.kind, messageId: c.messageId, key: `${input.threadId}:${c.messageId}:${c.index}` }, tally);
    }
  }
  // the free rules also catch a correction the model passed over; a line the model already made a lesson from is not counted twice
  if (keepLessons) lessonRules(w, lines, taught, tally, from >= 0);
  ctx.emit("memory.captured", input.threadId, { threadId: input.threadId, proposed: tally.proposed, merged: tally.merged });
  return { proposed: tally.proposed, merged: tally.merged, updated: tally.updated, closed: tally.closed, via: ran ? "model" : "rules" };
}

/** One model pass on the asker's account, inside the day's quota. False when it did not run (the caller then uses the rules); a provider's limit or fault never leaves this function. */
async function modelPass(
  ctx: MemCtx, input: LearnIn, p: { asker: string; day: string; shared: boolean; lines: Line[]; known: Fact[]; w: Writer; tally: Tally; taught: Set<string> },
): Promise<boolean> {
  const acct = input.account;
  // the account that ran this turn, and only when it is the asker's to spend: someone else's account never pays for this person's memory
  if (!acct?.ref || !acct.driver || (acct.payer !== undefined && acct.payer !== p.asker)) return false;
  const now = ctx.now();
  if (accountOf(ctx, acct.ref).pausedUntil > now) return false;
  const model = await modelFor(ctx, acct, now);
  if (!model) return false;
  const prompt = promptOf({ today: p.day, shared: p.shared, known: p.known, lines: p.lines });
  const system = p.w.lessons ? LEARN_SYSTEM + LESSON_SYSTEM : LEARN_SYSTEM;
  const chars = prompt.length + system.length;
  const caps = await capsOf(ctx);
  const held = reservationFor(ctx, acct.ref, acct.driver, chars);
  if (reserve(ctx, p.asker, p.day, caps, held) !== null) return false;
  let out: { text: string; tokensIn: number; tokensOut: number };
  try {
    out = (await ctx.call("engine.complete", { accountRef: acct.ref, model, system, prompt })) as typeof out;
  } catch (e) {
    settle(ctx, p.asker, p.day, held, null);
    accountFailed(ctx, acct.ref, ctx.now(), isLimitError(e));
    ctx.log.warn("memory learning paused for an account", { limit: isLimitError(e), reason: e instanceof Error ? e.name : "error" });
    return false;
  }
  const tokensIn = num(out.tokensIn);
  settle(ctx, p.asker, p.day, held, { tokensIn, tokensOut: num(out.tokensOut) });
  accountServed(ctx, acct.ref, chars, tokensIn);
  const byLine = new Map(p.lines.map((l) => [l.n, l]));
  const knownById = new Map(p.known.map((f) => [f.id, f]));
  for (const op of parseOps(String(out.text ?? ""))) {
    const line = byLine.get(op.line);
    if (!line?.mine) continue;   // a fact comes from something the asker said, never from an agent's reply or another person
    const key = `${input.threadId}:${line.m.messageId}:learn`;
    if (op.op === "lesson") { if (p.w.lessons && addLesson(p.w, { text: op.text!, how: op.how ?? "rewrite", messageId: line.m.messageId, key: `${input.threadId}:${line.m.messageId}:lesson` }, p.lines, p.tally)) p.taught.add(line.m.messageId); }
    else if (op.op === "add") addFact(p.w, { text: op.text!, kind: op.kind ?? "note", messageId: line.m.messageId, key }, p.tally);
    else {
      const old = knownById.get(op.id!);
      if (!old || old.status !== "current") continue;
      if (op.op === "update") updateFact(p.w, old, { text: op.text!, messageId: line.m.messageId, key }, p.tally);
      else closeFact(p.w, old, line.m.messageId, p.tally);
    }
  }
  return true;
}

// ---- what the person already knows

/** The person's live facts where learned facts land, newest first (the 300 most recent), opened under their own key. */
function liveFacts(ctx: MemCtx, target: LearnTarget): Fact[] {
  const rows = rowsOf(ctx.db, "SELECT * FROM memory_facts WHERE layer = ? AND owner_ref = ? AND status = 'current' ORDER BY learned_at DESC, id LIMIT 300", target.layer, target.ownerRef);
  return rows.map((r) => readFact(ctx, r)).filter((f) => f.text !== "" && (f.validTo === null || f.validTo > ctx.now()));
}

/** The facts a pass is shown: those that share words with what the person just said, then the newest, at most 20. */
export function relatedOf(known: Fact[], said: CaptureMessage[]): Fact[] {
  if (known.length === 0) return [];
  const q = said.map((m) => m.body).join(" ");
  const ranked = bm25(known.map((f) => ({ title: f.kind ?? "", text: f.text })), q);
  const matched = known.map((f, i) => ({ f, r: ranked[i]! })).filter((x) => x.r.matched > 0).sort((a, b) => b.r.score - a.r.score).slice(0, RELATED_MATCHED).map((x) => x.f);
  const out = [...matched];
  for (const f of known) { if (out.length >= RELATED_TOTAL) break; if (!out.includes(f)) out.push(f); }
  return out;
}

// ---- writing: add, update (close and replace), close

interface Writer {
  ctx: MemCtx; threadId: string; target: LearnTarget; audience: Array<[string, string]>; who: Who; sourceKind: SourceKind; statusFor(kind: string): FactStatus; low(kind: string): boolean;
  known: Fact[]; mode: CaptureMode | null; lessons: boolean; shared: boolean; agentId: string | null; place?: Place; heard?: Audience; /** what the person wrote on a line, by message id: a line they marked for themselves only stays theirs */ said?: Map<string, string>;
}

const lineLink = (threadId: string, messageId: string): string => `/chats/${threadId}#${messageId}`;

function write(w0: Writer, f: { text: string; kind: string; messageId: string; key: string; replaces?: string; why?: string }, status: FactStatus): Fact {
  // a line the person marked for themselves only is theirs, in their own layer, in any kind of place
  const priv = privateIntent(w0.said?.get(f.messageId) ?? "");
  const w: Writer = priv ? { ...w0, target: { layer: "person", ownerRef: actorOf(w0.ctx), agentId: w0.target.agentId, projectId: null }, place: undefined as never, heard: undefined as never } : w0;
  const { ctx, target } = w;
  let note: { replaced?: Fact; disputedWith?: Fact; questionId?: string } = {};
  const base = {
    layer: target.layer, ownerRef: target.ownerRef, agentId: target.agentId, projectId: target.projectId, kind: f.kind, text: f.text, validFrom: ctx.now(), sourceKind: w.sourceKind,
    sourceRef: w.threadId, sourcePerson: actorOf(ctx), proposedBy: ctx.principal.id, status, lowRisk: w.low(f.kind),
    links: [["capture", f.key], ["message", f.messageId], ...w.audience] as Array<[string, string]>, sourceLink: lineLink(w.threadId, f.messageId), how: "learn" as const, who: w.who,
  };
  let fact: Fact;
  if (w.place && w.heard && !f.replaces) {
    // what a person says in a place others read goes through the one door: replace by subject, dispute a clash, keep its place and message
    const out = writeSharedWith(ctx, { ...base, threadId: w.threadId, heard: w.heard, msgId: f.messageId, span: f.text }, w.place);
    fact = out.fact; note = out;
    if (out.deduped) return fact;
  } else {
    fact = insertFact(ctx, {
      ...base, ...(f.replaces ? { replaces: f.replaces } : {}), ...(f.why ? { why: f.why } : {}),
      ...(w.place && w.heard ? { place: { kind: w.place.kind, id: w.place.id, ...(w.place.parent ? { parent: w.place.parent } : {}) }, placeThread: w.threadId, audience: w.heard, msgId: f.messageId, span: f.text } : {}),
    });
  }
  if (w.place && status === "current") void postNoted(ctx, { threadId: w.threadId, factId: fact.id, kind: kindOf(f.kind), text: f.text, ...(note.replaced ? { replaces: note.replaced.id } : {}), ...(note.disputedWith ? { disputed: true } : {}), ...(note.questionId && note.disputedWith ? { question: { questionId: note.questionId, a: { text: note.disputedWith.text, by: note.disputedWith.sourcePerson, at: note.disputedWith.learnedAt }, b: { text: f.text, by: fact.sourcePerson, at: fact.learnedAt } } } : {}) });
  emitProposed(ctx, fact);
  emitLearned(ctx, fact, status === "current", w.who);
  if (status === "current") emitAccepted(ctx, fact, true);
  w.known.unshift({ ...fact, text: f.text });
  return fact;
}

function addFact(w: Writer, f: { text: string; kind: string; messageId: string; key: string }, tally: Tally): void {
  const want = normal(f.text);
  if (w.known.some((k) => normal(k.text) === want)) return;
  const status = w.statusFor(f.kind);
  write(w, f, status);
  tally.proposed++;
  if (status === "current") tally.merged++;
}

// ---- lessons: a correction of the agent's work, kept as a fact of kind lesson (lessons.ts)

/** Keep one lesson from a line. In a chat other people read its words must already be on screen. False when nothing was kept. */
function addLesson(w: Writer, f: { text: string; how: How; messageId: string; key: string }, lines: Line[], tally: Tally): boolean {
  if (!w.agentId) return false;
  if (w.shared && !groundedIn(f.text, lines.map((l) => l.m.body))) return false;
  const made = writeLesson(w.ctx, {
    agentId: w.agentId, how: f.how, text: f.text, who: w.who, key: f.key, threadId: w.threadId, messageId: f.messageId, sourceKind: w.sourceKind === "channel" ? "channel" : "chat", audience: w.audience,
    propose: w.mode === "propose",
  });
  if (!made) return false;
  tally.proposed++;
  if (made.status === "current") tally.merged++;
  return true;
}

/** The rules for lessons: a line of the person's straight after the agent's that says no, undoes, or asks for it another way. */
function lessonRules(w: Writer, lines: Line[], taught: Set<string>, tally: Tally, hadBefore: boolean): void {
  lines.forEach((l, i) => {
    // straight after the agent's line; the first line of a pass follows whatever an earlier pass read, which is the agent's last word when the chat had one
    const afterAgent = i === 0 ? hadBefore : lines[i - 1]?.mine === false;
    if (!l.mine || taught.has(l.m.messageId) || !afterAgent) return;
    const spot = correctionOf(l.m.body);
    if (spot) addLesson(w, { text: spot.text, how: spot.how, messageId: l.m.messageId, key: `${w.threadId}:${l.m.messageId}:lesson` }, lines, tally);
  });
}

/** A line changed something known. With saving on, the old fact closes now (its end date is this moment) and the new one replaces it; otherwise the new one waits with a question beside it. */
function updateFact(w: Writer, old: Fact, f: { text: string; messageId: string; key: string }, tally: Tally): void {
  if (normal(old.text) === normal(f.text)) return;
  const kind = old.kind ?? "note";
  const status = w.statusFor(kind);
  const { ctx } = w;
  if (status === "current") {
    const now = ctx.now();
    ctx.db.run("UPDATE memory_facts SET status = 'closed', valid_to = ?, closed_at = ? WHERE id = ? AND status = 'current'", now, now, old.id);
    w.known.splice(w.known.findIndex((k) => k.id === old.id), 1);
    write(w, { ...f, kind, replaces: old.id, why: "updated" }, "current");
    tally.updated++;
    tally.merged++;
  } else {
    const fresh = write(w, { ...f, kind, why: "updated" }, "proposed");
    question(ctx, "contradiction", old, fresh.id);
  }
  tally.proposed++;
}

/** A line says a known fact is no longer true. With saving on it closes now, its history kept; otherwise it becomes a question. */
function closeFact(w: Writer, old: Fact, messageId: string, tally: Tally): void {
  const { ctx } = w;
  if (w.mode !== "auto") { question(ctx, "stale", old, null); return; }
  const now = ctx.now();
  ctx.db.run("UPDATE memory_facts SET status = 'closed', valid_to = ?, closed_at = ? WHERE id = ? AND status = 'current'", now, now, old.id);
  ctx.db.run("INSERT OR IGNORE INTO memory_fact_links (fact_id, kind, ref) VALUES (?, 'closed_by', ?)", old.id, messageId);
  trail(ctx, {
    action: "edit", factId: old.id, layer: old.layer, ownerRef: old.ownerRef, agentId: old.agentId, projectId: old.projectId, who: w.who, source: `${w.sourceKind}:${w.threadId}`,
    reason: "no longer true", detail: { message: messageId, link: lineLink(w.threadId, messageId) },
  });
  w.known.splice(w.known.findIndex((k) => k.id === old.id), 1);
  tally.closed++;
}

function question(ctx: MemCtx, kind: "contradiction" | "stale", a: Fact, b: string | null): void {
  const open = rowsOf(ctx.db, "SELECT id FROM memory_questions WHERE kind = ? AND fact_a = ? AND COALESCE(fact_b, '') = ? AND status = 'open'", kind, a.id, b ?? "")[0];
  if (open) return;
  ctx.db.run(
    "INSERT INTO memory_questions (id, kind, fact_a, fact_b, layer, owner_ref, agent_id, project_id, status, created_at, run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL)",
    mintId("qst", ctx.now()), kind, a.id, b, a.layer, a.ownerRef, a.agentId, a.projectId, ctx.now(),
  );
}

// ---- the person's day, and the chat switch

/** Settings > Memory and privacy: what learning used today against the day's quota, and whether it is learning, on rules only, or paused. */
export async function learningToday(ctx: MemCtx, _input: Record<string, never>) {
  ensure(ctx.db);
  learnTables(ctx.db);
  const me = actorOf(ctx);
  const tz = await timezoneOf(ctx);
  const { day, resetsAt } = localDay(ctx.now(), tz);
  const caps = await capsOf(ctx);
  const u = usageOf(ctx, me, day);
  const full = u.passes >= caps.passes || u.tokensIn + u.reserved >= caps.tokens;
  return {
    day, passes: u.passes, tokensIn: u.tokensIn, tokensOut: u.tokensOut, rulePasses: u.rulePasses, capPasses: caps.passes, capTokens: caps.tokens, resetsAt, timezone: tz,
    state: full ? ("rules_only" as const) : ("learning" as const),
  };
}

async function needChat(ctx: MemCtx, threadId: string): Promise<{ starter?: string }> {
  try {
    const t = ((await ctx.call("threads.get", { threadId })) as { thread?: { starter?: string } }).thread;
    if (t) return t;
  } catch { /* not one of the caller's chats */ }
  raise(ctx, "validation.not_found", "There is no such chat.", { threadId });
}

/** "Don't remember this chat": whether the chat is on, and who turned it off. */
export async function chatLearningGet(ctx: MemCtx, input: { threadId: string }) {
  learnTables(ctx.db);
  await needChat(ctx, input.threadId);
  const s = chatForgotten(ctx, input.threadId);
  return { threadId: input.threadId, remember: !s.off, ...(s.by ? { by: s.by } : {}), ...(s.at ? { at: s.at } : {}) };
}

/** Anyone in the chat may turn learning off for it. Only who turned it off, or the person who started the chat, turns it back on. */
export async function chatLearningSet(ctx: MemCtx, input: { threadId: string; remember: boolean }) {
  learnTables(ctx.db);
  const t = await needChat(ctx, input.threadId);
  const me = actorOf(ctx);
  const s = chatForgotten(ctx, input.threadId);
  if (input.remember) {
    if (s.off && s.by !== me && t.starter !== me) raise(ctx, "permission.no_grant", "Only the person who turned this off, or who started the chat, can turn it back on.");
    ctx.db.run("DELETE FROM memory_chat_learning WHERE thread_id = ?", input.threadId);
  } else if (!s.off) {
    ctx.db.run("INSERT INTO memory_chat_learning (thread_id, off, by, at) VALUES (?, 1, ?, ?) ON CONFLICT(thread_id) DO UPDATE SET off = 1, by = excluded.by, at = excluded.at", input.threadId, me, ctx.now());
  }
  ctx.emit("memory.chat_learning_changed", input.threadId, { threadId: input.threadId, remember: input.remember, by: me });
  return chatLearningGet(ctx, { threadId: input.threadId });
}

/**
 * For capture at chat end: a line of the person's that a turn pass already read AND learned a fact from (the fact links the line's message) is left alone. A line a pass read but learned nothing from
 * (a model that found nothing, a pass that failed) still goes through the rules, so nothing said is lost to a pass that did not keep it.
 */
export function readByTurns(ctx: Pick<MemCtx, "db">, threadId: string, person: string, seq: number | undefined, messageId?: string): boolean {
  if (seq === undefined || messageId === undefined || seq > cursorOf(ctx, threadId, person)) return false;
  return rowsOf(ctx.db, "SELECT fact_id FROM memory_fact_links WHERE kind = 'message' AND ref = ? LIMIT 1", messageId).length > 0;
}
