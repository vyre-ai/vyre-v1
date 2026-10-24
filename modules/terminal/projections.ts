// @reads /modules/terminal/migrations/0001_init.sql
// Durable rows of the terminal module (sessions, commands, rules, attach tickets), the port to the machine a session lives on, the rule matcher and the per-session secret scrubbers.
// Every statement names a terminal_* table, which is all ctx.db lets a module touch. The migration file is the one source of the schema.
import { readFileSync } from "node:fs";
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";
import type { ErrorCode, EventName } from "../../packages/contracts/src/types.ts";
import { createScrubber, variantsOf } from "../../agent/src/vault-use/scrub.ts";
import type { Scrubber, Secret } from "../../agent/src/vault-use/scrub.ts";

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** The part of the host Ctx these handlers read. A test passes a small object; the host passes the full Ctx. */
export interface TermCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  actingFor?: string | undefined;
  run?: string | undefined;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: EventName, subject: string, payload: unknown): unknown;
  authorize(action: { perm: string | null; level: "view" | "use" | "edit" | "manage" }, resource: { type: string; id: string | null }): { effect: "allow" | "deny" | "hold" };
  vault?: { fill(handle: string, into: { kind: string; ref: string }): Promise<void> };
  log: { warn(msg: string, attrs?: Record<string, unknown>): void };
}

export function raise(ctx: Pick<TermCtx, "trace">, code: ErrorCode, message: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { message, ...(details ? { details } : {}) });
}

/** Who did it: the person an agent acts for, else the caller. */
export const actorOf = (ctx: Pick<TermCtx, "principal" | "actingFor">): string => ctx.actingFor ?? ctx.principal.id;

// ---- the machine a session lives on ----------------------------------------------------------------------------------------------------------------------

export type HostKind = "agent_computer" | "space_server" | "device";
export type TermState = "running" | "idle" | "exited";

export interface Target { host: HostKind; agentId?: string; computerId?: string; deviceId?: string }

/**
 * What the executor of a host does for a session (ARCH 6.7: local tools execute where the target lives). The agent computer's agentd, the Space server and a person's device daemon each
 * provide one; `createTmuxHost` (impl.ts) is the implementation all three share, over their own way of running `tmux`. The module never spawns a process itself.
 */
export interface TerminalHost {
  open(a: { terminalId: string; target: Target; name: string; cwd?: string; cols: number; rows: number; folders: readonly string[] }): Promise<{ cwd: string; title?: string }>;
  input(terminalId: string, data: string): Promise<void>;
  interrupt(terminalId: string): Promise<void>;
  resize(terminalId: string, cols: number, rows: number): Promise<void>;
  read(terminalId: string, o: { lines: number; since?: number }): Promise<{ text: string; next: number }>;
  /** Run to completion in the session. Rejects with `code: "timeout"` when the command does not finish in time (the host sends Ctrl-C). */
  run(terminalId: string, o: { command: string; cwd?: string; env: Readonly<Record<string, string>>; timeoutMs: number }): Promise<{ exitCode: number | null; output: string; truncated: boolean; durationMs: number }>;
  status(terminalIds: readonly string[]): Promise<Array<{ terminalId: string; state: TermState; lastLine?: string; exitCode: number | null }>>;
  /** Live frames: what the session prints, as it prints it (tmux control mode). Returns the function that stops it. */
  stream?(terminalId: string, onFrame: (text: string) => void): () => void;
  close(terminalId: string): Promise<void>;
  health(): Promise<{ ok: boolean; detail?: string; sessions: number }>;
}

let hostPort: TerminalHost | null = null;
export function bindHost(h: TerminalHost | null): void { hostPort = h; }
export const boundHost = (): TerminalHost | null => hostPort;
export function hostOf(ctx: Pick<TermCtx, "trace">): TerminalHost {
  if (!hostPort) raise(ctx, "provider.unavailable", "Terminals are not running on this host.");
  return hostPort;
}

/** Is this a Team Space? Agent computers need one (spec 2.7). The host binds the answer; unbound means team. */
let teamSpace: (space: string) => boolean = () => true;
export function bindTeam(f: ((space: string) => boolean) | null): void { teamSpace = f ?? (() => true); }
export const isTeam = (space: string): boolean => teamSpace(space);

// ---- schema -------------------------------------------------------------------------------------------------------------------------------------------------

const SCHEMA = readFileSync(new URL("./migrations/0001_init.sql", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter((s) => s.length > 0);
const ready = new WeakSet<object>();

export function ensure(db: Db): void {
  if (ready.has(db)) return;
  try { db.all("SELECT ticket_hash FROM terminal_tickets WHERE terminal_id = ?", "probe"); } catch { for (const stmt of SCHEMA) db.run(stmt); }
  ready.add(db);
}

export const mintId = (prefix: string, now: number = Date.now()): string => `${prefix}_${mintUuid(now).replaceAll("-", "")}`;
const hex = (n: number): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
export const ticketSecret = (): string => `trt_${hex(24)}`;
export async function sha256(text: string): Promise<string> {
  const d = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- rows -------------------------------------------------------------------------------------------------------------------------------------------------------

type Row = Record<string, unknown>;
const s = (v: unknown): string => String(v);
const opt = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));

export interface SessionRow {
  terminalId: string; name: string; named: boolean; host: HostKind; hostTitle: string; agentId?: string; computerId?: string; deviceId?: string; cwd: string; state: TermState;
  exitCode: number | null; cols: number; rows: number; owner: string; folderId?: string; runId?: string; createdAt: number; lastActiveAt: number; closedAt?: number;
}

export function sessionOf(r: Row): SessionRow {
  const out: SessionRow = {
    terminalId: s(r["terminal_id"]), name: s(r["name"]), named: Number(r["named"]) === 1, host: s(r["host"]) as HostKind, hostTitle: s(r["host_title"]), cwd: s(r["cwd"]), state: s(r["state"]) as TermState,
    exitCode: r["exit_code"] === null || r["exit_code"] === undefined ? null : Number(r["exit_code"]), cols: Number(r["cols"]), rows: Number(r["rows"]), owner: s(r["owner"]),
    createdAt: Number(r["created_at"]), lastActiveAt: Number(r["last_active_at"]),
  };
  const a = opt(r["agent_id"]); if (a !== undefined) out.agentId = a;
  const c = opt(r["computer_id"]); if (c !== undefined) out.computerId = c;
  const d = opt(r["device_id"]); if (d !== undefined) out.deviceId = d;
  const f = opt(r["folder_id"]); if (f !== undefined) out.folderId = f;
  const u = opt(r["run_id"]); if (u !== undefined) out.runId = u;
  if (r["closed_at"] !== null && r["closed_at"] !== undefined) out.closedAt = Number(r["closed_at"]);
  return out;
}

export function sessionBy(db: Db, terminalId: string): SessionRow | null {
  const r = (db.all("SELECT * FROM terminal_sessions WHERE terminal_id = ?", terminalId) as Row[])[0];
  return r ? sessionOf(r) : null;
}

export function insertSession(db: Db, x: SessionRow): void {
  db.run(
    `INSERT INTO terminal_sessions (terminal_id, name, named, host, host_title, agent_id, computer_id, device_id, cwd, state, exit_code, cols, rows, owner, folder_id, run_id, created_at, last_active_at, closed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    x.terminalId, x.name, x.named ? 1 : 0, x.host, x.hostTitle, x.agentId ?? null, x.computerId ?? null, x.deviceId ?? null, x.cwd, x.state, x.exitCode, x.cols, x.rows, x.owner,
    x.folderId ?? null, x.runId ?? null, x.createdAt, x.lastActiveAt,
  );
}

export const touch = (db: Db, terminalId: string, at: number): void => { db.run("UPDATE terminal_sessions SET last_active_at = ? WHERE terminal_id = ?", at, terminalId); };

export interface CommandRow { command: string; exitCode: number | null; startedAt: number; durationMs?: number }

export function commandsOf(db: Db, terminalId: string, limit = 50): CommandRow[] {
  const rows = db.all("SELECT * FROM (SELECT * FROM terminal_commands WHERE terminal_id = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq ASC", terminalId, limit) as Row[];
  return rows.map((r) => ({
    command: s(r["command"]), exitCode: r["exit_code"] === null || r["exit_code"] === undefined ? null : Number(r["exit_code"]), startedAt: Number(r["started_at"]),
    ...(r["duration_ms"] === null || r["duration_ms"] === undefined ? {} : { durationMs: Number(r["duration_ms"]) }),
  }));
}

// ---- rules ---------------------------------------------------------------------------------------------------------------------------------------------------

export interface Rules { allow: string[]; ask: string[]; deny: string[]; folders: string[] }
export const EMPTY_RULES: Readonly<Rules> = Object.freeze({ allow: [], ask: [], deny: [], folders: [] });
export const MAX_RULES = 200;
export const MAX_RULE_CHARS = 200;

export function rulesOf(db: Db, personId: string): Rules {
  const r = (db.all("SELECT * FROM terminal_rules WHERE person_id = ?", personId) as Row[])[0];
  if (!r) return { allow: [], ask: [], deny: [], folders: [] };
  const list = (v: unknown): string[] => { try { const a = JSON.parse(s(v)) as unknown; return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : []; } catch { return []; } };
  return { allow: list(r["allow"]), ask: list(r["ask"]), deny: list(r["deny"]), folders: list(r["folders"]) };
}

/** One command, or a pipeline or list of them: each simple command is judged on its own, so `ls && rm -rf /` is not allowed by an `ls` rule. */
export function segmentsOf(command: string): string[] {
  return command.split(/&&|\|\||[;|\n&]/).map((x) => x.trim()).filter((x) => x !== "");
}

function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${glob.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "s");
}

/** An entry matches a command when it is the command, a word-boundary prefix of it ("npm test" matches "npm test --watch"), or a `*` pattern that matches the whole command. */
export function entryMatches(entry: string, command: string): boolean {
  const e = entry.trim();
  const c = command.trim();
  if (e === "" || c === "") return false;
  if (e.includes("*")) return globToRegExp(e).test(c);
  return c === e || c.startsWith(`${e} `);
}

export type Verdict = { verdict: "deny" | "ask" | "allow" | "none"; entry?: string };

/** Deny wins over ask, ask over allow; a command made of several is as strict as its strictest part, and is allowed only when every part is. */
export function judge(rules: Rules, command: string): Verdict {
  const parts = segmentsOf(command);
  if (parts.length === 0) return { verdict: "none" };
  for (const p of parts) { const hit = rules.deny.find((e) => entryMatches(e, p)); if (hit !== undefined) return { verdict: "deny", entry: hit }; }
  for (const p of parts) { const hit = rules.ask.find((e) => entryMatches(e, p)); if (hit !== undefined) return { verdict: "ask", entry: hit }; }
  const allowed = parts.every((p) => rules.allow.some((e) => entryMatches(e, p)));
  return allowed ? { verdict: "allow" } : { verdict: "none" };
}

// ---- attach tickets -------------------------------------------------------------------------------------------------------------------------------------

export const TICKET_MS = 60_000;

/** The relay spends a ticket once. Returns who it was issued to and for which session, or null (unknown, spent or expired). */
export async function redeemTicket(db: Db, ticket: string, now: number): Promise<{ terminalId: string; personId: string } | null> {
  ensure(db);
  const hash = await sha256(ticket);
  const r = (db.all("SELECT * FROM terminal_tickets WHERE ticket_hash = ?", hash) as Row[])[0];
  if (!r || r["used_at"] !== null && r["used_at"] !== undefined || Number(r["expires_at"]) <= now) return null;
  const spent = db.run("UPDATE terminal_tickets SET used_at = ? WHERE ticket_hash = ? AND used_at IS NULL", now, hash);
  return spent.changes === 1 ? { terminalId: s(r["terminal_id"]), personId: s(r["person_id"]) } : null;
}

// ---- secrets used in a session ----------------------------------------------------------------------------------------------------------------------

/**
 * Values the host filled into a session (terminal.run with #Handle.field). Kept in memory only, per session, so everything that reads the screen back (read, attach replay, live frames,
 * status) goes through the same scrubber. A restart forgets them, which is why the screen is also cleared of them at the end of the run.
 */
const secretsByTerminal = new Map<string, Secret[]>();

export function rememberSecrets(terminalId: string, secrets: readonly Secret[]): void {
  if (secrets.length === 0) return;
  const cur = secretsByTerminal.get(terminalId) ?? [];
  for (const x of secrets) if (!cur.some((c) => c.handle === x.handle && c.value === x.value)) cur.push(x);
  secretsByTerminal.set(terminalId, cur);
}
export function scrubberFor(terminalId: string): Scrubber | null {
  const list = secretsByTerminal.get(terminalId);
  return list && list.length > 0 ? createScrubber(list) : null;
}
/** Every spelling of every value used in the session (the value, base64, hex, url-encoded ...): what a live frame must not show, even split across two frames. */
export function spellingsFor(terminalId: string): string[] {
  const out = new Set<string>();
  for (const x of secretsByTerminal.get(terminalId) ?? []) for (const v of variantsOf(x.value)) out.add(v);
  return [...out];
}
export const forgetSecrets = (terminalId: string): void => { secretsByTerminal.delete(terminalId); };

/** Text from a screen, with every value used in the session removed. */
export function clean(terminalId: string, text: string): string {
  const sc = scrubberFor(terminalId);
  return sc ? sc.scrub(text) : text;
}

// ---- values for #Handle.field in a command ------------------------------------------------------------------------------------------------------------

import type { ValueSource } from "../../agent/src/vault-use/run.ts";

/** Where a value comes from, in the process that runs the command (the host's Vault service, or the device's filler). Unbound: handles stay literal text and nothing is filled. */
let valueSource: ValueSource | null = null;
export function bindValues(v: ValueSource | null): void { valueSource = v; }
export const boundValues = (): ValueSource | null => valueSource;
