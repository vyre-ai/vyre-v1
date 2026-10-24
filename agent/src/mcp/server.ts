// The MCP endpoint (Streamable HTTP, request/response form): one POST per JSON-RPC message or batch.
//   auth        Authorization: Bearer <token>; the token is an outside actor's credential or the session token of a CLI engine (types.ts open)
//   tools/list  the default listed set the caller may use, plus the deferred tools it found with tool_search in this session
//   tools/call  one capability invoke, as the principal acting for the person; scopes narrow an outside actor first, then the same ToolSession the API drivers use refuses
//               what was never offered, and the invoke pipeline intersects access, applies the Gate and writes the audit row
// Nothing here decides access. A tool being listed grants nothing.
import { createToolSession } from "../tools/call.ts";
import type { ToolSession } from "../tools/call.ts";
import type { ToolCtx, ToolDef } from "../tools/types.ts";
import type { Invoke } from "../../../host/src/invoke.ts";
import { makeError } from "../../../host/src/routes/errors.ts";
import { INTERNAL_ERROR, INVALID_PARAMS, INVALID_REQUEST, METHOD_NOT_FOUND, PARSE_ERROR, err, isRequest, ok } from "./jsonrpc.ts";
import type { Id, Request, Response } from "./jsonrpc.ts";
import { scopeAllows } from "./scopes.ts";
import { DEFAULT_SCOPES } from "./types.ts";
import type { McpCaller, McpHttpRequest, McpHttpResponse, McpServer, McpServerDeps, Scopes } from "./types.ts";

export const PROTOCOL_VERSIONS: readonly string[] = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const MAX_RESULT_CHARS = 512 * 1024;
const MAX_BODY = 1024 * 1024;
const RECHECK_MS = 30_000;
const SEARCH_LIMIT = 8;

const INSTRUCTIONS =
  "Vyre tools. The list shows the common ones. Call tool_search with what you want to do to find the rest; the tools it returns can then be called. " +
  "Every call runs as you acting for the person who connected you, with the access you both have and no more. Some actions wait for a person to approve them.";

interface Session {
  caller: McpCaller;
  tools: ToolSession;
  ctx: ToolCtx;
  tokenKey: string;
  scopes: Scopes | null;
  checkedAt: number;
  protocol: string;
  clientName: string | undefined;
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
    const scopes = caller.kind === "outside" ? (caller.scopes ?? DEFAULT_SCOPES) : null;
    // The pipeline sees the real principal (an outside actor is an 'actor', not an 'agent') and the real origin.
    const invoke: Invoke = (cap, input, seed) => deps.invoke(cap, input, { ...seed, principal: caller.principal, origin: "mcp", space: caller.space });
    const tools = createToolSession({
      catalog: deps.catalog, defaults: deps.defaults, invoke,
      levelFor: () => null,
      canEngineer: () => caller.engineer === true,
    });
    const threadId = caller.threadId ?? caller.sessionId;
    const ctx: ToolCtx = {
      space: caller.space, agentId: caller.principal.id, asker,
      thread: { threadId, kind: "chat", planMode: caller.planMode === true },
      ...(caller.rules ? { rules: caller.rules } : {}),
      ...(caller.provider ? { provider: caller.provider } : {}),
      ...(caller.runId ? { runId: caller.runId } : {}),
      ...(caller.traceId ? { trace: { traceId: caller.traceId, spanId: hex(8) } } : {}),
    };
    return { caller, tools, ctx, tokenKey, scopes, checkedAt: now(), protocol: PROTOCOL_VERSIONS[0] ?? "2025-06-18", clientName };
  }

  const dropSession = (s: Session): void => {
    byToken.delete(s.tokenKey);
    bySession.delete(s.caller.sessionId);
    deps.onClose?.(s.caller);
  };

  const allowed = (s: Session, t: ToolDef): boolean => s.scopes === null || scopeAllows(s.scopes, t);

  function listTools(s: Session): ToolDef[] {
    const set = s.tools.toolsFor(s.ctx);
    const loaded = s.tools.loaded(s.ctx.thread.threadId);
    const out = [...set.listed, ...set.searchable.filter((t) => loaded.has(t.name))];
    return out.filter((t) => allowed(s, t));
  }

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
    const t = deps.catalog.byName(p.name);
    if (!t) return { invalid: `Unknown tool: ${p.name}` };
    const traceId = s.ctx.trace?.traceId ?? hex(16);

    if (!allowed(s, t)) {
      const error = makeError("permission.role_lacks_permission", traceId, { message: "This connection is not allowed to use that tool.", details: { tool: t.name, reason: "scope" } });
      deps.onCall?.(s.caller, t.name, "error");
      return { result: textResult({ error }, true, { error }) };
    }

    if (t.name === "tool_search") {
      const q = args["query"];
      if (typeof q !== "string" || q.trim() === "") {
        const error = makeError("validation.bad_input", traceId, { details: { errors: ["/query: required"], tool: t.name } });
        return { result: textResult({ error }, true, { error }) };
      }
      const found = s.tools.search(s.ctx, q).filter((f) => allowed(s, f)).slice(0, SEARCH_LIMIT);
      const data = { tools: found.map((f) => ({ name: f.name, summary: f.summary, toolset: f.toolset, inputSchema: f.inputSchema })) };
      deps.onCall?.(s.caller, t.name, "ok");
      return { result: textResult({ data }, false, { data }) };
    }

    const out = await s.tools.call(s.ctx, t.name, args);
    if (out.kind === "result") {
      deps.onCall?.(s.caller, t.name, "ok");
      const c = out.result.content as { data?: unknown; blocks?: string[] };
      return { result: textResult(c, false, c) };
    }
    if (out.kind === "held") {
      deps.onCall?.(s.caller, t.name, "held");
      const structured = { held: true, taskId: out.taskId, ...(out.runId === undefined ? {} : { runId: out.runId }), message: "Waiting for a person to approve this." };
      return { result: textResult(structured, true, structured) };
    }
    deps.onCall?.(s.caller, t.name, "error");
    return { result: textResult({ error: out.error }, true, { error: out.error }) };
  }

  async function dispatch(s: Session | null, req: Request): Promise<Response | null> {
    const id: Id = req.id ?? null;
    const isNote = req.id === undefined;
    switch (req.method) {
      case "initialize": return isNote ? null : ok(id, { protocolVersion: s?.protocol, capabilities: { tools: { listChanged: false } }, serverInfo: info, instructions: INSTRUCTIONS });
      case "notifications/initialized":
      case "notifications/cancelled": return null;
      case "ping": return isNote ? null : ok(id, {});
      case "tools/list":
        if (isNote) return null;
        return s ? ok(id, { tools: listTools(s).map(toolView) }) : err(id, INVALID_REQUEST, "No session.");
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

  async function handle(req: McpHttpRequest): Promise<McpHttpResponse> {
    if (!originOk(req.headers["origin"])) return json(403, { error: "origin not allowed" });
    if (req.method === "DELETE") {
      const token = bearer(req.headers["authorization"]);
      if (!token) return empty(401, { "www-authenticate": "Bearer" });
      const s = byToken.get(await sha256(token));
      if (!s) return empty(404);
      dropSession(s);
      return empty(204);
    }
    // No server-initiated messages: a GET for an event stream is answered with the standard "not offered".
    if (req.method !== "POST") return empty(405, { allow: "POST, DELETE" });
    const token = bearer(req.headers["authorization"]);
    if (!token) return empty(401, { "www-authenticate": "Bearer" });
    if (req.body.length > maxBody) return json(413, err(null, INVALID_REQUEST, "The request is too large."));

    let parsed: unknown;
    try { parsed = JSON.parse(req.body); } catch { return json(400, err(null, PARSE_ERROR, "Parse error")); }
    const batch = Array.isArray(parsed);
    const items: unknown[] = batch ? (parsed as unknown[]) : [parsed];
    if (items.length === 0) return json(400, err(null, INVALID_REQUEST, "Empty batch"));

    const tokenKey = await sha256(token);
    let s = byToken.get(tokenKey) ?? null;
    if (s && now() - s.checkedAt > recheckMs && deps.stillValid) {
      if (await deps.stillValid(s.caller)) s.checkedAt = now();
      else { dropSession(s); s = null; }
    }
    const init = items.find((i): i is Request => isRequest(i) && i.method === "initialize");
    const initializing = init !== undefined;
    const named = (init?.params as { clientInfo?: { name?: unknown } } | null | undefined)?.clientInfo?.name;
    const clientName = typeof named === "string" ? named.slice(0, 120) : undefined;
    if (!s) {
      const caller = await deps.open(token, clientName);
      if (!caller) return empty(401, { "www-authenticate": 'Bearer error="invalid_token"' });
      s = newSession(caller, tokenKey, clientName);
      byToken.set(tokenKey, s);
      bySession.set(caller.sessionId, s);
    }
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
