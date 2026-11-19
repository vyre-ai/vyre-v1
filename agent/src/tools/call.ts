// callTool (ARCH 6.7): every tool call is one capability invoke, as the agent acting for the asker. Nothing here decides access, Gate or audit; the invoke pipeline does,
// and no mode (Ask, Allow, Auto) or plan state can make this module skip it. We only (a) refuse what was never offered this turn, (b) route the answer back as a tool result.
import { nextReads } from "./next.ts";
import { HostError, makeError } from "../../../host/src/routes/errors.ts";
import type { CtxSeed, Invoke } from "../../../host/src/invoke.ts";
import { heldCard, recordWork, workCardOf } from "./work-cards.ts";
import { modelError } from "./model-error.ts";
import { PROBE_MESSAGE, probeIn } from "../../../lib/probe.ts";
import type { CapName, ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";
import { limited, shapeOutput } from "./compact.ts";
import { turnStartOf } from "./turn-start.ts";
import {
  HIDDEN_FROM_MODEL,
  SeenVersions,
  changedSinceTurn,
  kindOfWrite,
  learned,
  learnedRows,
  rowKey,
} from "./versions.ts";
import { canonical, fillInput, shortHash } from "./fill.ts";
import { findsByPath, placeField, placeInput } from "./place.ts";
import { parseProblem, rejectWords, unknownInputs } from "./reject.ts";
import { askLevel, refusalFor, searchTools, TASK_BATON_TOOLS, toolsFor, reachesScope } from "./access.ts";
import type { AccessDeps } from "./access.ts";
import type { LocalDecision } from "./local.ts";
import type { HookFire, HookVerdict } from "./hooks.ts";
import type { Refusal, ToolCtx, ToolDef, ToolResult, ToolSet } from "./types.ts";
import { withLocalTimes } from "../../../lib/time-convert.ts";

/** What an agent is told when it asks for a computer: agents no longer get a desktop (6 Nov), they have a terminal and a browser already. There is nothing for a person to set up. */
export const NO_COMPUTER_WORDS =
  "Agents no longer get a desktop computer. You already have a terminal in your own workspace (terminal_run, terminal_open) and a browser in the Space browser (chrome_open, chrome_snapshot, chrome_act). Use those. Use the person's own Chrome only if they ask for it.";

/** The capabilities whose results are times a person schedules by. */
const TIMED = /^(?:calendar|mail|inbox|tasks|meetings|events|goals)\./;

/** One example call for the tools where the minimal call cannot be made from the schema alone (one of several inputs is required). */
const EXAMPLES: Readonly<Record<string, string>> = {
  "sites.artifact_publish": 'artifact_publish {"title":"Q3 plan","html":"<h1>Q3 plan</h1>"}',
};

/** Refusals that retrying cannot change: the agent is above its clearance for the thing, or its role does not hold the permission. */
const NEVER_AGAIN: ReadonlySet<string> = new Set(["permission.above_clearance", "permission.role_lacks_permission"]);
/**
 * A refusal is remembered only to the end of the turn that met it (13 Nov: a remembered refusal must never outlive its cause). A person can grant a permission, share a file, unlock the Vault or connect an app between
 * two turns, and no event reaches this layer to say so; so across turns the server is asked again every time. Within one turn nothing can have changed for this agent but a person's act in the chat, and the loop
 * is what costs.
 */

export type ToolOutcome =
  /** `parkOn`: a question asked of the person (ask_question): the turn waits on its block and makes no further model call until it is answered. */
  | { kind: "result"; result: ToolResult; traceId: string; parkOn?: { blockId: string } }
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
  /** The one hooks layer (modules/hooks): asked for tool.before, outward.before and tool.after. When present it answers instead of before and after. */
  fire?(ctx: ToolCtx, f: Pick<HookFire, "event" | "tool" | "cap" | "input" | "output" | "ok">): Promise<HookVerdict>;
}

/**
 * Long commands that outlive the turn's patience (r42-runtime). A `terminal.run` the model asked to run in the background is waited for a few seconds like any call; if it has not finished by then it is left running
 * and the model is told at once, with the id of the node that stands for it in the Run tree. That node ends when the call does (done, or failed with the exit code), and a Run that sleeps on `run.node_ended` wakes.
 * The call itself is the ordinary one: same permissions, same Gate, same Vault scrubbing, same place rules.
 */
export interface BackgroundPort {
  /** How long the call is waited for before it is left running. */
  graceMs: number;
  /** Make the node that stands for the command, before it starts: the call carries its id, so stopping the node interrupts the command. Null: none could be made, so the call is simply waited for. */
  begin(ctx: ToolCtx, t: ToolDef): Promise<{ runId: string } | null>;
  /** The call ended. */
  end(runId: string, outcome: { ok: boolean; summary: string; code?: string; held?: boolean }): Promise<void>;
}
export const BACKGROUND_GRACE_MS = 4000;

export interface CallDeps extends AccessDeps {
  background?: BackgroundPort;
  /** Which tools a chat has found, kept by the caller so they outlive a session: a CLI engine's process that is started again (another request took its warm slot) goes on with the tools the chat already found. */
  loadedStore?: Map<string, Set<string>>;
  dynamic?: DynamicTools;
  hooks?: CallHooks;
  invoke: Invoke;
  /** A routine (a run, not a chat) met a refusal its agent can never fix: say so once to the person it works for, as a Needs-you line. Best effort; never fails a call. */
  needsYou?(n: { agentId: string; tool: string; asker: string; code: string }): void;
  /** The asker's time zone, when known: a calendar, mail, inbox or task result then carries each time in it as well (lib/time-convert.ts withLocalTimes). */
  zoneOf?(ctx: ToolCtx): string | undefined;
  /** Name the tool that reads one item after a list result, and list it at once. For a session whose model sees a live tool list (the API driver); a CLI engine through MCP lists once, so it is left out there. */
  nextHints?: boolean;
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

const hex = (n: number): string =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

export function createToolSession(deps: CallDeps): ToolSession {
  const loadedBy = deps.loadedStore ?? new Map<string, Set<string>>();
  /** The searches each turn has made, so the same one is not run twice. */
  const searchedIn = new Map<string, Set<string>>();
  const newTrace = deps.traceId ?? ((): string => hex(16));
  /** The versions this session's agents have seen of the files, records and tasks they read or wrote (agent/src/tools/versions.ts). */
  const seen = new SeenVersions();
  /** How many times each tool has been called in each turn (the key of a repeat on purpose differs from the key of a replay) and what its last call came to, for the first-call record. */
  const turnCalls = new Map<string, Map<string, { n: number; rejected: boolean }>>();
  const countCall = (
    ctx: ToolCtx,
    tool: string,
    input: unknown,
  ): { n: number; first: boolean; afterReject: boolean } => {
    const turn = ctx.turnId ?? ctx.trace?.traceId ?? "none";
    let m = turnCalls.get(turn);
    if (!m) {
      m = new Map();
      turnCalls.set(turn, m);
      if (turnCalls.size > 200) turnCalls.delete(turnCalls.keys().next().value as string);
    }
    const key = `${tool}:${shortHash(canonical(input))}`;
    const was = m.get(tool);
    const same = m.get(key);
    m.set(key, { n: (same?.n ?? 0) + 1, rejected: false });
    m.set(tool, { n: (was?.n ?? 0) + 1, rejected: was?.rejected ?? false });
    return { n: same?.n ?? 0, first: was === undefined, afterReject: was?.rejected === true };
  };
  /** Refusals an agent cannot fix, by agent, tool and input: answered at once the next time, without the server. */
  const refusals = new Map<string, { error: VyreError; turn: string }>();
  /** Routines that were told once about a refusal (a notice only: it never stops a call). */
  const told = new Set<string>();
  const markRejected = (ctx: ToolCtx, tool: string, v: boolean): void => {
    const m = turnCalls.get(ctx.turnId ?? ctx.trace?.traceId ?? "none");
    const w = m?.get(tool);
    if (m && w) m.set(tool, { ...w, rejected: v });
  };
  const loadedSet = (threadId: string): Set<string> => {
    let s = loadedBy.get(threadId);
    if (!s) {
      s = new Set();
      loadedBy.set(threadId, s);
    }
    return s;
  };

  const fail = (
    code: ErrorCode,
    traceId: string,
    o: { message?: string; details?: Record<string, unknown>; next?: NextStep[] } = {},
  ): ToolOutcome => {
    const error = makeError(code, traceId, o);
    return { kind: "error", error, result: { ok: false, content: { error: modelError(error) } } };
  };

  const askAccessNext = (ctx: ToolCtx, t: ToolDef): NextStep[] => {
    const scope = ctx.thread.scope;
    if (!scope) return [];
    return [
      {
        kind: "ask_access",
        label: "Ask for access",
        action: { cap: "access.request" as CapName, input: { resource: scope, level: t.level } },
      },
    ];
  };

  const refused = (why: Refusal, ctx: ToolCtx, t: ToolDef, traceId: string): ToolOutcome => {
    switch (why) {
      case "plan_mode":
        return fail("permission.plan_mode", traceId, { details: { tool: t.name } });
      case "ask_level":
        return fail("permission.role_lacks_permission", traceId, {
          message: "This pane only has view access to what you are looking at.",
          details: { tool: t.name, reason: "ask_level", needs: t.level },
          next: askAccessNext(ctx, t),
        });
      case "ask_scope":
        return fail("permission.role_lacks_permission", traceId, {
          message: "This Ask changes only what it is about. Continue in a chat to change anything else.",
          details: { tool: t.name, reason: "ask_scope" },
        });
      case "no_access":
        return fail("permission.no_grant", traceId, {
          details: { tool: t.name, reason: "no_access" },
          next: askAccessNext(ctx, t),
        });
      case "agent_denied":
        return fail("permission.role_lacks_permission", traceId, {
          message: "This agent is not allowed to use that tool.",
          details: { tool: t.name, reason: "agent_denied" },
        });
      case "engineer":
        return fail("permission.role_lacks_permission", traceId, {
          message: "The engineer tools need engineer access.",
          details: { tool: t.name, reason: "engineer" },
        });
    }
  };

  async function call(
    ctx: ToolCtx,
    name: string,
    input: unknown,
    opts: { approval?: string } = {},
  ): Promise<ToolOutcome> {
    // a CLI engine's call comes through its long-lived MCP session with no turn of its own: the engine noted when this agent's turn began, so a read and a write of one turn meet the same memory
    if (ctx.turnStartedAt === undefined) {
      const began = turnStartOf(ctx.thread.threadId, ctx.agentId);
      if (began !== undefined) ctx = { ...ctx, turnStartedAt: began };
    }
    const traceId = ctx.trace?.traceId ?? newTrace();
    const t = deps.catalog.byName(name) ?? (await deps.dynamic?.find(ctx, name));
    if (!t)
      return fail("validation.unknown_capability", traceId, {
        message: "There is no such tool.",
        details: { tool: name },
      });

    const level = askLevel(deps, ctx.asker, ctx.thread);
    const why = refusalFor(deps, ctx, t, level);
    if (why !== null) return refused(why, ctx, t, traceId);
    if (!reachesScope(t, ctx.thread, input)) return refused("ask_scope", ctx, t, traceId);

    // a tool is never called to see if it works, and never with placeholder content: refused before anything runs, so no card, hold, task or message reaches the chat
    const placeholder = probeIn(input, "", ctx.said ?? "", t.inputSchema);
    if (placeholder !== null)
      return fail("validation.bad_input", traceId, {
        message: PROBE_MESSAGE,
        details: { tool: t.name, reason: "placeholder" },
      });

    const isDynamic = !deps.catalog.byName(name);
    if (
      !isDynamic &&
      !deps.defaults.has(t.name) &&
      !(ctx.thread.scope?.type === "task" && TASK_BATON_TOOLS.has(t.name)) &&
      !loadedSet(ctx.thread.threadId).has(t.name)
    ) {
      return fail("validation.precondition_failed", traceId, {
        message: "Find this tool with tool_search first.",
        details: { tool: t.name, reason: "not_loaded" },
      });
    }

    if (t.name === "tool_search") {
      const query = (input as { query?: unknown } | null)?.query;
      if (typeof query !== "string" || query.trim() === "")
        return fail("validation.bad_input", traceId, { details: { errors: ["/query: required"], tool: t.name } });
      // The same search twice in one turn finds the same tools: the second time says so instead of searching again (a model went round this loop nineteen times).
      if (ctx.turnId) {
        const key = query.trim().toLowerCase().replace(/\s+/g, " ");
        let asked = searchedIn.get(ctx.turnId);
        if (!asked) {
          asked = new Set();
          searchedIn.set(ctx.turnId, asked);
          if (searchedIn.size > 200) searchedIn.delete(searchedIn.keys().next().value as string);
        }
        if (asked.has(key)) {
          return {
            kind: "result",
            traceId,
            result: {
              ok: true,
              content: {
                data: {
                  tools: [],
                  hint: "You already searched for that in this turn. What it found can be called now; call one of those tools, or change the words. If nothing fits, answer with what you have and say what is missing.",
                },
              },
            },
          };
        }
        asked.add(key);
      }
      const found = api.search(ctx, query);
      return {
        kind: "result",
        traceId,
        result: {
          ok: true,
          content: {
            data: {
              tools: found.map((f) => ({
                name: f.name,
                summary: f.summary,
                toolset: f.toolset,
                inputSchema: f.inputSchema,
              })),
            },
          },
        },
      };
    }

    let localAsk = false;
    if (t.local !== "none") {
      const d = deps.localPolicy
        ? deps.localPolicy(t, ctx, input)
        : ({ action: "refuse", reason: "no local policy" } as LocalDecision);
      if (d.action === "refuse")
        return fail("permission.role_lacks_permission", traceId, {
          message: "That is not allowed on this computer.",
          details: { tool: t.name, reason: d.reason },
        });
      if (d.action === "prompt") {
        // With no way to ask on the spot (a turn that runs on a server) the question is the Gate's: the call is held for a yes the person answers in the chat, never refused and never run unasked.
        if (deps.prompt) {
          const yes = await deps.prompt(t, ctx, input);
          if (!yes)
            return fail("permission.needs_approval", traceId, {
              message: "The person did not allow this.",
              details: { tool: t.name, reason: "local_prompt" },
            });
        } else localAsk = true;
      }
    }

    let hookNotes: string[] = [];
    if (deps.hooks?.fire) {
      const asked = async (event: "tool.before" | "outward.before"): Promise<HookVerdict | null> =>
        deps.hooks!.fire!(ctx, { event, tool: t.name, cap: t.cap, input }).catch(() => null);
      const v = await asked("tool.before");
      const o = v?.block ? null : t.effects === "outward" || t.gated ? await asked("outward.before") : null;
      const stop = v?.block ?? o?.block ?? null;
      if (stop)
        return fail("permission.role_lacks_permission", traceId, {
          message: `A hook stopped this: ${stop.reason}`,
          details: { tool: t.name, reason: "hook", hookId: stop.hookId },
        });
      hookNotes = [...(v?.notes ?? []), ...(o?.notes ?? [])];
    } else if (deps.hooks?.before) {
      const reason = await deps.hooks.before(ctx, t, input).catch(() => null);
      if (reason !== null)
        return fail("permission.role_lacks_permission", traceId, {
          message: `A plugin hook stopped this: ${reason}`,
          details: { tool: t.name, reason: "hook" },
        });
    }
    const refusalKey = `${ctx.agentId}|${ctx.asker}|${t.name}|${shortHash(canonical(input))}`;
    const known = refusals.get(refusalKey);
    if (known && ctx.turnId !== undefined && known.turn === ctx.turnId)
      return { kind: "error", error: known.error, result: { ok: false, content: { error: modelError(known.error) } } };
    const tally = countCall(ctx, t.name, input);
    const seed: CtxSeed = {
      space: ctx.space,
      principal: { kind: "agent", id: ctx.agentId },
      actingFor: ctx.asker,
      trace: ctx.trace,
      run: ctx.runId,
      thread: ctx.thread.threadId,
      origin: "agent",
      callMeta: { tool: t.name, first: tally.first, ...(tally.afterReject ? { afterReject: true } : {}) },
      provider: ctx.provider,
      approval: opts.approval,
      ...(ctx.thread.mode !== undefined ? { chatMode: ctx.thread.mode } : {}),
      // Ask first: a tool that changes or sends something is parked for a yes before it runs. Tools plan mode allows (reads, questions, plan proposals) never wait. Auto adds nothing and removes nothing: the Gate decides, as before.
      // An Ask pane never sends anything out on its own, in any mode: what leaves Vyre from one always stops for a yes.
      ...((ctx.thread.mode === "ask" && t.effects !== "read" && t.planMode === "blocked") ||
      (localAsk && t.effects !== "read") ||
      (ctx.thread.kind === "ask" && t.effects === "outward")
        ? { askFirst: true }
        : {}),
      ...(localAsk && t.effects !== "read" ? { mustAsk: true } : {}),
      ...(t.effects !== "read" && t.planMode === "blocked" ? { askable: true } : {}),
    };
    // a write to a file, record or task that takes a version: send the version this agent last saw when the model did not (agent/src/tools/versions.ts)
    let given = input;
    // a version input the model is not shown is never the model's to choose: a value it sends anyway is dropped, and the layer's takes its place
    const hidden = isDynamic ? undefined : HIDDEN_FROM_MODEL[t.cap];
    if (hidden && input !== null && typeof input === "object" && !Array.isArray(input)) {
      given = Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([k]) => !hidden.includes(k)));
    }
    const versioned = isDynamic ? undefined : kindOfWrite(t.cap);
    if (versioned && given !== null && typeof given === "object" && !Array.isArray(given)) {
      const o = given as Record<string, unknown>;
      const id = typeof o[versioned.field] === "number" ? undefined : versioned.idOf(o);
      if (id !== undefined) {
        const key = `${versioned.kind}:${id}`;
        let base = seen.get(ctx, key);
        if (base === undefined) {
          // a thing this agent has not read in this turn: the version it had when the turn started (a change since then refuses the write); with no turn start known, the version it has now
          const { askFirst: _a, mustAsk: _m, askable: _k, ...readSeed } = seed;
          const look = versioned.peek(id, o);
          try {
            const res = await deps.invoke(look.cap as CapName, look.input, readSeed);
            const n = res.status === "ok" ? versioned.now(res.output, ctx.turnStartedAt) : null;
            if (n) {
              if (versioned.kind === "file") {
                // no version from before the turn began (older ones purged, or the file made during the turn by someone else): it counts as changed
                if (n.atTime === undefined && ctx.turnStartedAt !== undefined)
                  return fail("validation.version_conflict", traceId, {
                    message: changedSinceTurn(versioned.noun),
                    details: { tool: t.name, reason: "changed_since_turn" },
                  });
                base = n.atTime ?? n.version;
              } else if (
                ctx.turnStartedAt !== undefined &&
                n.changedAt !== undefined &&
                n.changedAt >= ctx.turnStartedAt
              )
                return fail("validation.version_conflict", traceId, {
                  message: changedSinceTurn(versioned.noun),
                  details: { tool: t.name, reason: "changed_since_turn" },
                });
              else base = n.version;
            }
          } catch {
            /* a look that fails changes nothing: the write is made as the model sent it and says what is wrong itself */
          }
        }
        if (base !== undefined) given = { ...o, [versioned.field]: base };
      }
    }
    // a sheet row this agent read in the turn: send what the columns it changes held then, so a change made to them since refuses the write
    if (
      !isDynamic &&
      t.cap === "sheets.update_row" &&
      given !== null &&
      typeof given === "object" &&
      !Array.isArray(given)
    ) {
      const g = given as Record<string, unknown>;
      const values = g["values"];
      if (
        g["expect"] === undefined &&
        typeof g["fileId"] === "string" &&
        typeof g["rowId"] === "string" &&
        values !== null &&
        typeof values === "object"
      ) {
        const was = seen.getCells(ctx, rowKey(g["fileId"], g["sheet"], g["rowId"]));
        if (was) {
          const expect: Record<string, unknown> = {};
          for (const col of Object.keys(values as object)) if (col in was) expect[col] = was[col];
          if (Object.keys(expect).length > 0) given = { ...g, expect };
        }
      }
    }
    // where a model's first file or folder goes: the person's own files when it names none, a path or a folder name read as meant, a file found by its path (agent/src/tools/place.ts)
    if (!isDynamic && (placeField(t.cap) !== undefined || findsByPath(t.cap))) {
      const { askFirst: _a, mustAsk: _m, askable: _k, ...lookSeed } = seed;
      const parked = seed.askFirst === true || seed.mustAsk === true;
      try {
        const placed = await placeInput(
          t.cap,
          given,
          async (cap, i) => {
            const make = cap === "files.folder.create";
            try {
              const r = await deps.invoke(
                cap as CapName,
                make ? { ...i, idempotencyKey: `ag:pl:${ctx.turnId ?? "t"}:${shortHash(canonical(i))}` } : i,
                make ? seed : lookSeed,
              );
              return r.status === "ok" ? r.output : null;
            } catch {
              return null; // not found, or not allowed: the caller says what to do
            }
          },
          !parked,
        );
        if (placed.said !== undefined)
          return fail("validation.not_found", traceId, { message: placed.said, details: { tool: t.name } });
        given = placed.input;
      } catch {
        /* a look that fails changes nothing: the call goes on as the model wrote it and says what is wrong itself */
      }
    }
    try {
      const body =
        isDynamic && deps.dynamic
          ? deps.dynamic.input(ctx, t, input)
          : fillInput(t, limited(t.cap, unstringified(t.inputSchema, given)), ctx).input;
      // an input the tool does not have is never passed on silently: the server lets it through and no handler reads it, so a model's call would "work" and do less than it asked (F93)
      if (!isDynamic) {
        // who a call acts for is never the model's to say: a name that claims it is left to the pipeline, which ignores it
        const owned = [...(HIDDEN_FROM_MODEL[t.cap] ?? []), "idempotencyKey", "actingFor", "asker", "principal", "as"];
        const extra = unknownInputs(t.inputSchema, body, owned);
        // with a stranger among the inputs, the ones the tool needs and the call lacks are said in the same breath, so one refusal tells the model everything
        if (extra.length > 0 && body !== null && typeof body === "object" && !Array.isArray(body))
          for (const r of (t.inputSchema as { required?: string[] } | null)?.required ?? [])
            if (!(r in (body as object)) && !owned.includes(r)) extra.push(`/${r}: required`);
        if (extra.length > 0)
          return fail("validation.bad_input", traceId, {
            message: rejectWords(t, extra, EXAMPLES[t.cap]),
            details: { tool: t.name, errors: extra, reason: "unknown_input" },
          });
      }
      // a background request is the model's alone: the capability is the ordinary one and is never sent the word
      let sent = body;
      let wantsBackground = false;
      if (
        t.cap === "terminal.run" &&
        body !== null &&
        typeof body === "object" &&
        !Array.isArray(body) &&
        "background" in body
      ) {
        const { background, ...rest } = body as Record<string, unknown>;
        wantsBackground = background === true && deps.background !== undefined;
        sent = rest;
      }
      let res: Awaited<ReturnType<typeof deps.invoke>>;
      // the node that stands for the command is made first and names the call (seed.run), so a Stop on the node reaches the command in its tab
      const node = wantsBackground ? await deps.background!.begin(ctx, t).catch(() => null) : null;
      if (!node) res = await deps.invoke(t.cap, sent, seed);
      else {
        const port = deps.background!;
        const pending = deps.invoke(t.cap, sent, { ...seed, run: node.runId });
        const early = await Promise.race([
          pending.then(
            (r) => ({ r }),
            (e: unknown) => ({ e }),
          ),
          new Promise<null>((ok) => setTimeout(() => ok(null), port.graceMs).unref?.()),
        ]);
        const settle = (o: { ok: boolean; summary: string; code?: string; held?: boolean }): void => {
          void port.end(node.runId, o).catch(() => undefined);
        };
        const failure = (e: unknown): { ok: boolean; summary: string; code?: string } => ({
          ok: false,
          summary: e instanceof HostError ? e.error.message : "The command could not finish.",
          code: e instanceof HostError ? e.error.code : "internal.unexpected",
        });
        if (early !== null && "e" in early) {
          settle(failure(early.e));
          throw early.e;
        }
        if (early !== null) {
          settle(backgroundOutcome(early.r));
          res = early.r;
        } else {
          pending.then(
            (r) => settle(backgroundOutcome(r)),
            (e: unknown) => settle(failure(e)),
          );
          return {
            kind: "result",
            traceId,
            result: {
              ok: true,
              content: {
                started: true,
                runId: node.runId,
                message:
                  "It is still running in its tab and will go on. To wait for it without spending anything, use wait_for on the event run.node_ended with this runId; the answer then says how it ended. Read what it printed with terminal_read.",
              },
            },
          };
        }
      }
      if (!isDynamic && res.status === "ok")
        for (const l of learned(t.cap, body, res.output)) seen.set(ctx, l.key, l.version);
      if (!isDynamic && res.status === "ok")
        for (const r of learnedRows(t.cap, body, res.output, (k) => seen.getCells(ctx, k)))
          seen.setCells(ctx, r.key, r.cells);
      markRejected(ctx, t.name, false);
      if (res.status === "held") {
        recordWork(ctx.turnId, heldCard(t.cap, res.taskId, input));
        return {
          kind: "held",
          taskId: res.taskId,
          traceId: res.traceId,
          ...(res.runId === undefined ? {} : { runId: res.runId }),
          result: { ok: false, content: { held: true, taskId: res.taskId, message: "Waiting for approval." } },
        };
      }
      // A Flow the agent drafted in a chat leaves its card there. Done here, after the call returned, because only now is the new draft registered in access, so the card's handler (chat.flow_card) can read it
      // as the agent; the card itself is written by that server handler, so the agent cannot dress up a button.
      if (t.cap === "automations.create" && ctx.thread.threadId) {
        const made = (res.output as { automation?: { id?: unknown } } | null)?.automation?.id;
        if (typeof made === "string")
          await deps
            .invoke(
              "chat.flow_card",
              { threadId: ctx.thread.threadId, automationId: made, idempotencyKey: `flow-card:${made}` },
              seed,
            )
            .catch(() => undefined);
      }
      recordWork(ctx.turnId, workCardOf(t.cap, input, res.output));
      // the calendar and mail reads come back to a model as compact rows with a count and a size (compact.ts); the full answer is what the hooks and the work card see
      const shaped = isDynamic ? null : shapeOutput(t.cap, res.output);
      // times in the person's zone beside the ISO and epoch ones, for the tools that return times people schedule by
      const zone = TIMED.test(t.cap) ? deps.zoneOf?.(ctx) : undefined;
      const data = shaped ? shaped.data : res.output;
      const content: { data: unknown; meta?: unknown; blocks?: string[]; next?: string } = {
        data: zone ? withLocalTimes(data, zone) : data,
        ...(shaped ? { meta: shaped.meta } : {}),
      };
      if (t.blocks.length > 0) content.blocks = t.blocks;
      // a list names the tool that reads one item, and that tool is listed from now on: no search to find it
      const reads = deps.nextHints === true ? nextReads(t.name) : [];
      if (reads.length > 0) {
        const set = toolsFor(deps, ctx),
          offered = new Set([...set.listed, ...set.searchable].map((x) => x.name));
        const ready = reads.filter((n) => offered.has(n));
        if (ready.length > 0) {
          for (const n of ready) loadedSet(ctx.thread.threadId).add(n);
          content.next = `To read one of these, call ${ready.join(" or ")} with its id. ${ready.length > 1 ? "They are" : "It is"} ready to call now.`;
        }
      }
      if (hookNotes.length > 0) (content as { hookNotes?: string[] }).hookNotes = hookNotes;
      if (deps.hooks?.fire)
        void deps.hooks
          .fire(ctx, { event: "tool.after", tool: t.name, cap: t.cap, input, output: res.output, ok: true })
          .catch(() => undefined);
      else if (deps.hooks?.after)
        void Promise.resolve(deps.hooks.after(ctx, t, input, { ok: true, output: res.output })).catch(() => undefined);
      const asked = t.cap === "chat.question.ask" ? (res.output as { blockId?: unknown } | null)?.blockId : undefined;
      return {
        kind: "result",
        traceId: res.traceId,
        result: { ok: true, content },
        ...(typeof asked === "string" ? { parkOn: { blockId: asked } } : {}),
      };
    } catch (e) {
      // An agent that asks for a computer is refused for want of the grant; what it needs to hear is what it has, not that it lacks permission, and no person has anything to press.
      if (e instanceof HostError && e.error.code === "permission.no_grant" && t.cap === "computers.provision") {
        const error = makeError("permission.no_grant", traceId, {
          message: NO_COMPUTER_WORDS,
          details: { tool: t.name, reason: "no_new_desktop" },
        });
        return { kind: "error", error, result: { ok: false, content: { error: modelError(error) } } };
      }
      if (e instanceof HostError && e.error.code === "validation.bad_input") {
        // the input was not accepted: say which input and what rule, and show a minimal call. The field paths and rules are kept in the error's details for the log, never a value.
        const problems = (e.error.details as { errors?: unknown } | undefined)?.errors;
        const list = Array.isArray(problems) ? problems.filter((p): p is string => typeof p === "string") : [];
        markRejected(ctx, t.name, true);
        if (list.length > 0) {
          const error = {
            ...e.error,
            message: rejectWords(
              t,
              list,
              EXAMPLES[t.cap],
              input !== null && typeof input === "object" && !Array.isArray(input) ? Object.keys(input) : [],
            ),
          };
          return { kind: "error", error, result: { ok: false, content: { error: modelError(error) } } };
        }
      }
      if (e instanceof HostError && NEVER_AGAIN.has(e.error.code)) {
        // the agent cannot fix this itself: remember it, so the same call is not made again this turn or on the next run of a routine, and tell the person a routine works for, once
        if (refusals.size >= 1_000) refusals.delete(refusals.keys().next().value as string);
        if (ctx.turnId !== undefined) refusals.set(refusalKey, { error: e.error, turn: ctx.turnId });
        const already = told.has(refusalKey);
        if (told.size >= 1_000) told.clear();
        told.add(refusalKey);
        if (!already && (ctx.thread.kind === "run" || ctx.runId !== undefined)) {
          try {
            deps.needsYou?.({ agentId: ctx.agentId, tool: t.name, asker: ctx.asker, code: e.error.code });
          } catch {
            /* a line that cannot be raised never fails the call */
          }
        }
      }
      if (e instanceof HostError)
        return { kind: "error", error: e.error, result: { ok: false, content: { error: modelError(e.error) } } };
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
    forget: (threadId) => {
      loadedBy.delete(threadId);
    },
    preload: (threadId, names) => {
      const set = loadedSet(threadId);
      for (const n of names) set.add(n);
    },
  };
  return api;
}

/** How a background command ended, in words for the node: the exit code and how long, or why it did not finish. */
function backgroundOutcome(r: { status: string; output?: unknown }): {
  ok: boolean;
  summary: string;
  code?: string;
  held?: boolean;
} {
  if (r.status !== "ok")
    return { ok: false, held: true, summary: "It waits for a person's approval; it starts when allowed." };
  const o = (r.output ?? {}) as { exitCode?: number | null; durationMs?: number };
  const mins = typeof o.durationMs === "number" ? Math.max(1, Math.round(o.durationMs / 60_000)) : undefined;
  const took = mins === undefined ? "" : mins < 2 ? " after about a minute" : ` after ${mins} minutes`;
  if (o.exitCode === 0) return { ok: true, summary: `Finished, exit 0${took}.` };
  return {
    ok: false,
    summary:
      o.exitCode === null || o.exitCode === undefined
        ? `It ended without an exit code${took}.`
        : `It ended with exit ${o.exitCode}${took}.`,
    code: "terminal.nonzero_exit",
  };
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
      if (
        want === "array"
          ? Array.isArray(parsed)
          : parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      )
        (out ??= { ...(input as Record<string, unknown>) })[k] = parsed;
    } catch {
      /* not JSON: validation says so */
    }
  }
  return out ?? input;
}
