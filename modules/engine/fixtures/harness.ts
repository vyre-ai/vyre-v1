// Test harness for the engine handlers: a real in-memory SQLite behind the host's ctx.db guard (engine_* tables only), a recording ctx, a scripted
// stand-in for the capabilities the handlers call (threads.get, tasks.create), and checks against the frozen contract.
import { ProjectionHost } from "../../../kernel/src/store/projection.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import type { RawDb } from "../../../host/src/ctx/db.ts";
import { eventErrors } from "./contract.ts";
import { createEngineRuntime } from "../impl.ts";
import { bindEngine } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";
import type { TurnEngine } from "../../../agent/src/turn-engine/engine.ts";
import type { EngineOptions } from "../../../agent/src/turn-engine/engine.ts";
import type { OpenSession } from "../../../agent/src/turn-engine/types.ts";
import { strictGuard } from "../../../packages/contracts/src/contract-check.ts";
import { registry as strictRegistry } from "../../../generated/registry.ts";
import { validateInput as strictValidate } from "../../../generated/validators.ts";
const assertStrictInput = strictGuard(strictRegistry, strictValidate);

export const NOW = 1_760_000_000_000;
export const TRACE = "0123456789abcdef0123456789abcdef";

export interface Emitted { name: string; subject: string; payload: Record<string, unknown> }
export interface Called { cap: string; input: Record<string, unknown> }
export interface ThreadAgentSpec { agentId: string; mode: "lead" | "listen"; model?: string; provider?: string; accountRef?: string }
export interface ThreadSpec { threadId: string; kind?: string; starter?: string; agents: ThreadAgentSpec[] }

export interface HarnessOptions {
  /** Share one database between two harnesses (two hosts on one Space). */
  raw?: RawDb;
  principal?: EngineCtx["principal"];
  threads?: ThreadSpec[];
  /** The caller may manage AI spend (ai.spend). Default true. */
  manager?: boolean;
  /** tasks.create fails (the tasks module is down). */
  tasksFail?: boolean;
  clock?: { t: number };
}

/** A real in-memory SQLite, opened through the kernel's projection host (modules never import node:sqlite, boundary B2). */
export function openRaw(): RawDb {
  const host = ProjectionHost.open({ path: ":memory:", space: "spc_enginetest", projections: [] });
  return {
    all: (sql, ...args) => host.tx.all(sql, ...args),
    run: (sql, ...args) => ({ changes: host.tx.run(sql, ...args).changes }),
  };
}

export function harness(o: HarnessOptions = {}) {
  const raw = o.raw ?? openRaw();
  const clock = o.clock ?? { t: NOW };
  const emitted: Emitted[] = [];
  const called: Called[] = [];
  const threads = new Map((o.threads ?? []).map((t) => [t.threadId, t]));
  let tasks = 0;
  let manager = o.manager !== false;
  let tasksFail = o.tasksFail === true;
  const db = scopedDb("engine", raw, TRACE);
  const ctx: EngineCtx = {
    space: "spc_enginetest",
    principal: o.principal ?? { kind: "person", id: "usr_dana" },
    trace: { traceId: TRACE },
    now: () => clock.t,
    db,
    emit(name, subject, payload) {
      emitted.push({ name, subject, payload: payload as Record<string, unknown> });
      return null;
    },
    async call(cap, input) {
      assertStrictInput(cap, input);
      const body = input as Record<string, unknown>;
      called.push({ cap, input: body });
      if (cap === "threads.get") {
        const t = threads.get(String(body["threadId"]));
        if (!t) throw new Error("no such thread");
        return { thread: { threadId: t.threadId, ...(t.kind === undefined ? {} : { kind: t.kind }), ...(t.starter === undefined ? {} : { starter: t.starter }), agents: t.agents } };
      }
      if (cap === "tasks.create") {
        if (tasksFail) throw new Error("tasks is down");
        return { task: { id: `tsk_card${++tasks}` } };
      }
      throw new Error(`unexpected capability ${cap}`);
    },
    authorize: () => ({ effect: manager ? "allow" : "deny" }),
    log: { warn() {} },
  };
  return {
    ctx, raw, db, emitted, called, clock,
    advance(ms: number) { clock.t += ms; },
    setManager(v: boolean) { manager = v; },
    failTasks(v: boolean) { tasksFail = v; },
    rows(sql: string, ...args: unknown[]): Record<string, unknown>[] { return db.all(sql, ...args) as Record<string, unknown>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    calls(cap: string): Called[] { return called.filter((c) => c.cap === cap); },
    /** A turn engine on this harness's tables, bound for the handlers. */
    runtime(opts: { openSession: OpenSession; holder?: string } & Partial<Omit<EngineOptions, "openSession" | "holder">>): TurnEngine {
      const { openSession, holder, ...rest } = opts;
      const engine = createEngineRuntime({ db, holder: holder ?? "host:spc_enginetest", openSession, now: () => clock.t, ...rest });
      bindEngine(engine);
      return engine;
    },
  };
}

export type Harness = ReturnType<typeof harness>;

export { contractErrors, eventErrors } from "./contract.ts";

/** Every event the harness saw conforms to its schema. */
export function assertEventsConform(h: Harness): string[] {
  return h.emitted.flatMap((e) => eventErrors(e.name, e.payload).map((m) => `${e.name}: ${m}`));
}

export function codeOf(err: unknown): string {
  const shaped = err as { error?: { code?: string } } | null;
  return shaped?.error?.code ?? "";
}
