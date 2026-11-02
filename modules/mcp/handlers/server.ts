// mcp: sessions (outside agents and CLI engines) and the tool list the MCP server serves (spec 2.2, 4.12; ARCH 6.6, 6.7). Sign-in for outside agents is in oauth.ts and handlers/oauth.ts.
//   mcp.session.mint / close / list    the session of an outside agent or a CLI engine; `mint` encodes principal, acting-for person, thread, run and trace
//   mcp.tools.list / tool.search / tool.describe / toolsets.list / health   the generated tool list as this caller may see it
// Nothing stored is a secret. Every call the server makes goes through the invoke pipeline as the agent acting for the person.
import { isSystemCall } from "../../../lib/trust.ts";
import { searchTools, toolsFor } from "../../../agent/src/tools/access.ts";
import type { AccessDeps } from "../../../agent/src/tools/access.ts";
import type { ToolCtx, ToolDef } from "../../../agent/src/tools/types.ts";
import {
  DEFAULT_SESSION_TTL_SEC, actorOf, boundServer, countLive, endpointOf, ensure, insertSession, isLive, loadGenerated, mintId, registryHash, raise, secret, sessionBy, sessionOf, sha256,
} from "../projections.ts";
import type { McpCtx, SessionRow } from "../projections.ts";

type Row = Record<string, unknown>;
const TOOLSETS = ["records", "files", "memory", "vault", "automations", "chats", "inbox", "sites", "terminal", "computer", "agents", "tasks", "meta", "engineer"] as const;
type Toolset = (typeof TOOLSETS)[number];

const holdsEngineer = (ctx: McpCtx): boolean => ctx.authorize({ perm: "engineer.mcp", level: "use" }, { type: "space", id: ctx.space }).effect === "allow";

function sessionOut(s: SessionRow) {
  return {
    sessionId: s.sessionId, kind: s.kind, principal: s.principal,
    ...(s.actingFor === undefined ? {} : { actingFor: s.actingFor }), ...(s.threadId === undefined ? {} : { threadId: s.threadId }), ...(s.runId === undefined ? {} : { runId: s.runId }),
    ...(s.name === undefined ? {} : { name: s.name }),
    startedAt: s.startedAt, ...(s.lastCallAt === undefined ? {} : { lastCallAt: s.lastCallAt }), calls: s.calls,
    ...(s.closedAt===undefined?{}:{closedAt:s.closedAt}),...(s.expiresAt===undefined?{}:{expiresAt:s.expiresAt}),
  };
}

// ---- sessions ---------------------------------------------------------------------------------------------------------------------------------------

export async function sessionMint(ctx: McpCtx, input: { principal: string; actingFor: string; threadId: string; runId?: string; traceId: string; ttlSec?: number }) {
  // a session token acts as the principal it names, for the person it names: minting one is the host's act (the engine seam drives a CLI engine through it). A member who could name any principal here would be that principal.
  if (!isSystemCall(ctx)) raise(ctx, "permission.no_grant", "Only the server can mint a session for an engine.");
  ensure(ctx.db);
  const now = ctx.now();
  const ttl = Math.min(86_400, Math.max(60, input.ttlSec ?? DEFAULT_SESSION_TTL_SEC));
  const token = secret("vys");
  const s: SessionRow = {
    sessionId: mintId("ses", now), kind: "driver", tokenHash: await sha256(token), principal: input.principal, actingFor: input.actingFor, threadId: input.threadId,
    ...(input.runId === undefined ? {} : { runId: input.runId }), traceId: input.traceId, startedAt: now, expiresAt: now + ttl * 1000, calls: 0,
  };
  insertSession(ctx.db, s);
  ctx.emit("mcp.session_started", s.sessionId, { sessionId: s.sessionId, kind: "driver", principal: s.principal, actingFor: input.actingFor, threadId: input.threadId });
  return { sessionId: s.sessionId, sessionToken: token, url: endpointOf().loopbackUrl, expiresAt: s.expiresAt as number };
}

export function sessionClose(ctx: McpCtx, input: { sessionId: string }) {
  ensure(ctx.db);
  const s = sessionBy(ctx.db, "session_id", input.sessionId);
  if (!s) raise(ctx, "validation.bad_input", "There is no such session.");
  if (s.closedAt === undefined) {
    ctx.db.run("UPDATE mcp_sessions SET closed_at = ? WHERE session_id = ? AND closed_at IS NULL", ctx.now(), s.sessionId);
    ctx.emit("mcp.session_ended", s.sessionId, { sessionId: s.sessionId, calls: s.calls });
  }
  boundServer()?.end(s.sessionId);
  return { closed: true };
}

export function sessionsList(ctx: McpCtx, input: { kind?: "outside" | "driver"; cursor?: string; limit?: number }) {
  ensure(ctx.db);
  const limit = Math.min(200, Math.max(1, input.limit ?? 50));
  const offset = input.cursor !== undefined && /^\d+$/.test(input.cursor) ? Number(input.cursor) : 0;
  const where = input.kind ? "WHERE kind = ?" : "";
  const args = input.kind ? [input.kind] : [];
  const total = Number((ctx.db.all(`SELECT COUNT(*) AS n FROM mcp_sessions ${where}`, ...args) as Row[])[0]?.["n"] ?? 0);
  const rows = ctx.db.all(`SELECT * FROM mcp_sessions ${where} ORDER BY started_at DESC, session_id DESC LIMIT ? OFFSET ?`, ...args, limit, offset) as Row[];
  const sessions = rows.map((r) => sessionOut(sessionOf(r)));
  const next = offset + sessions.length < total ? String(offset + sessions.length) : undefined;
  return { sessions, total, ...(next === undefined ? {} : { next }) };
}

// ---- tools ------------------------------------------------------------------------------------------------------------------------------------------

function accessFor(ctx: McpCtx): { deps: AccessDeps; tool: ToolCtx } {
  const g = loadGenerated();
  const engineer = holdsEngineer(ctx);
  const asker = actorOf(ctx);
  return {
    deps: { catalog: g.catalog, defaults: g.defaults, levelFor: () => null, canEngineer: () => engineer },
    tool: { space: ctx.space, agentId: ctx.principal.id, asker, thread: { threadId: ctx.thread ?? "direct", kind: "chat", planMode: false } },
  };
}

function info(t: ToolDef, defaults: ReadonlySet<string>, withInput: boolean) {
  return { name: t.name, summary: t.summary, toolset: t.toolset as Toolset, deferred: !defaults.has(t.name), ...(withInput ? { input: t.inputSchema } : {}) };
}

export function toolsList(ctx: McpCtx, input: { toolset?: Toolset; includeDeferred?: boolean }) {
  const g = loadGenerated();
  const { deps, tool } = accessFor(ctx);
  const set = toolsFor(deps, tool);
  const pool = input.includeDeferred === true ? [...set.listed, ...set.searchable] : set.listed;
  const rows = pool.filter((t) => input.toolset === undefined || t.toolset === input.toolset);
  return { tools: rows.map((t) => info(t, g.defaults, false)), total: rows.length };
}

export function toolSearch(ctx: McpCtx, input: { query: string; toolset?: Toolset; limit?: number }) {
  const g = loadGenerated();
  const { deps, tool } = accessFor(ctx);
  const set = toolsFor(deps, tool);
  const pool = input.toolset === undefined ? set.searchable : set.searchable.filter((t) => t.toolset === input.toolset);
  return { tools: searchTools(pool, input.query, Math.min(50, Math.max(1, input.limit ?? 8))).map((t) => info(t, g.defaults, true)) };
}

export function toolDescribe(ctx: McpCtx, input: { names: string[] }) {
  const g = loadGenerated();
  const { deps, tool } = accessFor(ctx);
  const set = toolsFor(deps, tool);
  const offered = new Map([...set.listed, ...set.searchable].map((t) => [t.name, t] as const));
  const tools = input.names.flatMap((n) => { const t = offered.get(n); return t ? [info(t, g.defaults, true)] : []; });
  return { tools };
}

export function toolsetsList(ctx: McpCtx, _input: Record<string, never>) {
  const g = loadGenerated();
  const engineer = holdsEngineer(ctx);
  return {
    toolsets: TOOLSETS.map((toolset) => {
      const all = g.catalog.all.filter((t) => t.toolset === toolset);
      return { toolset, tools: all.length, listed: all.filter((t) => g.defaults.has(t.name)).length, allowed: toolset !== "engineer" || engineer };
    }),
  };
}

export async function health(ctx: McpCtx, _input: Record<string, never>) {
  const t0 = Date.now();
  ensure(ctx.db);
  const g = loadGenerated();
  const sessions = countLive(ctx.db, ctx.now());
  const server = boundServer();
  const latencyMs = Date.now() - t0;
  // No server bound means this host does not serve MCP (a device with the daemon only): degraded, not down, because the capability list still answers.
  return {
    state: server ? ("healthy" as const) : ("degraded" as const),
    ...(server ? {} : { detail: "The MCP endpoint is not running on this host." }),
    latencyMs, sessions, registryHash: await registryHash(),
  };
}

export { isLive };
