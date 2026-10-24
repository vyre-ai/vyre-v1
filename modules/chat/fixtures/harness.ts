// Test harness for the chat module: a real in-memory SQLite behind the host's ctx.db guard (chat_* tables only), a recording ctx, a clock the tests move, an in-memory stand-in for the
// capabilities chat calls (settings.get, mcp.token.issue), and checks against the frozen contract.
import { ProjectionHost } from "../../../kernel/src/store/projection.ts";
import { registry } from "../../../generated/registry.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import type { RawDb } from "../../../host/src/ctx/db.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { insertBlock, insertMessage, insertPlan, mintId } from "../projections.ts";
import type { ChatCtx, PlanStep, Principal } from "../projections.ts";

export const NOW = 1_760_000_000_000;
export const TRACE = "0123456789abcdef0123456789abcdef";
export const SPACE = "spc_chattest";
export const DANA = "usr_dana";
export const MAYA = "usr_maya";
export const LEO = "usr_leo";
export const INTAKE = "agt_intake";
export const DRAFTER = "agt_drafter";
export const REVIEWER = "agt_reviewer";

export interface Emitted { name: string; subject: string; payload: Record<string, unknown> }
export interface CallLog { cap: string; input: Record<string, unknown> }

export interface HarnessOptions {
  raw?: RawDb;
  principal?: Principal;
  actingFor?: string;
  clock?: { t: number };
  /** Answers to capabilities chat calls, by name. A name that is absent throws, like a capability the host does not have. */
  calls?: Record<string, (input: Record<string, unknown>) => unknown>;
}

/** A real in-memory SQLite, opened through the kernel's projection host (modules never import node:sqlite, boundary B2). */
export function openRaw(): RawDb {
  const host = ProjectionHost.open({ path: ":memory:", space: SPACE, projections: [] });
  return {
    all: (sql, ...args) => host.tx.all(sql, ...args),
    run: (sql, ...args) => ({ changes: host.tx.run(sql, ...args).changes }),
  };
}

export function harness(o: HarnessOptions = {}) {
  const raw = o.raw ?? openRaw();
  const clock = o.clock ?? { t: NOW };
  const emitted: Emitted[] = [];
  const callLog: CallLog[] = [];
  const answers: Record<string, (input: Record<string, unknown>) => unknown> = {
    "mcp.token.issue": (i) => ({ tokenId: "tok_test", oneTimeToken: "otk_testtoken", expiresAt: clock.t + 600_000, mcpUrl: "https://northwind.example.com/mcp", echo: i }),
    ...(o.calls ?? {}),
  };
  const db = scopedDb("chat", raw, TRACE);
  const ctx: ChatCtx = {
    space: SPACE,
    principal: o.principal ?? { kind: "person", id: DANA },
    ...(o.actingFor === undefined ? {} : { actingFor: o.actingFor }),
    trace: { traceId: TRACE },
    now: () => clock.t,
    db,
    emit(name, subject, payload) { emitted.push({ name, subject, payload: payload as Record<string, unknown> }); return null; },
    async call(cap, input) {
      callLog.push({ cap, input: input as Record<string, unknown> });
      const f = answers[cap];
      if (!f) throw new Error(`${cap} is not available`);
      return f(input as Record<string, unknown>);
    },
    log: { warn() {} },
  };
  const h = {
    ctx, raw, db, emitted, callLog, clock,
    advance(ms: number) { clock.t += ms; },
    rows(sql: string, ...args: unknown[]): Record<string, unknown>[] { return db.all(sql, ...args) as Record<string, unknown>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    names(): string[] { return emitted.map((e) => e.name); },
    clear() { emitted.length = 0; callLog.length = 0; },
    /** The same database as another principal (a second person, an agent, a service). */
    as(principal: Principal, actingFor?: string): ChatCtx { return { ...ctx, principal, ...(actingFor === undefined ? {} : { actingFor }) }; },
    agent(id: string = INTAKE, actingFor: string = DANA): ChatCtx { return h.as({ kind: "agent", id }, actingFor); },
    person(id: string): ChatCtx { return h.as({ kind: "person", id }); },
    /** A question block, parked in a message of the thread, as chat.question.ask will write it (a later packet). */
    seedQuestion(threadId: string, q: { mode: "single" | "multi" | "free"; options?: Array<{ key: string; label: string }>; allowOther?: boolean; prompt?: string }): { blockId: string; messageId: string } {
      const blockId = mintId("blk", clock.t);
      const data = { threadId, blockId, prompt: q.prompt ?? "Which one?", mode: q.mode, options: q.options ?? [], allowOther: q.allowOther ?? false };
      const m = insertMessage(ctx, threadId, { author: INTAKE, kind: "agent", body: "", blocks: [{ type: "question", v: 1, id: blockId, data, state: "waiting", traceId: TRACE }] });
      insertBlock(ctx, { id: blockId, thread: threadId, message: m.id, type: "question", data });
      return { blockId, messageId: m.id };
    },
    /** A proposed plan block, as chat.plan.propose will write it (a later packet). */
    seedPlan(threadId: string, steps: string[] = ["Read the file", "Change the file", "Run the tests"]): { planId: string; blockId: string; messageId: string; stepIds: string[] } {
      const planId = mintId("pln", clock.t), blockId = mintId("blk", clock.t);
      const list: PlanStep[] = steps.map((text, i) => ({ stepId: `stp_${planId.slice(4, 10)}${i}`, text, state: "todo" }));
      const data = { threadId, blockId, planId, title: "The plan", steps: list, state: "proposed" };
      const m = insertMessage(ctx, threadId, { author: INTAKE, kind: "agent", body: "", blocks: [{ type: "plan", v: 1, id: blockId, data, state: "waiting", traceId: TRACE }] });
      insertBlock(ctx, { id: blockId, thread: threadId, message: m.id, type: "plan", data });
      insertPlan(ctx, { id: planId, thread: threadId, block: blockId, title: "The plan", steps: list });
      return { planId, blockId, messageId: m.id, stepIds: list.map((s) => s.stepId) };
    },
  };
  return h;
}

export type Harness = ReturnType<typeof harness>;

export function eventErrors(name: string, payload: unknown): string[] {
  const def = registry.events.find((e) => e.name === name);
  if (!def) return [`${name} is not in the registry`];
  return validate(def.payload, payload, "", registry.$defs);
}

/** Errors of a value against the frozen input or output of a capability. */
export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const def = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  if (!def) return [`${cap} is not in the registry`];
  return validate(side === "in" ? def.input : def.output, value, "", registry.$defs);
}

export function assertEventsConform(h: Harness): string[] {
  return h.emitted.flatMap((e) => eventErrors(e.name, e.payload).map((m) => `${e.name}: ${m}`));
}

export function codeOf(err: unknown): string {
  const e = err as { error?: { code?: string }; code?: string };
  return e?.error?.code ?? e?.code ?? "unknown";
}

/** Run something that must fail and return its error code. */
export async function failure(f: () => unknown): Promise<string> {
  try { await f(); } catch (e) { return codeOf(e); }
  return "none";
}
