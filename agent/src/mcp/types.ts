// The MCP server for outside actors (Claude Code, Codex) and for CLI engine sessions (ARCH 6.6, 6.7; spec 2.2, 4.12, "native"). One server, two kinds of caller; only the token differs.
// Everything the server needs from outside is a port here, so the same code runs against the real invoke pipeline and against fakes in tests.
import type { Invoke } from "../../../host/src/invoke.ts";
import type { AgentRules, Catalog } from "../tools/types.ts";

/** What an outside actor may do: read, post in threads, read changesets, write on a branch (off by default; writes there need approval at the Gate). */
export interface Scopes { read: boolean; post: boolean; readChangesets: boolean; writeBranch: boolean }
export const DEFAULT_SCOPES: Readonly<Scopes> = Object.freeze({ read: true, post: true, readChangesets: true, writeBranch: false });

export interface McpCaller {
  /** 'outside': a registered tool on someone's computer. 'driver': the loopback session of a CLI engine the host runs. */
  kind: "outside" | "driver";
  sessionId: string;
  space: string;
  /** Who the calls are made as: the outside actor, or the agent whose CLI engine this is. */
  principal: { kind: "actor" | "agent"; id: string };
  /** The person the calls are made for. Every call is the intersection of the principal's access and this person's (kernel authorize, rule 5). */
  actingFor?: string;
  threadId?: string;
  runId?: string;
  traceId?: string;
  /** Outside actors only. A driver session has the agent's own rules instead. */
  scopes?: Scopes;
  /** The actor holds engineer.mcp (set by an admin): the engineer toolset is listed. */
  engineer?: boolean;
  name?: string;
  /** The agent's allow and deny lists (driver sessions). */
  rules?: AgentRules;
  /** AI provider of the engine behind this session, for label-vs-provider checks inside authorize. */
  provider?: string;
  planMode?: boolean;
}

export interface McpServerDeps {
  /** The generated tool list joined with the registry (tools/catalog.ts). */
  catalog: Catalog;
  /** The frozen default listed set (about 60 names). Every other tool is found with tool_search. */
  defaults: ReadonlySet<string>;
  /** The invoke pipeline. Authorization, the Gate and the audit all happen there. */
  invoke: Invoke;
  /** Token to caller. Null when the token is unknown, expired, revoked or closed. Called once per token while its session lives. */
  open(token: string, clientName?: string): Promise<McpCaller | null>;
  /** Is the caller still allowed in? Asked at most every `recheckMs`; a revoked token or a closed session ends here, before the next call. */
  stillValid?(caller: McpCaller): Promise<boolean>;
  /** A tool call finished. For the Console's call counts. */
  onCall?(caller: McpCaller, tool: string, outcome: "ok" | "error" | "held"): void;
  onClose?(caller: McpCaller): void;
  now?(): number;
  info?: { name: string; version: string };
  /** Origins a browser may send. Loopback origins are always allowed; a request with any other Origin is refused (DNS-rebinding guard). */
  allowedOrigins?: readonly string[];
  recheckMs?: number;
  maxBodyBytes?: number;
}

export interface McpHttpRequest {
  method: string;
  /** Header names lower case. */
  headers: Readonly<Record<string, string | undefined>>;
  body: string;
}
export interface McpHttpResponse { status: number; headers: Record<string, string>; body: string }

export interface McpServer {
  handle(req: McpHttpRequest): Promise<McpHttpResponse>;
  /** Live sessions. */
  sessions(): number;
  /** End a session (mcp.session.close, a revoked token). */
  end(sessionId: string): boolean;
}
