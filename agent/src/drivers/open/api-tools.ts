// Tools for API-key chats (ARCH 6.7, spec 2.2): the API driver advertises the same tool set the MCP endpoint offers this agent for this asker, and the engine's tool runner executes each
// call through the tool session, which is one capability invoke as the agent acting for the asker. Access, the Gate and the audit happen in that pipeline; nothing here decides them.
// A call the asker may not make comes back as a refused tool result the model reads; a call held at the Gate parks the turn (turn.waiting) through toolRunnerFrom.
import type { ToolSession } from "../../tools/call.ts";
import type { AgentRules, ThreadFacts, ToolCtx, ToolDef } from "../../tools/types.ts";
import { toolRunnerFrom } from "../../turn-engine/tools.ts";
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
  /** What the thread is (kind, Ask scope, plan mode). Default: a plain chat. */
  thread?(threadId: string): Omit<ThreadFacts, "threadId">;
}

export interface ApiTools {
  /** SessionOpenerDeps.apiContext */
  context: (spec: SessionSpec, input: TurnInput) => Promise<SessionContext>;
  /** EngineOptions.callTool */
  runner: ToolRunner;
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
      const tools = [...set.listed, ...set.searchable.filter((t) => loaded.has(t.name)), ...extra].map(view);
      return { system, tools };
    },
    runner: toolRunnerFrom(async (call, ctx) => { await d.prepare?.(ctx); return d.session.call(ctxFor(ctx.threadId, ctx.agentId, ctx.asker, ctx.turnId), call.name, call.input); }),
  };
}
