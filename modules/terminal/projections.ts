// @reads /modules/terminal/migrations/0001_init.sql
// Durable rows of the terminal module (sessions, commands, rules, attach tickets), the port to the machine a session lives on, the rule matcher and the per-session secret scrubbers.
// Every statement names a terminal_* table, which is all ctx.db lets a module touch. The migration file is the one source of the schema.
import { readFileSync } from "node:fs";
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";
import { createScrubber, MIN_SECRET_LENGTH, runWithVault, variantsOf } from "../../lib/vault-use/index.ts";
import type { ErrorCode, EventName } from "../../packages/contracts/src/types.ts";

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
  /** The chat the call came from (an agent's tool call names it). */
  thread?: string | undefined;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: EventName, subject: string, payload: unknown): unknown;
  /** Another module's capability, as the caller (the chat card of terminal.request). */
  call?(cap: string, input: unknown): Promise<unknown>;
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

// Two ways a host gets here: the daemon hands over this machine's own (setTerminalHost in impl.ts), and a test binds a stand-in. A stand-in bound in the process wins, so a test that boots a daemon
// still runs against its own machine.
let hostPort: TerminalHost | null = null;
let machinePort: TerminalHost | null = null;
export function bindHost(h: TerminalHost | null): void { hostPort = h; }
export function bindMachineHost(h: TerminalHost | null): void { machinePort = h; }
export const boundHost = (): TerminalHost | null => hostPort ?? machinePort;
export function hostOf(ctx: Pick<TermCtx, "trace">): TerminalHost {
  const h = boundHost();
  if (!h) raise(ctx, "provider.unavailable", "Terminals are not running on this host.");
  return h;
}

// ---- where an agent's command runs ---------------------------------------------------------------------------------------------------------------------

/**
 * Where a person's turn runs, for an agent's terminal_run that names no terminal and no host (owner, 31 Oct: a chat runs on this computer or on a server of the Space). The daemon reads it as the person:
 * engine.placement.decide, whether the agent has a computer, and which of the person's computers this Space can open a terminal on. Null when it cannot be read.
 */
export interface TurnPlace {
  team: boolean;
  /** The agent has a computer of its own in this Space. */
  agentComputer: boolean;
  /** The person's computer, the agent's own computer, one of the person's added servers, or the Space server. */
  runsOn: "device" | "agent_computer" | "server" | "space";
  /** The person's computer the turn runs on, when this Space can open a terminal on it. */
  deviceId?: string;
}
export type PlaceOf = (a: { space: string; threadId?: string; agentId: string; person: string }) => Promise<TurnPlace | null>;

let placePort: PlaceOf | null = null;
let machinePlace: PlaceOf | null = null;
export function bindPlace(f: PlaceOf | null): void { placePort = f; }
export function bindMachinePlace(f: PlaceOf | null): void { machinePlace = f; }
export const boundPlace = (): PlaceOf | null => placePort ?? machinePlace;

/**
 * Whether this host has agent workspaces (a container runtime and the workspace image path): an agent's terminal then goes to its workspace, from wherever its turn runs (owner, 6 Nov). The daemon
 * binds it when it hands over a workspace config (setTerminalHost); a test binds it directly. Unbound: no workspaces, and an agent's commands go where the turn runs, as before.
 */
let workspacesProbe: ((agentId: string) => Promise<boolean>) | null = null;
export function bindWorkspaces(on: boolean | ((agentId: string) => Promise<boolean>)): void { workspacesProbe = typeof on === "function" ? on : on ? () => Promise.resolve(true) : null; }
/** Are workspaces configured on this host at all (a machine may still be missing for one agent: workspacesFor says). */
export const workspacesReady = (): boolean => workspacesProbe !== null;
/** Is there a machine this agent's workspace can live on now: the Space's own runtime, or a server that joined. When not, its commands go where its turn runs, as before. */
export async function workspacesFor(agentId: string): Promise<boolean> { try { return workspacesProbe !== null && (await workspacesProbe(agentId)); } catch { return false; } }

/** What an agent's workspace is doing now (the fleet's status), for the Terminal tab; null when this host has none. */
export type WorkspaceStatusOf = (agentId: string) => Promise<{ state: "running" | "asleep" | "waiting" | "none"; line?: string; host?: "space" | "server"; nodeId?: string; projects?: string[] }>;
let statusPort: WorkspaceStatusOf | null = null;
export function bindWorkspaceStatus(f: WorkspaceStatusOf | null): void { statusPort = f; }
export const boundWorkspaceStatus = (): WorkspaceStatusOf | null => statusPort;

/** Is this a Team Space? Agent computers need one (spec 2.7). The host binds the answer; unbound means team. */
let teamSpace: (space: string) => boolean = () => true;
export function bindTeam(f: ((space: string) => boolean) | null): void { teamSpace = f ?? (() => true); }
export const isTeam = (space: string): boolean => teamSpace(space);

// ---- schema -------------------------------------------------------------------------------------------------------------------------------------------------

const SCHEMA = readFileSync(new URL("./migrations/0001_init.sql", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter((s) => s.length > 0);
const TABS_SCHEMA = readFileSync(new URL("./migrations/0002_tabs.sql", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .split(";").map((x) => x.trim()).filter((x) => x.length > 0);
const ready = new WeakSet<object>();

export function ensure(db: Db): void {
  if (ready.has(db)) return;
  try { db.all("SELECT ticket_hash FROM terminal_tickets WHERE terminal_id = ?", "probe"); } catch { for (const stmt of SCHEMA) db.run(stmt); }
  // a Space made before tabs has the first schema only
  try { db.all("SELECT terminal_id FROM terminal_tabs WHERE terminal_id = ?", "probe"); } catch { for (const stmt of TABS_SCHEMA) db.run(stmt); }
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

/** Whose tab a session is: the agent itself, a helper it started (by name), or a person who opened it. */
export interface TabBy { kind: "agent" | "helper" | "person"; name?: string }

export interface SessionRow {
  by?: TabBy; actor?: string;
  terminalId: string; name: string; named: boolean; host: HostKind; hostTitle: string; agentId?: string; computerId?: string; deviceId?: string; cwd: string; state: TermState;
  exitCode: number | null; cols: number; rows: number; owner: string; folderId?: string; runId?: string; createdAt: number; lastActiveAt: number; closedAt?: number;
}

export function sessionOf(r: Row): SessionRow {
  const out: SessionRow = {
    terminalId: s(r["terminal_id"]), name: s(r["name"]), named: Number(r["named"]) === 1, host: s(r["host"]) as HostKind, hostTitle: s(r["host_title"]), cwd: s(r["cwd"]), state: s(r["state"]) as TermState,
    exitCode: r["exit_code"] === null || r["exit_code"] === undefined ? null : Number(r["exit_code"]), cols: Number(r["cols"]), rows: Number(r["rows"]), owner: s(r["owner"]),
    createdAt: Number(r["created_at"]), lastActiveAt: Number(r["last_active_at"]),
  };
  const tk = opt(r["tab_kind"]);
  if (tk === "agent" || tk === "helper" || tk === "person") { const tn = opt(r["tab_name"]); out.by = { kind: tk, ...(tn === undefined ? {} : { name: tn }) }; }
  const ta = opt(r["tab_actor"]); if (ta !== undefined) out.actor = ta;
  const a = opt(r["agent_id"]); if (a !== undefined) out.agentId = a;
  const c = opt(r["computer_id"]); if (c !== undefined) out.computerId = c;
  const d = opt(r["device_id"]); if (d !== undefined) out.deviceId = d;
  const f = opt(r["folder_id"]); if (f !== undefined) out.folderId = f;
  const u = opt(r["run_id"]); if (u !== undefined) out.runId = u;
  if (r["closed_at"] !== null && r["closed_at"] !== undefined) out.closedAt = Number(r["closed_at"]);
  return out;
}

export function sessionBy(db: Db, terminalId: string): SessionRow | null {
  const r = (db.all(`${SESSION_SELECT} WHERE s.terminal_id = ?`, terminalId) as Row[])[0];
  return r ? sessionOf(r) : null;
}

/** A session with its tab: who made it. */
export const SESSION_SELECT = "SELECT s.*, t.kind AS tab_kind, t.name AS tab_name, t.actor AS tab_actor FROM terminal_sessions s LEFT JOIN terminal_tabs t ON t.terminal_id = s.terminal_id";

export function insertTab(db: Db, terminalId: string, by: TabBy, actor: string, threadId?: string): void {
  db.run("INSERT OR REPLACE INTO terminal_tabs (terminal_id, kind, name, actor, thread_id) VALUES (?, ?, ?, ?, ?)", terminalId, by.kind, by.name ?? null, actor, threadId ?? null);
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

// ---- Vault values in a command -------------------------------------------------------------------------------------------------------------------------

// The fill-and-scrub machinery is lib/vault-use (ARCH 6.11), the same code the engine uses. The real one is bound from the start, so a daemon that wires nothing still scrubs; a test may bind a stand-in.
// With no value source bound nothing is ever filled, a #Handle stays literal text, and there is nothing to scrub.
export interface Secret { handle: string; itemId: string; value: string }
export type Where = "host" | "device" | "computer";
export type Lookup =
  | { kind: "value"; itemId: string; value: string; spaceOnly: boolean; injectIntoDeployments: boolean }
  | { kind: "unknown" }
  | { kind: "denied"; reason: "no_access" | "provider_label" | "other" };
export interface ValueSource { lookup(handle: string, who: { agentId: string; asker: string; where: Where }): Promise<Lookup> }
export interface VaultRunDeps { source: ValueSource; reportMiss(r: { itemId: string; place: "terminal" | "http" | "browser" | "file" | "chat"; traceId: string }): void | Promise<void> }
export interface VaultCall { tool: string; args: unknown; traceId: string; agentId: string; asker: string; where: Where }
export type VaultRun =
  | { ok: true; display: unknown; output: string | AsyncIterable<string>; used: Array<{ handle: string; itemId: string }>; scrubMiss: boolean }
  | { ok: false; display: unknown; used: Array<{ handle: string; itemId: string }>; error: { code: "permission.no_grant" | "permission.provider_label" | "validation.bad_input" | "provider.unavailable"; message: string; handle?: string } };
export interface ScrubberLike { scrub(text: string): string }
export interface VaultKit {
  run(deps: VaultRunDeps, call: VaultCall, exec: (args: unknown) => Promise<string | AsyncIterable<string>>): Promise<VaultRun>;
  createScrubber(secrets: readonly Secret[]): ScrubberLike;
  /** Every spelling of a value that must not show (the value, base64, hex, url-encoded ...). */
  spellings(value: string): string[];
}

/** The real kit: lib/vault-use. */
export const REAL_KIT: VaultKit = { run: runWithVault as VaultKit["run"], createScrubber, spellings: variantsOf };
let vaultKit: VaultKit = REAL_KIT;
/** A stand-in for tests; null puts the real one back. */
export function bindKit(k: VaultKit | null): void { vaultKit = k ?? REAL_KIT; }
export const boundKit = (): VaultKit => vaultKit;

/** Where a value comes from, in the process that runs the command (the host's Vault service, or the device's filler). */
// Two ways it gets here, as with the host: the daemon hands over the Space's Vault (setTerminalHost), and a test binds a stand-in, which wins.
let valueSource: ValueSource | null = null;
let machineValues: ValueSource | null = null;
export function bindValues(v: ValueSource | null): void { valueSource = v; }
export function bindMachineValues(v: ValueSource | null): void { machineValues = v; }
export const boundValues = (): ValueSource | null => valueSource ?? machineValues;

// ---- secrets used in a session or a workspace ----------------------------------------------------------------------------------------------------------

/**
 * Values the host filled into commands (terminal.run with #Handle.field), kept in memory only, so everything that reads a screen back (run output, read, attach replay, live frames, status) goes
 * through the same scrubber. They are kept per workspace, not per tab: every tab of an agent's workspace is the same computer, where one person's command can print what another person's command
 * left (a tab's scrollback, a file, a process). A session on another computer keeps its own. A restart forgets them.
 */
const secretsByScope = new Map<string, Secret[]>();

/** What a session's screens are scrubbed of: its workspace's values when it is in one, else its own. */
export function scopeOf(x: { terminalId: string; host: string; agentId?: string | undefined }): string {
  return x.host === "agent_computer" && x.agentId !== undefined ? `ws:${x.agentId}` : `trm:${x.terminalId}`;
}
/** The scope of a session by its id, read from its row (a session nobody knows is its own). */
export function scopeOfId(db: Db, terminalId: string): string {
  const r = db.all("SELECT host, agent_id FROM terminal_sessions WHERE terminal_id = ?", terminalId)[0] as { host?: unknown; agent_id?: unknown } | undefined;
  return scopeOf({ terminalId, host: String(r?.host ?? ""), ...(typeof r?.agent_id === "string" ? { agentId: r.agent_id } : {}) });
}

export function rememberSecrets(scope: string, secrets: readonly Secret[]): void {
  const keep = secrets.filter((x) => x.value.length >= MIN_SECRET_LENGTH);
  if (keep.length === 0) return;
  const cur = secretsByScope.get(scope) ?? [];
  for (const x of keep) if (!cur.some((c) => c.handle === x.handle && c.value === x.value)) cur.push(x);
  secretsByScope.set(scope, cur);
}
export function scrubberFor(scope: string): ScrubberLike | null {
  const list = secretsByScope.get(scope);
  return list && list.length > 0 ? vaultKit.createScrubber(list) : null;
}
/** Every spelling of every value used in the scope: what a live frame must not show, even split across two frames. */
export function spellingsFor(scope: string): string[] {
  const out = new Set<string>();
  for (const x of secretsByScope.get(scope) ?? []) for (const v of vaultKit.spellings(x.value)) out.add(v);
  return [...out];
}
/** A tab of its own is forgotten when it closes; a workspace keeps its values for as long as this process runs, since its other tabs and files may still hold them. */
export const forgetSecrets = (scope: string): void => { if (scope.startsWith("trm:")) secretsByScope.delete(scope); };

/** Every remembered value forgotten: a test starting clean. */
export const forgetAllSecrets = (): void => { secretsByScope.clear(); };

/** Text from a screen, with every value used in the scope removed. */
export function clean(scope: string, text: string): string {
  const sc = scrubberFor(scope);
  return sc ? sc.scrub(text) : text;
}
