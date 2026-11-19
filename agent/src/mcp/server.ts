// The MCP endpoint (Streamable HTTP, request/response form): one POST per JSON-RPC message or batch.
//   auth        Authorization: Bearer <token>; the token is an outside agent's access token (modules/mcp/oauth.ts) or the session token of a CLI engine (types.ts open). No token, or a bad one, answers 401 naming where to sign in.
//   tools/list  the default listed set the caller may use, plus the deferred tools it found with tool_search in this session
//   tools/call  one capability invoke, as the agent acting for the person; outside.ts narrows an outside agent first, then the same ToolSession the API drivers use refuses
//               what was never offered, and the invoke pipeline intersects access, applies the Gate and writes the audit row
// Nothing here decides access. A tool being listed grants nothing.
import { safeContent } from "../tools/model-error.ts";

import { PROBE_MESSAGE, probeIn } from "../../../lib/probe.ts";
import { createToolSession } from "../tools/call.ts";
import { decideLocal, dialFor } from "../tools/local.ts";
import { localFacts } from "../tools/local-facts.ts";
import type { ToolSession } from "../tools/call.ts";
import { hooksHolder, NO_VERDICT } from "../tools/hooks.ts";
import type { CallHooks } from "../tools/call.ts";
import { CLI_EVENT } from "../../../lib/hooks.ts";
import type { ToolCtx, ToolDef } from "../tools/types.ts";
import type { Invoke } from "../../../host/src/invoke.ts";
import { makeError } from "../../../host/src/routes/errors.ts";
import {
  INTERNAL_ERROR,
  INVALID_PARAMS,
  INVALID_REQUEST,
  METHOD_NOT_FOUND,
  PARSE_ERROR,
  err,
  isRequest,
  ok,
} from "./jsonrpc.ts";
import type { Id, Request, Response } from "./jsonrpc.ts";
import { outsideAllows, outsideDoor, setupCovers, setupRefusal } from "./outside.ts";
import { searchTools } from "../tools/access.ts";
import { HostError } from "../../../host/src/routes/errors.ts";
import { heldCard, workCardOf } from "../tools/work-cards.ts";
import type { McpCaller, McpChange, McpHttpRequest, McpHttpResponse, McpServer, McpServerDeps } from "./types.ts";
import {
  LIST_READS,
  RESOURCE_TEMPLATES,
  asBytes,
  completionsOf,
  contentsOf,
  isSkillName,
  listedResources,
  needsBytes,
  promptOf,
  promptsOf,
  routeOf,
} from "./resources.ts";

/** structuredContent for a machine: the error as a model reads it, plus `code` (the same value as supportCode). */
function withMachineCode(v: unknown): unknown {
  const e = (v as { error?: { supportCode?: unknown } } | null)?.error;
  return e && typeof e === "object" && typeof e.supportCode === "string"
    ? { ...(v as object), error: { ...e, code: e.supportCode } }
    : v;
}

/** The revisions a client opens with `initialize` (the handshake era). The first is what a client that asks for one we do not serve is given. */
export const PROTOCOL_VERSIONS: readonly string[] = ["2025-06-18", "2025-11-25", "2025-03-26", "2024-11-05"];
/** The revisions with no handshake and no session: every request says its version in `_meta`, and is answered on its own (2026-07-28 and later). */
export const MODERN_VERSIONS: readonly string[] = ["2026-07-28"];
/** Every revision this endpoint serves, newest first: what `server/discover` and a version refusal name. */
export const SUPPORTED_VERSIONS: readonly string[] = [...MODERN_VERSIONS, ...[...PROTOCOL_VERSIONS].sort().reverse()];
const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CLIENT = "io.modelcontextprotocol/clientInfo";
const META_CLIENT_CAPS = "io.modelcontextprotocol/clientCapabilities";
const META_SERVER = "io.modelcontextprotocol/serverInfo";
const META_SUBSCRIPTION = "io.modelcontextprotocol/subscriptionId";
/** The most addresses one app watches, and the most streams one sign-in holds open. */
const MAX_WATCHED = 100;
const MAX_STREAMS = 8;
/** The most streams the whole Space holds open, whoever asks: each costs a timer and a sign-in check every keep-alive. */
const MAX_TOTAL_STREAMS = 200;
/** A reserved stream whose response never started (the client went away between the answer and the first write) frees its place after this. */
const UNSTARTED_MS = 10_000;
/** A proof read that failed is not tried again for the same address and app for this long. */
const DENIED_MS = 5_000;
const KEEP_ALIVE_MS = 20_000;
const SSE_HEADERS = { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" };
const sse = (message: unknown): string => `event: message\ndata: ${JSON.stringify(message)}\n\n`;
/** Error codes the 2026-07-28 revision defines (its reserved range, -32020 to -32099). */
export const HEADER_MISMATCH = -32020;
export const UNSUPPORTED_PROTOCOL_VERSION = -32022;
/** How long a client may keep a list before asking again. A list differs by caller, so it is never shared between sign-ins. */
const LIST_TTL_MS = 5 * 60_000;
const DISCOVER_TTL_MS = 60 * 60_000;
/** "Resource not found" as the handshake revisions say it; 2026-07-28 says it as invalid params. */
const RESOURCE_NOT_FOUND = -32002;
/** Methods whose `params.name` or `params.uri` is mirrored in the Mcp-Name header. */
const NAMED: Readonly<Record<string, "name" | "uri">> = {
  "tools/call": "name",
  "prompts/get": "name",
  "resources/read": "uri",
};
export const MAX_RESULT_CHARS = 512 * 1024;
const MAX_BODY = 1024 * 1024;
const RECHECK_MS = 30_000;
const SEARCH_LIMIT = 8;

const INSTRUCTIONS =
  "Vyre tools. The list shows the common ones. Call tool_search with what you want to do to find the rest; the tools it returns can then be called. " +
  "Every call runs as you acting for the person who connected you, with the access you both have and no more. Some actions wait for a person to approve them. Call a tool that is not in your list with use_tool.";
const OUTSIDE_INSTRUCTIONS = `${INSTRUCTIONS} You are a member of this Space. Call agents_next to take the next mention or task; it tells you the chat to work in, and what you do there shows in that chat.`;
/** The tool a client that lists once uses for everything tool_search found: most MCP clients never list again in a session. */
const USE_TOOL = "use_tool";
const USE_TOOL_VIEW = {
  name: USE_TOOL,
  description: "Call a tool that tool_search found, by name.",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string" }, arguments: { type: "object" } },
    required: ["name"],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
};
/** What tool_search shows an outside agent for putting a key in the Vault: names only. */
const PASTE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "The key's name, like Google_Client_Secret" },
    fieldKeys: { type: "array", items: { type: "string" } },
    folderId: { type: "string" },
    reason: { type: "string" },
  },
  required: ["name"],
};
const PASTE_NOTE =
  "Asks a person to paste the value in their own app. Send names only; you get the key's name back to pass as a handle, never the value.";
const ASK_NOTE =
  "Only a person does this here. Calling it asks the person you act for; it runs as them once they approve.";
const SETUP_NOTE =
  "Runs as the person you act for, under the setup grant they gave you. Their own rights are checked on the call.";
/** Listed for an outside agent from the start, so it can get work and answer without a search. */
const OUTSIDE_PRELOAD: readonly string[] = ["agents_next"];
/** Listed for a CLI engine from the start: "make me a file" is a first-hour ask, and it needs a new file and a place to put it. */
const ENGINE_PRELOAD: readonly string[] = [
  "files_tree",
  "files_create",
  "files_folder_create",
  "people_status",
  "message_person",
  "task_submit",
  "task_ask",
  "models_for_helpers",
  "helper_note",
]; // and who is in, and a message to a teammate (lane l-agentdm), and the two a helper hands in or asks with, so it never has to search for them

interface Session {
  caller: McpCaller;
  /** The pipeline as this caller: the real principal and origin. */
  invoke: Invoke;
  tools: ToolSession;
  ctx: ToolCtx;
  tokenKey: string;
  checkedAt: number;
  protocol: string;
  clientName: string | undefined;
  /** Asks this session already drew a card for: a repeat returns the same hold, and draws no second card. */
  asked: Set<string>;
  /** The addresses a client of a handshake revision asked to watch (resources/subscribe): its GET stream is told when one changes. A client of the current revision names them on its listen request instead. */
  subs: Set<string>;
  /** The deferred tools this caller is listed from the start, whatever it searched for since: a stateless client's list never changes because of its own earlier requests. */
  fixed: ReadonlySet<string>;
  /** Settles when the session ends: a call in flight stops waiting and fails. */
  gone: Promise<"gone">;
  end: () => void;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): McpHttpResponse => ({
  status,
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});
const empty = (status: number, headers: Record<string, string> = {}): McpHttpResponse => ({
  status,
  headers,
  body: "",
});

async function sha256(text: string): Promise<string> {
  const d = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

const bearer = (h: string | undefined): string | null => {
  const m = /^Bearer\s+(\S+)$/i.exec(h ?? "");
  return m?.[1] ?? null;
};

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

const hex = (n: number): string =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

export function toolView(t: ToolDef): {
  name: string;
  description: string;
  inputSchema: unknown;
  annotations: Record<string, unknown>;
} {
  return {
    name: t.name,
    description: t.summary,
    inputSchema: t.inputSchema ?? { type: "object", properties: {} },
    annotations: {
      readOnlyHint: t.effects === "read",
      destructiveHint:
        t.effects !== "read" && /(^|[._])(delete|remove|purge|erase|destroy|discard|revoke)([._]|$)/.test(t.cap),
      openWorldHint: t.effects === "outward",
    },
  };
}

export function createMcpServer(deps: McpServerDeps): McpServer {
  const now = deps.now ?? Date.now;
  const info = deps.info ?? { name: "vyre", version: "1.0.0" };
  const recheckMs = deps.recheckMs ?? RECHECK_MS;
  const maxBody = deps.maxBodyBytes ?? MAX_BODY;
  const byToken = new Map<string, Session>();
  /** The tools each chat has found, across the sessions of its engine process: a process started again keeps them. */
  const foundByChat = new Map<string, Set<string>>();
  const bySession = new Map<string, Session>();

  const originOk = (origin: string | undefined): boolean =>
    origin === undefined || LOOPBACK.test(origin) || (deps.allowedOrigins?.includes(origin) ?? false);

  function newSession(caller: McpCaller, tokenKey: string, clientName: string | undefined): Session {
    const asker = caller.actingFor ?? caller.principal.id;
    // The pipeline sees the real principal and the real origin.
    // An outside agent that has not taken a job works in no chat, so its calls name none, and every call it makes is on the audit log, whatever the capability.
    const invoke: Invoke = (cap, input, seed) => {
      const outsideCall = caller.kind === "outside";
      // the setup grant: a call in its scope that the agent may not make runs as its person (host/src/invoke.ts), read now so a grant taken back counts at once
      const t = outsideCall ? deps.catalog.all.find((x) => x.cap === cap) : undefined;
      const setup =
        t !== undefined && setupCovers(t) && setupRefusal(t, input) === null && deps.setupGrant?.(caller) === true;
      const { thread, ...rest } = seed;
      // An outside agent stopped at a role its person holds asks that person (docs/ask-the-person.md); the door says 'always' for what only a person does.
      return deps.invoke(cap, input, {
        ...rest,
        principal: caller.principal,
        origin: "mcp",
        space: caller.space,
        ...(thread !== undefined && (!outsideCall || thread.startsWith("thr_")) ? { thread } : {}),
        ...(outsideCall
          ? { auditAll: true, askPerson: seed.askPerson ?? "if_refused", ...(setup ? { setupGrant: true } : {}) }
          : {}),
      });
    };
    // the one hooks layer, for every engine that reaches Vyre here: the port is the host's, bound when its engine runtime starts
    const hooks: CallHooks = {
      fire: (c, f) =>
        hooksHolder.port
          ? hooksHolder.port.fire({
              ...f,
              agentId: c.agentId,
              asker: c.asker,
              threadId: c.thread.threadId,
              threadKind: c.thread.kind,
              ...(c.turnId ? { turnId: c.turnId } : {}),
              engine: caller.provider ?? "cli",
              source: "tools",
            })
          : Promise.resolve(NO_VERDICT),
    };
    const tools = createToolSession({
      ...(caller.kind === "driver" ? { loadedStore: foundByChat } : {}),
      catalog: deps.catalog,
      defaults: deps.defaults,
      invoke,
      ...(deps.needsYou ? { needsYou: deps.needsYou } : {}),
      hooks,
      levelFor: () => caller.askLevel ?? null,
      canEngineer: () => false,
      // A CLI engine's session works for one chat, so a local tool follows that chat's mode, under the owner's floor. An outside agent has none: outside.ts refuses local tools before they get here.
      ...(caller.kind === "driver"
        ? {
            localPolicy: (t: ToolDef, c: ToolCtx, input: unknown) => {
              const dial = dialFor(c.thread.mode, caller.localFloor);
              return decideLocal(t, dial.person, dial.floor, localFacts(t, input));
            },
          }
        : {}),
    });
    const threadId = caller.threadId ?? caller.sessionId;
    if (caller.preload) tools.preload(threadId, caller.preload);
    tools.preload(threadId, caller.kind === "outside" ? OUTSIDE_PRELOAD : ENGINE_PRELOAD);
    const fixed = new Set([
      ...(caller.preload ?? []),
      ...(caller.kind === "outside" ? OUTSIDE_PRELOAD : ENGINE_PRELOAD),
    ]);
    const ctx: ToolCtx = {
      space: caller.space,
      agentId: caller.principal.id,
      asker,
      thread: {
        threadId,
        kind: caller.threadKind ?? "chat",
        planMode: caller.planMode === true || caller.mode === "plan",
        ...(caller.mode !== undefined ? { mode: caller.mode } : {}),
        ...(caller.scope ? { scope: caller.scope } : {}),
      },
      ...(caller.rules ? { rules: caller.rules } : {}),
      ...(caller.provider ? { provider: caller.provider } : {}),
      ...(caller.runId ? { runId: caller.runId } : {}),
      ...(caller.traceId ? { trace: { traceId: caller.traceId, spanId: hex(8) } } : {}),
    };
    let end = (): void => undefined;
    const gone = new Promise<"gone">((resolve) => {
      end = () => resolve("gone");
    });
    return {
      caller,
      invoke,
      tools,
      ctx,
      tokenKey,
      asked: new Set<string>(),
      subs: new Set<string>(),
      fixed,
      checkedAt: now(),
      protocol: PROTOCOL_VERSIONS[0] ?? "2025-06-18",
      clientName,
      gone,
      end,
    };
  }

  const dropSession = (s: Session): void => {
    byToken.delete(s.tokenKey);
    bySession.delete(s.caller.sessionId);
    s.end();
    deps.onClose?.(s.caller);
  };

  const unauthorized = (origin: string | undefined, error?: "invalid_token"): McpHttpResponse =>
    empty(401, {
      "www-authenticate": deps.challenge ? deps.challenge(origin, error) : error ? `Bearer error="${error}"` : "Bearer",
    });

  const allowed = (s: Session, t: ToolDef): boolean => s.caller.kind !== "outside" || outsideAllows(t);

  /** An outside agent took a job: from here its tools work in that chat, under the chat's mode. Auto never reaches it: "asked this turn" needs a turn Vyre can see, so an outward act stops for a person unless they gave a standing yes. */
  async function bind(s: Session, threadId: string): Promise<void> {
    if (s.ctx.thread.threadId === threadId) return;
    const facts: Partial<Pick<McpCaller, "mode" | "planMode" | "threadKind" | "scope">> =
      (await deps.bindThread?.(s.caller, threadId).catch(() => null)) ?? {};
    const was = s.tools.loaded(s.ctx.thread.threadId);
    s.tools.preload(threadId, [...was]);
    s.ctx = {
      ...s.ctx,
      thread: {
        threadId,
        kind: facts.threadKind ?? "chat",
        planMode: facts.planMode === true || facts.mode === "plan",
        ...(facts.mode === "ask" || facts.mode === "plan" ? { mode: facts.mode } : {}),
        ...(facts.scope ? { scope: facts.scope } : {}),
      },
    };
  }

  function listTools(s: Session): ToolDef[] {
    const set = s.tools.toolsFor(s.ctx);
    const loaded = s.tools.loaded(s.ctx.thread.threadId);
    const out = [...set.listed, ...set.searchable.filter((t) => loaded.has(t.name))];
    return out.filter((t) => allowed(s, t));
  }
  const toolViews = (s: Session): unknown[] => [
    ...listTools(s).map(toolView),
    ...(s.caller.kind === "outside" || !s.ctx.thread.planMode ? [USE_TOOL_VIEW] : []),
  ];
  /** The list for a client with no handshake: the same for every request of this caller, in name order, so the client and the model's prompt cache can keep it. What tool_search found is called with use_tool. */
  function stableToolViews(s: Session): unknown[] {
    const set = s.tools.toolsFor(s.ctx);
    const tools = [...set.listed, ...set.searchable.filter((t) => s.fixed.has(t.name))]
      .filter((t) => allowed(s, t))
      .map(toolView);
    if (s.caller.kind === "outside" || !s.ctx.thread.planMode) tools.push(USE_TOOL_VIEW);
    return tools.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  /** The text a model reads. The same data also travels as structuredContent unless it had to be cut: a cut answer is never sent twice. */
  const textResult = (value0: unknown, isError: boolean, structured0?: unknown): Record<string, unknown> => {
    // an error reaches the model as a code and a plain sentence: no trace and no internal id (tools/model-error.ts)
    const value = isError && typeof value0 === "object" ? safeContent(value0) : value0;
    // the machine copy keeps `code` for a client that branches on it; what the model reads (the text) has it only as supportCode
    const structured = isError && structured0 !== undefined ? withMachineCode(safeContent(structured0)) : structured0;
    let text = typeof value === "string" ? value : JSON.stringify(value);
    const cut = text.length > MAX_RESULT_CHARS;
    if (cut) text = `${text.slice(0, MAX_RESULT_CHARS)}\n[cut: ${text.length - MAX_RESULT_CHARS} more characters]`;
    // the trace id goes in _meta, for the turn's Details: it is not part of what the model reads
    const trace =
      isError && value0 !== null && typeof value0 === "object"
        ? (value0 as { error?: { traceId?: unknown } }).error?.traceId
        : undefined;
    return {
      content: [{ type: "text", text }],
      isError,
      ...(structured === undefined || cut ? {} : { structuredContent: structured }),
      ...(typeof trace === "string" ? { _meta: { "vyre/traceId": trace } } : {}),
    };
  };

  async function callTool(
    s: Session,
    params: unknown,
    callId?: string,
  ): Promise<{ result: Record<string, unknown> } | { invalid: string }> {
    const p = params as { name?: unknown; arguments?: unknown } | null;
    if (!p || typeof p.name !== "string" || p.name === "") return { invalid: "tools/call needs a tool name" };
    if (
      p.arguments !== undefined &&
      (p.arguments === null || typeof p.arguments !== "object" || Array.isArray(p.arguments))
    )
      return { invalid: "arguments must be an object" };
    const args = (p.arguments ?? {}) as Record<string, unknown>;
    if (p.name === USE_TOOL) return callTool(s, { name: args["name"], arguments: args["arguments"] ?? {} }, callId);
    const t = deps.catalog.byName(p.name);
    if (!t) return { invalid: `Unknown tool: ${p.name}` };
    const traceId = s.ctx.trace?.traceId ?? hex(16);
    // no tool is called to see if it works, and none with placeholder content: refused before it reaches the chat, a hold, a task or a person's list
    if (probeIn(args, "", "", t.inputSchema) !== null) {
      const error = makeError("validation.bad_input", traceId, {
        message: PROBE_MESSAGE,
        details: { tool: t.name, reason: "placeholder" },
      });
      deps.onCall?.(s.caller, t.name, "error", { cap: t.cap, threadId: s.ctx.thread.threadId });
      return { result: textResult({ error }, true, { error }) };
    }

    if (!allowed(s, t)) {
      const door = outsideDoor(t);
      // with the setup grant, what is in its scope runs as the person, values included; what is not stays where it was
      if (door !== "open" && setupCovers(t) && deps.setupGrant?.(s.caller) === true) {
        const no = setupRefusal(t, args);
        if (no !== null) {
          const error = makeError("permission.role_lacks_permission", traceId, {
            message: no,
            details: { tool: t.name, reason: "setup_people_only" },
          });
          deps.onCall?.(s.caller, t.name, "error", { cap: t.cap, threadId: s.ctx.thread.threadId });
          return { result: textResult({ error }, true, { error }) };
        }
        return askThePerson(s, t, args, traceId);
      }
      if (door === "ask") return askThePerson(s, t, args, traceId);
      if (door === "paste") return pasteKey(s, t, args, traceId);
      const message =
        t.toolset === "vault"
          ? "The Vault stays in the person's app. To add a key, call vault_item_put with its name and field names, and the person pastes the value."
          : "That runs on a Vyre computer. Use your own machine for it.";
      const error = makeError("permission.role_lacks_permission", traceId, {
        message,
        details: { tool: t.name, reason: "not_from_outside" },
      });
      deps.onCall?.(s.caller, t.name, "error", { cap: t.cap, threadId: s.ctx.thread.threadId });
      return { result: textResult({ error }, true, { error }) };
    }

    if (t.name === "tool_search") {
      const q = args["query"];
      if (typeof q !== "string" || q.trim() === "") {
        const error = makeError("validation.bad_input", traceId, {
          details: { errors: ["/query: required"], tool: t.name },
        });
        return { result: textResult({ error }, true, { error }) };
      }
      const found = s.tools
        .search(s.ctx, q)
        .filter((f) => allowed(s, f))
        .slice(0, SEARCH_LIMIT);
      const data: { tools: Array<Record<string, unknown>> } = {
        tools: found.map((f) => ({ name: f.name, summary: f.summary, toolset: f.toolset, inputSchema: f.inputSchema })),
      };
      // what only a person does is found too, marked: calling it asks the person this agent acts for
      if (s.caller.kind === "outside") {
        const setup = deps.setupGrant?.(s.caller) === true;
        const runs = (f: ToolDef): boolean => setup && setupCovers(f);
        const asks = searchTools(
          deps.catalog.all.filter(
            (f) => f.local === "none" && outsideDoor(f) !== "open" && (outsideDoor(f) !== "off" || runs(f)),
          ),
          q,
          SEARCH_LIMIT,
        );
        for (const f of asks) {
          if (runs(f))
            data.tools.push({
              name: f.name,
              summary: f.summary,
              toolset: f.toolset,
              inputSchema: f.inputSchema,
              note: SETUP_NOTE,
            });
          else
            data.tools.push({
              name: f.name,
              summary: f.summary,
              toolset: f.toolset,
              inputSchema: outsideDoor(f) === "paste" ? PASTE_SCHEMA : f.inputSchema,
              asksPerson: true,
              note: outsideDoor(f) === "paste" ? PASTE_NOTE : ASK_NOTE,
            });
        }
      }
      deps.onCall?.(s.caller, t.name, "ok");
      return { result: textResult({ data }, false, { data }) };
    }

    // the session can end while the call runs (Remove on the agent's profile): it fails here at once, whatever the call is still waiting on
    if (s.caller.kind === "outside" && !deps.defaults.has(t.name)) s.tools.preload(s.ctx.thread.threadId, [t.name]);
    const run = s.tools.call(callId ? { ...s.ctx, callId } : s.ctx, t.name, args);
    const out = s.caller.kind === "outside" ? await Promise.race([run, s.gone]) : await run;
    if (out === "gone") {
      const error = makeError("permission.revoked", traceId, { message: "This connection was removed." });
      return { result: textResult({ error }, true, { error }) };
    }
    const threadId = s.ctx.thread.threadId;
    if (out.kind === "result") {
      const c = out.result.content as { data?: unknown; blocks?: string[] };
      const job = t.cap === "agents.next" ? (c.data as { job?: { threadId?: unknown } | null } | null)?.job : undefined;
      if (typeof job?.threadId === "string") await bind(s, job.threadId);
      deps.onCall?.(s.caller, t.name, "ok", {
        cap: t.cap,
        threadId,
        ...(typeof job?.threadId === "string" ? { threadId: job.threadId } : {}),
        card: workCardOf(t.cap, args, c.data),
      });
      return { result: textResult(c, false, c) };
    }
    if (out.kind === "held") {
      deps.onCall?.(s.caller, t.name, "held", {
        cap: t.cap,
        threadId,
        taskId: out.taskId,
        card: heldCard(t.cap, out.taskId, args),
      });
      const structured = {
        held: true,
        taskId: out.taskId,
        ...(out.runId === undefined ? {} : { runId: out.runId }),
        message: "Waiting for a person to approve this.",
      };
      return { result: textResult(structured, true, structured) };
    }
    deps.onCall?.(s.caller, t.name, "error", { cap: t.cap, threadId });
    return { result: textResult({ error: out.error }, true, { error: out.error }) };
  }

  /**
   * Ask the person (docs/ask-the-person.md): what only a person does here waits for the person this agent acts for, as an Approve task in Needs you and a card in the chat it works in. The pipeline
   * checks that person's own access first and refuses when they cannot do it either. On their yes it runs as them, once, with exactly this input, and the answer comes back through agents_next.
   */
  async function askThePerson(
    s: Session,
    t: ToolDef,
    args: Record<string, unknown>,
    traceId: string,
  ): Promise<{ result: Record<string, unknown> }> {
    const threadId = s.ctx.thread.threadId;
    const seed = {
      space: s.caller.space,
      principal: s.caller.principal,
      actingFor: s.ctx.asker,
      origin: "mcp",
      askPerson: "always" as const,
      ...(s.ctx.trace ? { trace: s.ctx.trace } : { trace: { traceId, spanId: hex(8) } }),
      ...(threadId.startsWith("thr_") ? { thread: threadId } : {}),
      ...(s.ctx.provider ? { provider: s.ctx.provider } : {}),
    };
    let out: Awaited<ReturnType<Invoke>> | "gone";
    try {
      out = await Promise.race([s.invoke(t.cap, args, seed), s.gone]);
    } catch (e) {
      let error =
        e instanceof HostError
          ? e.error
          : makeError("internal.unexpected", traceId, {
              message: `${t.name} could not finish on the server just now, and nothing was changed. Try it once more; if it fails again, tell the person in plain words that it did not work. Do not paste ids or traces.`,
              details: { tool: t.name, reason: "server_error" },
            });
      // a Mine item needs the person's own key, held on the server only while they are signed in: say so plainly (owner ruling 3 Nov)
      if ((error.details as { reason?: unknown } | undefined)?.reason === "vault_locked")
        error = {
          ...error,
          message:
            "Their Mine items open while they are signed in to Vyre. Ask the person you act for to sign in on this Space, in the app or the browser, then try again. Saving a new item works now.",
        };
      deps.onCall?.(s.caller, t.name, "error", { cap: t.cap, threadId });
      return { result: textResult({ error }, true, { error }) };
    }
    if (out === "gone") {
      const error = makeError("permission.revoked", traceId, { message: "This connection was removed." });
      return { result: textResult({ error }, true, { error }) };
    }
    if (out.status === "held") {
      // the same ask again is the same hold (the Gate's flood guard): no second card
      const repeat = s.asked.has(out.taskId);
      s.asked.add(out.taskId);
      deps.onCall?.(s.caller, t.name, "held", {
        cap: t.cap,
        threadId,
        taskId: out.taskId,
        card: repeat ? null : { ...heldCard(t.cap, out.taskId, args), lead: "Asks you" },
      });
      const structured = {
        held: true,
        asksPerson: true,
        taskId: out.taskId,
        ...(repeat ? { already: true } : {}),
        message: repeat
          ? "You already asked for exactly this. It is still waiting for the person you act for. Call agents_next for the answer."
          : "Only the person you act for can do this here, so it waits for them. Approve runs it as them, once, exactly as you sent it. Call agents_next for the answer.",
      };
      return { result: textResult(structured, true, structured) };
    }
    // it ran as the person under the setup grant: the answer, as any call's
    const c = { data: out.output };
    deps.onCall?.(s.caller, t.name, "ok", { cap: t.cap, threadId, card: workCardOf(t.cap, args, out.output) });
    return { result: textResult(c, false, c) };
  }

  /**
   * Putting a key in the Vault from outside becomes a key request (vault.request): a person who manages the folder pastes the value in their own app, where it is encrypted and stored. The agent sends
   * names only, gets the key's name back to pass as a handle, and is never given Use on it. A value in the call is refused, not stored or echoed.
   */
  async function pasteKey(
    s: Session,
    t: ToolDef,
    args: Record<string, unknown>,
    traceId: string,
  ): Promise<{ result: Record<string, unknown> }> {
    const threadId = s.ctx.thread.threadId;
    const refuse = (message: string, reason: string): { result: Record<string, unknown> } => {
      const error = makeError("validation.bad_input", traceId, { message, details: { tool: t.name, reason } });
      deps.onCall?.(s.caller, t.name, "error", { cap: t.cap, threadId });
      return { result: textResult({ error }, true, { error }) };
    };
    const fields = Array.isArray(args["fields"]) ? (args["fields"] as unknown[]) : [];
    if (
      fields.some(
        (f) =>
          f !== null &&
          typeof f === "object" &&
          typeof (f as { value?: unknown }).value === "string" &&
          (f as { value: string }).value !== "",
      )
    ) {
      return refuse(
        "Never send a secret value. Send the key's name and its field names; the person pastes the values in their own app.",
        "value_sent",
      );
    }
    const keys = [
      ...fields.map((f) => (f !== null && typeof f === "object" ? (f as { key?: unknown }).key : f)),
      ...(Array.isArray(args["fieldKeys"]) ? (args["fieldKeys"] as unknown[]) : []),
    ].filter((k): k is string => typeof k === "string" && k !== "");
    if (typeof args["name"] !== "string" || args["name"] === "")
      return refuse("Name the key, like Google_Client_Secret.", "name_required");
    const input = {
      name: args["name"],
      reason:
        typeof args["reason"] === "string" && args["reason"].trim()
          ? args["reason"]
          : "Asked for by an outside agent you connected.",
      handleOnly: true,
      ...(keys.length > 0 ? { fields: [...new Set(keys)] } : {}),
      ...(typeof args["folderId"] === "string" ? { folderId: args["folderId"] } : {}),
      idempotencyKey:
        typeof args["idempotencyKey"] === "string" && args["idempotencyKey"]
          ? args["idempotencyKey"]
          : `paste:${hex(12)}`,
    };
    const seed = {
      space: s.caller.space,
      principal: s.caller.principal,
      actingFor: s.ctx.asker,
      origin: "mcp",
      askPerson: undefined,
      ...(s.ctx.trace ? { trace: s.ctx.trace } : {}),
      ...(threadId.startsWith("thr_") ? { thread: threadId } : {}),
      ...(s.ctx.provider ? { provider: s.ctx.provider } : {}),
    };
    let out: Awaited<ReturnType<Invoke>>;
    try {
      out = await s.invoke("vault.request", input, seed);
    } catch (e) {
      const error =
        e instanceof HostError
          ? e.error
          : makeError("internal.unexpected", traceId, {
              message: `${t.name} could not finish on the server just now, and nothing was changed. Try it once more; if it fails again, tell the person in plain words that it did not work. Do not paste ids or traces.`,
              details: { tool: t.name, reason: "server_error" },
            });
      deps.onCall?.(s.caller, t.name, "error", { cap: "vault.request", threadId });
      return { result: textResult({ error }, true, { error }) };
    }
    const request =
      out.status === "ok"
        ? (out.output as { request?: { id?: unknown; taskId?: unknown; name?: unknown } } | null)?.request
        : undefined;
    const taskId = typeof request?.taskId === "string" ? request.taskId : undefined;
    deps.onCall?.(s.caller, t.name, "held", { cap: "vault.request", threadId, ...(taskId ? { taskId } : {}) });
    const structured = {
      held: true,
      asksPerson: true,
      ...(typeof request?.id === "string" ? { requestId: request.id } : {}),
      handle: `#${String(input.name)}`,
      message: `Waiting for a person to paste the value in their own app. Once saved, pass #${String(input.name)} where a handle goes. You never get the value. Call agents_next for the answer.`,
    };
    return { result: textResult(structured, true, structured) };
  }

  /**
   * A read made for a resource or a prompt: the named read tool, through this caller's tool session, so the access check, what stays with people and the audit are a tool call's. Null when it was refused,
   * failed or is not there: the caller is never told which. `note` puts it on the app's activity, as a tool call is; the reads a list is built from are not noted one by one.
   */
  async function readFor(
    s: Session,
    tool: string,
    args: Record<string, unknown>,
    note: boolean,
  ): Promise<{ data: unknown } | null> {
    const t = deps.catalog.byName(tool);
    if (!t || t.effects !== "read" || !allowed(s, t)) return null;
    s.tools.preload(s.ctx.thread.threadId, [t.name]);
    let data: { data: unknown } | null = null;
    try {
      const out = await Promise.race([s.tools.call(s.ctx, t.name, args), s.gone]);
      if (out !== "gone" && out.kind === "result") data = { data: (out.result.content as { data?: unknown }).data };
    } catch {
      /* a read that failed adds nothing */
    }
    if (note) deps.onCall?.(s.caller, t.name, data ? "ok" : "error", { cap: t.cap, threadId: s.ctx.thread.threadId });
    return data;
  }

  /**
   * One message. `modern` is a request of the 2026-07-28 revision or later: it was not preceded by a handshake, so nothing here reads what an earlier request left behind, and its result says it is complete,
   * who answered, and (for a list) how long it may be kept.
   */
  async function dispatch(s: Session | null, req: Request, modern = false): Promise<Response | null> {
    const id: Id = req.id ?? null;
    const isNote = req.id === undefined;
    const done = (result: Record<string, unknown>, ttlMs?: number): Response =>
      ok(
        id,
        modern
          ? {
              resultType: "complete",
              ...result,
              ...(ttlMs === undefined ? {} : { ttlMs, cacheScope: "private" }),
              _meta: { ...(result["_meta"] as Record<string, unknown> | undefined), [META_SERVER]: info },
            }
          : result,
      );
    const instructions = s?.caller.kind === "outside" ? OUTSIDE_INSTRUCTIONS : INSTRUCTIONS;
    // an app connected from outside also gets the Space's things as resources and its skills as prompts; a CLI engine the host runs has both through its own tools, and is offered tools only
    const more =
      s?.caller.kind === "outside"
        ? { resources: { subscribe: true }, prompts: { listChanged: true }, completions: {} }
        : {};
    const params = (req.params ?? {}) as Record<string, unknown>;
    switch (req.method) {
      case "initialize":
        return isNote
          ? null
          : ok(id, {
              protocolVersion: s?.protocol,
              capabilities: { tools: { listChanged: false }, ...more },
              serverInfo: info,
              instructions,
            });
      case "server/discover":
        // the handshake's answer for a client that has none: asked for at any time, or never
        if (!modern) break;
        return isNote
          ? null
          : done(
              { supportedVersions: SUPPORTED_VERSIONS, capabilities: { tools: {}, ...more }, instructions },
              DISCOVER_TTL_MS,
            );
      case "resources/list": {
        if (isNote) return null;
        if (!s || s.caller.kind !== "outside") break;
        if (params["cursor"] !== undefined) return err(id, INVALID_PARAMS, "That cursor is not one this server gave.");
        const [types, files, templates] = await Promise.all(
          (["types", "files", "templates"] as const).map((k) =>
            readFor(s, LIST_READS[k].tool, LIST_READS[k].args, false),
          ),
        );
        return done(
          { resources: listedResources({ types: types?.data, files: files?.data, templates: templates?.data }) },
          LIST_TTL_MS,
        );
      }
      case "resources/templates/list":
        if (isNote) return null;
        if (!s || s.caller.kind !== "outside") break;
        if (params["cursor"] !== undefined) return err(id, INVALID_PARAMS, "That cursor is not one this server gave.");
        return done({ resourceTemplates: RESOURCE_TEMPLATES }, LIST_TTL_MS);
      case "resources/read": {
        if (isNote) return null;
        if (!s || s.caller.kind !== "outside") break;
        const uri = params["uri"];
        // a thing the caller may not see and a thing that is not there are the same answer
        const missing = (): Response =>
          err(id, modern ? INVALID_PARAMS : RESOURCE_NOT_FOUND, "Resource not found", {
            uri: typeof uri === "string" ? uri.slice(0, 512) : null,
          });
        const route = routeOf(uri);
        if (!route) return missing();
        let got = await readFor(s, route.tool, route.args, true);
        if (got && needsBytes(route, got.data)) got = (await readFor(s, route.tool, asBytes(route).args, false)) ?? got;
        if (!got) return missing();
        return done({ contents: contentsOf(route, uri as string, got.data) }, 0);
      }
      case "resources/subscribe":
      case "resources/unsubscribe": {
        // the handshake revisions: what this session's GET stream is told about. The current revision names its addresses on subscriptions/listen.
        if (modern) break;
        if (isNote) return null;
        if (!s || s.caller.kind !== "outside") break;
        const uri = params["uri"];
        if (typeof uri !== "string" || !routeOf(uri))
          return err(id, RESOURCE_NOT_FOUND, "Resource not found", {
            uri: typeof uri === "string" ? uri.slice(0, 512) : null,
          });
        if (req.method === "resources/unsubscribe") s.subs.delete(uri);
        else if (s.subs.size < MAX_WATCHED) s.subs.add(uri);
        else return err(id, INVALID_PARAMS, `One app watches at most ${MAX_WATCHED} addresses.`);
        return ok(id, {});
      }
      case "prompts/list": {
        if (isNote) return null;
        if (!s || s.caller.kind !== "outside") break;
        if (params["cursor"] !== undefined) return err(id, INVALID_PARAMS, "That cursor is not one this server gave.");
        const skills = await readFor(s, "skills_list", { agentId: s.caller.principal.id }, false);
        return done({ prompts: promptsOf(skills?.data) }, LIST_TTL_MS);
      }
      case "prompts/get": {
        if (isNote) return null;
        if (!s || s.caller.kind !== "outside") break;
        const name = params["name"];
        const loaded = isSkillName(name)
          ? await readFor(s, "load_skill", { name, agentId: s.caller.principal.id }, true)
          : null;
        const prompt = promptOf(
          loaded?.data,
          (params["arguments"] as Record<string, unknown> | undefined)?.["request"],
        );
        return prompt
          ? done(prompt)
          : err(id, INVALID_PARAMS, `Unknown prompt: ${typeof name === "string" ? name.slice(0, 64) : ""}`);
      }
      case "completion/complete": {
        if (isNote) return null;
        if (!s || s.caller.kind !== "outside") break;
        const types = await readFor(s, LIST_READS.types.tool, LIST_READS.types.args, false);
        return done({ completion: completionsOf(params["ref"], params["argument"], types?.data) });
      }
      case "notifications/initialized":
      case "notifications/cancelled":
        return null;
      case "ping":
        // gone from the protocol with the handshake
        if (modern) break;
        return isNote ? null : ok(id, {});
      case "tools/list":
        if (isNote) return null;
        if (!s) return err(id, INVALID_REQUEST, "No session.");
        return modern ? done({ tools: stableToolViews(s) }, LIST_TTL_MS) : ok(id, { tools: toolViews(s) });
      case "tools/call": {
        if (isNote) return null;
        if (!s) return err(id, INVALID_REQUEST, "No session.");
        try {
          const r = await callTool(s, req.params, `${s.caller.sessionId}:${String(id)}`);
          return "invalid" in r ? err(id, INVALID_PARAMS, r.invalid) : done(r.result);
        } catch {
          return err(id, INTERNAL_ERROR, "Something went wrong on our side.");
        }
      }
      case "vyre/hook": {
        // the vyre-hook shim of a CLI engine: its own built-in tools and subagents (Vyre's own tools already pass through the tool session, so they are not asked twice)
        if (isNote) return null;
        if (!s || s.caller.kind !== "driver") return err(id, INVALID_REQUEST, "No session.");
        const p = (req.params ?? {}) as { event?: unknown; payload?: Record<string, unknown> };
        const event = CLI_EVENT[String(p.event)];
        const body = p.payload ?? {};
        const tool = typeof body["tool_name"] === "string" ? (body["tool_name"] as string) : undefined;
        if (!event || !hooksHolder.port || (tool?.startsWith("mcp__vyre__") ?? false))
          return ok(id, { block: null, notes: [] });
        const v = await hooksHolder.port.fire({
          event,
          agentId: s.ctx.agentId,
          asker: s.ctx.asker,
          threadId: s.ctx.thread.threadId,
          threadKind: s.ctx.thread.kind,
          engine: s.caller.provider ?? "cli",
          source: "cli",
          ...(tool ? { tool } : {}),
          ...(body["tool_input"] !== undefined ? { input: body["tool_input"] } : {}),
          ...(body["tool_response"] !== undefined ? { output: body["tool_response"] } : {}),
          ...(typeof body["prompt"] === "string" ? { prompt: body["prompt"] as string } : {}),
        });
        return ok(id, { block: v.block ? v.block.reason : null, notes: v.notes });
      }
      default:
        break;
    }
    return isNote ? null : err(id, METHOD_NOT_FOUND, `Method not found: ${req.method}`);
  }

  /** The value of a mirrored header: as sent, or the text inside the `=?base64?...?=` wrapping a client uses for a name that is not plain ASCII. Null when the wrapping is broken. */
  const headerValue = (raw: string): string | null => {
    const m = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/.exec(raw);
    if (!m) return raw;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(atob(m[1] as string), (c) => c.charCodeAt(0)),
      );
    } catch {
      return null;
    }
  };

  /**
   * A request that says its own version (2026-07-28): what is wrong with how it was sent, as the answer to give, or null when it is in order. The headers repeat the body so a proxy can route on them, and
   * a request whose headers and body disagree is refused, so nothing in between can be told one thing while this server does another.
   */
  function modernRefusal(
    req: Request,
    meta: Record<string, unknown>,
    headers: McpHttpRequest["headers"],
  ): Response | null {
    const id: Id = req.id ?? null;
    const version = meta[META_VERSION];
    const sent = headers["mcp-protocol-version"];
    if (typeof version !== "string")
      return err(id, INVALID_PARAMS, `Every request names its protocol version in _meta["${META_VERSION}"].`);
    if (sent === undefined)
      return err(id, HEADER_MISMATCH, "Header mismatch: the MCP-Protocol-Version header is missing.");
    if (sent !== version)
      return err(
        id,
        HEADER_MISMATCH,
        `Header mismatch: MCP-Protocol-Version header value '${sent}' does not match body value '${version}'`,
      );
    if (!MODERN_VERSIONS.includes(version))
      return err(id, UNSUPPORTED_PROTOCOL_VERSION, "Unsupported protocol version", {
        supported: SUPPORTED_VERSIONS,
        requested: version,
      });
    const caps = meta[META_CLIENT_CAPS];
    if (caps === null || typeof caps !== "object" || Array.isArray(caps))
      return err(
        id,
        INVALID_PARAMS,
        `Every request carries _meta["${META_CLIENT_CAPS}"], an object (empty when there are none).`,
      );
    const method = headers["mcp-method"];
    if (method === undefined) return err(id, HEADER_MISMATCH, "Header mismatch: the Mcp-Method header is missing.");
    if (method !== req.method)
      return err(
        id,
        HEADER_MISMATCH,
        `Header mismatch: Mcp-Method header value '${method}' does not match body value '${req.method}'`,
      );
    const key = NAMED[req.method];
    if (key) {
      const named = (req.params as Record<string, unknown> | null | undefined)?.[key];
      const raw = headers["mcp-name"];
      if (raw === undefined) return err(id, HEADER_MISMATCH, "Header mismatch: the Mcp-Name header is missing.");
      const value = headerValue(raw);
      if (value === null || value !== named)
        return err(id, HEADER_MISMATCH, `Header mismatch: Mcp-Name header does not match the ${key} in the body.`);
    }
    return null;
  }

  /** The session this token belongs to, or null. An outside agent's token is read on every request: it may have expired, or its sign-in may have ended, since the last one. */
  async function sessionFor(
    token: string,
    tokenKey: string,
    clientName: string | undefined,
    origin: string | undefined,
  ): Promise<Session | null> {
    let s = byToken.get(tokenKey) ?? null;
    if (s?.caller.kind === "outside") {
      if (await deps.open(token, undefined, origin)) return s;
      byToken.delete(tokenKey);
      return null;
    }
    if (s && now() - s.checkedAt > recheckMs && deps.stillValid) {
      if (await deps.stillValid(s.caller)) s.checkedAt = now();
      else {
        dropSession(s);
        s = null;
      }
    }
    if (s) return s;
    const caller = await deps.open(token, clientName, origin);
    if (!caller) return null;
    // a rotated token keeps its session: the client goes on with the session id it holds
    const kept = bySession.get(caller.sessionId);
    if (kept) {
      byToken.delete(kept.tokenKey);
      kept.tokenKey = tokenKey;
      byToken.set(tokenKey, kept);
      return kept;
    }
    const made = newSession(caller, tokenKey, clientName);
    byToken.set(tokenKey, made);
    bySession.set(caller.sessionId, made);
    return made;
  }

  // ---- watching: the streams that stay open -------------------------------------------------------------------------------------------------------------------

  interface Listener {
    s: Session;
    /** The addresses it watches now. */
    uris(): ReadonlySet<string>;
    prompts: boolean;
    /** One notification, in the shape of its revision. */
    notify(method: string, params: Record<string, unknown>): void;
    /** Is its sign-in still good? Asked before it is told anything. */
    valid(): Promise<boolean>;
    end(): void;
  }
  /** An address that was just announced to a listener is not announced again within this time: one change often shows as several events (a task created and assigned). */
  const QUIET_MS = 300;
  const told = new WeakMap<Listener, Map<string, number>>();
  /** Per listener: until when a failed proof read for a change is not made again, so a watcher of a hot address it may not read costs a read now and then, not one per event. */
  const refused = new WeakMap<Listener, Map<string, number>>();
  const listeners = new Set<Listener>();
  const keepAliveMs = deps.keepAliveMs ?? KEEP_ALIVE_MS;
  const unstartedMs = deps.unstartedMs ?? UNSTARTED_MS;
  /** Places taken before a stream starts, so a burst of requests cannot all pass the check and then all open: the check and the taking are one step, with no wait between them. */
  const taken = new WeakMap<Session, number>();
  let takenTotal = 0;
  function reserve(s: Session): { release(): void; started(): void } | null {
    if ((taken.get(s) ?? 0) >= MAX_STREAMS || takenTotal >= MAX_TOTAL_STREAMS) return null;
    taken.set(s, (taken.get(s) ?? 0) + 1);
    takenTotal += 1;
    let done = false;
    const release = (): void => {
      if (done) return;
      done = true;
      taken.set(s, Math.max(0, (taken.get(s) ?? 1) - 1));
      takenTotal = Math.max(0, takenTotal - 1);
      clearTimeout(timer);
    };
    const timer = setTimeout(release, unstartedMs);
    (timer as { unref?: () => void }).unref?.();
    // a stream that has begun keeps its place until it ends: only a response that never began gives it up
    return { release, started: () => clearTimeout(timer) };
  }


  /**
   * A stream that stays open for one app. It is told only what it asked for, only while its sign-in stands (checked at every keep-alive, and before each notification), and it ends at once when the
   * app is removed. `subId` is the listen request's id (the current revision); null is the GET stream of a handshake revision, which has no acknowledgment and no closing answer.
   */
  function openStream(
    s: Session,
    token: string,
    origin: string | undefined,
    subId: Id,
    watch: { uris(): ReadonlySet<string>; prompts: boolean },
    ack: Record<string, unknown> | null,
    slot: { release(): void; started(): void },
  ): McpHttpResponse {
    const tag = subId === null ? {} : { _meta: { [META_SUBSCRIPTION]: subId } };
    return {
      status: 200,
      headers: { ...SSE_HEADERS },
      body: "",
      stream: async ({ write, closed }) => {
        slot.started();
        try {
          await run({ write, closed });
        } finally {
          slot.release();
        }
      },
    };
    async function run({ write, closed }: { write(chunk: string): void; closed: Promise<void> }): Promise<void> {
      {
        let over: (why: "ended") => void = () => undefined;
        const ended = new Promise<"ended">((resolve) => {
          over = resolve;
        });
        const l: Listener = {
          s,
          uris: watch.uris,
          prompts: watch.prompts,
          notify: (method, params) => write(sse({ jsonrpc: "2.0", method, params: { ...params, ...tag } })),
          valid: async () => bySession.get(s.caller.sessionId) === s && (await deps.open(token, undefined, origin)) !== null,
          end: () => over("ended"),
        };
        // the acknowledgment is the first thing on the stream, before any notification can be
        if (ack)
          write(sse({ jsonrpc: "2.0", method: "notifications/subscriptions/acknowledged", params: { ...tag, notifications: ack } }));
        listeners.add(l);
        const tick = setInterval(() => {
          write(":\n\n");
          void l.valid().then(
            (good) => {
              if (!good) l.end();
            },
            () => l.end(),
          );
        }, keepAliveMs);
        (tick as { unref?: () => void }).unref?.();
        const why = await Promise.race([closed.then(() => "client" as const), s.gone, ended]);
        clearInterval(tick);
        listeners.delete(l);
        // an ending of our own doing says so, so the client knows it was not a dropped line; a client that went away is told nothing
        if (why !== "client" && subId !== null)
          write(sse(ok(subId, { resultType: "complete", _meta: { [META_SUBSCRIPTION]: subId, [META_SERVER]: info } })));
      }
    }
  }

  /** subscriptions/listen (2026-07-28): the one long request an app keeps open to be told what changed. It names what it wants; the acknowledgment names what it gets. */
  function listen(s: Session, token: string, origin: string | undefined, req: Request): McpHttpResponse {
    const id: Id = req.id ?? null;
    if (s.caller.kind !== "outside")
      return json(404, err(id, METHOD_NOT_FOUND, `Method not found: ${req.method}`));
    const asked = (req.params as { notifications?: unknown } | null | undefined)?.notifications;
    if (id === null || asked === null || typeof asked !== "object" || Array.isArray(asked))
      return json(200, err(id, INVALID_PARAMS, "subscriptions/listen needs an id and a notifications object."));
    const slot = reserve(s);
    if (!slot)
      return json(429, err(id, INVALID_REQUEST, `One app holds at most ${MAX_STREAMS} streams open, and this Space ${MAX_TOTAL_STREAMS}. Close one first.`));
    const want = asked as { promptsListChanged?: unknown; resourceSubscriptions?: unknown };
    // an address that is not one of this server's is left out of the acknowledgment, which is how the client learns it is not watched
    const uris = new Set(
      (Array.isArray(want.resourceSubscriptions) ? want.resourceSubscriptions : [])
        .filter((u): u is string => typeof u === "string" && routeOf(u) !== null)
        .slice(0, MAX_WATCHED),
    );
    const prompts = want.promptsListChanged === true;
    return openStream(s, token, origin, id, { uris: () => uris, prompts }, {
      ...(prompts ? { promptsListChanged: true } : {}),
      ...(Array.isArray(want.resourceSubscriptions) ? { resourceSubscriptions: [...uris] } : {}),
    }, slot);
  }

  /** Tell the apps that are watching. Each is told only after the proof read passes as that app, so what an app may not see it does not hear of. */
  async function changed(change: McpChange): Promise<number> {
    let sent = 0;
    for (const l of [...listeners]) {
      try {
        const who = l.s.caller.actingFor ?? "";
        const hits = (change.targets ?? []).filter(
          (t) => l.uris().has(t.uri) && (t.people === undefined || t.people.includes(who)),
        );
        const prompts = change.prompts === true && l.prompts;
        if (hits.length === 0 && !prompts) continue;
        if (!(await l.valid())) {
          l.end();
          continue;
        }
        if (prompts) {
          l.notify("notifications/prompts/list_changed", {});
          sent += 1;
        }
        if (hits.length === 0) continue;
        if (change.proof) {
          const key = `${change.proof.tool} ${JSON.stringify(change.proof.args)}`;
          const memo = refused.get(l) ?? new Map<string, number>();
          refused.set(l, memo);
          if (now() < (memo.get(key) ?? 0)) continue;
          if (!(await readFor(l.s, change.proof.tool, change.proof.args, false))) {
            memo.set(key, now() + DENIED_MS);
            continue;
          }
        }
        if (!listeners.has(l)) continue;
        const recent = told.get(l) ?? new Map<string, number>();
        told.set(l, recent);
        for (const t of hits) {
          const at = now();
          if (at - (recent.get(t.uri) ?? -Infinity) < QUIET_MS) continue;
          recent.set(t.uri, at);
          l.notify("notifications/resources/updated", { uri: t.uri });
          sent += 1;
        }
      } catch {
        /* one app's stream never stops the others being told */
      }
    }
    return sent;
  }

  async function handle(req: McpHttpRequest): Promise<McpHttpResponse> {
    if (!originOk(req.headers["origin"])) return json(403, { error: "origin not allowed" });
    if (req.method === "DELETE") {
      const token = bearer(req.headers["authorization"]);
      if (!token) return unauthorized(req.origin);
      const s = byToken.get(await sha256(token));
      if (!s) return empty(404);
      dropSession(s);
      return empty(204);
    }
    // GET is the notification stream of the handshake revisions (2025-11-25 and before), for an app that opened with initialize: it is told about the addresses it asked to watch with resources/subscribe.
    // The current revision has no GET; its stream is the answer to a subscriptions/listen POST.
    if (req.method === "GET" && /\btext\/event-stream\b/.test(req.headers["accept"] ?? "")) {
      const token = bearer(req.headers["authorization"]);
      if (!token) return unauthorized(req.origin);
      const known = byToken.get(await sha256(token));
      if (!known) {
        // never seen: a sign-in that does not stand is refused so the app signs in again; a CLI engine's is told "not offered"
        const who = await deps.open(token, undefined, req.origin);
        if (!who) return unauthorized(req.origin, "invalid_token");
        return empty(405, { allow: "POST, DELETE" });
      }
      if (known.caller.kind !== "outside") return empty(405, { allow: "POST, DELETE" });
      const s = await sessionFor(token, known.tokenKey, undefined, req.origin);
      if (!s) return unauthorized(req.origin, "invalid_token");
      const slot = reserve(s);
      if (!slot) return empty(429);
      return openStream(s, token, req.origin, null, { uris: () => s.subs, prompts: true }, null, slot);
    }
    if (req.method !== "POST") return empty(405, { allow: "POST, DELETE" });
    const token = bearer(req.headers["authorization"]);
    if (!token) return unauthorized(req.origin);
    if (req.body.length > maxBody) return json(413, err(null, INVALID_REQUEST, "The request is too large."));

    let parsed: unknown;
    try {
      parsed = JSON.parse(req.body);
    } catch {
      return json(400, err(null, PARSE_ERROR, "Parse error"));
    }
    const batch = Array.isArray(parsed);
    const items: unknown[] = batch ? (parsed as unknown[]) : [parsed];
    if (items.length === 0) return json(400, err(null, INVALID_REQUEST, "Empty batch"));

    const tokenKey = await sha256(token);
    const init = items.find((i): i is Request => isRequest(i) && i.method === "initialize");
    const initializing = init !== undefined;
    // which era: a request that names its version in _meta (or in the header alone, which is then a request sent wrong) is answered on its own, with no handshake before it and no session after it
    const metaOf = (i: unknown): Record<string, unknown> | null => {
      const m = isRequest(i) ? (i.params as { _meta?: unknown } | null | undefined)?._meta : undefined;
      return m !== null && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : null;
    };
    const modern =
      !initializing &&
      (items.some((i) => META_VERSION in (metaOf(i) ?? {})) ||
        MODERN_VERSIONS.includes(req.headers["mcp-protocol-version"] ?? ""));
    const meta = modern ? (metaOf(items[0]) ?? {}) : {};
    const named = modern
      ? (meta[META_CLIENT] as { name?: unknown } | null | undefined)?.name
      : (init?.params as { clientInfo?: { name?: unknown } } | null | undefined)?.clientInfo?.name;
    const clientName = typeof named === "string" ? named.slice(0, 120) : undefined;
    const s = await sessionFor(token, tokenKey, clientName, req.origin);
    if (!s) return unauthorized(req.origin, "invalid_token");
    if (modern) {
      const item = items[0];
      if (batch || !isRequest(item)) return json(400, err(null, INVALID_REQUEST, "Send one request in each POST."));
      const refusal = modernRefusal(item, meta, req.headers);
      if (refusal) return json(400, refusal);
      if (clientName !== undefined) s.clientName = clientName;
      if (item.method === "subscriptions/listen") return listen(s, token, req.origin, item);
      const r = await dispatch(s, item, true);
      if (!r) return empty(202);
      // an unknown method is 404 with the JSON-RPC error in the body, which is how a client tells this endpoint from an older server that has no such address
      return json("error" in r && r.error.code === METHOD_NOT_FOUND ? 404 : 200, r);
    }
    const header = req.headers["mcp-session-id"];
    if (header !== undefined && header !== s.caller.sessionId && !initializing) return empty(404);

    const out: Response[] = [];
    for (const item of items) {
      if (!isRequest(item)) {
        out.push(err(null, INVALID_REQUEST, "Invalid request"));
        continue;
      }
      if (item.method === "initialize") {
        const p = item.params as { protocolVersion?: unknown; clientInfo?: { name?: unknown } } | null;
        const asked = typeof p?.protocolVersion === "string" ? p.protocolVersion : "";
        s.protocol = PROTOCOL_VERSIONS.includes(asked) ? asked : (PROTOCOL_VERSIONS[0] ?? "2025-06-18");
        if (typeof p?.clientInfo?.name === "string") s.clientName = p.clientInfo.name.slice(0, 120);
      }
      const r = await dispatch(s, item);
      if (r) out.push(r);
    }
    const headers: Record<string, string> = initializing ? { "mcp-session-id": s.caller.sessionId } : {};
    if (out.length === 0) return empty(202, headers);
    return json(200, batch ? out : out[0], headers);
  }

  return {
    handle,
    sessions: () => bySession.size,
    end(sessionId) {
      const s = bySession.get(sessionId);
      if (!s) return false;
      dropSession(s);
      return true;
    },
    changed,
    listeners: () => listeners.size,
  };
}
