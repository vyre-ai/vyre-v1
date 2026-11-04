// Tools for API-key chats (ARCH 6.7, spec 2.2): the API driver advertises the same tool set the MCP endpoint offers this agent for this asker, and the engine's tool runner executes each
// call through the tool session, which is one capability invoke as the agent acting for the asker. Access, the Gate and the audit happen in that pipeline; nothing here decides them.
// A call the asker may not make comes back as a refused tool result the model reads; a call held at the Gate parks the turn (turn.waiting) through toolRunnerFrom.
import type { ToolSession } from "../../tools/call.ts";
import type { AgentRules, ThreadFacts, ToolCtx, ToolDef } from "../../tools/types.ts";
import { toolRunnerFrom } from "../../turn-engine/tools.ts";
import type { ToolOutcomeLike } from "../../turn-engine/tools.ts";
import type { ToolRunner } from "../../turn-engine/engine.ts";
import type { SessionSpec, TurnInput } from "../../turn-engine/types.ts";
import type { SessionContext } from "../api/session.ts";
import type { ApiTool, SystemBlock } from "../api/types.ts";

export interface ApiToolsDeps {
  session: ToolSession;
  space: string;
  /** The system prompt blocks for a turn (guide, VYRE.md, AGENT.md). */
  system(spec: SessionSpec, input: TurnInput): SystemBlock[] | Promise<SystemBlock[]>;
  /** The agent's allow and deny lists. */
  rules?(agentId: string): AgentRules | undefined;
  /** Read what decides a turn's tool set (the agent's lists, the thread, the asker's level on an Ask pane's object) before the set is built or a tool runs. Called once per turn. */
  prepare?(turn: { threadId: string; agentId: string; asker: string; turnId: string }): Promise<void>;
  /** Tools this turn has besides the catalog (an agent's plugin MCP tools). Listed to the model after the catalog's own; the tool session finds them again by name. */
  extra?(ctx: ToolCtx): Promise<readonly ToolDef[]>;
  /** Told after a call reached its tool (not a search, not a refusal): which agent used which tool. The engine counts it to list the agent's most used tools next time. */
  used?(agentId: string, tool: string): void;
  /** Is this tool an independent read? tool_batch runs only those. */
  isRead?(name: string): boolean;
  /** What the thread is (kind, Ask scope, plan mode). Default: a plain chat. */
  thread?(threadId: string): Omit<ThreadFacts, "threadId">;
}

/** The most reads one tool_batch runs. */
export const BATCH_MAX = 6;
/** Providers whose models are not told parallel calls are on (a local or custom server): they get tool_batch, so several reads still go in one step. */
export const BATCH_PROVIDERS: ReadonlySet<string> = new Set(["local", "custom"]);
const BATCH_TOOL: ApiTool = {
  name: "tool_batch",
  description: `Run up to ${BATCH_MAX} independent read-only tools at once. Each request has an id you choose, the tool name and its input; the results come back keyed by id. Only reads: anything that changes or sends something is called on its own.`,
  inputSchema: { type: "object", properties: { requests: { type: "array", maxItems: BATCH_MAX, items: { type: "object", properties: { id: { type: "string" }, tool: { type: "string" }, input: { type: "object" } }, required: ["id", "tool"] } } }, required: ["requests"] },
};

export interface ApiTools {
  /** SessionOpenerDeps.apiContext */
  context: (spec: SessionSpec, input: TurnInput) => Promise<SessionContext>;
  /** EngineOptions.callTool */
  runner: ToolRunner;
  /** EngineOptions.toolClass: which calls of one step may run together (independent reads). */
  toolClass?: (name: string) => "read" | "other";
}

const view = (t: ToolDef): ApiTool => ({ name: t.name, description: t.summary, inputSchema: t.inputSchema ?? { type: "object", properties: {} } });

export function createApiTools(d: ApiToolsDeps): ApiTools {
  /** The engine's provider per thread, recorded when the turn's context is built, so the label-vs-provider rule sees it when the tool runs. */
  const providerOf = new Map<string, string>();
  const ctxFor = (threadId: string, agentId: string, asker: string, turnId?: string): ToolCtx => {
    const rules = d.rules?.(agentId);
    const provider = providerOf.get(threadId);
    return {
      space: d.space, agentId, asker, thread: { threadId, kind: "chat", planMode: false, ...d.thread?.(threadId) },
      ...(rules ? { rules } : {}), ...(provider ? { provider } : {}), ...(turnId ? { turnId } : {}),
    };
  };
  /** tool_batch: the reads run together and each answer comes back under its request id; a request that is not an independent read is refused by itself and does not stop the rest. */
  const runBatch = async (input: unknown, ctx: { threadId: string; agentId: string; asker: string; turnId: string }): Promise<ToolOutcomeLike> => {
    const asked = ((input as { requests?: unknown } | null)?.requests);
    const list = Array.isArray(asked) ? asked.slice(0, BATCH_MAX) : [];
    const c = ctxFor(ctx.threadId, ctx.agentId, ctx.asker, ctx.turnId);
    const settled = await Promise.allSettled(list.map(async (r, i) => {
      const q = (r ?? {}) as { id?: unknown; tool?: unknown; input?: unknown };
      const id = typeof q.id === "string" && q.id !== "" ? q.id : String(i + 1);
      if (typeof q.tool !== "string" || !d.isRead!(q.tool)) return [id, { ok: false, content: { error: "tool_batch runs independent reads only. Call this one on its own." } }] as const;
      const out = await d.session.call(c, q.tool, q.input ?? {});
      if (out.kind === "result" && out.result.ok) { try { d.used?.(ctx.agentId, q.tool); } catch { /* counting never fails a call */ } }
      return [id, { ok: out.result.ok, content: out.result.content }] as const;
    }));
    const results: Record<string, unknown> = {};
    settled.forEach((s, i) => { const id = s.status === "fulfilled" ? s.value[0] : String(i + 1); results[id] = s.status === "fulfilled" ? s.value[1] : { ok: false, content: { error: "That read failed." } }; });
    if (Array.isArray(asked) && asked.length > BATCH_MAX) results["_skipped"] = { ok: false, content: { error: `Only the first ${BATCH_MAX} requests ran. Ask for the rest in another call.` } };
    return { kind: "result", result: { ok: true, content: { data: { results } } } };
  };
  return {
    async context(spec, input) {
      const account = (spec as SessionSpec & { account?: { provider?: string } }).account;
      if (account?.provider) providerOf.set(input.threadId, account.provider);
      // The system prompt first: building it may read what decides the tool set (the agent's lists, the thread, the asker's level on an Ask pane's object).
      await d.prepare?.({ threadId: input.threadId, agentId: input.agent.id, asker: input.asker, turnId: input.turnId });
      const system = await d.system(spec, input);
      const c = ctxFor(input.threadId, input.agent.id, input.asker, input.turnId);
      const set = d.session.toolsFor(c);
      const loaded = d.session.loaded(input.threadId);
      const extra = d.extra ? await d.extra(c).catch(() => []) : [];
      const batch = account?.provider !== undefined && BATCH_PROVIDERS.has(account.provider) && d.isRead !== undefined ? [BATCH_TOOL] : [];
      const tools = [...set.listed, ...set.searchable.filter((t) => loaded.has(t.name)), ...extra].map(view).concat(batch);
      // the same set read again: after tool_search the loaded set has grown, and the driver adds what is new to the next step of the turn
      const reload = async (): Promise<ApiTool[]> => {
        const now = d.session.toolsFor(c);
        const have = d.session.loaded(input.threadId);
        return [...now.listed, ...now.searchable.filter((t) => have.has(t.name)), ...extra].map(view).concat(batch);
      };
      return { system, tools, reload };
    },
    runner: toolRunnerFrom(async (call, ctx) => {
      await d.prepare?.(ctx);
      if (call.name === "tool_batch" && d.isRead) return runBatch(call.input, ctx);
      const out = await d.session.call(ctxFor(ctx.threadId, ctx.agentId, ctx.asker, ctx.turnId), call.name, call.input);
      if (out.kind === "result" && out.result.ok && call.name !== "tool_search") { try { d.used?.(ctx.agentId, call.name); } catch { /* counting never fails a call */ } }
      return out;
    }),
  };
}
