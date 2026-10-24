// @reads /modules/mcp/migrations/0001_init.sql
// Durable rows of the mcp module (tokens and sessions), the ports the host binds at boot, and the generated tool catalog the handlers read.
// Every statement names an mcp_* table, which is all ctx.db lets a module touch. The migration file is the one source of the schema.
import { readFileSync } from "node:fs";
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";
import type { ErrorCode, EventName } from "../../packages/contracts/src/types.ts";
import { buildCatalog, parseDefaultTools } from "../../agent/src/tools/catalog.ts";
import type { AgentToolRow, Catalog, McpToolRow, RegistryCapRow } from "../../agent/src/tools/types.ts";
import { DEFAULT_SCOPES } from "../../agent/src/mcp/types.ts";
import type { McpCaller, McpServer, Scopes } from "../../agent/src/mcp/types.ts";

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** The part of the host Ctx these handlers read. A test passes a small object; the host passes the full Ctx. */
export interface McpCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  actingFor?: string | undefined;
  thread?: string | undefined;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: EventName, subject: string, payload: unknown): unknown;
  authorize(action: { perm: string | null; level: "view" | "use" | "edit" | "manage" }, resource: { type: string; id: string | null }): { effect: "allow" | "deny" | "hold" };
  log: { warn(msg: string, attrs?: Record<string, unknown>): void };
}

export function raise(ctx: Pick<McpCtx, "trace">, code: ErrorCode, message: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { message, ...(details ? { details } : {}) });
}

/** Who did it: the person an agent acts for, else the caller. */
export const actorOf = (ctx: Pick<McpCtx, "principal" | "actingFor">): string => ctx.actingFor ?? ctx.principal.id;

// ---- endpoint and server, bound at boot --------------------------------------------------------------------------------------------------------------

export interface Endpoint {
  /** Where outside tools connect: the Space's public address plus /mcp. */
  url: string;
  /** Where a CLI engine on this host connects: loopback. */
  loopbackUrl: string;
}
const DEFAULT_ENDPOINT: Endpoint = { url: "http://127.0.0.1:41800/mcp", loopbackUrl: "http://127.0.0.1:41800/mcp" };
let endpoint: Endpoint = DEFAULT_ENDPOINT;
export function bindEndpoint(e: Endpoint | null): void { endpoint = e ?? DEFAULT_ENDPOINT; }
export const endpointOf = (): Endpoint => endpoint;

/** Does this outside actor hold engineer.mcp? Access owns the answer (the actor's roles and its Engineer MCP switch), so the host binds it; unbound fails closed. */
export type EngineerCheck = (actorId: string) => boolean;
let engineerCheck: EngineerCheck = () => false;
export function bindEngineerCheck(f: EngineerCheck | null): void { engineerCheck = f ?? (() => false); }
export const actorHoldsEngineer = (actorId: string): boolean => engineerCheck(actorId);

let server: McpServer | null = null;
/** The live server on this host, so closing a session also ends it there. */
export function bindServer(s: McpServer | null): void { server = s; }
export const boundServer = (): McpServer | null => server;

// ---- schema -----------------------------------------------------------------------------------------------------------------------------------------

const SCHEMA = readFileSync(new URL("./migrations/0001_init.sql", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter((s) => s.length > 0);
const ready = new WeakSet<object>();

/** Make sure the mcp tables exist. One cheap probe per handle; the IF NOT EXISTS statements run only when it fails. */
export function ensure(db: Db): void {
  if (ready.has(db)) return;
  try { db.all("SELECT reveals FROM mcp_tokens WHERE token_id = ?", "probe"); } catch { for (const stmt of SCHEMA) db.run(stmt); }
  ready.add(db);
}

// ---- ids and secrets ----------------------------------------------------------------------------------------------------------------------------------

/** Contract ids are `<prefix>_<lowercase alphanumerics>`. */
export const mintId = (prefix: string, now: number = Date.now()): string => `${prefix}_${mintUuid(now).replaceAll("-", "")}`;

const bytesHex = (n: number): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
/** A token nobody can guess: 192 random bits behind a readable prefix. */
export const secret = (prefix: string): string => `${prefix}_${bytesHex(24)}`;

export async function sha256(text: string): Promise<string> {
  const d = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const ONE_TIME_MS = 10 * 60_000;
export const DEFAULT_SESSION_TTL_SEC = 6 * 3600;

// ---- rows -------------------------------------------------------------------------------------------------------------------------------------------

type Row = Record<string, unknown>;
const str = (v: unknown): string => String(v);
const optStr = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));
const num = (v: unknown): number => Number(v);

export function parseScopes(raw: unknown): Scopes {
  try {
    const o = JSON.parse(str(raw)) as Partial<Scopes>;
    return { read: o.read === true, post: o.post === true, readChangesets: o.readChangesets === true, writeBranch: o.writeBranch === true };
  } catch { return { ...DEFAULT_SCOPES }; }
}
export const scopesJson = (s: Scopes): string => JSON.stringify({ read: s.read, post: s.post, readChangesets: s.readChangesets, writeBranch: s.writeBranch });

export interface TokenRow {
  tokenId: string; tokenHash: string; name: string; kind: string; channelId?: string; scopes: Scopes; issuedBy: string; issuedAt: number; expiresAt: number;
  state: "issued" | "registered" | "revoked"; actorId?: string; credHash?: string; registeredAt?: number; reveals: number;
}
function tokenOf(r: Row): TokenRow {
  const out: TokenRow = {
    tokenId: str(r["token_id"]), tokenHash: str(r["token_hash"]), name: str(r["name"]), kind: str(r["kind"]), scopes: parseScopes(r["scopes"]), issuedBy: str(r["issued_by"]),
    issuedAt: num(r["issued_at"]), expiresAt: num(r["expires_at"]), state: str(r["state"]) as TokenRow["state"], reveals: num(r["reveals"]),
  };
  const c = optStr(r["channel_id"]); if (c !== undefined) out.channelId = c;
  const a = optStr(r["actor_id"]); if (a !== undefined) out.actorId = a;
  const h = optStr(r["cred_hash"]); if (h !== undefined) out.credHash = h;
  if (r["registered_at"] !== null && r["registered_at"] !== undefined) out.registeredAt = num(r["registered_at"]);
  return out;
}

export function tokenBy(db: Db, column: "token_id" | "token_hash" | "actor_id" | "cred_hash", value: string): TokenRow | null {
  const r = (db.all(`SELECT * FROM mcp_tokens WHERE ${column} = ?`, value) as Row[])[0];
  return r ? tokenOf(r) : null;
}

export interface SessionRow {
  sessionId: string; kind: "outside" | "driver"; tokenHash?: string; tokenId?: string; principal: string; actingFor?: string; threadId?: string; runId?: string; traceId?: string;
  name?: string; scopes?: Scopes; startedAt: number; expiresAt?: number; lastCallAt?: number; calls: number; closedAt?: number;
}
export function sessionOf(r: Row): SessionRow {
  const out: SessionRow = { sessionId: str(r["session_id"]), kind: str(r["kind"]) as SessionRow["kind"], principal: str(r["principal"]), startedAt: num(r["started_at"]), calls: num(r["calls"]) };
  const set = <K extends keyof SessionRow>(k: K, v: SessionRow[K] | undefined): void => { if (v !== undefined) out[k] = v; };
  set("tokenHash", optStr(r["token_hash"])); set("tokenId", optStr(r["token_id"])); set("actingFor", optStr(r["acting_for"])); set("threadId", optStr(r["thread_id"]));
  set("runId", optStr(r["run_id"])); set("traceId", optStr(r["trace_id"])); set("name", optStr(r["name"]));
  if (r["scopes"] !== null && r["scopes"] !== undefined) out.scopes = parseScopes(r["scopes"]);
  if (r["expires_at"] !== null && r["expires_at"] !== undefined) out.expiresAt = num(r["expires_at"]);
  if (r["last_call_at"] !== null && r["last_call_at"] !== undefined) out.lastCallAt = num(r["last_call_at"]);
  if (r["closed_at"] !== null && r["closed_at"] !== undefined) out.closedAt = num(r["closed_at"]);
  return out;
}

export function sessionBy(db: Db, column: "session_id" | "token_hash", value: string): SessionRow | null {
  const r = (db.all(`SELECT * FROM mcp_sessions WHERE ${column} = ?`, value) as Row[])[0];
  return r ? sessionOf(r) : null;
}

export function insertSession(db: Db, s: SessionRow): void {
  db.run(
    `INSERT INTO mcp_sessions (session_id, kind, token_hash, token_id, principal, acting_for, thread_id, run_id, trace_id, name, scopes, started_at, expires_at, last_call_at, calls, closed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL)`,
    s.sessionId, s.kind, s.tokenHash ?? null, s.tokenId ?? null, s.principal, s.actingFor ?? null, s.threadId ?? null, s.runId ?? null, s.traceId ?? null, s.name ?? null,
    s.scopes ? scopesJson(s.scopes) : null, s.startedAt, s.expiresAt ?? null,
  );
}

export function touchSession(db: Db, sessionId: string, at: number): void {
  db.run("UPDATE mcp_sessions SET calls = calls + 1, last_call_at = ? WHERE session_id = ?", at, sessionId);
}

/** Live: not closed, not past its end, and for an outside session its token not revoked. */
export function isLive(db: Db, s: SessionRow, now: number): boolean {
  if (s.closedAt !== undefined) return false;
  if (s.expiresAt !== undefined && s.expiresAt <= now) return false;
  if (s.tokenId !== undefined) {
    const t = tokenBy(db, "token_id", s.tokenId);
    if (!t || t.state === "revoked") return false;
  }
  return true;
}

export function countLive(db: Db, now: number): number {
  const rows = db.all("SELECT * FROM mcp_sessions WHERE closed_at IS NULL AND (expires_at IS NULL OR expires_at > ?)", now) as Row[];
  return rows.map(sessionOf).filter((s) => isLive(db, s, now)).length;
}

/** The actor was revoked in access (token.revoked): its credential stops working and its sessions end. Returns the sessions it ended. */
export function revokeActor(db: Db, actorId: string, now: number): string[] {
  ensure(db);
  db.run("UPDATE mcp_tokens SET state = 'revoked' WHERE actor_id = ?", actorId);
  const open = (db.all("SELECT session_id FROM mcp_sessions WHERE principal = ? AND closed_at IS NULL", actorId) as Row[]).map((r) => str(r["session_id"]));
  db.run("UPDATE mcp_sessions SET closed_at = ? WHERE principal = ? AND closed_at IS NULL", now, actorId);
  for (const id of open) server?.end(id);
  return open;
}

// ---- who is calling ---------------------------------------------------------------------------------------------------------------------------------

/** Token to caller, or null. The credential of an outside actor opens a fresh session; the session token of a CLI engine finds the one minted for it. */
export async function callerForToken(db: Db, space: string, token: string, now: number, name?: string): Promise<{ caller: McpCaller; fresh: boolean } | { refused: "unknown" | "expired" | "revoked" }> {
  ensure(db);
  const hash = await sha256(token);
  const own = sessionBy(db, "token_hash", hash);
  if (own) {
    if (own.closedAt !== undefined) return { refused: "revoked" };
    if (own.expiresAt !== undefined && own.expiresAt <= now) return { refused: "expired" };
    return { caller: driverCaller(space, own), fresh: false };
  }
  const t = tokenBy(db, "cred_hash", hash);
  if (!t) return { refused: "unknown" };
  if (t.state === "revoked") return { refused: "revoked" };
  if (t.actorId === undefined) return { refused: "unknown" };
  const s: SessionRow = {
    sessionId: mintId("ses", now), kind: "outside", tokenId: t.tokenId, principal: t.actorId, actingFor: t.issuedBy, name: (name ?? t.name).slice(0, 120), scopes: t.scopes, startedAt: now, calls: 0,
  };
  insertSession(db, s);
  return { caller: outsideCaller(space, s), fresh: true };
}

export function outsideCaller(space: string, s: SessionRow): McpCaller {
  return {
    kind: "outside", sessionId: s.sessionId, space, principal: { kind: "actor", id: s.principal }, ...(s.actingFor === undefined ? {} : { actingFor: s.actingFor }),
    scopes: s.scopes ?? { ...DEFAULT_SCOPES }, ...(s.name === undefined ? {} : { name: s.name }), ...(actorHoldsEngineer(s.principal) ? { engineer: true } : {}),
  };
}

export function driverCaller(space: string, s: SessionRow): McpCaller {
  return {
    kind: "driver", sessionId: s.sessionId, space, principal: { kind: "agent", id: s.principal }, ...(s.actingFor === undefined ? {} : { actingFor: s.actingFor }),
    ...(s.threadId === undefined ? {} : { threadId: s.threadId }), ...(s.runId === undefined ? {} : { runId: s.runId }), ...(s.traceId === undefined ? {} : { traceId: s.traceId }),
    ...(s.name === undefined ? {} : { name: s.name }),
  };
}

// ---- the generated catalog ----------------------------------------------------------------------------------------------------------------------------

export interface Generated { catalog: Catalog; defaults: Set<string>; registryHash: string }
let generated: Generated | null = null;

const read = (rel: string): string => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

/** The tool list the generator wrote, joined with the registry, and the frozen default listed set. Read once. */
export function loadGenerated(): Generated {
  if (generated) return generated;
  const reg = JSON.parse(read("generated/registry.json")) as { capabilities: RegistryCapRow[]; agentTools: AgentToolRow[] };
  const tools = (JSON.parse(read("generated/mcp-tools.json")) as { tools: McpToolRow[] }).tools;
  generated = {
    catalog: buildCatalog(reg.capabilities, tools, reg.agentTools),
    defaults: parseDefaultTools(read("docs/frozen/agent-tools.md")),
    registryHash: read("generated/hash.txt").trim(),
  };
  return generated;
}
