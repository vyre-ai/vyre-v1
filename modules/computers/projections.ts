// @reads /modules/computers/migrations/0001_init.sql
// Durable rows of the computers module (agent computers, recordings, tickets, timeline steps, signed-in sessions), the port to the machine that runs the containers, and the helpers
// every computers handler shares. Every statement names a computers_* table, which is all ctx.db lets a module touch. The migration file is the one source of the schema.
import { readFileSync } from "node:fs";
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";
import type { ErrorCode, EventName } from "../../packages/contracts/src/types.ts";

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** The part of the host Ctx these handlers read. A test passes a small object; the host passes the full Ctx. */
export interface CompCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  actingFor?: string | undefined;
  run?: string | undefined;
  thread?: string | undefined;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: EventName, subject: string, payload: unknown): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  authorize(action: { perm: string | null; level: "view" | "use" | "edit" | "manage" }, resource: { type: string; id: string | null }): { effect: "allow" | "deny" | "hold" };
  log: { warn(msg: string, attrs?: Record<string, unknown>): void };
}

export function raise(ctx: Pick<CompCtx, "trace">, code: ErrorCode, message: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { message, ...(details ? { details } : {}) });
}

/** Who did it: the person an agent acts for, else the caller. */
export const actorOf = (ctx: Pick<CompCtx, "principal" | "actingFor">): string => ctx.actingFor ?? ctx.principal.id;

export const DEFAULT_TAB_LIMIT = 8;
export const DEFAULT_IDLE_MINUTES = 10;
export const TICKET_MS = 60_000;

export type CompState = "provisioning" | "asleep" | "waking" | "working" | "takeover" | "error";
export type HostKind = "server" | "vm";

// ---- the machine the containers run on -------------------------------------------------------------------------------------------------------------------

export interface Probe { running: boolean; busy: boolean; tabs: number; caption?: string; lastFrameAt?: number; diskBytes?: number }
export interface SessionInfo { site: string; signedInAs?: string; since: number; lastSeen: number }
export interface RecordResult { events?: string; har?: string; durationMs?: number }

/**
 * What the machine that runs agent computers does (ARCH 6.6, 7.2: one container `vyre-comp-<agent>` per agent, `agentd` inside). The module never starts a process or opens a socket itself;
 * the host binds one of these (impl.ts builds the Docker one). Every method names the computer by id and answers within seconds; a computer that is asleep has no running container.
 */
export interface ComputerHost {
  readonly kind: HostKind;
  /** Create the container (stopped) and its profile disk. */
  create(a: { computerId: string; agentId: string; tabLimit: number; idleSleepMinutes: number }): Promise<{ diskBytes?: number }>;
  /** Unseal the profile disk and start the container; resolves when agentd answers. */
  start(a: { computerId: string; tabLimit: number; agentId?: string }): Promise<void>;
  /** Seal the profile disk and stop the container. Returns the signed-in sites it saw, for the list that must be there while the computer sleeps. */
  stop(a: { computerId: string; reason: "idle" | "requested" | "remove"; agentId?: string }): Promise<{ sessions?: SessionInfo[]; diskBytes?: number }>;
  /** Remove the container and its profile disk. */
  remove(computerId: string): Promise<void>;
  probe(computerId: string): Promise<Probe>;
  /** tabLimit, and the Vault channel (fillUrl and fillToken, held in agentd's memory only): agentd asks the host for one #Handle.field at a time over it. */
  configure(a: { computerId: string; tabLimit?: number; fillUrl?: string; fillToken?: string }): Promise<void>;
  /** The person's input replaces the agent's: agentd pauses the agent's tools and accepts the person's connection. */
  takeover(a: { computerId: string; personId: string }): Promise<void>;
  giveBack(computerId: string): Promise<void>;
  screenshot(computerId: string): Promise<{ bytes: Uint8Array; width: number; height: number }>;
  /** Where the live view is served from, for a ticket the viewer will present. */
  stream(a: { computerId: string; ticket: string }): Promise<{ transport: "webrtc" | "mjpeg"; url: string }>;
  record(a: { computerId: string; recordingId: string; action: "start" | "stop" }): Promise<RecordResult>;
  /** Write the masked events and network log beside the video agentd saved, in the recording's folder under the agent's Files folder. */
  saveRecording(a: { computerId: string; recordingId: string; folderPath: string; events: string; har: string }): Promise<void>;
  removeRecording(a: { computerId: string; recordingId: string; folderPath: string }): Promise<void>;
  sessions(computerId: string): Promise<SessionInfo[]>;
  signOut(a: { computerId: string; site: string }): Promise<boolean>;
  health(): Promise<{ ok: boolean; detail?: string; latencyMs?: number }>;
}

/** The host's Vault fill channel (P-L2_21): a token per computer and the address agentd posts to. Unbound, a computer has no Vault channel and refuses a #Handle. */
export interface FillBinding {
  issue(h: { computerId: string; agentId: string; asker: string }): Promise<{ fillToken: string; revoke(): void }>;
  url(): string;
}
let fill: FillBinding | null = null;
export function bindFill(b: FillBinding | null): void { fill = b; }
export const boundFill = (): FillBinding | null => fill;
/** The live grant per computer, so sleep and remove can end it. */
const fillGrants = new Map<string, { revoke(): void }>();
export function holdFill(computerId: string, g: { revoke(): void }): void { fillGrants.get(computerId)?.revoke(); fillGrants.set(computerId, g); }
export function dropFill(computerId: string): void { fillGrants.get(computerId)?.revoke(); fillGrants.delete(computerId); }

let hostPort: ComputerHost | null = null;
export function bindHost(h: ComputerHost | null): void { hostPort = h; }
export const boundHost = (): ComputerHost | null => hostPort;
export function hostOf(ctx: Pick<CompCtx, "trace">): ComputerHost {
  if (!hostPort) raise(ctx, "provider.unavailable", "Agent computers are not running on this host.");
  return hostPort;
}

/** Is this a Team Space? Agent computers need one (spec 2.7). The host binds the answer; unbound means team. */
let teamSpace: (space: string) => boolean = () => true;
export function bindTeam(f: ((space: string) => boolean) | null): void { teamSpace = f ?? (() => true); }
export function needTeam(ctx: Pick<CompCtx, "space" | "trace">): void {
  if (!teamSpace(ctx.space)) raise(ctx, "permission.needs_team", "Agent computers need a Team Space.");
}

// ---- schema --------------------------------------------------------------------------------------------------------------------------------------------

const SCHEMA = readFileSync(new URL("./migrations/0001_init.sql", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter((s) => s.length > 0);
const ready = new WeakSet<object>();

export function ensure(db: Db): void {
  if (ready.has(db)) return;
  try { db.all("SELECT site FROM computers_sessions WHERE computer_id = ?", "probe"); } catch { for (const stmt of SCHEMA) db.run(stmt); }
  ready.add(db);
}

export type Row = Record<string, unknown>;
export const rowsOf = (db: Db, sql: string, ...args: unknown[]): Row[] => db.all(sql, ...args) as Row[];
const str = (v: unknown): string => String(v ?? "");
const num = (v: unknown): number => Number(v ?? 0);
const opt = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));
const optNum = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number(v));

/** Contract ids are `<prefix>_<lowercase alphanumerics>`. */
export const mintId = (prefix: string, now: number = Date.now()): string => `${prefix}_${mintUuid(now).replaceAll("-", "")}`;
const hex = (n: number): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256(text: string): Promise<string> {
  const d = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- computers ---------------------------------------------------------------------------------------------------------------------------------------

export interface ComputerRow {
  computerId: string; agentId: string; state: CompState; caption?: string; tabs: number; tabLimit: number; idleSleepMinutes: number; host: HostKind; diskBytes?: number;
  lastFrameAt?: number; lastFrameFile?: string; lastActiveAt?: number; takeoverBy?: string; takeoverStep?: string; takeoverAt?: number; recordingId?: string; error?: string; createdAt: number;
}

export function computerOf(r: Row): ComputerRow {
  const out: ComputerRow = {
    computerId: str(r["computer_id"]), agentId: str(r["agent_id"]), state: str(r["state"]) as CompState, tabs: num(r["tabs"]), tabLimit: num(r["tab_limit"]),
    idleSleepMinutes: num(r["idle_sleep_minutes"]), host: str(r["host"]) as HostKind, createdAt: num(r["created_at"]),
  };
  const caption = opt(r["caption"]); if (caption !== undefined) out.caption = caption;
  const disk = optNum(r["disk_bytes"]); if (disk !== undefined) out.diskBytes = disk;
  const frame = optNum(r["last_frame_at"]); if (frame !== undefined) out.lastFrameAt = frame;
  const frameFile = opt(r["last_frame_file"]); if (frameFile !== undefined) out.lastFrameFile = frameFile;
  const active = optNum(r["last_active_at"]); if (active !== undefined) out.lastActiveAt = active;
  const by = opt(r["takeover_by"]); if (by !== undefined) out.takeoverBy = by;
  const step = opt(r["takeover_step"]); if (step !== undefined) out.takeoverStep = step;
  const at = optNum(r["takeover_at"]); if (at !== undefined) out.takeoverAt = at;
  const rec = opt(r["recording_id"]); if (rec !== undefined) out.recordingId = rec;
  const err = opt(r["error"]); if (err !== undefined) out.error = err;
  return out;
}

export function computerBy(db: Db, computerId: string): ComputerRow | null {
  const r = rowsOf(db, "SELECT * FROM computers_computers WHERE computer_id = ?", computerId)[0];
  return r ? computerOf(r) : null;
}

/** The contract's computer row. */
export function computerOut(c: ComputerRow) {
  return {
    computerId: c.computerId, agentId: c.agentId, state: c.state, ...(c.caption !== undefined ? { caption: c.caption } : {}), tabs: c.tabs, tabLimit: c.tabLimit, host: c.host,
    ...(c.diskBytes !== undefined ? { diskBytes: c.diskBytes } : {}), ...(c.lastFrameAt !== undefined ? { lastFrameAt: c.lastFrameAt } : {}),
    ...(c.lastActiveAt !== undefined ? { lastActiveAt: c.lastActiveAt } : {}), ...(c.takeoverBy !== undefined ? { takeoverBy: c.takeoverBy } : {}), recording: c.recordingId !== undefined,
  };
}

export function needComputer(ctx: Pick<CompCtx, "db" | "trace">, computerId: string): ComputerRow {
  const c = computerBy(ctx.db, computerId);
  if (!c) raise(ctx, "validation.not_found", "There is no such agent computer.", { computerId });
  return c;
}

/** Set columns of one computer. Keys are column names; a value of null clears the column. */
export function setComputer(db: Db, computerId: string, cols: Record<string, string | number | null>): void {
  const keys = Object.keys(cols);
  if (keys.length === 0) return;
  db.run(`UPDATE computers_computers SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE computer_id = ?`, ...keys.map((k) => cols[k] as string | number | null), computerId);
}

// ---- timeline -----------------------------------------------------------------------------------------------------------------------------------------

export interface StepRow { stepId: string; idx: number; at: number; by: "agent" | "person"; caption: string; tool: string; frameFileId?: string; runId?: string; threadId?: string }

export function stepOf(r: Row): StepRow {
  const out: StepRow = { stepId: str(r["step_id"]), idx: num(r["idx"]), at: num(r["at"]), by: str(r["by_who"]) as "agent" | "person", caption: str(r["caption"]), tool: str(r["tool"]) };
  const f = opt(r["frame_file_id"]); if (f !== undefined) out.frameFileId = f;
  const run = opt(r["run_id"]); if (run !== undefined) out.runId = run;
  const th = opt(r["thread_id"]); if (th !== undefined) out.threadId = th;
  return out;
}

/** The contract's timeline step. */
export const stepOut = (s: StepRow) => ({
  stepId: s.stepId, idx: s.idx, at: s.at, caption: s.caption, tool: s.tool, ...(s.frameFileId ? { frameFileId: s.frameFileId } : {}), by: s.by, ...(s.runId ? { runId: s.runId } : {}),
});

/** Add one step to a computer's timeline (the next index). The tool handlers of the other computers packets call this too. */
export function addStep(db: Db, computerId: string, at: number, s: { by: "agent" | "person"; caption: string; tool: string; frameFileId?: string; runId?: string; threadId?: string }): StepRow {
  const idx = num(rowsOf(db, "SELECT COALESCE(MAX(idx), -1) + 1 AS next FROM computers_timeline WHERE computer_id = ?", computerId)[0]?.["next"]);
  const stepId = mintId("stp", at);
  db.run(
    "INSERT INTO computers_timeline (step_id, computer_id, idx, at, by_who, caption, tool, frame_file_id, run_id, thread_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    stepId, computerId, idx, at, s.by, s.caption, s.tool, s.frameFileId ?? null, s.runId ?? null, s.threadId ?? null,
  );
  return { stepId, idx, at, by: s.by, caption: s.caption, tool: s.tool, ...(s.frameFileId ? { frameFileId: s.frameFileId } : {}), ...(s.runId ? { runId: s.runId } : {}), ...(s.threadId ? { threadId: s.threadId } : {}) };
}

export function setStepCaption(db: Db, stepId: string, caption: string): void {
  db.run("UPDATE computers_timeline SET caption = ? WHERE step_id = ?", caption, stepId);
}

// ---- recordings ---------------------------------------------------------------------------------------------------------------------------------------

export interface RecordingRow {
  recordingId: string; computerId: string; agentId: string; startedAt: number; endedAt?: number; durationMs?: number; folderPath: string; state: "recording" | "saved" | "processed";
  intents: string[]; byPerson: string; taskId?: string;
}

export function recordingOf(r: Row): RecordingRow {
  let intents: string[] = [];
  try { const a = JSON.parse(str(r["intents"])) as unknown; if (Array.isArray(a)) intents = a.filter((x): x is string => typeof x === "string"); } catch { intents = []; }
  const out: RecordingRow = {
    recordingId: str(r["recording_id"]), computerId: str(r["computer_id"]), agentId: str(r["agent_id"]), startedAt: num(r["started_at"]), folderPath: str(r["folder_path"]),
    state: str(r["state"]) as RecordingRow["state"], intents, byPerson: str(r["by_person"]),
  };
  const e = optNum(r["ended_at"]); if (e !== undefined) out.endedAt = e;
  const d = optNum(r["duration_ms"]); if (d !== undefined) out.durationMs = d;
  const t = opt(r["task_id"]); if (t !== undefined) out.taskId = t;
  return out;
}

export function recordingBy(db: Db, recordingId: string): RecordingRow | null {
  const r = rowsOf(db, "SELECT * FROM computers_recordings WHERE recording_id = ?", recordingId)[0];
  return r ? recordingOf(r) : null;
}

/** The contract's recording row. */
export const recordingOut = (r: RecordingRow) => ({
  recordingId: r.recordingId, computerId: r.computerId, agentId: r.agentId, startedAt: r.startedAt, ...(r.endedAt !== undefined ? { endedAt: r.endedAt } : {}),
  ...(r.durationMs !== undefined ? { durationMs: r.durationMs } : {}), folderPath: r.folderPath, state: r.state, intents: r.intents,
});

export const recordingFiles = (folderPath: string) => ({ eventsPath: `${folderPath}/events.jsonl`, harPath: `${folderPath}/network.har`, videoPath: `${folderPath}/video.mp4` });

// ---- tickets -------------------------------------------------------------------------------------------------------------------------------------------

/** A one-use secret for a viewer's connection (kind "takeover" or "stream"). Only its hash is stored. */
export async function mintTicket(db: Db, kind: "takeover" | "stream", computerId: string, personId: string, now: number): Promise<{ ticket: string; expiresAt: number }> {
  const ticket = `cpt_${hex(24)}`;
  const expiresAt = now + TICKET_MS;
  db.run("INSERT INTO computers_tickets (ticket_hash, kind, computer_id, person_id, expires_at, used_at) VALUES (?, ?, ?, ?, ?, NULL)", await sha256(ticket), kind, computerId, personId, expiresAt);
  return { ticket, expiresAt };
}

/** The relay spends a ticket once. Returns who it was issued to and for which computer, or null (unknown, spent or expired). */
export async function redeemTicket(db: Db, ticket: string, now: number): Promise<{ kind: string; computerId: string; personId: string } | null> {
  ensure(db);
  const hash = await sha256(ticket);
  const r = rowsOf(db, "SELECT * FROM computers_tickets WHERE ticket_hash = ?", hash)[0];
  if (!r || (r["used_at"] !== null && r["used_at"] !== undefined) || num(r["expires_at"]) <= now) return null;
  const spent = db.run("UPDATE computers_tickets SET used_at = ? WHERE ticket_hash = ? AND used_at IS NULL", now, hash);
  return spent.changes === 1 ? { kind: str(r["kind"]), computerId: str(r["computer_id"]), personId: str(r["person_id"]) } : null;
}

// ---- the agent's folder ----------------------------------------------------------------------------------------------------------------------------

/** The agent's Files folder id, for storing screenshots and for checking that a person may see a recording. */
export async function agentFolder(ctx: CompCtx, agentId: string): Promise<string | null> {
  try {
    const out = (await ctx.call("agents.get", { agentId })) as { agent?: { folderId?: string } };
    return out.agent?.folderId ?? null;
  } catch { return null; }
}

// ---- secrets used on a computer -------------------------------------------------------------------------------------------------------------------------

// The fill-and-scrub machinery is agent/src/vault-use (ARCH 6.11). Boundary B8 does not let this module import `agent`, so the host binds the scrubber here; the Chrome and Screen tools
// register the values they filled, per computer, in memory only. With none bound there is nothing to scrub but the structural masking in record.ts.
export interface Secret { handle: string; itemId: string; value: string }
export interface ScrubberLike { scrub(text: string): string }
export interface ScrubKit { createScrubber(secrets: readonly Secret[]): ScrubberLike }
let scrubKit: ScrubKit | null = null;
export function bindKit(k: ScrubKit | null): void { scrubKit = k; }
const secretsByComputer = new Map<string, Secret[]>();
export function rememberSecrets(computerId: string, secrets: readonly Secret[]): void {
  if (secrets.length === 0) return;
  const cur = secretsByComputer.get(computerId) ?? [];
  for (const x of secrets) if (!cur.some((c) => c.handle === x.handle && c.value === x.value)) cur.push(x);
  secretsByComputer.set(computerId, cur);
}
export function forgetSecrets(computerId: string): void { secretsByComputer.delete(computerId); }
/** Text with every value filled on this computer removed. */
export function clean(computerId: string, text: string): string {
  const list = secretsByComputer.get(computerId);
  return list && list.length > 0 && scrubKit ? scrubKit.createScrubber(list).scrub(text) : text;
}
