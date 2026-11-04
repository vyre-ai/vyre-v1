// The MCP endpoint (Streamable HTTP, request/response form): one POST per JSON-RPC message or batch.
//   auth        Authorization: Bearer <token>; the token is an outside agent's access token (modules/mcp/oauth.ts) or the session token of a CLI engine (types.ts open). No token, or a bad one, answers 401 naming where to sign in.
//   tools/list  the default listed set the caller may use, plus the deferred tools it found with tool_search in this session
//   tools/call  one capability invoke, as the agent acting for the person; outside.ts narrows an outside agent first, then the same ToolSession the API drivers use refuses
//               what was never offered, and the invoke pipeline intersects access, applies the Gate and writes the audit row
// Nothing here decides access. A tool being listed grants nothing.
import { createToolSession } from "../tools/call.ts";
import { decideLocal, dialFor } from "../tools/local.ts";
import { localFacts } from "../tools/local-facts.ts";
import type { ToolSession } from "../tools/call.ts";
import type { ToolCtx, ToolDef } from "../tools/types.ts";
import type { Invoke } from "../../../host/src/invoke.ts";
import { makeError } from "../../../host/src/routes/errors.ts";
import { INTERNAL_ERROR, INVALID_PARAMS, INVALID_REQUEST, METHOD_NOT_FOUND, PARSE_ERROR, err, isRequest, ok } from "./jsonrpc.ts";
import type { Id, Request, Response } from "./jsonrpc.ts";
import { outsideAllows, outsideDoor, setupCovers, setupRefusal } from "./outside.ts";
import { searchTools } from "../tools/access.ts";
import { HostError } from "../../../host/src/routes/errors.ts";
import { heldCard, workCardOf } from "../tools/work-cards.ts";
import type { McpCaller, McpHttpRequest, McpHttpResponse, McpServer, McpServerDeps } from "./types.ts";

export const PROTOCOL_VERSIONS: readonly string[] = ["2025-06-18", "2025-03-26", "2024-11-05"];
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
const USE_TOOL_VIEW = { name: USE_TOOL, description: "Call a tool that tool_search found, by name.", inputSchema: { type: "object", properties: { name: { type: "string" }, arguments: { type: "object" } }, required: ["name"] }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } };
/** What tool_search shows an outside agent for putting a key in the Vault: names only. */
const PASTE_SCHEMA = { type: "object", properties: { name: { type: "string", description: "The key's name, like Google_Client_Secret" }, fieldKeys: { type: "array", items: { type: "string" } }, folderId: { type: "string" }, reason: { type: "string" } }, required: ["name"] };
const PASTE_NOTE = "Asks a person to paste the value in their own app. Send names only; you get the key's name back to pass as a handle, never the value.";
const ASK_NOTE = "Only a person does this here. Calling it asks the person you act for; it runs as them once they approve.";
const SETUP_NOTE = "Runs as the person you act for, under the setup grant they gave you. Their own rights are checked on the call.";
/** Listed for an outside agent from the start, so it can get work and answer without a search. */
const OUTSIDE_PRELOAD: readonly string[] = ["agents_next"];
/** Listed for a CLI engine from the start: "make me a file" is a first-hour ask, and it needs a new file and a place to put it. */
const ENGINE_PRELOAD: readonly string[] = ["files_tree", "files_create", "files_folder_create", "people_status", "message_person", "task_submit", "task_ask", "models_for_helpers", "helper_note"];   // and who is in, and a message to a teammate (lane l-agentdm), and the two a helper hands in or asks with, so it never has to search for them

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
  /** Settles when the session ends: a call in flight stops waiting and fails. */
  gone: Promise<"gone">;
  end: () => void;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): McpHttpResponse =>
  ({ status, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const empty = (status: number, headers: Record<string, string> = {}): McpHttpResponse => ({ status, headers, body: "" });

async function sha256(text: string): Promise<string> {
  const d = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

const bearer = (h: string | undefined): string | null => {
  const m = /^Bearer\s+(\S+)$/i.exec(h ?? "");
  return m?.[1] ?? null;
};

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

const hex = (n: number): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

export function toolView(t: ToolDef): { name: string; description: string; inputSchema: unknown; annotations: Record<string, unknown> } {
  return {
    name: t.name,
    description: t.summary,
    inputSchema: t.inputSchema ?? { type: "object", properties: {} },
    annotations: { readOnlyHint: t.effects === "read", destructiveHint: t.effects !== "read" && /(^|[._])(delete|remove|purge|erase|destroy|discard|revoke)([._]|$)/.test(t.cap), openWorldHint: t.effects === "outward" },
  };
}

export function createMcpServer(deps: McpServerDeps): McpServer {
  const now = deps.now ?? Date.now;
  const info = deps.info ?? { name: "vyre", version: "1.0.0" };
  const recheckMs = deps.recheckMs ?? RECHECK_MS;
  const maxBody = deps.maxBodyBytes ?? MAX_BODY;
  const byToken = new Map<string, Session>();
  const bySession = new Map<string, Session>();

  const originOk = (origin: string | undefined): boolean => origin === undefined || LOOPBACK.test(origin) || (deps.allowedOrigins?.includes(origin) ?? false);

  function newSession(caller: McpCaller, tokenKey: string, clientName: string | undefined): Session {
    const asker = caller.actingFor ?? caller.principal.id;
    // The pipeline sees the real principal and the real origin.
    // An outside agent that has not taken a job works in no chat, so its calls name none, and every call it makes is on the audit log, whatever the capability.
    const invoke: Invoke = (cap, input, seed) => {
      const outsideCall = caller.kind === "outside";
      // the setup grant: a call in its scope that the agent may not make runs as its person (host/src/invoke.ts), read now so a grant taken back counts at once
      const t = outsideCall ? deps.catalog.all.find((x) => x.cap === cap) : undefined;
      const setup = t !== undefined && setupCovers(t) && setupRefusal(t, input) === null && deps.setupGrant?.(caller) === true;
      const { thread, ...rest } = seed;
      // An outside agent stopped at a role its person holds asks that person (docs/ask-the-person.md); the door says 'always' for what only a person does.
      return deps.invoke(cap, input, { ...rest, principal: caller.principal, origin: "mcp", space: caller.space, ...(thread !== undefined && (!outsideCall || thread.startsWith("thr_")) ? { thread } : {}), ...(outsideCall ? { auditAll: true, askPerson: seed.askPerson ?? "if_refused", ...(setup ? { setupGrant: true } : {}) } : {}) });
    };
    const tools = createToolSession({
      catalog: deps.catalog, defaults: deps.defaults, invoke,
      levelFor: () => caller.askLevel ?? null,
      canEngineer: () => false,
      // A CLI engine's session works for one chat, so a local tool follows that chat's mode, under the owner's floor. An outside agent has none: outside.ts refuses local tools before they get here.
      ...(caller.kind === "driver" ? { localPolicy: (t: ToolDef, c: ToolCtx, input: unknown) => { const dial = dialFor(c.thread.mode, caller.localFloor); return decideLocal(t, dial.person, dial.floor, localFacts(t, input)); } } : {}),
    });
    const threadId = caller.threadId ?? caller.sessionId;
    if (caller.preload) tools.preload(threadId, caller.preload);
    tools.preload(threadId, caller.kind === "outside" ? OUTSIDE_PRELOAD : ENGINE_PRELOAD);
    const ctx: ToolCtx = {
      space: caller.space, agentId: caller.principal.id, asker,
      thread: { threadId, kind: caller.threadKind ?? "chat", planMode: caller.planMode === true || caller.mode === "plan", ...(caller.mode !== undefined ? { mode: caller.mode } : {}), ...(caller.scope ? { scope: caller.scope } : {}) },
      ...(caller.rules ? { rules: caller.rules } : {}),
      ...(caller.provider ? { provider: caller.provider } : {}),
      ...(caller.runId ? { runId: caller.runId } : {}),
      ...(caller.traceId ? { trace: { traceId: caller.traceId, spanId: hex(8) } } : {}),
    };
    let end = (): void => undefined;
    const gone = new Promise<"gone">((resolve) => { end = () => resolve("gone"); });
    return { caller, invoke, tools, ctx, tokenKey, asked: new Set<string>(), checkedAt: now(), protocol: PROTOCOL_VERSIONS[0] ?? "2025-06-18", clientName, gone, end };
  }

  const dropSession = (s: Session): void => {
    byToken.delete(s.tokenKey);
    bySession.delete(s.caller.sessionId);
    s.end();
    deps.onClose?.(s.caller);
  };

  const unauthorized = (origin: string | undefined, error?: "invalid_token"): McpHttpResponse => empty(401, { "www-authenticate": deps.challenge ? deps.challenge(origin, error) : error ? `Bearer error="${error}"` : "Bearer" });

  const allowed = (s: Session, t: ToolDef): boolean => s.caller.kind !== "outside" || outsideAllows(t);

  /** An outside agent took a job: from here its tools work in that chat, under the chat's mode. Auto never reaches it: "asked this turn" needs a turn Vyre can see, so an outward act stops for a person unless they gave a standing yes. */
  async function bind(s: Session, threadId: string): Promise<void> {
    if (s.ctx.thread.threadId === threadId) return;
    const facts: Partial<Pick<McpCaller, "mode" | "planMode" | "threadKind" | "scope">> = (await deps.bindThread?.(s.caller, threadId).catch(() => null)) ?? {};
    const was = s.tools.loaded(s.ctx.thread.threadId);
    s.tools.preload(threadId, [...was]);
    s.ctx = { ...s.ctx, thread: {
      threadId, kind: facts.threadKind ?? "chat", planMode: facts.planMode === true || facts.mode === "plan", ...(facts.mode === "ask" || facts.mode === "plan" ? { mode: facts.mode } : {}), ...(facts.scope ? { scope: facts.scope } : {}),
    } };
  }

  function listTools(s: Session): ToolDef[] {
    const set = s.tools.toolsFor(s.ctx);
    const loaded = s.tools.loaded(s.ctx.thread.threadId);
    const out = [...set.listed, ...set.searchable.filter((t) => loaded.has(t.name))];
    return out.filter((t) => allowed(s, t));
  }
  const toolViews = (s: Session): unknown[] => [...listTools(s).map(toolView), ...(s.caller.kind === "outside" || !s.ctx.thread.planMode ? [USE_TOOL_VIEW] : [])];

  /** The text a model reads. The same data also travels as structuredContent unless it had to be cut: a cut answer is never sent twice. */
  const textResult = (value: unknown, isError: boolean, structured?: unknown): Record<string, unknown> => {
    let text = typeof value === "string" ? value : JSON.stringify(value);
    const cut = text.length > MAX_RESULT_CHARS;
    if (cut) text = `${text.slice(0, MAX_RESULT_CHARS)}\n[cut: ${text.length - MAX_RESULT_CHARS} more characters]`;
    return { content: [{ type: "text", text }], isError, ...(structured === undefined || cut ? {} : { structuredContent: structured }) };
  };

  async function callTool(s: Session, params: unknown): Promise<{ result: Record<string, unknown> } | { invalid: string }> {
    const p = params as { name?: unknown; arguments?: unknown } | null;
    if (!p || typeof p.name !== "string" || p.name === "") return { invalid: "tools/call needs a tool name" };
    if (p.arguments !== undefined && (p.arguments === null || typeof p.arguments !== "object" || Array.isArray(p.arguments))) return { invalid: "arguments must be an object" };
    const args = (p.arguments ?? {}) as Record<string, unknown>;
    if (p.name === USE_TOOL) return callTool(s, { name: args["name"], arguments: args["arguments"] ?? {} });
    const t = deps.catalog.byName(p.name);
    if (!t) return { invalid: `Unknown tool: ${p.name}` };
    const traceId = s.ctx.trace?.traceId ?? hex(16);

    if (!allowed(s, t)) {
      const door = outsideDoor(t);
      // with the setup grant, what is in its scope runs as the person, values included; what is not stays where it was
      if (door !== "open" && setupCovers(t) && deps.setupGrant?.(s.caller) === true) {
        const no = setupRefusal(t, args);
        if (no !== null) {
          const error = makeError("permission.role_lacks_permission", traceId, { message: no, details: { tool: t.name, reason: "setup_people_only" } });
          deps.onCall?.(s.caller, t.name, "error", { cap: t.cap, threadId: s.ctx.thread.threadId });
          return { result: textResult({ error }, true, { error }) };
        }
        return askThePerson(s, t, args, traceId);
      }
      if (door === "ask") return askThePerson(s, t, args, traceId);
      if (door === "paste") return pasteKey(s, t, args, traceId);
      const message = t.toolset === "vault"
        ? "The Vault stays in the person's app. To add a key, call vault_item_put with its name and field names, and the person pastes the value."
        : "That runs on a Vyre computer. Use your own machine for it.";
      const error = makeError("permission.role_lacks_permission", traceId, { message, details: { tool: t.name, reason: "not_from_outside" } });
      deps.onCall?.(s.caller, t.name, "error", { cap: t.cap, threadId: s.ctx.thread.threadId });
      return { result: textResult({ error }, true, { error }) };
    }

    if (t.name === "tool_search") {
      const q = args["query"];
      if (typeof q !== "string" || q.trim() === "") {
        const error = makeError("validation.bad_input", traceId, { details: { errors: ["/query: required"], tool: t.name } });
        return { result: textResult({ error }, true, { error }) };
      }
      const found = s.tools.search(s.ctx, q).filter((f) => allowed(s, f)).slice(0, SEARCH_LIMIT);
      const data: { tools: Array<Record<string, unknown>> } = { tools: found.map((f) => ({ name: f.name, summary: f.summary, toolset: f.toolset, inputSchema: f.inputSchema })) };
      // what only a person does is found too, marked: calling it asks the person this agent acts for
      if (s.caller.kind === "outside") {
        const setup = deps.setupGrant?.(s.caller) === true;
        const runs = (f: ToolDef): boolean => setup && setupCovers(f);
        const asks = searchTools(deps.catalog.all.filter((f) => f.local === "none" && outsideDoor(f) !== "open" && (outsideDoor(f) !== "off" || runs(f))), q, SEARCH_LIMIT);
        for (const f of asks) {
          if (runs(f)) data.tools.push({ name: f.name, summary: f.summary, toolset: f.toolset, inputSchema: f.inputSchema, note: SETUP_NOTE });
          else data.tools.push({ name: f.name, summary: f.summary, toolset: f.toolset, inputSchema: outsideDoor(f) === "paste" ? PASTE_SCHEMA : f.inputSchema, asksPerson: true, note: outsideDoor(f) === "paste" ? PASTE_NOTE : ASK_NOTE });
        }
      }
      deps.onCall?.(s.caller, t.name, "ok");
      return { result: textResult({ data }, false, { data }) };
    }

    // the session can end while the call runs (Remove on the agent's profile): it fails here at once, whatever the call is still waiting on
    if (s.caller.kind === "outside" && !deps.defaults.has(t.name)) s.tools.preload(s.ctx.thread.threadId, [t.name]);
    const run = s.tools.call(s.ctx, t.name, args);
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
      deps.onCall?.(s.caller, t.name, "ok", { cap: t.cap, threadId, ...(typeof job?.threadId === "string" ? { threadId: job.threadId } : {}), card: workCardOf(t.cap, args, c.data) });
      return { result: textResult(c, false, c) };
    }
    if (out.kind === "held") {
      deps.onCall?.(s.caller, t.name, "held", { cap: t.cap, threadId, taskId: out.taskId, card: heldCard(t.cap, out.taskId, args) });
      const structured = { held: true, taskId: out.taskId, ...(out.runId === undefined ? {} : { runId: out.runId }), message: "Waiting for a person to approve this." };
      return { result: textResult(structured, true, structured) };
    }
    deps.onCall?.(s.caller, t.name, "error", { cap: t.cap, threadId });
    return { result: textResult({ error: out.error }, true, { error: out.error }) };
  }

  /**
   * Ask the person (docs/ask-the-person.md): what only a person does here waits for the person this agent acts for, as an Approve task in Needs you and a card in the chat it works in. The pipeline
   * checks that person's own access first and refuses when they cannot do it either. On their yes it runs as them, once, with exactly this input, and the answer comes back through agents_next.
   */
  async function askThePerson(s: Session, t: ToolDef, args: Record<string, unknown>, traceId: string): Promise<{ result: Record<string, unknown> }> {
    const threadId = s.ctx.thread.threadId;
    const seed = { space: s.caller.space, principal: s.caller.principal, actingFor: s.ctx.asker, origin: "mcp", askPerson: "always" as const, ...(s.ctx.trace ? { trace: s.ctx.trace } : { trace: { traceId, spanId: hex(8) } }), ...(threadId.startsWith("thr_") ? { thread: threadId } : {}), ...(s.ctx.provider ? { provider: s.ctx.provider } : {}) };
    let out: Awaited<ReturnType<Invoke>> | "gone";
    try { out = await Promise.race([s.invoke(t.cap, args, seed), s.gone]); }
    catch (e) {
      let error = e instanceof HostError ? e.error : makeError("internal.unexpected", traceId, { message: `${t.name} could not finish on the server just now, and nothing was changed. Try it once more; if it fails again, tell the person it did not work and give them this trace: ${traceId}.`, details: { tool: t.name, reason: "server_error" } });
      // a Mine item needs the person's own key, held on the server only while they are signed in: say so plainly (owner ruling 3 Nov)
      if ((error.details as { reason?: unknown } | undefined)?.reason === "vault_locked") error = { ...error, message: "Their Mine items open while they are signed in to Vyre. Ask the person you act for to sign in on this Space, in the app or the browser, then try again. Saving a new item works now." };
      deps.onCall?.(s.caller, t.name, "error", { cap: t.cap, threadId });
      return { result: textResult({ error }, true, { error }) };
    }
    if (out === "gone") { const error = makeError("permission.revoked", traceId, { message: "This connection was removed." }); return { result: textResult({ error }, true, { error }) }; }
    if (out.status === "held") {
      // the same ask again is the same hold (the Gate's flood guard): no second card
      const repeat = s.asked.has(out.taskId);
      s.asked.add(out.taskId);
      deps.onCall?.(s.caller, t.name, "held", { cap: t.cap, threadId, taskId: out.taskId, card: repeat ? null : { ...heldCard(t.cap, out.taskId, args), lead: "Asks you" } });
      const structured = { held: true, asksPerson: true, taskId: out.taskId, ...(repeat ? { already: true } : {}), message: repeat ? "You already asked for exactly this. It is still waiting for the person you act for. Call agents_next for the answer." : "Only the person you act for can do this here, so it waits for them. Approve runs it as them, once, exactly as you sent it. Call agents_next for the answer." };
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
  async function pasteKey(s: Session, t: ToolDef, args: Record<string, unknown>, traceId: string): Promise<{ result: Record<string, unknown> }> {
    const threadId = s.ctx.thread.threadId;
    const refuse = (message: string, reason: string): { result: Record<string, unknown> } => {
      const error = makeError("validation.bad_input", traceId, { message, details: { tool: t.name, reason } });
      deps.onCall?.(s.caller, t.name, "error", { cap: t.cap, threadId });
      return { result: textResult({ error }, true, { error }) };
    };
    const fields = Array.isArray(args["fields"]) ? (args["fields"] as unknown[]) : [];
    if (fields.some((f) => f !== null && typeof f === "object" && typeof (f as { value?: unknown }).value === "string" && (f as { value: string }).value !== "")) {
      return refuse("Never send a secret value. Send the key's name and its field names; the person pastes the values in their own app.", "value_sent");
    }
    const keys = [...fields.map((f) => (f !== null && typeof f === "object" ? (f as { key?: unknown }).key : f)), ...(Array.isArray(args["fieldKeys"]) ? (args["fieldKeys"] as unknown[]) : [])].filter((k): k is string => typeof k === "string" && k !== "");
    if (typeof args["name"] !== "string" || args["name"] === "") return refuse("Name the key, like Google_Client_Secret.", "name_required");
    const input = {
      name: args["name"], reason: typeof args["reason"] === "string" && args["reason"].trim() ? args["reason"] : "Asked for by an outside agent you connected.", handleOnly: true,
      ...(keys.length > 0 ? { fields: [...new Set(keys)] } : {}), ...(typeof args["folderId"] === "string" ? { folderId: args["folderId"] } : {}),
      idempotencyKey: typeof args["idempotencyKey"] === "string" && args["idempotencyKey"] ? args["idempotencyKey"] : `paste:${hex(12)}`,
    };
    const seed = { space: s.caller.space, principal: s.caller.principal, actingFor: s.ctx.asker, origin: "mcp", askPerson: undefined, ...(s.ctx.trace ? { trace: s.ctx.trace } : {}), ...(threadId.startsWith("thr_") ? { thread: threadId } : {}), ...(s.ctx.provider ? { provider: s.ctx.provider } : {}) };
    let out: Awaited<ReturnType<Invoke>>;
    try { out = await s.invoke("vault.request", input, seed); }
    catch (e) {
      const error = e instanceof HostError ? e.error : makeError("internal.unexpected", traceId, { message: `${t.name} could not finish on the server just now, and nothing was changed. Try it once more; if it fails again, tell the person it did not work and give them this trace: ${traceId}.`, details: { tool: t.name, reason: "server_error" } });
      deps.onCall?.(s.caller, t.name, "error", { cap: "vault.request", threadId });
      return { result: textResult({ error }, true, { error }) };
    }
    const request = out.status === "ok" ? (out.output as { request?: { id?: unknown; taskId?: unknown; name?: unknown } } | null)?.request : undefined;
    const taskId = typeof request?.taskId === "string" ? request.taskId : undefined;
    deps.onCall?.(s.caller, t.name, "held", { cap: "vault.request", threadId, ...(taskId ? { taskId } : {}) });
    const structured = { held: true, asksPerson: true, ...(typeof request?.id === "string" ? { requestId: request.id } : {}), handle: `#${String(input.name)}`, message: `Waiting for a person to paste the value in their own app. Once saved, pass #${String(input.name)} where a handle goes. You never get the value. Call agents_next for the answer.` };
    return { result: textResult(structured, true, structured) };
  }

  async function dispatch(s: Session | null, req: Request): Promise<Response | null> {
    const id: Id = req.id ?? null;
    const isNote = req.id === undefined;
    switch (req.method) {
      case "initialize": return isNote ? null : ok(id, { protocolVersion: s?.protocol, capabilities: { tools: { listChanged: false } }, serverInfo: info, instructions: s?.caller.kind === "outside" ? OUTSIDE_INSTRUCTIONS : INSTRUCTIONS });
      case "notifications/initialized":
      case "notifications/cancelled": return null;
      case "ping": return isNote ? null : ok(id, {});
      case "tools/list":
        if (isNote) return null;
        return s ? ok(id, { tools: toolViews(s) }) : err(id, INVALID_REQUEST, "No session.");
      case "tools/call": {
        if (isNote) return null;
        if (!s) return err(id, INVALID_REQUEST, "No session.");
        try {
          const r = await callTool(s, req.params);
          return "invalid" in r ? err(id, INVALID_PARAMS, r.invalid) : ok(id, r.result);
        } catch {
          return err(id, INTERNAL_ERROR, "Something went wrong on our side.");
        }
      }
      default:
        return isNote ? null : err(id, METHOD_NOT_FOUND, `Method not found: ${req.method}`);
    }
  }

  /** The session this token belongs to, or null. An outside agent's token is read on every request: it may have expired, or its sign-in may have ended, since the last one. */
  async function sessionFor(token: string, tokenKey: string, clientName: string | undefined, origin: string | undefined): Promise<Session | null> {
    let s = byToken.get(tokenKey) ?? null;
    if (s?.caller.kind === "outside") {
      if (await deps.open(token, undefined, origin)) return s;
      byToken.delete(tokenKey);
      return null;
    }
    if (s && now() - s.checkedAt > recheckMs && deps.stillValid) {
      if (await deps.stillValid(s.caller)) s.checkedAt = now();
      else { dropSession(s); s = null; }
    }
    if (s) return s;
    const caller = await deps.open(token, clientName, origin);
    if (!caller) return null;
    // a rotated token keeps its session: the client goes on with the session id it holds
    const kept = bySession.get(caller.sessionId);
    if (kept) { byToken.delete(kept.tokenKey); kept.tokenKey = tokenKey; byToken.set(tokenKey, kept); return kept; }
    const made = newSession(caller, tokenKey, clientName);
    byToken.set(tokenKey, made);
    bySession.set(caller.sessionId, made);
    return made;
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
    // No server-initiated messages: a GET for an event stream is answered with the standard "not offered".
    if (req.method !== "POST") return empty(405, { allow: "POST, DELETE" });
    const token = bearer(req.headers["authorization"]);
    if (!token) return unauthorized(req.origin);
    if (req.body.length > maxBody) return json(413, err(null, INVALID_REQUEST, "The request is too large."));

    let parsed: unknown;
    try { parsed = JSON.parse(req.body); } catch { return json(400, err(null, PARSE_ERROR, "Parse error")); }
    const batch = Array.isArray(parsed);
    const items: unknown[] = batch ? (parsed as unknown[]) : [parsed];
    if (items.length === 0) return json(400, err(null, INVALID_REQUEST, "Empty batch"));

    const tokenKey = await sha256(token);
    const init = items.find((i): i is Request => isRequest(i) && i.method === "initialize");
    const initializing = init !== undefined;
    const named = (init?.params as { clientInfo?: { name?: unknown } } | null | undefined)?.clientInfo?.name;
    const clientName = typeof named === "string" ? named.slice(0, 120) : undefined;
    const s = await sessionFor(token, tokenKey, clientName, req.origin);
    if (!s) return unauthorized(req.origin, "invalid_token");
    const header = req.headers["mcp-session-id"];
    if (header !== undefined && header !== s.caller.sessionId && !initializing) return empty(404);

    const out: Response[] = [];
    for (const item of items) {
      if (!isRequest(item)) { out.push(err(null, INVALID_REQUEST, "Invalid request")); continue; }
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
  };
}
