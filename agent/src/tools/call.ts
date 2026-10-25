// callTool (ARCH 6.7): every tool call is one capability invoke, as the agent acting for the asker. Nothing here decides access, Gate or audit; the invoke pipeline does,
// and no mode (Ask, Allow, Auto) or plan state can make this module skip it. We only (a) refuse what was never offered this turn, (b) route the answer back as a tool result.
import { HostError, makeError } from "../../../host/src/routes/errors.ts";
import type { CtxSeed, Invoke } from "../../../host/src/invoke.ts";
import type { CapName, ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";
import { askLevel, refusalFor, searchTools, toolsFor } from "./access.ts";
import type { AccessDeps } from "./access.ts";
import type { LocalDecision } from "./local.ts";
import type { Refusal, ToolCtx, ToolDef, ToolResult, ToolSet } from "./types.ts";

export type ToolOutcome =
  | { kind: "result"; result: ToolResult; traceId: string }
  | { kind: "error"; result: ToolResult; error: VyreError }
  /** Parked at the Gate: the turn shows turn.waiting {task} and resumes when it is approved or denied. */
  | { kind: "held"; result: ToolResult; taskId: string; runId?: string; traceId: string };

export interface CallDeps extends AccessDeps {
  invoke: Invoke;
  traceId?(): string;
  /** Local tools only: what Ask, Allow and Auto say. Fails closed: a missing policy refuses a local tool. */
  localPolicy?(t: ToolDef, ctx: ToolCtx, input: unknown): LocalDecision;
  /** Local tools that need a prompt: resolves true when the person allows this one call. */
  prompt?(t: ToolDef, ctx: ToolCtx, input: unknown): Promise<boolean>;
}

export interface ToolSession {
  toolsFor(ctx: ToolCtx): ToolSet;
  /** `approval` is the Gate resume path's token for exactly this payload; nothing else may set it. */
  call(ctx: ToolCtx, name: string, input: unknown, opts?: { approval?: string }): Promise<ToolOutcome>;
  search(ctx: ToolCtx, query: string): ToolDef[];
  /** Deferred tools found by tool_search in this thread. */
  loaded(threadId: string): ReadonlySet<string>;
  forget(threadId: string): void;
}

const hex = (n: number): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

export function createToolSession(deps: CallDeps): ToolSession {
  const loadedBy = new Map<string, Set<string>>();
  const newTrace = deps.traceId ?? ((): string => hex(16));
  const loadedSet = (threadId: string): Set<string> => {
    let s = loadedBy.get(threadId);
    if (!s) { s = new Set(); loadedBy.set(threadId, s); }
    return s;
  };

  const fail = (code: ErrorCode, traceId: string, o: { message?: string; details?: Record<string, unknown>; next?: NextStep[] } = {}): ToolOutcome => {
    const error = makeError(code, traceId, o);
    return { kind: "error", error, result: { ok: false, content: { error } } };
  };

  const askAccessNext = (ctx: ToolCtx, t: ToolDef): NextStep[] => {
    const scope = ctx.thread.scope;
    if (!scope) return [];
    return [{ kind: "ask_access", label: "Ask for access", action: { cap: "access.request" as CapName, input: { resource: scope, level: t.level } } }];
  };

  const refused = (why: Refusal, ctx: ToolCtx, t: ToolDef, traceId: string): ToolOutcome => {
    switch (why) {
      case "plan_mode":
        return fail("permission.plan_mode", traceId, { details: { tool: t.name } });
      case "ask_level":
        return fail("permission.role_lacks_permission", traceId, { message: "This pane only has view access to what you are looking at.", details: { tool: t.name, reason: "ask_level", needs: t.level }, next: askAccessNext(ctx, t) });
      case "no_access":
        return fail("permission.no_grant", traceId, { details: { tool: t.name, reason: "no_access" }, next: askAccessNext(ctx, t) });
      case "agent_denied":
        return fail("permission.role_lacks_permission", traceId, { message: "This agent is not allowed to use that tool.", details: { tool: t.name, reason: "agent_denied" } });
      case "engineer":
        return fail("permission.role_lacks_permission", traceId, { message: "The engineer tools need engineer access.", details: { tool: t.name, reason: "engineer" } });
    }
  };

  async function call(ctx: ToolCtx, name: string, input: unknown, opts: { approval?: string } = {}): Promise<ToolOutcome> {
    const traceId = ctx.trace?.traceId ?? newTrace();
    const t = deps.catalog.byName(name);
    if (!t) return fail("validation.unknown_capability", traceId, { message: "There is no such tool.", details: { tool: name } });

    const level = askLevel(deps, ctx.asker, ctx.thread);
    const why = refusalFor(deps, ctx, t, level);
    if (why !== null) return refused(why, ctx, t, traceId);

    if (!deps.defaults.has(t.name) && !loadedSet(ctx.thread.threadId).has(t.name)) {
      return fail("validation.precondition_failed", traceId, { message: "Find this tool with tool_search first.", details: { tool: t.name, reason: "not_loaded" } });
    }

    if (t.name === "tool_search") {
      const query = (input as { query?: unknown } | null)?.query;
      if (typeof query !== "string" || query.trim() === "") return fail("validation.bad_input", traceId, { details: { errors: ["/query: required"], tool: t.name } });
      const found = api.search(ctx, query);
      return {
        kind: "result", traceId,
        result: { ok: true, content: { data: { tools: found.map((f) => ({ name: f.name, summary: f.summary, toolset: f.toolset, inputSchema: f.inputSchema })) } } },
      };
    }

    if (t.local !== "none") {
      const d = deps.localPolicy ? deps.localPolicy(t, ctx, input) : ({ action: "refuse", reason: "no local policy" } as LocalDecision);
      if (d.action === "refuse") return fail("permission.role_lacks_permission", traceId, { message: "That is not allowed on this computer.", details: { tool: t.name, reason: d.reason } });
      if (d.action === "prompt") {
        const yes = deps.prompt ? await deps.prompt(t, ctx, input) : false;
        if (!yes) return fail("permission.needs_approval", traceId, { message: "The person did not allow this.", details: { tool: t.name, reason: "local_prompt" } });
      }
    }

    const seed: CtxSeed = {
      space: ctx.space,
      principal: { kind: "agent", id: ctx.agentId },
      actingFor: ctx.asker,
      trace: ctx.trace,
      run: ctx.runId,
      thread: ctx.thread.threadId,
      origin: "agent",
      provider: ctx.provider,
      approval: opts.approval,
    };
    try {
      const res = await deps.invoke(t.cap, input, seed);
      if (res.status === "held") {
        return {
          kind: "held", taskId: res.taskId, traceId: res.traceId, ...(res.runId === undefined ? {} : { runId: res.runId }),
          result: { ok: false, content: { held: true, taskId: res.taskId, message: "Waiting for approval." } },
        };
      }
      const content: { data: unknown; blocks?: string[] } = { data: res.output };
      if (t.blocks.length > 0) content.blocks = t.blocks;
      return { kind: "result", traceId: res.traceId, result: { ok: true, content } };
    } catch (e) {
      if (e instanceof HostError) return { kind: "error", error: e.error, result: { ok: false, content: { error: e.error } } };
      return fail("internal.unexpected", traceId, { message: "Something went wrong on our side." });
    }
  }

  const api: ToolSession = {
    toolsFor: (ctx) => toolsFor(deps, ctx),
    call,
    search(ctx, query) {
      const found = searchTools(toolsFor(deps, ctx).searchable, query);
      const set = loadedSet(ctx.thread.threadId);
      for (const f of found) set.add(f.name);
      return found;
    },
    loaded: (threadId) => loadedSet(threadId),
    forget: (threadId) => { loadedBy.delete(threadId); },
  };
  return api;
}
