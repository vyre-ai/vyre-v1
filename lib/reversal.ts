// Learn from an undo (owner approval 3 Nov 2026, "Learn from every correction"): when a person undoes or reverses what an agent did (restores what it deleted, puts back an earlier version of what it
// wrote, moves back what it moved, reverts the change it proposed, undoes its Run), the agent keeps a lesson, the same lesson a "no" in chat leaves (memory.corrections.record, how "reverse").
// One seam serves every undo path: a module wraps the capability that undoes (`withReversals`), and the wrapper
//   1. before the undo runs, finds who made the latest act the undo reverses (the event log: the newest event of the types the undo reverses; or the module's own record when it keeps one),
//   2. after the undo worked, tells memory, as the person, with a plain line of what was undone and a reference that makes one lesson per act however often it is undone and redone.
// Only a person's own press teaches, and only an agent's act is a correction: the person undoing their own work, or a colleague's, leaves nothing. memory.corrections.record keeps the privacy rules (the
// switch Learn from my corrections, a chat set not to be remembered, an agent that keeps no memory, and a chat other people read keeps nothing without the person's own words), so nothing here repeats
// them. A memory that fails never holds the undo up.
export type Subject = { type: string; id: string };
export interface LoggedAct { seq: number; id: string; type: string; actor: string; runId?: string; payload: Record<string, unknown> }
/** The agent whose act is being reversed, the chat it happened in when known, and a stable reference for it. */
export interface AgentAct { agentId: string; ref: string; threadId?: string | undefined; event?: LoggedAct }

export interface ReverseCtx { principal: { kind: string; id: string }; call?(cap: string, input: unknown): Promise<unknown> }

/** How one undoing capability finds the act it reverses and says what was undone. */
/* eslint-disable @typescript-eslint/no-explicit-any -- a table of rules over handlers whose inputs and outputs differ */
export interface Reversal<C = any, I = any, O = any> {
  /** The thing whose latest event is being reversed, read from the event log. */
  subject?(input: I): Subject | null;
  /** The event types that make the act (the newest of them counts). */
  types?: readonly string[];
  /** A narrower test on that newest event (moving back: the event it left from is where this puts it). */
  match?(e: LoggedAct, input: I): boolean;
  /** For a module that keeps its own record of who did it (a changeset's author, a task's history, a Run's owner): the act, with no event lookup. */
  actOf?(ctx: C, input: I): AgentAct | AgentAct[] | null | Promise<AgentAct | AgentAct[] | null>;
  /** What was undone, in a plain phrase ("deleted the file Q3 plan.pdf"). Null: nothing was undone, so nothing is taught. */
  was(input: I, out: O, act: AgentAct, acts: readonly AgentAct[]): string | null;
  /** The correction is a "no" to a proposal rather than an undo of a done act (discarding what the agent staged). */
  how?: "reverse" | "refuse";
}

export const isAgentId = (id: unknown): id is string => typeof id === "string" && /^agt_/.test(id);

/** Every event of these types on this subject, oldest first (paged, as the Run's undo does). */
async function eventsOf(ctx: ReverseCtx, subject: Subject, types: readonly string[]): Promise<LoggedAct[]> {
  const all: LoggedAct[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const r = (await ctx.call!("events.list", { subject, types: [...types], ...(cursor ? { cursor } : {}), limit: 500 })) as { events?: LoggedAct[]; next?: string } | null;
    all.push(...(r?.events ?? []));
    if (!r?.next) break;
    cursor = r.next;
  }
  return all.sort((a, b) => a.seq - b.seq);
}

/** The agent behind the newest event of these types on a subject, or null when a person (or anything else) made it. Read before the undo runs, since the undo may add events of the same type. */
export async function agentBehind(ctx: ReverseCtx, subject: Subject, types: readonly string[], match?: (e: LoggedAct) => boolean): Promise<AgentAct | null> {
  if (ctx.principal.kind !== "person" || !ctx.call) return null;
  const newest = (await eventsOf(ctx, subject, types)).at(-1);
  if (!newest || !isAgentId(newest.actor) || (match && !match(newest))) return null;
  let threadId: string | undefined;
  if (newest.runId) {
    try { threadId = ((await ctx.call("runs.get", { runId: newest.runId })) as { run?: { threadId?: string } } | null)?.run?.threadId; } catch { /* no chat is known; the act stands on its own */ }
  }
  return { agentId: newest.actor, ref: newest.id, threadId, event: newest };
}

/** Tell memory the person undid an agent's act. A memory that fails, or says nothing was kept, changes nothing here. */
export async function taught(ctx: ReverseCtx, act: AgentAct, was: string, how: "reverse" | "refuse" = "reverse"): Promise<void> {
  if (!ctx.call) return;
  try {
    await ctx.call("memory.corrections.record", { agentId: act.agentId, how, was, ...(act.threadId ? { threadId: act.threadId } : {}), ref: `${how}:${act.ref}` });
  } catch { /* the undo stands; the lesson is a courtesy */ }
}

/** The agents that made a Run's writes (the actors of its events), each with the chat the Run came from, for undoing the Run. */
export async function agentsOfRun(ctx: { call?(cap: string, input: unknown): Promise<unknown> }, runId: string): Promise<AgentAct[]> {
  if (!ctx.call) return [];
  const r = (await ctx.call("events.list", { runId, limit: 500 })) as { events?: LoggedAct[] } | null;
  const agents = [...new Set((r?.events ?? []).map((e) => e.actor).filter(isAgentId))];
  if (agents.length === 0) return [];
  let threadId: string | undefined;
  try { threadId = ((await ctx.call("runs.get", { runId })) as { run?: { threadId?: string } } | null)?.run?.threadId; } catch { /* the Run stands on its own */ }
  return agents.map((agentId) => ({ agentId, ref: `run:${runId}`, threadId }));
}

type Handler = (ctx: any, input: any) => Promise<unknown>;
/** The same handler map with the undoing capabilities wrapped. Each wrapper looks first and teaches after; the handler itself runs exactly as before. */
export function withReversals<H extends Record<string, Handler>>(handlers: H, table: Record<string, Reversal>): H {
  const out: Record<string, Handler> = { ...handlers };
  for (const [cap, r] of Object.entries(table)) {
    const inner = handlers[cap] as Handler | undefined;
    if (!inner) continue;
    const rule = r;
    out[cap] = (async (ctx: ReverseCtx, input: any): Promise<unknown> => {
      let acts: AgentAct[] = [];
      if (ctx.principal.kind === "person" && ctx.call) {
        try {
          if (rule.actOf) { const a = await rule.actOf(ctx, input); acts = a === null ? [] : Array.isArray(a) ? a : [a]; }
          else {
            const subject = rule.subject?.(input);
            const one = subject && rule.types ? await agentBehind(ctx, subject, rule.types, rule.match ? (e) => rule.match!(e, input) : undefined) : null;
            acts = one ? [one] : [];
          }
        } catch { acts = []; }
      }
      const result = await inner(ctx, input);
      for (const act of acts) {
        let was: string | null = null;
        try { was = rule.was(input, result, act, acts); } catch { was = null; }
        if (was) await taught(ctx, act, was, rule.how ?? "reverse");
      }
      return result;
    }) as Handler;
  }
  return out as H;
}
