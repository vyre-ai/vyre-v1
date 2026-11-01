// mcp module entry (lane L2). The host loads the generated stubs while host/modules.json says `status: 'stub'` and this file once it says `live` (ruling 25).
// Also here: the runtime that puts the MCP server (agent/src/mcp) on this module's tables. The host mounts `runtime.handle` at the Space's /mcp address and on loopback for CLI engines.
import { CONNECTOR_CHAT, CONNECTOR_TOOLS, CREW_TOOLS, CRM_CHAT, CRM_TOOLS } from "../../lib/connector-chat.ts";
import { createMcpServer } from "../../agent/src/mcp/server.ts";
import type { McpCaller, McpServer, McpServerDeps } from "../../agent/src/mcp/types.ts";
import type { Invoke } from "../../host/src/invoke.ts";
import { handlers as table } from "./handlers/index.ts";
import type { Handler } from "../../host/src/invoke.ts";
import { bindEndpoint, bindEngineerCheck, bindServer, callerForToken, ensure, isLive, loadGenerated, sessionBy, touchSession } from "./projections.ts";
import type { Db, Endpoint, EngineerCheck } from "./projections.ts";

export const handlers: Record<string, Handler> = table as unknown as Record<string, Handler>;

export interface RuntimeOptions {
  db: Db;
  space: string;
  invoke: Invoke;
  now?: () => number;
  endpoint?: Endpoint;
  /** Does an outside actor hold engineer.mcp? Access answers; unset means no. */
  engineerCheck?: EngineerCheck;
  /** A session started on the wire (an outside actor connected). The host may emit mcp.session_started from here. */
  onStarted?: (caller: McpCaller) => void;
  info?: McpServerDeps["info"];
  allowedOrigins?: McpServerDeps["allowedOrigins"];
}

/**
 * A CLI engine's session works for one chat. The chat's mode (Ask first, Auto, Plan) decides what its tools may do, so it is read when the session opens: the engine opens a new session, with a new token, whenever
 * the mode changes (the pool key holds it). A chat that cannot be read leaves the caller as it was; the Gate and access checks still stand.
 */
export async function withChatMode(o: RuntimeOptions, caller: McpCaller): Promise<McpCaller> {
  if (caller.kind !== "driver" || caller.threadId === undefined) return caller;
  try {
    const seed = { space: o.space, principal: caller.principal, ...(caller.actingFor ? { actingFor: caller.actingFor } : {}), origin: "mcp" as const };
    const r = await o.invoke("threads.get", { threadId: caller.threadId }, seed);
    const thread = r.status === "ok" ? (r.output as { thread?: { mode?: unknown; title?: unknown; kind?: unknown; scopeType?: unknown; scopeId?: unknown } } | null)?.thread : undefined;
    const mode = thread?.mode;
    // the same facts the API tools read for a turn (modules/engine/api-tools.ts), so an Ask or a task thread is the same on every driver
    const facts: Partial<McpCaller> = typeof thread?.kind !== "string" ? {} : { threadKind: thread.kind as McpCaller["threadKind"], ...(typeof thread.scopeType === "string" && typeof thread.scopeId === "string" ? { scope: { type: thread.scopeType, id: thread.scopeId } } : {}) };
    if (thread?.kind === "ask" && facts.scope) {
      const l = await o.invoke("chat.ask_level", { threadId: caller.threadId }, seed).catch(() => null);
      facts.askLevel = l?.status === "ok" ? ((l.output as { level?: McpCaller["askLevel"] } | null)?.level ?? null) : null;
    }
    // a chat that builds a connector lists the builder's tools from the start: the CLI cannot pick up a tool found later with tool_search
    const preload = typeof thread?.title === "string" && CONNECTOR_CHAT.test(thread.title) ? { preload: CONNECTOR_TOOLS } : typeof thread?.title === "string" && CRM_CHAT.test(thread.title) ? { preload: CRM_TOOLS } : thread?.kind === "chat" ? { preload: CREW_TOOLS } : {};
    if (mode === "ask" || mode === "auto" || mode === "plan") return { ...caller, ...facts, mode, planMode: mode === "plan", ...preload };
    if ("preload" in preload || facts.threadKind !== undefined) return { ...caller, ...facts, ...preload };
  } catch { /* the chat is not readable here: no mode is applied */ }
  return caller;
}

/** The MCP server on this host's tables. Binds itself so mcp.session.close also ends the live session. */
export function createMcpRuntime(o: RuntimeOptions): McpServer {
  const now = o.now ?? Date.now;
  ensure(o.db);
  if (o.endpoint) bindEndpoint(o.endpoint);
  if (o.engineerCheck) bindEngineerCheck(o.engineerCheck);
  const g = loadGenerated();
  const server = createMcpServer({
    catalog: g.catalog,
    defaults: g.defaults,
    invoke: o.invoke,
    now,
    ...(o.info ? { info: o.info } : {}),
    ...(o.allowedOrigins ? { allowedOrigins: o.allowedOrigins } : {}),
    async open(token, clientName) {
      const r = await callerForToken(o.db, o.space, token, now(), clientName);
      if ("refused" in r) return null;
      if (r.fresh) o.onStarted?.(r.caller);
      return withChatMode(o, r.caller);
    },
    async stillValid(caller) {
      const s = sessionBy(o.db, "session_id", caller.sessionId);
      return s !== null && isLive(o.db, s, now());
    },
    onCall(caller) { touchSession(o.db, caller.sessionId, now()); },
    onClose(caller) { o.db.run("UPDATE mcp_sessions SET closed_at = ? WHERE session_id = ? AND closed_at IS NULL", now(), caller.sessionId); },
  });
  bindServer(server);
  return server;
}

export { bindEndpoint, bindEngineerCheck, bindServer };
export { revokeActor } from "./projections.ts";
