// The MCP server for outside agents (Claude Code, Cursor and any MCP client) and for CLI engine sessions (ARCH 6.6, 6.7; spec 2.2, 4.12, "native"). One server, two kinds of caller; only the token differs.
// Everything the server needs from outside is a port here, so the same code runs against the real invoke pipeline and against fakes in tests.
import type { Invoke } from "../../../host/src/invoke.ts";
import type { AgentRules, Catalog, Level, ThreadFacts } from "../tools/types.ts";
import type { ModePair } from "../tools/local.ts";
import type { WorkCard } from "../tools/work-cards.ts";

export interface McpCaller {
  /** 'outside': an agent that signed in from outside Vyre. 'driver': the loopback session of a CLI engine the host runs. */
  kind: "outside" | "driver";
  sessionId: string;
  space: string;
  /** Who the calls are made as: always an agent of the Space. */
  principal: { kind: "agent"; id: string };
  /** The person the calls are made for. Every call is the intersection of the principal's access and this person's (kernel authorize, rule 5). */
  actingFor?: string;
  threadId?: string;
  runId?: string;
  traceId?: string;
  /** The address this agent's token is bound to. */
  resource?: string;
  name?: string;
  /** The agent's allow and deny lists (driver sessions). */
  rules?: AgentRules;
  /** AI provider of the engine behind this session, for label-vs-provider checks inside authorize. */
  provider?: string;
  planMode?: boolean;
  /** Driver sessions: the owner's floor on local tools, read when the session opens. */
  localFloor?: ModePair;
  /** Deferred tools to list from the first turn. A CLI engine lists its tools once when it starts, so a tool found later with tool_search is not callable there; a chat that is known to need some lists them up front. */
  preload?: readonly string[];
  /** The chat's mode when this session opened (a mode change opens a new engine session, so a new token). Plan also sets planMode. */
  mode?: "ask" | "auto" | "plan";
  /** What the chat is, read when the session opened, so a tool here is the same tool on every driver: its kind, what it is about, and in an Ask the person's level on that (null when they hold none). */
  threadKind?: ThreadFacts["kind"];
  scope?: { type: string; id: string };
  askLevel?: Level | null;
}

export interface McpServerDeps {
  /** The generated tool list joined with the registry (tools/catalog.ts). */
  catalog: Catalog;
  /** The frozen default listed set (about 60 names). Every other tool is found with tool_search. */
  defaults: ReadonlySet<string>;
  /** The invoke pipeline. Authorization, the Gate and the audit all happen there. */
  invoke: Invoke;
  /** Token to caller. Null when the token is unknown, expired, revoked, closed or for another address. An outside agent's token is read again on every request; a CLI engine's once while its session lives. */
  open(token: string, clientName?: string, origin?: string): Promise<McpCaller | null>;
  /** Is the caller still allowed in? Asked at most every `recheckMs`; a revoked token or a closed session ends here, before the next call. */
  stillValid?(caller: McpCaller): Promise<boolean>;
  /** A tool call finished: the Console's call counts, and for an outside agent its activity and its steps in the chat it is working in. */
  onCall?(caller: McpCaller, tool: string, outcome: "ok" | "error" | "held", detail?: CallDetail): void;
  /** An outside agent took a job in this chat: what the chat is, so its tools there follow the chat's mode. */
  bindThread?(caller: McpCaller, threadId: string): Promise<Partial<Pick<McpCaller, "mode" | "planMode" | "threadKind" | "scope">>>;
  onClose?(caller: McpCaller): void;
  /** Does this outside agent act for its person including setup (owner ruling 3 Nov)? Read on every call, so taking it back counts at the next one. */
  setupGrant?(caller: McpCaller): boolean;
  now?(): number;
  info?: { name: string; version: string };
  /** A 401 for an outside client: what its WWW-Authenticate says, naming where to sign in. */
  challenge?(origin: string | undefined, error?: "invalid_token"): string;
  /** Origins a browser may send. Loopback origins are always allowed; a request with any other Origin is refused (DNS-rebinding guard). */
  allowedOrigins?: readonly string[];
  recheckMs?: number;
  maxBodyBytes?: number;
}

export interface CallDetail { cap: string; threadId?: string; taskId?: string; card?: WorkCard | null }

export interface McpHttpRequest {
  method: string;
  /** Header names lower case. */
  headers: Readonly<Record<string, string | undefined>>;
  body: string;
  /** The address this request reached, as this host trusts it (never the Host header alone). A token bound to another address is refused. */
  origin?: string;
}
export interface McpHttpResponse { status: number; headers: Record<string, string>; body: string }

export interface McpServer {
  handle(req: McpHttpRequest): Promise<McpHttpResponse>;
  /** Live sessions. */
  sessions(): number;
  /** End a session (mcp.session.close, a revoked token). */
  end(sessionId: string): boolean;
}
