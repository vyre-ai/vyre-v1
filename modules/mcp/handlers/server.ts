// mcp: one-time tokens for outside agents, the registered credential, scopes, sessions (outside actors and CLI engines) and the tool list the MCP server serves (spec 2.2, 4.12; ARCH 6.6, 6.7).
//   mcp.token.issue / register / log_reveal   a one-time token, valid once and for 10 minutes, traded by the outside tool for a long-lived credential shown once; reveal and copy are logged
//   mcp.scopes.set                            read, post in threads, read changesets, write on a branch (with approval)
//   mcp.session.open / mint / close / list    the session of an outside actor or a CLI engine; `mint` encodes principal, acting-for person, thread, run and trace
//   mcp.tools.list / tool.search / tool.describe / toolsets.list / health   the generated tool list as this caller may see it
// Nothing stored is a secret: tokens are kept as SHA-256 and shown once. Access (who the actor is, revoking it) belongs to the access module: it creates the actor principal when it sees
// token.registered, and calls revokeActor (projections.ts) when it emits token.revoked. Every call the server makes still goes through the invoke pipeline as the actor acting for the person.
import { searchTools, toolsFor } from "../../../agent/src/tools/access.ts";
import type { AccessDeps } from "../../../agent/src/tools/access.ts";
import type { ToolCtx, ToolDef } from "../../../agent/src/tools/types.ts";
import { scopeAllows } from "../../../agent/src/mcp/scopes.ts";
import { DEFAULT_SCOPES } from "../../../agent/src/mcp/types.ts";
import type { Scopes } from "../../../agent/src/mcp/types.ts";
import {
  DEFAULT_SESSION_TTL_SEC, ONE_TIME_MS, actorOf, boundServer, callerForToken, countLive, endpointOf, ensure, insertSession, isLive, loadGenerated, mintId, parseScopes, raise, revokeActor,
  scopesJson, secret, sessionBy, sessionOf, sha256, tokenBy,
} from "../projections.ts";
import type { McpCtx, SessionRow } from "../projections.ts";

type Row = Record<string, unknown>;
const TOOLSETS = ["records", "files", "memory", "vault", "automations", "chats", "inbox", "sites", "terminal", "computer", "agents", "tasks", "meta", "engineer"] as const;
type Toolset = (typeof TOOLSETS)[number];
const KINDS = new Set(["claude_code", "codex", "other"]);

const holdsEngineer = (ctx: McpCtx): boolean => ctx.authorize({ perm: "engineer.mcp", level: "use" }, { type: "space", id: ctx.space }).effect === "allow";

function sessionOut(s: SessionRow) {
  return {
    sessionId: s.sessionId, kind: s.kind, principal: s.principal,
    ...(s.actingFor === undefined ? {} : { actingFor: s.actingFor }), ...(s.threadId === undefined ? {} : { threadId: s.threadId }), ...(s.runId === undefined ? {} : { runId: s.runId }),
    ...(s.name === undefined ? {} : { name: s.name }), ...(s.scopes === undefined ? {} : { scopes: s.scopes }),
    startedAt: s.startedAt, ...(s.lastCallAt === undefined ? {} : { lastCallAt: s.lastCallAt }), calls: s.calls,
  };
}

// ---- tokens -----------------------------------------------------------------------------------------------------------------------------------------

export async function tokenIssue(ctx: McpCtx, input: { name: string; kind: "claude_code" | "codex" | "other"; channelId?: string; scopes?: Scopes; idempotencyKey?: string }) {
  ensure(ctx.db);
  const name = input.name.trim();
  if (name === "") raise(ctx, "validation.bad_input", "Give the connection a name.");
  if (!KINDS.has(input.kind)) raise(ctx, "validation.bad_input", "That kind of tool is not one Vyre connects to.");
  const scopes: Scopes = input.scopes ? parseScopes(JSON.stringify(input.scopes)) : { ...DEFAULT_SCOPES };
  const now = ctx.now();
  const tokenId = mintId("tok", now);
  const oneTime = secret("otk");
  const expiresAt = now + ONE_TIME_MS;
  const by = actorOf(ctx);
  ctx.db.run(
    `INSERT INTO mcp_tokens (token_id, token_hash, name, kind, channel_id, scopes, issued_by, issued_at, expires_at, state, reveals) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', 0)`,
    tokenId, await sha256(oneTime), name.slice(0, 120), input.kind, input.channelId ?? null, scopesJson(scopes), by, now, expiresAt,
  );
  ctx.emit("token.issued", tokenId, { tokenId, name: name.slice(0, 120), kind: input.kind, ...(input.channelId === undefined ? {} : { channelId: input.channelId }), by, expiresAt });
  return { tokenId, oneTimeToken: oneTime, expiresAt, mcpUrl: endpointOf().url };
}

export async function tokenRegister(ctx: McpCtx, input: { oneTimeToken: string; clientName: string; clientVersion?: string }) {
  ensure(ctx.db);
  const row = tokenBy(ctx.db, "token_hash", await sha256(input.oneTimeToken));
  // Wrong, used and revoked look the same from outside: the tool learns nothing about which tokens exist.
  if (!row || row.state !== "issued") raise(ctx, "auth.invalid_code", "That token is wrong or has already been used.");
  const now = ctx.now();
  if (row.expiresAt <= now) raise(ctx, "auth.expired", "That token has expired. Make a new one in Vyre.");
  const actorId = mintId("act", now);
  const credential = secret("vyr");
  // The single UPDATE both claims the token and records the credential: a second register with the same token matches no row.
  const claimed = ctx.db.run(
    "UPDATE mcp_tokens SET state = 'registered', actor_id = ?, cred_hash = ?, registered_at = ?, client_name = ?, client_version = ? WHERE token_id = ? AND state = 'issued'",
    actorId, await sha256(credential), now, input.clientName.slice(0, 120), input.clientVersion?.slice(0, 60) ?? null, row.tokenId,
  );
  if (claimed.changes !== 1) raise(ctx, "auth.invalid_code", "That token is wrong or has already been used.");
  ctx.emit("token.registered", actorId, { tokenId: row.tokenId, actorId, name: row.name, scopes: row.scopes });
  return { actorId, token: credential, mcpUrl: endpointOf().url, scopes: row.scopes };
}

export async function tokenLogReveal(ctx: McpCtx, input: { tokenId: string; action: "reveal" | "copy" }) {
  ensure(ctx.db);
  const row = tokenBy(ctx.db, "token_id", input.tokenId);
  if (!row) raise(ctx, "validation.bad_input", "There is no such token.");
  const by = actorOf(ctx);
  if (row.issuedBy !== by && ctx.authorize({ perm: "channels.agents", level: "manage" }, { type: "space", id: ctx.space }).effect !== "allow") {
    raise(ctx, "permission.no_grant", "Only the person who made the token can log that it was shown.");
  }
  ctx.db.run("UPDATE mcp_tokens SET reveals = reveals + 1 WHERE token_id = ?", row.tokenId);
  ctx.emit("token.revealed", row.tokenId, { tokenId: row.tokenId, action: input.action, by });
  return { ok: true };
}

export function scopesSet(ctx: McpCtx, input: { actorId: string; scopes: Scopes }) {
  ensure(ctx.db);
  const row = tokenBy(ctx.db, "actor_id", input.actorId);
  if (!row) raise(ctx, "validation.bad_input", "There is no such outside actor.");
  if (row.state === "revoked") raise(ctx, "permission.no_grant", "That connection was revoked.");
  const scopes = parseScopes(JSON.stringify(input.scopes));
  ctx.db.run("UPDATE mcp_tokens SET scopes = ? WHERE actor_id = ?", scopesJson(scopes), input.actorId);
  // Sessions already open pick the new scopes up on their next call: the server rechecks, and a new session reads the token row.
  ctx.db.run("UPDATE mcp_sessions SET scopes = ? WHERE principal = ? AND closed_at IS NULL", scopesJson(scopes), input.actorId);
  ctx.emit("mcp.scopes_changed", input.actorId, { actorId: input.actorId, by: actorOf(ctx) });
  return { scopes };
}

// ---- sessions ---------------------------------------------------------------------------------------------------------------------------------------

function toolsetsOf(scopes: Scopes | undefined, engineer: boolean): Toolset[] {
  const { catalog } = loadGenerated();
  const seen = new Set<string>();
  for (const t of catalog.all) {
    if (t.toolset === "engineer" && !engineer) continue;
    if (scopes && !scopeAllows(scopes, t)) continue;
    seen.add(t.toolset);
  }
  return TOOLSETS.filter((s) => seen.has(s));
}

export async function sessionOpen(ctx: McpCtx, input: { token: string; clientName?: string }) {
  ensure(ctx.db);
  const now = ctx.now();
  const r = await callerForToken(ctx.db, ctx.space, input.token, now, input.clientName);
  if ("refused" in r) {
    if (r.refused === "expired") raise(ctx, "auth.expired", "That session has expired.");
    if (r.refused === "revoked") raise(ctx, "permission.revoked", "That connection was revoked.");
    raise(ctx, "auth.unauthenticated", "That token is not one Vyre knows.");
  }
  const c = r.caller;
  if (r.fresh) ctx.emit("mcp.session_started", c.sessionId, { sessionId: c.sessionId, kind: "outside", principal: c.principal.id, ...(c.actingFor === undefined ? {} : { actingFor: c.actingFor }) });
  return {
    sessionId: c.sessionId, principal: c.principal.id, ...(c.actingFor === undefined ? {} : { actingFor: c.actingFor }),
    scopes: c.scopes ?? { ...DEFAULT_SCOPES }, toolsets: toolsetsOf(c.kind === "outside" ? c.scopes : undefined, c.engineer === true),
  };
}

export async function sessionMint(ctx: McpCtx, input: { principal: string; actingFor: string; threadId: string; runId?: string; traceId: string; ttlSec?: number }) {
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

export function health(ctx: McpCtx, _input: Record<string, never>) {
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
    latencyMs, sessions, registryHash: g.registryHash,
  };
}

export { isLive, revokeActor };
