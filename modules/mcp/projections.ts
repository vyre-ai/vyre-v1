// @reads /modules/mcp/migrations/0001_init.sql
// @reads /modules/mcp/migrations/0002_oauth.sql
// Durable rows of the mcp module (sessions), the ports the host binds at boot, and the generated tool catalog the handlers read. Sign-in lives in oauth.ts.
// Every statement names an mcp_* table, which is all ctx.db lets a module touch. The migration file is the one source of the schema.
import { readFileSync } from "node:fs";
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";
import type { ErrorCode, EventName } from "../../packages/contracts/src/types.ts";
import { OUTSIDE_PROVIDER } from "../../kernel/src/authorize/index.ts";
import { buildCatalog, offerable, parseDefaultTools } from "../../agent/src/tools/catalog.ts";
import { DEFERRED_CAPS } from "../../host/src/routes/deferred.ts";
import type { AgentToolRow, Catalog, McpToolRow, RegistryCapRow } from "../../agent/src/tools/types.ts";
import type { McpCaller, McpServer } from "../../agent/src/mcp/types.ts";

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** The part of the host Ctx these handlers read. A test passes a small object; the host passes the full Ctx. */
export interface McpCtx {
  depth?: number;
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

let server: McpServer | null = null;
/** The live server on this host, so closing a session also ends it there. */
export function bindServer(s: McpServer | null): void { server = s; }
export const boundServer = (): McpServer | null => server;

// ---- schema -----------------------------------------------------------------------------------------------------------------------------------------

const schemaOf = (file: string): string[] => readFileSync(new URL(`./migrations/${file}`, import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter((s) => s.length > 0);
const SCHEMA = [...schemaOf("0001_init.sql"), ...schemaOf("0002_oauth.sql")];
const ready = new WeakSet<object>();

/** Make sure the mcp tables exist. One cheap probe per handle; the IF NOT EXISTS statements run only when it fails. */
export function ensure(db: Db): void {
  if (ready.has(db)) return;
  try { db.all("SELECT session_id FROM mcp_oauth_grants WHERE grant_id = ?", "probe"); } catch { for (const stmt of SCHEMA) db.run(stmt); }
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

export const DEFAULT_SESSION_TTL_SEC = 6 * 3600;

// ---- rows -------------------------------------------------------------------------------------------------------------------------------------------

type Row = Record<string, unknown>;
const str = (v: unknown): string => String(v);
const optStr = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));
const num = (v: unknown): number => Number(v);

export interface SessionRow {
  sessionId: string; kind: "outside" | "driver"; tokenHash?: string; principal: string; actingFor?: string; threadId?: string; runId?: string; traceId?: string;
  name?: string; startedAt: number; expiresAt?: number; lastCallAt?: number; calls: number; closedAt?: number;
}
export function sessionOf(r: Row): SessionRow {
  const out: SessionRow = { sessionId: str(r["session_id"]), kind: str(r["kind"]) as SessionRow["kind"], principal: str(r["principal"]), startedAt: num(r["started_at"]), calls: num(r["calls"]) };
  const set = <K extends keyof SessionRow>(k: K, v: SessionRow[K] | undefined): void => { if (v !== undefined) out[k] = v; };
  set("tokenHash", optStr(r["token_hash"])); set("actingFor", optStr(r["acting_for"])); set("threadId", optStr(r["thread_id"]));
  set("runId", optStr(r["run_id"])); set("traceId", optStr(r["trace_id"])); set("name", optStr(r["name"]));
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
    `INSERT INTO mcp_sessions (session_id, kind, token_hash, principal, acting_for, thread_id, run_id, trace_id, name, started_at, expires_at, last_call_at, calls, closed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL)`,
    s.sessionId, s.kind, s.tokenHash ?? null, s.principal, s.actingFor ?? null, s.threadId ?? null, s.runId ?? null, s.traceId ?? null, s.name ?? null, s.startedAt, s.expiresAt ?? null,
  );
}

export function touchSession(db: Db, sessionId: string, at: number): void {
  db.run("UPDATE mcp_sessions SET calls = calls + 1, last_call_at = ? WHERE session_id = ?", at, sessionId);
}

/** Live: not closed and not past its end. An outside session has no end of its own: its access token is checked on every request. */
export function isLive(_db: Db, s: SessionRow, now: number): boolean {
  if (s.closedAt !== undefined) return false;
  return s.expiresAt === undefined || s.expiresAt > now;
}

export function countLive(db: Db, now: number): number {
  const rows = db.all("SELECT * FROM mcp_sessions WHERE closed_at IS NULL AND (expires_at IS NULL OR expires_at > ?)", now) as Row[];
  return rows.map(sessionOf).filter((s) => isLive(db, s, now)).length;
}

// ---- who is calling ---------------------------------------------------------------------------------------------------------------------------------

/** The session token of a CLI engine: finds the one minted for it. An outside agent's access token is read in oauth.ts. */
export async function driverForToken(db: Db, space: string, token: string, now: number): Promise<{ caller: McpCaller } | { refused: "unknown" | "expired" | "revoked" }> {
  ensure(db);
  const own = sessionBy(db, "token_hash", await sha256(token));
  if (!own) return { refused: "unknown" };
  if (own.closedAt !== undefined) return { refused: "revoked" };
  if (own.expiresAt !== undefined && own.expiresAt <= now) return { refused: "expired" };
  return { caller: driverCaller(space, own) };
}

export function outsideCaller(space: string, s: SessionRow, resource: string): McpCaller {
  return {
    kind: "outside", sessionId: s.sessionId, space, principal: { kind: "agent", id: s.principal }, ...(s.actingFor === undefined ? {} : { actingFor: s.actingFor }),
    provider: OUTSIDE_PROVIDER, resource, ...(s.name === undefined ? {} : { name: s.name }),
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

export interface Generated { catalog: Catalog; defaults: Set<string> }
let generated: Generated | null = null;

const read = (rel: string): string => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

/** The tool list the generator wrote, joined with the registry, and the frozen default listed set. Read once. */
export function loadGenerated(): Generated {
  if (generated) return generated;
  const reg = JSON.parse(read("generated/registry.json")) as { capabilities: RegistryCapRow[]; agentTools: AgentToolRow[] };
  const tools = (JSON.parse(read("generated/mcp-tools.json")) as { tools: McpToolRow[] }).tools;
  generated = {
    catalog: offerable(buildCatalog(reg.capabilities, tools, reg.agentTools), (cap) => DEFERRED_CAPS.has(cap)),
    defaults: parseDefaultTools(read("docs/frozen/agent-tools.md")),
  };
  return generated;
}

let hashed: string | null = null;
/** The hash of generated/registry.json, computed here (the file holds no hash since the per-manifest snapshots) and kept. */
export async function registryHash(): Promise<string> {
  hashed ??= await sha256(read("generated/registry.json"));
  return hashed;
}
