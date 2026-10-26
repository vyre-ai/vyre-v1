// Group d of the chat handlers (P-L2_24d): the canonical transcript, plan and question blocks, helpers and the agent handoff.
//   chat.transcript.append / get / read / search / summary / summarize   the provider-neutral transcript rows of a thread (ARCH 6.9), kept in chat_transcript_* tables made on first use
//   chat.question.ask / chat.plan.propose / chat.plan.reject / chat.plan.step_done   the writing half of the blocks that chat.answer_block and chat.approve_plan answer
//   chat.helper.start / chat.helpers.list / chat.handoff   sub-task threads and agent-to-agent threads
// No handler here calls a model. transcript.summarize writes the plain extract of agent/src/transcript (the floor every switch and rollover already uses) and marks the thread as wanting a
// model refresh; search is lexical, because the module holds no embedding index.
import { createTranscript, redact, refreshSummary, transcriptPath } from "../../../agent/src/transcript/index.ts";
import type { Part, Turn } from "../../../agent/src/transcript/index.ts";
import {
  addAgent, addMember, agentsOf, askerOf, blockBy, ensure, hopLimit, insertBlock, insertMessage, insertPlan, insertThread, lastMessage, messageBy, mintId, patchBlockInMessage, planBy, raise,
  threadBy, threadOut,
} from "../projections.ts";
import type { ChatCtx, Db, PlanStep, ThreadRec } from "../projections.ts";
import { canSpeak, deliver } from "./post.ts";

type Row = Record<string, unknown>;

// ---- shared -----------------------------------------------------------------------------------------------------------------------------------------

/** A thread the caller may use, or a not-found. A closed thread takes no new blocks. */
function visible(ctx: ChatCtx, threadId: string): ThreadRec {
  const t = threadBy(ctx.db, threadId);
  if (!t || !canSpeak(ctx, t)) raise(ctx, "validation.not_found", "That chat does not exist or is not yours.");
  return t;
}
function open(ctx: ChatCtx, threadId: string): ThreadRec {
  const t = visible(ctx, threadId);
  if (t.closedAt !== undefined) raise(ctx, "validation.bad_input", "This thread is closed. Reopen it to write in it.");
  return t;
}
const authorKind = (ctx: ChatCtx): "agent" | "text" => (ctx.principal.kind === "agent" ? "agent" : "text");
const author = (ctx: ChatCtx): { kind: ChatCtx["principal"]["kind"]; id: string } => ({ kind: ctx.principal.kind, id: ctx.principal.id });

function emitStarted(ctx: ChatCtx, t: ThreadRec): void {
  ctx.emit("thread.started", t.id, {
    threadId: t.id, kind: t.kind, starter: t.starter ?? ctx.principal.id,
    ...(t.parentThreadId !== undefined ? { parentThreadId: t.parentThreadId } : {}), ...(t.channelId !== undefined ? { channelId: t.channelId } : {}),
    ...(t.scopeType !== undefined ? { scopeType: t.scopeType } : {}), ...(t.scopeId !== undefined ? { scopeId: t.scopeId } : {}),
  });
}

const json = (raw: unknown): unknown => { try { return raw === null || raw === undefined ? null : JSON.parse(String(raw)); } catch { return null; } };

// ---- transcript tables ------------------------------------------------------------------------------------------------------------------------------

const MAX_ROWS = 500;
const MAX_CONTENT = 200_000;
const TRANSCRIPT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS chat_transcript_row (
    thread TEXT NOT NULL, idx INTEGER NOT NULL, turnId TEXT NOT NULL, author TEXT, role TEXT NOT NULL, kind TEXT NOT NULL, content TEXT, toolName TEXT, toolCallId TEXT, at INTEGER NOT NULL,
    PRIMARY KEY (thread, idx)
  )`,
  "CREATE INDEX IF NOT EXISTS chat_transcript_row__turn ON chat_transcript_row (thread, turnId)",
  `CREATE TABLE IF NOT EXISTS chat_transcript_summary (
    thread TEXT PRIMARY KEY, summary TEXT NOT NULL, upToIdx INTEGER NOT NULL, upToTurn INTEGER NOT NULL, updatedAt INTEGER NOT NULL, writer TEXT, requestedAt INTEGER
  )`,
];
const tReady = new WeakSet<object>();
function ensureTranscript(db: Db): void {
  ensure(db);
  if (tReady.has(db)) return;
  for (const stmt of TRANSCRIPT_SCHEMA) db.run(stmt);
  tReady.add(db);
}

/** Every string in a value goes through redact(): a credential pasted into a conversation never reaches the stored transcript. */
function clean(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return redact(v).text;
  if (depth > 12 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => clean(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Row).map(([k, x]) => [k, clean(x, depth + 1)]));
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (content !== null && typeof content === "object" && typeof (content as Row)["text"] === "string") return String((content as Row)["text"]);
  return content === null || content === undefined ? "" : JSON.stringify(content);
}

/** The contract's role words: the transcript module of the agent package says person and agent. */
function roleOf(role: string): "user" | "assistant" | "tool" | "system" {
  const r = role.toLowerCase();
  if (r === "user" || r === "person" || r === "human") return "user";
  if (r === "assistant" || r === "agent") return "assistant";
  if (r === "tool") return "tool";
  return "system";
}

export async function transcriptAppend(
  ctx: ChatCtx, input: { threadId: string; turnId: string; rows: Array<{ role: string; kind: string; content: unknown; toolName?: string; toolCallId?: string }>; idempotencyKey?: string },
) {
  ensureTranscript(ctx.db);
  const t = threadBy(ctx.db, input.threadId);
  if (!t) raise(ctx, "validation.not_found", "That chat does not exist.");
  // Engines write as services or actors, which the pipeline already checked against the thread; a person or an agent must also belong to a private chat.
  if ((ctx.principal.kind === "person" || ctx.principal.kind === "agent") && !canSpeak(ctx, t)) raise(ctx, "validation.not_found", "That chat does not exist.");
  if (input.rows.length === 0 || input.rows.length > MAX_ROWS) raise(ctx, "validation.bad_input", `A turn has 1 to ${MAX_ROWS} rows.`);
  const stored = input.rows.map((r) => {
    if (r.role.trim() === "" || r.kind.trim() === "") raise(ctx, "validation.bad_input", "Every row needs a role and a kind.");
    const content = JSON.stringify(clean(r.content ?? null));
    if (content.length > MAX_CONTENT) raise(ctx, "validation.bad_input", `A row can hold at most ${MAX_CONTENT} characters.`);
    return { ...r, content };
  });

  // The same turn written twice (a hook retried, an offline resend) is the same turn.
  const prior = ctx.db.all("SELECT thread, COUNT(*) AS n FROM chat_transcript_row WHERE turnId = ? GROUP BY thread", input.turnId) as Row[];
  const was = prior[0];
  if (was) {
    if (String(was["thread"]) !== t.id) raise(ctx, "validation.bad_input", "That turn id belongs to another chat.");
    return { appended: Number(was["n"]) };
  }
  const top = Number((ctx.db.all("SELECT MAX(idx) AS top FROM chat_transcript_row WHERE thread = ?", t.id) as Row[])[0]?.["top"] ?? 0);
  const by = ctx.principal.id;
  const now = ctx.now();
  stored.forEach((r, i) => {
    ctx.db.run(
      "INSERT INTO chat_transcript_row (thread, idx, turnId, author, role, kind, content, toolName, toolCallId, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      t.id, top + i + 1, input.turnId, by, r.role, r.kind, r.content, r.toolName ?? null, r.toolCallId ?? null, now,
    );
  });
  return { appended: stored.length };
}

export async function transcriptGet(ctx: ChatCtx, input: { threadId: string; turnId: string }) {
  ensureTranscript(ctx.db);
  const t = visible(ctx, input.threadId);
  const rows = ctx.db.all("SELECT * FROM chat_transcript_row WHERE thread = ? AND turnId = ? ORDER BY idx", t.id, input.turnId) as Row[];
  if (rows.length === 0) raise(ctx, "validation.not_found", "That turn is not in this transcript.");
  return {
    turnId: input.turnId,
    rows: rows.map((r) => ({
      idx: Number(r["idx"]), role: String(r["role"]), kind: String(r["kind"]), content: json(r["content"]), ...(r["toolName"] ? { toolName: String(r["toolName"]) } : {}), at: Number(r["at"]),
    })),
  };
}

/** chats/<id>/transcript.md as a window: the head only on the first window, `next` is the index to ask for after this one. */
export async function transcriptRead(ctx: ChatCtx, input: { threadId: string; fromIdx?: number; limit?: number }) {
  ensureTranscript(ctx.db);
  const t = visible(ctx, input.threadId);
  const from = Math.max(1, input.fromIdx ?? 1);
  const limit = Math.min(MAX_ROWS, Math.max(1, input.limit ?? 100));
  const rows = ctx.db.all("SELECT * FROM chat_transcript_row WHERE thread = ? AND idx >= ? ORDER BY idx LIMIT ?", t.id, from, limit + 1) as Row[];
  const shown = rows.slice(0, limit);
  const parts = shown.map((r) => {
    const tool = r["toolName"] ? `, ${String(r["toolName"])}` : "";
    return `## #${Number(r["idx"])} ${String(r["role"])} (${String(r["kind"])}${tool}), ${new Date(Number(r["at"])).toISOString()}\n\n${textOf(json(r["content"]))}\n`;
  });
  const head = from <= 1 ? `# ${t.title ?? "Transcript"}\n\n` : "";
  const more = rows[limit];
  return { markdown: head + parts.join("\n"), ...(more ? { next: Number(more["idx"]) } : {}) };
}

const WORD = /[^\p{L}\p{N}_]+/u;
const wordsOf = (s: string): string[] => [...new Set(s.toLowerCase().split(WORD).filter((w) => w.length >= 2))];

/** Lexical search over the transcripts the asker may see. `mode` semantic and hybrid fall back to the same keyword match: the module has no embedding index. */
export async function transcriptSearch(
  ctx: ChatCtx, input: { q: string; mode?: "keyword" | "semantic" | "hybrid"; threadId?: string; agentId?: string; limit?: number },
) {
  ensureTranscript(ctx.db);
  const q = wordsOf(input.q.slice(0, 500));
  if (q.length === 0) raise(ctx, "validation.bad_input", "Search for at least one word.");
  const limit = Math.min(50, Math.max(1, input.limit ?? 10));
  const where: string[] = ["t.deleted_at IS NULL"];
  const args: unknown[] = [];
  if (input.threadId !== undefined) {
    const t = threadBy(ctx.db, input.threadId);
    if (!t || !canSpeak(ctx, t)) raise(ctx, "validation.bad_input", "That chat does not exist or is not yours.");
    where.push("r.thread = ?"); args.push(t.id);
  }
  if (input.agentId !== undefined) { where.push("r.thread IN (SELECT thread FROM chat_thread_agent WHERE agentId = ? AND deleted_at IS NULL)"); args.push(input.agentId); }
  const rows = ctx.db.all(
    `SELECT r.* FROM chat_transcript_row r JOIN chat_thread t ON t.id = r.thread WHERE ${where.join(" AND ")} ORDER BY r.at DESC, r.idx DESC LIMIT 5000`, ...args,
  ) as Row[];
  const may = new Map<string, boolean>();
  const allowed = (id: string): boolean => {
    let ok = may.get(id);
    if (ok === undefined) { const t = threadBy(ctx.db, id); ok = t !== null && canSpeak(ctx, t); may.set(id, ok); }
    return ok;
  };
  const hits: Array<{ score: number; hit: Row }> = [];
  for (const r of rows) {
    const thread = String(r["thread"]);
    if (!allowed(thread)) continue;
    const text = textOf(json(r["content"]));
    const have = new Set(wordsOf(text));
    const found = q.filter((w) => have.has(w));
    if (found.length === 0) continue;
    const lower = text.toLowerCase();
    const at = lower.indexOf(found[0]!);
    const start = Math.max(0, at - 40);
    hits.push({
      score: found.length / q.length,
      hit: {
        turnId: String(r["turnId"]), threadId: thread, idx: Number(r["idx"]), role: roleOf(String(r["role"])), snippet: text.slice(start, start + 160).replace(/\s+/g, " ").trim(),
        at: Number(r["at"]), link: `${transcriptPath(thread)}#${Number(r["idx"])}`,
      },
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return { hits: hits.slice(0, limit).map((h) => h.hit) };
}

export async function transcriptSummary(ctx: ChatCtx, input: { threadId: string }) {
  ensureTranscript(ctx.db);
  const t = visible(ctx, input.threadId);
  const r = (ctx.db.all("SELECT * FROM chat_transcript_summary WHERE thread = ?", t.id) as Row[])[0];
  return { summary: r ? String(r["summary"]) : "", upToIdx: r ? Number(r["upToIdx"]) : 0, updatedAt: r ? Number(r["updatedAt"]) : 0, transcriptPath: transcriptPath(t.id) };
}

/** The stored rows of a thread as the agent package's turns: one turn per turn id, in the order written. */
function turnsOf(rows: Row[], threadId: string): { turns: Turn[]; lastIdx: number[] } {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const id = String(r["turnId"]);
    const g = groups.get(id);
    if (g) g.push(r); else groups.set(id, [r]);
  }
  const turns: Turn[] = [];
  const lastIdx: number[] = [];
  for (const g of groups.values()) {
    const first = g[0]!;
    const parts: Part[] = [];
    for (const r of g) {
      const kind = String(r["kind"]);
      const text = textOf(json(r["content"]));
      const name = r["toolName"] ? String(r["toolName"]) : "tool";
      const id = r["toolCallId"] ? String(r["toolCallId"]) : String(r["idx"]);
      if (kind === "tool_call") parts.push({ kind: "tool_call", id, name, tool: name, summary: text.replace(/\s+/g, " ").slice(0, 200), args: {}, links: [] });
      else if (kind === "tool_result") parts.push({ kind: "tool_result", id, ok: true, output: text.slice(0, 2000), cut: text.length > 2000 });
      else if (roleOf(String(r["role"])) !== "tool" && text !== "") parts.push({ kind: "text", text });
    }
    turns.push({
      threadId, n: turns.length + 1, role: roleOf(String(first["role"])) === "user" ? "person" : "agent", authorId: String(first["author"] ?? "unknown"), engine: null, model: null,
      at: Number(first["at"]), parts, links: [], tokens: { in: 0, out: 0 },
    });
    lastIdx.push(Number(g[g.length - 1]!["idx"]));
  }
  return { turns, lastIdx };
}

/**
 * Bring the rolling summary forward with no provider call: the extract of asks and outcomes covers every turn but the newest twenty. The row also records requestedAt, which is the
 * request a background worker with a cheap model picks up to replace the extract. The answer is the row index the summary now reaches.
 */
export async function transcriptSummarize(ctx: ChatCtx, input: { threadId: string; idempotencyKey?: string }) {
  ensureTranscript(ctx.db);
  const t = visible(ctx, input.threadId);
  const rows = ctx.db.all("SELECT * FROM chat_transcript_row WHERE thread = ? ORDER BY idx", t.id) as Row[];
  const cur = (ctx.db.all("SELECT * FROM chat_transcript_summary WHERE thread = ?", t.id) as Row[])[0];
  const now = ctx.now();
  const { turns, lastIdx } = turnsOf(rows, t.id);
  const store = createTranscript();
  for (const turn of turns) store.append({ ...turn });
  if (cur && Number(cur["upToTurn"]) > 0) {
    store.setSummary({ threadId: t.id, text: String(cur["summary"]), upTo: Number(cur["upToTurn"]), by: String(cur["writer"] ?? "extract"), at: Number(cur["updatedAt"]) });
  }
  const next = await refreshSummary(store, undefined, { threadId: t.id, every: 1, now: () => ctx.now(), by: "extract" });
  const upToTurn = next?.upTo ?? 0;
  const upToIdx = upToTurn > 0 ? (lastIdx[upToTurn - 1] ?? 0) : 0;
  const text = next?.text ?? "";
  const changed = next !== null && (!cur || Number(cur["upToTurn"]) !== upToTurn);
  if (!cur) {
    ctx.db.run("INSERT INTO chat_transcript_summary (thread, summary, upToIdx, upToTurn, updatedAt, writer, requestedAt) VALUES (?, ?, ?, ?, ?, ?, ?)", t.id, text, upToIdx, upToTurn, now, next?.by ?? "extract", now);
  } else if (changed) {
    ctx.db.run("UPDATE chat_transcript_summary SET summary = ?, upToIdx = ?, upToTurn = ?, updatedAt = ?, writer = ?, requestedAt = ? WHERE thread = ?", text, upToIdx, upToTurn, now, next?.by ?? "extract", now, t.id);
  } else {
    ctx.db.run("UPDATE chat_transcript_summary SET requestedAt = ? WHERE thread = ?", now, t.id);
  }
  return { upToIdx: changed || !cur ? upToIdx : Number(cur["upToIdx"]) };
}

// ---- question and plan blocks -----------------------------------------------------------------------------------------------------------------------

const MAX_PROMPT = 4_000;
const MAX_OPTIONS = 20;
const MAX_STEPS = 50;
const MAX_STEP = 2_000;

export async function questionAsk(
  ctx: ChatCtx,
  input: { threadId: string; prompt: string; mode: "single" | "multi" | "free"; options?: Array<{ key: string; label: string; detail?: string }>; allowOther?: boolean; idempotencyKey?: string },
) {
  ensure(ctx.db);
  const t = open(ctx, input.threadId);
  const prompt = input.prompt.trim();
  if (prompt === "" || prompt.length > MAX_PROMPT) raise(ctx, "validation.bad_input", `A question needs words, at most ${MAX_PROMPT} characters.`);
  const options = input.options ?? [];
  if (input.mode === "free" && options.length > 0) raise(ctx, "validation.bad_input", "A free-text question has no options.");
  if (input.mode !== "free") {
    if (options.length === 0 || options.length > MAX_OPTIONS) raise(ctx, "validation.bad_input", `Give 1 to ${MAX_OPTIONS} options.`);
    const keys = new Set<string>();
    for (const o of options) {
      if (o.key.trim() === "" || o.label.trim() === "") raise(ctx, "validation.bad_input", "Every option needs a key and a label.");
      if (keys.has(o.key)) raise(ctx, "validation.bad_input", "Two options share a key.", { key: o.key });
      keys.add(o.key);
    }
  }
  const blockId = mintId("blk", ctx.now());
  const data = { threadId: t.id, blockId, prompt, mode: input.mode, options, allowOther: input.allowOther ?? false };
  const m = insertMessage(ctx, t.id, { author: ctx.principal.id, kind: authorKind(ctx), body: "", blocks: [{ type: "question", v: 1, id: blockId, data, state: "waiting", traceId: ctx.trace.traceId }] });
  insertBlock(ctx, { id: blockId, thread: t.id, message: m.id, type: "question", data });
  deliver(ctx, t, m, [], author(ctx), { notify: false });
  ctx.emit("block.waiting", t.id, { threadId: t.id, blockId, blockType: "question" });
  return { blockId, messageId: m.id };
}

export async function planPropose(
  ctx: ChatCtx, input: { threadId: string; title: string; steps: Array<{ text: string; detail?: string }>; docFileId?: string; idempotencyKey?: string },
) {
  ensure(ctx.db);
  const t = open(ctx, input.threadId);
  const title = input.title.trim();
  if (title === "" || title.length > 200) raise(ctx, "validation.bad_input", "A plan needs a title of up to 200 characters.");
  if (input.steps.length === 0 || input.steps.length > MAX_STEPS) raise(ctx, "validation.bad_input", `A plan has 1 to ${MAX_STEPS} steps.`);
  if (input.docFileId !== undefined && !input.docFileId.startsWith("fil_")) raise(ctx, "validation.bad_input", "That is not a file.", { id: input.docFileId });
  const now = ctx.now();
  const steps: PlanStep[] = input.steps.map((s) => {
    const text = s.text.trim();
    if (text === "" || text.length > MAX_STEP) raise(ctx, "validation.bad_input", `A step needs words, at most ${MAX_STEP} characters.`);
    const detail = s.detail?.trim();
    return { stepId: mintId("stp", now), text, state: "todo", ...(detail ? { detail } : {}) };
  });
  const planId = mintId("pln", now);
  const blockId = mintId("blk", now);
  const data = { threadId: t.id, blockId, planId, title, steps, state: "proposed", ...(input.docFileId !== undefined ? { docFileId: input.docFileId } : {}) };
  const m = insertMessage(ctx, t.id, { author: ctx.principal.id, kind: authorKind(ctx), body: "", blocks: [{ type: "plan", v: 1, id: blockId, data, state: "waiting", traceId: ctx.trace.traceId }] });
  insertBlock(ctx, { id: blockId, thread: t.id, message: m.id, type: "plan", data });
  insertPlan(ctx, { id: planId, thread: t.id, block: blockId, title, steps, docFileId: input.docFileId });
  ctx.emit("plan.proposed", t.id, { planId, threadId: t.id, steps: steps.length });
  deliver(ctx, t, m, [], author(ctx), { notify: false });
  ctx.emit("block.waiting", t.id, { threadId: t.id, blockId, blockType: "plan" });
  return { planId, blockId };
}

function planOf(ctx: ChatCtx, threadId: string, planId: string) {
  const t = threadBy(ctx.db, threadId);
  const plan = planBy(ctx.db, planId);
  if (!plan || !t || plan.thread !== t.id || !canSpeak(ctx, t)) raise(ctx, "validation.not_found", "That plan does not exist.");
  return { t, plan };
}

export async function planReject(ctx: ChatCtx, input: { threadId: string; planId: string; note?: string; idempotencyKey?: string }) {
  ensure(ctx.db);
  const { t, plan } = planOf(ctx, input.threadId, input.planId);
  if (ctx.principal.kind !== "person") raise(ctx, "validation.bad_input", "A person sends a plan back, not an agent.");
  if (plan.state === "rejected") return { ok: true };
  if (plan.state !== "proposed") raise(ctx, "validation.bad_input", `This plan was already ${plan.state}.`);
  const note = input.note?.trim() || undefined;
  if (note !== undefined && note.length > 4_000) raise(ctx, "validation.bad_input", "A note can be at most 4000 characters.");
  const by = askerOf(ctx);
  const now = ctx.now();
  // Plan mode stays on: the thread row is not touched, and the note rides in the answer the wake carries back to the agent.
  ctx.db.run("UPDATE chat_plan SET state = 'rejected', decidedBy = ?, decidedAt = ? WHERE id = ?", by, now, plan.id);
  ctx.db.run("UPDATE chat_block SET state = 'done', answer = ?, answeredBy = ?, answeredAt = ? WHERE id = ?", JSON.stringify({ approved: false, ...(note !== undefined ? { note } : {}) }), by, now, plan.block);
  const block = blockBy(ctx.db, plan.block);
  if (block) {
    patchBlockInMessage(ctx.db, block.message, block.id, (b) => ({ ...b, state: "done", data: { ...(b["data"] as Record<string, unknown>), state: "rejected", ...(note !== undefined ? { note } : {}) } }));
  }
  ctx.emit("plan.rejected", t.id, { planId: plan.id, threadId: t.id, by });
  ctx.emit("block.answered", t.id, { threadId: t.id, blockId: plan.block, by });
  return { ok: true };
}

export async function planStepDone(ctx: ChatCtx, input: { threadId: string; planId: string; stepId: string }) {
  ensure(ctx.db);
  const { t, plan } = planOf(ctx, input.threadId, input.planId);
  if (plan.state !== "approved" && plan.state !== "done") raise(ctx, "validation.bad_input", "Steps tick off once the plan is approved.");
  const i = plan.steps.findIndex((s) => s.stepId === input.stepId);
  if (i < 0) raise(ctx, "validation.bad_input", "That step is not in this plan.", { stepId: input.stepId });
  const view = (steps: PlanStep[]) => ({ plan: { planId: plan.id, steps } });
  if (plan.steps[i]!.state === "done") return view(plan.steps);
  const steps = plan.steps.map((s) => (s.stepId === input.stepId ? { ...s, state: "done" as const } : s));
  const finished = steps.every((s) => s.state === "done" || s.state === "skipped");
  ctx.db.run("UPDATE chat_plan SET steps = ?, state = ? WHERE id = ?", JSON.stringify(steps), finished ? "done" : plan.state, plan.id);
  const block = blockBy(ctx.db, plan.block);
  if (block) patchBlockInMessage(ctx.db, block.message, block.id, (b) => ({ ...b, data: { ...(b["data"] as Record<string, unknown>), steps, ...(finished ? { state: "done" } : {}) } }));
  ctx.emit("plan.step_done", t.id, { planId: plan.id, threadId: t.id, stepId: input.stepId });
  return view(steps);
}

// ---- helpers and handoff ----------------------------------------------------------------------------------------------------------------------------

/** The agent that works a new thread: the one named, else the caller when it is an agent, else the agent leading the parent. */
function workerFor(ctx: ChatCtx, parent: ThreadRec, named: string | undefined): string {
  if (named !== undefined) {
    if (!named.startsWith("agt_")) raise(ctx, "validation.bad_input", "That is not an agent.", { id: named });
    return named;
  }
  if (ctx.principal.kind === "agent") return ctx.principal.id;
  const list = agentsOf(ctx.db, parent.id);
  const lead = list.find((a) => a.mode === "lead") ?? list[0];
  if (!lead) raise(ctx, "validation.bad_input", "Name the agent that does the work.");
  return lead.agentId;
}

export async function helperStart(
  ctx: ChatCtx,
  input: { threadId: string; title: string; instruction: string; agentId?: string; model?: string; provider?: string; effort?: string; idempotencyKey?: string },
) {
  ensure(ctx.db);
  const parent = open(ctx, input.threadId);
  if (parent.kind === "helper") raise(ctx, "validation.bad_input", "A helper chat does not start helpers of its own.");
  const title = input.title.trim();
  const instruction = input.instruction.trim();
  if (title === "" || title.length > 120) raise(ctx, "validation.bad_input", "A helper needs a title of up to 120 characters.");
  if (instruction === "" || instruction.length > 100_000) raise(ctx, "validation.bad_input", "Tell the helper what to do.");
  const agentId = workerFor(ctx, parent, input.agentId);
  const asker = askerOf(ctx);
  const by = author(ctx);

  // The line in the parent chat that stands for the helper, with its block; the helper thread hangs under that line.
  const blockId = mintId("blk", ctx.now());
  const line = insertMessage(ctx, parent.id, {
    author: ctx.principal.id, kind: authorKind(ctx), body: `Started a helper: ${title}`,
    blocks: [{ type: "helper", v: 1, id: blockId, data: { title, agentId, ...(input.model !== undefined ? { model: input.model } : {}) }, state: "live", traceId: ctx.trace.traceId }],
  });
  const helper = insertThread(ctx, { kind: "helper", title, starter: asker, parentThreadId: parent.id, parentMessageId: line.id, listed: false });
  patchBlockInMessage(ctx.db, line.id, blockId, (b) => ({ ...b, data: { ...(b["data"] as Record<string, unknown>), helperThreadId: helper.id } }));
  if (asker.startsWith("usr_")) addMember(ctx, helper.id, asker, "owner");
  addAgent(ctx, helper.id, { agentId, mode: "lead", model: input.model, provider: input.provider, effort: input.effort, addedBy: asker });

  const first = insertMessage(ctx, helper.id, { author: ctx.principal.id, kind: authorKind(ctx), body: instruction });
  ctx.emit("helper.started", helper.id, { helperThreadId: helper.id, parentThreadId: parent.id, agentId, ...(input.model !== undefined ? { model: input.model } : {}) });
  emitStarted(ctx, helper);
  deliver(ctx, parent, messageBy(ctx.db, line.id)!, [], by, { notify: false });
  deliver(ctx, helper, first, [], by, { notify: false });
  return { helper: threadOut(ctx.db, threadBy(ctx.db, helper.id)!), blockId };
}

export async function helpersList(ctx: ChatCtx, input: { threadId: string }) {
  ensure(ctx.db);
  const parent = visible(ctx, input.threadId);
  const rows = ctx.db.all("SELECT id FROM chat_thread WHERE parentThreadId = ? AND kind = 'helper' AND deleted_at IS NULL ORDER BY createdAt, rowid", parent.id) as Row[];
  const helpers: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const h = threadBy(ctx.db, String(r["id"]));
    if (!h) continue;
    const lead = agentsOf(ctx.db, h.id)[0];
    if (!lead) continue;
    // Status comes from the helper block in the parent chat (whoever runs the helper sets it live, done or error), else from the thread being closed.
    const line = h.parentMessageId !== undefined ? messageBy(ctx.db, h.parentMessageId) : null;
    const state = line?.blocks.find((b) => b["type"] === "helper" && (b["data"] as Row | undefined)?.["helperThreadId"] === h.id)?.["state"];
    const status = state === "error" ? "failed" : state === "done" || h.closedAt !== undefined ? "done" : "running";
    helpers.push({ threadId: h.id, title: h.title ?? "Helper", status, agentId: lead.agentId, ...(lead.model !== undefined ? { model: lead.model } : {}), startedAt: h.createdAt });
  }
  return { helpers };
}

export async function handoff(ctx: ChatCtx, input: { threadId: string; toAgentId: string; note: string; idempotencyKey?: string }) {
  ensure(ctx.db);
  const source = open(ctx, input.threadId);
  if (source.kind === "helper") raise(ctx, "validation.bad_input", "A helper chat is read-only and hands nothing off.");
  if (!input.toAgentId.startsWith("agt_")) raise(ctx, "validation.bad_input", "That is not an agent.", { id: input.toAgentId });
  const note = input.note.trim();
  if (note === "" || note.length > 100_000) raise(ctx, "validation.bad_input", "Say what the other agent should do.");
  const list = agentsOf(ctx.db, source.id);
  const fromAgentId = ctx.principal.kind === "agent" ? ctx.principal.id : (list.find((a) => a.mode === "lead") ?? list[0])?.agentId;
  if (fromAgentId === undefined) raise(ctx, "validation.precondition_failed", "No agent in this chat has work to hand over.");
  if (fromAgentId === input.toAgentId) raise(ctx, "validation.bad_input", "An agent cannot hand work to itself.");

  // A handoff is one more hop after whatever the chat holds now; past the hop limit a person has to speak first.
  const depth = (lastMessage(ctx.db, source.id)?.depth ?? 0) + 1;
  const limit = await hopLimit(ctx);
  if (depth > limit) raise(ctx, "validation.precondition_failed", `The agents have handed this on ${limit} times. A person has to reply before they go on.`, { limit, depth });

  const asker = askerOf(ctx);
  const t = insertThread(ctx, { kind: "thread", title: note.replace(/\s+/g, " ").slice(0, 60), starter: asker, parentThreadId: source.id, listed: false });
  if (asker.startsWith("usr_")) addMember(ctx, t.id, asker, "owner");
  addAgent(ctx, t.id, { agentId: input.toAgentId, mode: "lead", addedBy: asker });
  const m = insertMessage(ctx, t.id, { author: ctx.principal.id, kind: authorKind(ctx), body: note, depth });
  ctx.emit("agent.handoff", t.id, { fromThreadId: source.id, toThreadId: t.id, fromAgentId, toAgentId: input.toAgentId, depth });
  emitStarted(ctx, t);
  deliver(ctx, t, m, [], author(ctx), { notify: false });
  return { thread: threadOut(ctx.db, threadBy(ctx.db, t.id)!), depth };
}

export const g24dHandlers = {
  "chat.transcript.append": transcriptAppend,
  "chat.transcript.get": transcriptGet,
  "chat.transcript.read": transcriptRead,
  "chat.transcript.search": transcriptSearch,
  "chat.transcript.summarize": transcriptSummarize,
  "chat.transcript.summary": transcriptSummary,
  "chat.plan.propose": planPropose,
  "chat.plan.reject": planReject,
  "chat.plan.step_done": planStepDone,
  "chat.question.ask": questionAsk,
  "chat.helper.start": helperStart,
  "chat.helpers.list": helpersList,
  "chat.handoff": handoff,
};
