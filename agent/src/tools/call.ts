// callTool (ARCH 6.7): every tool call is one capability invoke, as the agent acting for the asker. Nothing here decides access, Gate or audit; the invoke pipeline does,
// and no mode (Ask, Allow, Auto) or plan state can make this module skip it. We only (a) refuse what was never offered this turn, (b) route the answer back as a tool result.
import { nextReads } from "./next.ts";
import { HostError, makeError } from "../../../host/src/routes/errors.ts";
import type { CtxSeed, Invoke } from "../../../host/src/invoke.ts";
import { heldCard, recordWork, workCardOf } from "./work-cards.ts";
import { modelError } from "./model-error.ts";
import type { CapName, ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";
import { limited, shapeOutput } from "./compact.ts";
import { askLevel, refusalFor, searchTools, TASK_BATON_TOOLS, toolsFor, reachesScope } from "./access.ts";
import type { AccessDeps } from "./access.ts";
import type { LocalDecision } from "./local.ts";
import type { Refusal, ToolCtx, ToolDef, ToolResult, ToolSet } from "./types.ts";

export type ToolOutcome =
  | { kind: "result"; result: ToolResult; traceId: string }
  | { kind: "error"; result: ToolResult; error: VyreError }
  /** Parked at the Gate: the turn shows turn.waiting {task} and resumes when it is approved or denied. */
  | { kind: "held"; result: ToolResult; taskId: string; runId?: string; traceId: string };

/** Tools of a turn that are not in the generated catalog: the MCP tools of a plugin or a connection. Each is called through one capability (def.cap), so access, the Gate and the audit apply as to any tool. */
export interface DynamicTools {
  /** May be async: a turn that resumes after a hold or a restart has not listed its tools again yet, so the first call finds them then. */
  find(ctx: ToolCtx, name: string): ToolDef | undefined | Promise<ToolDef | undefined>;
  /** The input of that capability for one call of the tool. */
  input(ctx: ToolCtx, t: ToolDef, input: unknown): unknown;
}

/** Plugin hooks around a call. They run in the sandbox (modules/engine/plugin-runtime.ts); this file only asks and waits. */
export interface CallHooks {
  /** A reason to refuse the call (a PreToolUse hook exited with 2), or null. */
  before?(ctx: ToolCtx, t: ToolDef, input: unknown): Promise<string | null>;
  /** Told how the call ended. Not waited for: a slow hook must not hold the model. */
  after?(ctx: ToolCtx, t: ToolDef, input: unknown, result: { ok: boolean; output: unknown }): Promise<void> | void;
}

export interface CallDeps extends AccessDeps {
  dynamic?: DynamicTools;
  hooks?: CallHooks;
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
  /** List these deferred tools in this thread without a tool_search (names the catalog does not know are ignored). */
  preload(threadId: string, names: readonly string[]): void;
}

const hex = (n: number): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

export function createToolSession(deps: CallDeps): ToolSession {
  const loadedBy = new Map<string, Set<string>>();
  /** The searches each turn has made, so the same one is not run twice. */
  const searchedIn = new Map<string, Set<string>>();
  const newTrace = deps.traceId ?? ((): string => hex(16));
  const loadedSet = (threadId: string): Set<string> => {
    let s = loadedBy.get(threadId);
    if (!s) { s = new Set(); loadedBy.set(threadId, s); }
    return s;
  };

  const fail = (code: ErrorCode, traceId: string, o: { message?: string; details?: Record<string, unknown>; next?: NextStep[] } = {}): ToolOutcome => {
    const error = makeError(code, traceId, o);
    return { kind: "error", error, result: { ok: false, content: { error: modelError(error) } } };
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
      case "ask_scope":
        return fail("permission.role_lacks_permission", traceId, { message: "This Ask changes only what it is about. Continue in a chat to change anything else.", details: { tool: t.name, reason: "ask_scope" } });
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
    const t = deps.catalog.byName(name) ?? (await deps.dynamic?.find(ctx, name));
    if (!t) return fail("validation.unknown_capability", traceId, { message: "There is no such tool.", details: { tool: name } });

    const level = askLevel(deps, ctx.asker, ctx.thread);
    const why = refusalFor(deps, ctx, t, level);
    if (why !== null) return refused(why, ctx, t, traceId);
    if (!reachesScope(t, ctx.thread, input)) return refused("ask_scope", ctx, t, traceId);

    const isDynamic = !deps.catalog.byName(name);
    if (!isDynamic && !deps.defaults.has(t.name) && !(ctx.thread.scope?.type === "task" && TASK_BATON_TOOLS.has(t.name)) && !loadedSet(ctx.thread.threadId).has(t.name)) {
      return fail("validation.precondition_failed", traceId, { message: "Find this tool with tool_search first.", details: { tool: t.name, reason: "not_loaded" } });
    }

    if (t.name === "tool_search") {
      const query = (input as { query?: unknown } | null)?.query;
      if (typeof query !== "string" || query.trim() === "") return fail("validation.bad_input", traceId, { details: { errors: ["/query: required"], tool: t.name } });
      // The same search twice in one turn finds the same tools: the second time says so instead of searching again (a model went round this loop nineteen times).
      if (ctx.turnId) {
        const key = query.trim().toLowerCase().replace(/\s+/g, " ");
        let asked = searchedIn.get(ctx.turnId);
        if (!asked) { asked = new Set(); searchedIn.set(ctx.turnId, asked); if (searchedIn.size > 200) searchedIn.delete(searchedIn.keys().next().value as string); }
        if (asked.has(key)) {
          return { kind: "result", traceId, result: { ok: true, content: { data: { tools: [], hint: "You already searched for that in this turn. What it found can be called now; call one of those tools, or change the words. If nothing fits, answer with what you have and say what is missing." } } } };
        }
        asked.add(key);
      }
      const found = api.search(ctx, query);
      return {
        kind: "result", traceId,
        result: { ok: true, content: { data: { tools: found.map((f) => ({ name: f.name, summary: f.summary, toolset: f.toolset, inputSchema: f.inputSchema })) } } },
      };
    }

    let localAsk = false;
    if (t.local !== "none") {
      const d = deps.localPolicy ? deps.localPolicy(t, ctx, input) : ({ action: "refuse", reason: "no local policy" } as LocalDecision);
      if (d.action === "refuse") return fail("permission.role_lacks_permission", traceId, { message: "That is not allowed on this computer.", details: { tool: t.name, reason: d.reason } });
      if (d.action === "prompt") {
        // With no way to ask on the spot (a turn that runs on a server) the question is the Gate's: the call is held for a yes the person answers in the chat, never refused and never run unasked.
        if (deps.prompt) {
          const yes = await deps.prompt(t, ctx, input);
          if (!yes) return fail("permission.needs_approval", traceId, { message: "The person did not allow this.", details: { tool: t.name, reason: "local_prompt" } });
        } else localAsk = true;
      }
    }

    if (deps.hooks?.before) {
      const reason = await deps.hooks.before(ctx, t, input).catch(() => null);
      if (reason !== null) return fail("permission.role_lacks_permission", traceId, { message: `A plugin hook stopped this: ${reason}`, details: { tool: t.name, reason: "hook" } });
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
      ...(ctx.thread.mode !== undefined ? { chatMode: ctx.thread.mode } : {}),
      // Ask first: a tool that changes or sends something is parked for a yes before it runs. Tools plan mode allows (reads, questions, plan proposals) never wait. Auto adds nothing and removes nothing: the Gate decides, as before.
      // An Ask pane never sends anything out on its own, in any mode: what leaves Vyre from one always stops for a yes.
      ...((ctx.thread.mode === "ask" && t.effects !== "read" && t.planMode === "blocked") || (localAsk && t.effects !== "read") || (ctx.thread.kind === "ask" && t.effects === "outward") ? { askFirst: true } : {}),
      ...(localAsk && t.effects !== "read" ? { mustAsk: true } : {}),
      ...(t.effects !== "read" && t.planMode === "blocked" ? { askable: true } : {}),
    };
    try {
      const res = await deps.invoke(t.cap, isDynamic && deps.dynamic ? deps.dynamic.input(ctx, t, input) : limited(t.cap, unstringified(t.inputSchema, input)), seed);
      if (res.status === "held") {
        recordWork(ctx.turnId, heldCard(t.cap, res.taskId, input));
        return {
          kind: "held", taskId: res.taskId, traceId: res.traceId, ...(res.runId === undefined ? {} : { runId: res.runId }),
          result: { ok: false, content: { held: true, taskId: res.taskId, message: "Waiting for approval." } },
        };
      }
      // A Flow the agent drafted in a chat leaves its card there. Done here, after the call returned, because only now is the new draft registered in access, so the card's handler (chat.flow_card) can read it
      // as the agent; the card itself is written by that server handler, so the agent cannot dress up a button.
      if (t.cap === "automations.create" && ctx.thread.threadId) {
        const made = (res.output as { automation?: { id?: unknown } } | null)?.automation?.id;
        if (typeof made === "string") await deps.invoke("chat.flow_card", { threadId: ctx.thread.threadId, automationId: made, idempotencyKey: `flow-card:${made}` }, seed).catch(() => undefined);
      }
      recordWork(ctx.turnId, workCardOf(t.cap, input, res.output));
      // the calendar and mail reads come back to a model as compact rows with a count and a size (compact.ts); the full answer is what the hooks and the work card see
      const shaped = isDynamic ? null : shapeOutput(t.cap, res.output);
      const content: { data: unknown; meta?: unknown; blocks?: string[]; next?: string } = shaped ? { data: shaped.data, meta: shaped.meta } : { data: res.output };
      if (t.blocks.length > 0) content.blocks = t.blocks;
      // a list names the tool that reads one item, and that tool is listed from now on: no search to find it
      const reads = nextReads(t.name);
      if (reads.length > 0) {
        const set = toolsFor(deps, ctx), offered = new Set([...set.listed, ...set.searchable].map((x) => x.name));
        const ready = reads.filter((n) => offered.has(n));
        if (ready.length > 0) { for (const n of ready) loadedSet(ctx.thread.threadId).add(n); content.next = `To read one of these, call ${ready.join(" or ")} with its id. ${ready.length > 1 ? "They are" : "It is"} ready to call now.`; }
      }
      if (deps.hooks?.after) void Promise.resolve(deps.hooks.after(ctx, t, input, { ok: true, output: res.output })).catch(() => undefined);
      return { kind: "result", traceId: res.traceId, result: { ok: true, content } };
    } catch (e) {
      if (e instanceof HostError) return { kind: "error", error: e.error, result: { ok: false, content: { error: modelError(e.error) } } };
      // a failure nobody named (a crash inside a module): a plain sentence the model can act on, never a bare "500"; the cause and stack are in the server log under this trace (host/src/invoke.ts)
      return fail("internal.unexpected", traceId, {
        message: `${t.name} could not finish on the server just now, and nothing was changed. Try it once more; if it fails again, tell the person in plain words that it did not work. Do not paste ids or traces.`,
        details: { tool: t.name, reason: "server_error" },
      });
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
    preload: (threadId, names) => { const set = loadedSet(threadId); for (const n of names) set.add(n); },
  };
  return api;
}

/**
 * Some models send a list or an object argument as its JSON text ("[{...}]" where the schema says array). Read back only what the tool's own schema says is a list or an object, only at the top level, and
 * only when the text parses to that very shape; anything else is passed on as given, so validation still says what is wrong.
 */
export function unstringified(schema: unknown, input: unknown): unknown {
  const props = (schema as { properties?: Record<string, { type?: unknown }> } | null)?.properties;
  if (!props || input === null || typeof input !== "object" || Array.isArray(input)) return input;
  let out: Record<string, unknown> | null = null;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const want = props[k]?.type;
    if (typeof v !== "string" || (want !== "array" && want !== "object")) continue;
    const s = v.trim();
    if (!(want === "array" ? s.startsWith("[") : s.startsWith("{"))) continue;
    try {
      const parsed = JSON.parse(s) as unknown;
      if (want === "array" ? Array.isArray(parsed) : parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) (out ??= { ...(input as Record<string, unknown>) })[k] = parsed;
    } catch { /* not JSON: validation says so */ }
  }
  return out ?? input;
}
