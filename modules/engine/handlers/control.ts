// engine control of a running thread and AI incidents (spec 4.14, 4.17, 3.10; ARCH 6.2, 6.4):
//   engine.interrupt, engine.stop, engine.stop_all, engine.set_mode, engine.set_model, engine.switch,
//   engine.incidents.list, engine.incident.get/open/assign/resolve/note.
// The live engine is the TurnEngine bound at boot (projections.boundEngine). A thread that is not open on this host is opened from threads.get first,
// with the mode, model and engine this module saved for its agents. Events are the manifest's, with the caller as `by`.
import type { TurnEngine } from "../../../agent/src/turn-engine/engine.ts";
import type { EngineAgent, ThreadKind } from "../../../agent/src/turn-engine/types.ts";
import { actorOf, boundEngine, ensure, mintId, raise } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";

type Row = Record<string, unknown>;
const rows = (ctx: EngineCtx, sql: string, ...args: unknown[]): Row[] => ctx.db.all(sql, ...args) as Row[];
const orUndef = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));

interface ThreadOut {
  thread: {
    threadId: string; kind?: string; starter?: string;
    agents: Array<{ agentId: string; mode: "lead" | "listen"; model?: string; provider?: string; effort?: string; accountRef?: string; watches?: boolean }>;
  };
}

const KINDS = new Set<string>(["chat", "channel", "thread", "ask", "run", "helper", "console"]);
const DRIVER_TITLE: Readonly<Record<string, string>> = {
  anthropic: "Anthropic", openai: "OpenAI", openrouter: "OpenRouter", google: "Google", xai: "xAI", opencode_go: "OpenCode Go", local: "a local model",
  claude_code: "Claude Code", codex: "Codex", grok: "Grok",
};

interface AgentState { mode: string | null; model: string | null; provider: string | null; effort: string | null; accountRef: string | null; engine: string | null }

function stateOf(ctx: EngineCtx, threadId: string, agentId: string): AgentState | null {
  const r = rows(ctx, "SELECT * FROM engine_agent_state WHERE thread_id = ? AND agent_id = ?", threadId, agentId)[0];
  if (!r) return null;
  const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
  return { mode: s(r["mode"]), model: s(r["model"]), provider: s(r["provider"]), effort: s(r["effort"]), accountRef: s(r["account_ref"]), engine: s(r["engine"]) };
}

function saveState(ctx: EngineCtx, threadId: string, agentId: string, patch: Partial<AgentState>): AgentState {
  const cur = stateOf(ctx, threadId, agentId) ?? { mode: null, model: null, provider: null, effort: null, accountRef: null, engine: null };
  const next: AgentState = { ...cur, ...patch };
  ctx.db.run(
    `INSERT OR REPLACE INTO engine_agent_state (thread_id, agent_id, mode, model, provider, effort, account_ref, engine, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    threadId, agentId, next.mode, next.model, next.provider, next.effort, next.accountRef, next.engine, ctx.now(),
  );
  return next;
}

/** Open the thread in the engine if this host has not yet, from threads.get plus what this module saved for its agents. */
export async function open(ctx: EngineCtx, threadId: string): Promise<TurnEngine> {
  ensure(ctx.db);
  const engine = boundEngine(ctx);
  try {
    engine.agents(threadId);
    return engine;
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
  }
  let out: ThreadOut;
  try {
    out = (await ctx.call("threads.get", { threadId })) as ThreadOut;
  } catch {
    raise(ctx, "validation.not_found", "There is no such conversation.", { threadId });
  }
  const t = out.thread;
  const agents: EngineAgent[] = t.agents.map((a) => {
    const saved = stateOf(ctx, threadId, a.agentId);
    const mode = (saved?.mode ?? a.mode) === "lead" ? "lead" : "listen";
    const model = saved?.model ?? a.model;
    const accountRef = saved?.accountRef ?? a.accountRef;
    return { id: a.agentId, mode, ...(model === undefined ? {} : { model }), ...(accountRef === undefined ? {} : { accountRef }), ...(a.watches === true ? { watching: true } : {}) };
  });
  const kind: ThreadKind = t.kind !== undefined && KINDS.has(t.kind) ? (t.kind as ThreadKind) : "thread";
  // Two leads in one thread would break the unique lead rule; the saved mode wins for the agent that was set last, so demote extras.
  let leadSeen = false;
  for (const a of agents) { if (a.mode === "lead") { if (leadSeen) a.mode = "listen"; leadSeen = true; } }
  engine.openThread({ id: threadId, kind, starter: t.starter ?? actorOf(ctx), agents });
  return engine;
}

// ---- interrupt, stop, stop_all

export async function interrupt(ctx: EngineCtx, input: { threadId: string; messageId?: string }): Promise<{ queued: boolean }> {
  const engine = await open(ctx, input.threadId);
  let r;
  try {
    r = await engine.interrupt(input.threadId, input.messageId);
  } catch (e) {
    if (e instanceof RangeError) raise(ctx, "validation.not_found", "There is no such message in this conversation.", { messageId: input.messageId });
    throw e;
  }
  const by = actorOf(ctx);
  for (const c of r.cancelled) ctx.emit("turn.cancelled", input.threadId, { turnId: c.turnId, threadId: input.threadId, agentId: c.agentId, by });
  const queue = engine.queue(input.threadId);
  for (const qseq of r.qseqs) {
    const row = queue.find((q) => q.qseq === qseq);
    if (!row) continue;
    ctx.emit("turn.queued", input.threadId, {
      threadId: input.threadId, agentId: row.agentId, kind: row.kind, qseq, ...(row.messageId === null ? {} : { messageId: row.messageId }),
    });
  }
  return { queued: r.queued };
}

async function stopWith(ctx: EngineCtx, threadId: string, o: { agentId?: string; all: boolean }): Promise<{ stopped: number }> {
  const engine = await open(ctx, threadId);
  const r = await engine.stop(threadId, { ...(o.agentId === undefined ? {} : { agentId: o.agentId }), clearQueue: o.all });
  const by = actorOf(ctx);
  for (const c of r.stopped) ctx.emit("turn.cancelled", threadId, { turnId: c.turnId, threadId, agentId: c.agentId, by });
  for (const c of r.released) ctx.emit("turn.cancelled", threadId, { turnId: c.turnId, threadId, agentId: c.agentId, by });
  return { stopped: r.stopped.length + r.released.length + r.dropped.length };
}

/** Stop one agent working in a thread (its running turn, its queued turns and its parked turns). Without an agent, the turn that is running. */
export const stop = (ctx: EngineCtx, input: { threadId: string; agentId?: string }): Promise<{ stopped: number }> =>
  stopWith(ctx, input.threadId, { ...(input.agentId === undefined ? {} : { agentId: input.agentId }), all: false });

/** Stop every agent working in the thread: the running turn, everything queued, everything parked. */
export const stopAll = (ctx: EngineCtx, input: { threadId: string }): Promise<{ stopped: number }> => stopWith(ctx, input.threadId, { all: true });

// ---- set_mode, set_model, switch

export async function setMode(ctx: EngineCtx, input: { threadId: string; agentId: string; mode: "lead" | "listen" }): Promise<{ mode: "lead" | "listen"; leadAgentId: string | null }> {
  const engine = await open(ctx, input.threadId);
  const before = new Map(engine.agents(input.threadId).map((a) => [a.id, a.mode] as const));
  try {
    engine.setMode(input.threadId, input.agentId, input.mode);
  } catch (e) {
    if (e instanceof RangeError) raise(ctx, "validation.not_found", "That agent is not in this conversation.", { agentId: input.agentId });
    throw e;
  }
  const agents = engine.agents(input.threadId);
  // The engine demoted the previous lead; save every mode that changed, so a reopened thread has the same single lead.
  for (const a of agents) {
    if (a.id === input.agentId || before.get(a.id) !== a.mode) saveState(ctx, input.threadId, a.id, { mode: a.mode });
  }
  ctx.emit("agent.mode_changed", input.threadId, { threadId: input.threadId, agentId: input.agentId, mode: input.mode, by: actorOf(ctx) });
  return { mode: input.mode, leadAgentId: agents.find((a) => a.mode === "lead")?.id ?? null };
}

function providerFor(model: string): string | undefined {
  const m = model.toLowerCase();
  if (m.startsWith("claude")) return "anthropic";
  if (m.startsWith("gpt") || /^o\d/.test(m)) return "openai";
  if (m.startsWith("gemini")) return "google";
  if (m.startsWith("grok")) return "xai";
  if (m.includes("/")) return "openrouter";
  return undefined;
}

export async function setModel(
  ctx: EngineCtx,
  input: { threadId: string; agentId: string; model?: string; provider?: string; effort?: "low" | "medium" | "high" | "max"; accountRef?: string },
): Promise<{ model: string; provider: string; effort?: "low" | "medium" | "high" | "max"; accountRef?: string }> {
  const engine = await open(ctx, input.threadId);
  const agent = engine.agents(input.threadId).find((a) => a.id === input.agentId);
  if (!agent) raise(ctx, "validation.not_found", "That agent is not in this conversation.", { agentId: input.agentId });
  const saved = stateOf(ctx, input.threadId, input.agentId);
  const model = input.model ?? saved?.model ?? agent.model;
  if (model === undefined || model === null) raise(ctx, "validation.precondition_failed", "Pick a model first.", { agentId: input.agentId });
  const provider = input.provider ?? (input.model === undefined ? saved?.provider ?? undefined : undefined) ?? providerFor(model);
  if (provider === undefined) raise(ctx, "validation.precondition_failed", "Name the provider for this model.", { model });
  const effort = input.effort ?? (saved?.effort as "low" | "medium" | "high" | "max" | null | undefined) ?? undefined;
  const accountRef = input.accountRef ?? saved?.accountRef ?? agent.accountRef;
  engine.setAgent(input.threadId, input.agentId, { model, ...(accountRef === undefined ? {} : { accountRef }) });
  saveState(ctx, input.threadId, input.agentId, { model, provider, effort: effort ?? null, accountRef: accountRef ?? null });
  ctx.emit("agent.model_changed", input.threadId, { threadId: input.threadId, agentId: input.agentId, model, provider, by: actorOf(ctx) });
  return { model, provider, ...(effort === undefined ? {} : { effort }), ...(accountRef === undefined ? {} : { accountRef }) };
}

/** Rolling handoff: the new engine starts from the summary and the last turns (spec 4.14). The summary itself is the transcript module's. */
const HANDOFF_TURNS = 20;

export async function switchEngine(
  ctx: EngineCtx,
  input: { threadId: string; agentId?: string; driver: string; model: string; provider?: string; effort?: "low" | "medium" | "high" | "max"; accountRef?: string },
): Promise<{ engine: string; model: string; quietLine: string; handoffTurns: number }> {
  const engine = await open(ctx, input.threadId);
  const agents = engine.agents(input.threadId);
  const agentId = input.agentId ?? agents.find((a) => a.mode === "lead")?.id;
  if (agentId === undefined) raise(ctx, "validation.precondition_failed", "Name the agent to switch; nobody leads this conversation.", { threadId: input.threadId });
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) raise(ctx, "validation.not_found", "That agent is not in this conversation.", { agentId });
  const paused = rows(ctx, "SELECT paused FROM engine_spend_state WHERE id = ?", "space")[0];
  if (paused && Number(paused["paused"]) === 1) raise(ctx, "permission.limit", "AI spend is paused in this Space.", { reason: "spend_paused" });
  const saved = stateOf(ctx, input.threadId, agentId);
  const provider = input.provider ?? providerFor(input.model) ?? (DRIVER_TITLE[input.driver] ? input.driver : "openrouter");
  const accountRef = input.accountRef ?? saved?.accountRef ?? agent.accountRef;
  const done = engine.turns(input.threadId).filter((t) => t.state === "completed").length;
  const handoffTurns = Math.min(HANDOFF_TURNS, done);
  const to = DRIVER_TITLE[input.driver] ?? input.driver;
  const quietLine = handoffTurns === 0
    ? `Switched to ${to}`
    : `Switched to ${to}, picked up from the summary and the last ${handoffTurns === 1 ? "turn" : `${handoffTurns} turns`}`;
  const from = saved?.engine ?? agent.model ?? "default";
  engine.setAgent(input.threadId, agentId, { model: input.model, ...(accountRef === undefined ? {} : { accountRef }) });
  saveState(ctx, input.threadId, agentId, { model: input.model, provider, engine: input.driver, effort: input.effort ?? saved?.effort ?? null, accountRef: accountRef ?? null });
  const by = actorOf(ctx);
  ctx.emit("turn.engine_switched", input.threadId, { threadId: input.threadId, agentId, from, to: input.driver, handoffTurns, by });
  ctx.emit("agent.model_changed", input.threadId, { threadId: input.threadId, agentId, model: input.model, provider, by });
  return { engine: input.driver, model: input.model, quietLine, handoffTurns };
}

// ---- incidents

type IncidentKind = "label_denied" | "scrub_miss" | "runaway_spend" | "repeated_failure" | "person_report" | "other";
type IncidentState = "open" | "assigned" | "resolved";
interface Incident {
  incidentId: string; kind: IncidentKind; title: string; state: IncidentState; ownerId?: string; agentId?: string; turnId?: string;
  openedAt: number; resolvedAt?: number; notes: Array<{ by: string; at: number; text: string }>;
}

function incidentOf(ctx: EngineCtx, r: Row): Incident {
  const id = String(r["id"]);
  const notes = rows(ctx, "SELECT by_principal, at, note_text FROM engine_incident_notes WHERE incident_id = ? ORDER BY n ASC", id).map((n) => ({ by: String(n["by_principal"]), at: Number(n["at"]), text: String(n["note_text"]) }));
  const owner = orUndef(r["owner_id"]), agent = orUndef(r["agent_id"]), turn = orUndef(r["turn_id"]);
  return {
    incidentId: id, kind: String(r["kind"]) as IncidentKind, title: String(r["title"]), state: String(r["state"]) as IncidentState,
    ...(owner === undefined ? {} : { ownerId: owner }), ...(agent === undefined ? {} : { agentId: agent }), ...(turn === undefined ? {} : { turnId: turn }),
    openedAt: Number(r["opened_at"]), ...(r["resolved_at"] === null || r["resolved_at"] === undefined ? {} : { resolvedAt: Number(r["resolved_at"]) }), notes,
  };
}

function loadIncident(ctx: EngineCtx, incidentId: string): Incident {
  ensure(ctx.db);
  const r = rows(ctx, "SELECT * FROM engine_incidents WHERE id = ?", incidentId)[0];
  if (!r) raise(ctx, "validation.not_found", "There is no such incident.", { incidentId });
  return incidentOf(ctx, r);
}

function addNote(ctx: EngineCtx, incidentId: string, text: string): void {
  const n = Number(rows(ctx, "SELECT COALESCE(MAX(n), 0) + 1 AS n FROM engine_incident_notes WHERE incident_id = ?", incidentId)[0]?.["n"] ?? 1);
  ctx.db.run("INSERT INTO engine_incident_notes (incident_id, n, by_principal, at, note_text) VALUES (?, ?, ?, ?, ?)", incidentId, n, actorOf(ctx), ctx.now(), text);
}

/** Open an incident from inside the module (a scrub miss, a label denial, runaway spend). Handlers and the worker use it; the capability wraps it. */
export function openIncident(
  ctx: EngineCtx,
  input: { kind: IncidentKind; title: string; agentId?: string; turnId?: string; note?: string; ownerId?: string },
): Incident {
  ensure(ctx.db);
  const incidentId = mintId("inc", ctx.now());
  ctx.db.run(
    `INSERT INTO engine_incidents (id, kind, title, state, owner_id, agent_id, turn_id, opened_by, opened_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    incidentId, input.kind, input.title, input.ownerId === undefined ? "open" : "assigned", input.ownerId ?? null, input.agentId ?? null, input.turnId ?? null, actorOf(ctx), ctx.now(),
  );
  if (input.note !== undefined && input.note.trim() !== "") addNote(ctx, incidentId, input.note);
  ctx.emit("incident.opened", incidentId, { incidentId, kind: input.kind, ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }) });
  return loadIncident(ctx, incidentId);
}

export function incidentOpen(ctx: EngineCtx, input: { kind: IncidentKind; title: string; agentId?: string; turnId?: string; note?: string }): { incident: Incident } {
  if (input.title.trim() === "") raise(ctx, "validation.bad_input", "Give the incident a title.");
  return { incident: openIncident(ctx, input) };
}

export function incidentsList(ctx: EngineCtx, input: { state?: IncidentState[]; cursor?: string; limit?: number }): { incidents: Incident[]; next?: string; total?: number } {
  ensure(ctx.db);
  const states = input.state && input.state.length > 0 ? input.state : null;
  const where = states ? `WHERE state IN (${states.map(() => "?").join(", ")})` : "";
  const args: unknown[] = states ? [...states] : [];
  const total = Number(rows(ctx, `SELECT COUNT(*) AS n FROM engine_incidents ${where}`, ...args)[0]?.["n"] ?? 0);
  const limit = input.limit ?? 50;
  const offset = input.cursor !== undefined && /^\d+$/.test(input.cursor) ? Number(input.cursor) : 0;
  const page = rows(ctx, `SELECT * FROM engine_incidents ${where} ORDER BY opened_at DESC, id DESC LIMIT ? OFFSET ?`, ...args, limit, offset);
  const next = offset + page.length < total ? String(offset + page.length) : undefined;
  return { incidents: page.map((r) => incidentOf(ctx, r)), ...(next === undefined ? {} : { next }), total };
}

export const incidentGet = (ctx: EngineCtx, input: { incidentId: string }): { incident: Incident } => ({ incident: loadIncident(ctx, input.incidentId) });

export function incidentAssign(ctx: EngineCtx, input: { incidentId: string; ownerId: string }): { incident: Incident } {
  const cur = loadIncident(ctx, input.incidentId);
  if (cur.state === "resolved") raise(ctx, "validation.precondition_failed", "This incident is resolved. Reopen is not part of v1.", { incidentId: input.incidentId });
  ctx.db.run("UPDATE engine_incidents SET owner_id = ?, state = 'assigned' WHERE id = ?", input.ownerId, input.incidentId);
  ctx.emit("incident.assigned", input.incidentId, { incidentId: input.incidentId, ownerId: input.ownerId });
  return { incident: loadIncident(ctx, input.incidentId) };
}

export function incidentResolve(ctx: EngineCtx, input: { incidentId: string; note: string }): { incident: Incident } {
  const cur = loadIncident(ctx, input.incidentId);
  if (cur.state === "resolved") return { incident: cur };
  if (input.note.trim() === "") raise(ctx, "validation.bad_input", "Say what was done before resolving.");
  addNote(ctx, input.incidentId, input.note);
  ctx.db.run("UPDATE engine_incidents SET state = 'resolved', resolved_at = ? WHERE id = ?", ctx.now(), input.incidentId);
  ctx.emit("incident.resolved", input.incidentId, { incidentId: input.incidentId, by: actorOf(ctx) });
  return { incident: loadIncident(ctx, input.incidentId) };
}

export function incidentNote(ctx: EngineCtx, input: { incidentId: string; text: string }): { incident: Incident } {
  loadIncident(ctx, input.incidentId);
  if (input.text.trim() === "") raise(ctx, "validation.bad_input", "A note needs some text.");
  addNote(ctx, input.incidentId, input.text);
  return { incident: loadIncident(ctx, input.incidentId) };
}
