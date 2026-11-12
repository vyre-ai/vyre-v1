// @reads /modules/computers/migrations/0004_migration.sql
// The one-time move of an existing agent computer (Dex on MLA) to the new model (6 Nov design, "Migration"): the agent gets a workspace and a Space browser profile, and the profile keeps
// the logins of the computer's Chrome, because Chrome's user-data folder is copied into it. Run by the idle pass (sleepIdle), so it happens at the first pass after an update installs the code and
// never again for a computer that finished.
//   The workspace and the browser profile belong to l-ws and l-sbrowser; they bind `bindMigration` with three calls. Unbound, nothing runs and nothing is marked, so the move happens on the first
//   pass after both lanes have landed. Each call must be safe to repeat for the same agent: a pass that stops halfway is run again.
// DECISION: Only a computer that is asleep moves. Chrome's cookie and login databases are SQLite files; a copy taken while Chrome runs can be torn. An awake computer is picked up on a later pass,
//   after it slept (the idle job sleeps it when it is quiet). The pass never wakes or stops a computer by itself.
// DECISION: The old computer is left as it is, asleep, with its profile volume. It holds the logins until the person has seen the new browser work; removing it is theirs (Console > Computers).
// DECISION: A computer on a joined server (its host cannot hand over Chrome's folder yet) still gets its workspace and profile, and is marked `partial`: the agent signs in again once.
//   A failed step is tried on the next pass, three times in all, then marked `failed` with the reason, and left alone.
import { computerBy, computerOf, hostFor, raise, rowsOf } from "./projections.ts";
import type { CompCtx, ComputerRow } from "./projections.ts";

export interface ChromeData { tar: Uint8Array }
export interface MigrationPorts {
  /** The agent's workspace, made when it has none. Safe to repeat. (l-ws) */
  ensureWorkspace(ctx: CompCtx, a: { agentId: string; computerId: string }): Promise<{ workspaceId: string }>;
  /** The agent's Space browser profile, made when it has none. Safe to repeat. (l-sbrowser) */
  ensureBrowserProfile(ctx: CompCtx, a: { agentId: string; computerId: string }): Promise<{ profileId: string }>;
  /** Put Chrome's user-data (the tar of the old computer's folder) into the profile, replacing what the profile holds. The profile is not running. (l-sbrowser) */
  importChromeData(ctx: CompCtx, a: { agentId: string; profileId: string; data: ChromeData }): Promise<{ bytes: number }>;
  /** Does the agent's browser profile already hold sign-ins (made there since its browser calls went to the Space browser)? Then nothing is copied over it. Optional, but left out nothing can be told, so the move waits (not now): nothing final is recorded from a guess and nothing is overwritten. */
  /** Can the Space browser take an import now (the service can start, the image is there)? Asked before anything is read from the desktop; throws when it cannot. Optional. */
  browserReady?(ctx: CompCtx, a: { agentId: string; profileId: string }): Promise<void>;
  profileInUse?(ctx: CompCtx, a: { agentId: string; profileId: string }): Promise<boolean>;
}
let ports: MigrationPorts | null = null;
const parts: Partial<MigrationPorts> = {};
/** All three at once (a test, or one binder that owns them all). */
export function bindMigration(p: MigrationPorts | null): void { ports = p; }
/** One at a time, each by the lane that owns it (l-ws: ensureWorkspace; l-sbrowser: the profile and Chrome's data). The move runs once all three are bound. */
export function bindMigrationPort<K extends keyof MigrationPorts>(k: K, f: MigrationPorts[K] | null): void { if (f) parts[k] = f; else delete parts[k]; }
const boundPorts = (): MigrationPorts | null => ports ?? (parts.ensureWorkspace && parts.ensureBrowserProfile && parts.importChromeData ? (parts as MigrationPorts) : null);

export const MAX_ATTEMPTS = 3;
/** The Chrome folder is read into memory whole, so a desktop whose profile disk is bigger than this is not copied (recorded `partial`, with the reason): 512 MB is safe on a small server. */
export const MAX_COPY_BYTES = 512 * 1024 * 1024;
/** How long an agent's first browser call waits for the move it started, and a wake waits for a move that is running. The move carries on after it. */
export const WAIT_MS = 20_000;
let waitMs = WAIT_MS;
/** For tests: how long a call waits for a move in flight. */
export function setMoveWait(ms: number | null): void { waitMs = ms ?? WAIT_MS; }

export interface MigrationResult { done: number; partial: number; failed: number; waiting: number }

const say = (e: unknown): string => (e instanceof Error ? e.message.slice(0, 300) : "unknown");

/**
 * A failure that says "not now", not "this will not work": the runtime or the Space browser is not there, an image could not be fetched, the profile is busy or held, the host has no room. It uses no
 * attempt and is tried again at the next pass.
 */
export function notNow(e: unknown): boolean {
  const x = e as { code?: unknown; reason?: unknown; workspace?: unknown; error?: { code?: unknown } } | null;
  // the Space browser says why it will not take the import now by a stable `reason`, never by its wording
  if (x?.reason === "profile_held" || x?.reason === "profile_busy") return true;
  // faults that will not go away by waiting back off like real failures, and the Console line says why: a host that never has a Space browser, container settings that were refused
  if (permanent(e)) return false;
  if (x?.code === "unavailable" || x?.error?.code === "provider.unavailable" || x?.workspace === true) return true;
  return /image .* (is )?not on this server|did not answer|no room|waiting for room/i.test(say(e));
}
const permanent = (e: unknown): boolean => /not running on this host|outside its profile|not JSON|settings .*refused/i.test(say(e));

/** Not-now waits grow: a minute, five, thirty, then hourly. They use no attempt. Kept in memory (a restart tries once at once), and logged once per wait. */
const NOW_WAITS = [60_000, 300_000, 1_800_000, 3_600_000];
const nowWaits = new Map<string, { n: number; until: number }>();
const waitingNotNow = (ctx: Pick<CompCtx, "now">, id: string): boolean => ctx.now() < (nowWaits.get(id)?.until ?? 0);
function waitMore(ctx: CompCtx, c: ComputerRow, reason: string): void {
  const n = (nowWaits.get(c.computerId)?.n ?? 0) + 1;
  const ms = NOW_WAITS[Math.min(n - 1, NOW_WAITS.length - 1)]!;
  nowWaits.set(c.computerId, { n, until: ctx.now() + ms });
  ctx.log.warn("computers: the move waits", { computerId: c.computerId, reason, retryInMs: ms });
}
/** For tests: forget the not-now waits. */
export function resetMoveState(): void { nowWaits.clear(); }

const IMPORTING = "importing: ";
export const INTERRUPTED = "Moving its sign-ins was interrupted. It will be tried again.";
/** A refusal that comes before the Space browser touches the profile (busy, held): the import did not start. */
const BEFORE_TOUCH = (e: unknown): boolean => { const r = (e as { reason?: unknown } | null)?.reason; return r === "profile_held" || r === "profile_busy"; };
function markImporting(ctx: CompCtx, c: ComputerRow, a: { workspaceId: string | null; profileId: string | null; attempts: number }): void {
  record(ctx, c, "failed", { workspaceId: a.workspaceId, profileId: a.profileId, attempts: a.attempts, bytes: null, error: IMPORTING });
}
function clearMark(ctx: CompCtx, c: ComputerRow, prior: Record<string, unknown> | undefined): void {
  if (prior) ctx.db.run("UPDATE computers_migration SET error = NULL WHERE computer_id = ?", c.computerId); else ctx.db.run("DELETE FROM computers_migration WHERE computer_id = ?", c.computerId);
}
/** A row written before the import and kept until it ends: after a restart in the middle, the profile holds the import's own half-written folder, the one case where writing over it is right. */
function ownImport(ctx: Pick<CompCtx, "db">, id: string): boolean {
  const r = rowsOf(ctx.db, "SELECT state, error FROM computers_migration WHERE computer_id = ?", id)[0];
  return !!r && String(r["state"]) === "failed" && String(r["error"] ?? "").startsWith(IMPORTING);
}

/** After a real failure: wait a minute, then an hour, then a day, and keep trying once a day. */
export const backoffMs = (attempts: number): number => (attempts <= 1 ? 60_000 : attempts === 2 ? 3_600_000 : 86_400_000);

type Step = "done" | "partial" | "failed" | "retry";
/** Moves in flight, by computer: the idle pass and an agent's first browser call never move one computer twice at once; a call waits (for a short time) for the move that is already running. */
const moving = new Map<string, Promise<Step>>();

/** Has this computer's move reached its end: moved (done) or moved without its sign-ins (partial)? A failed move is never the end: it is tried again. */
function settled(ctx: Pick<CompCtx, "db">, computerId: string): boolean {
  return rowsOf(ctx.db, "SELECT 1 FROM computers_migration WHERE computer_id = ? AND state IN ('done', 'partial')", computerId).length > 0;
}

/** After a real failure the next try is not due yet. */
function dueAt(ctx: Pick<CompCtx, "db">, computerId: string): number {
  const r = rowsOf(ctx.db, "SELECT state, attempts, at FROM computers_migration WHERE computer_id = ?", computerId)[0];
  return r && String(r["state"]) === "failed" ? Number(r["at"]) + backoffMs(Number(r["attempts"])) : 0;
}

const MOVING_LINE = "This older desktop is being moved to the agent's workspace and Space browser. Try again in a minute.";

/** A wake, a take over or any call that would start the computer waits a short while for a move in flight, then says it is being moved. The desktop is never started during its move. */
export async function holdWhileMoving(ctx: Pick<CompCtx, "trace">, computerId: string): Promise<void> {
  const flying = moving.get(computerId);
  if (!flying) return;
  const done = await Promise.race([flying.then(() => true, () => true), new Promise<boolean>((r) => { const t = setTimeout(() => r(false), waitMs); t.unref?.(); })]);
  if (!done || moving.has(computerId)) raise(ctx, "validation.precondition_failed", MOVING_LINE, { moving: true });
}

const asleep = (ctx: Pick<CompCtx, "db">, computerId: string): boolean => computerBy(ctx.db, computerId)?.state === "asleep";

/** Move one asleep computer. A failed step is its own row, never a throw. */
function moveOne(ctx: CompCtx, p: MigrationPorts, c: ComputerRow): Promise<Step> {
  const flying = moving.get(c.computerId);
  if (flying) return flying;
  const run = (async (): Promise<Step> => {
    const prior = rowsOf(ctx.db, "SELECT attempts, workspace_id, profile_id FROM computers_migration WHERE computer_id = ?", c.computerId)[0];
    const attempts = Number(prior?.["attempts"] ?? 0) + 1;
    let workspaceId = prior?.["workspace_id"] ? String(prior["workspace_id"]) : null;
    let profileId = prior?.["profile_id"] ? String(prior["profile_id"]) : null;
    let importStarted = false;
    let ours = false;
    try {
      workspaceId = (await p.ensureWorkspace(ctx, { agentId: c.agentId, computerId: c.computerId })).workspaceId;
      profileId = (await p.ensureBrowserProfile(ctx, { agentId: c.agentId, computerId: c.computerId })).profileId;
      const host = hostFor(ctx, c.computerId);
      if (!host?.chromeData) { record(ctx, c, "partial", { workspaceId, profileId, attempts, bytes: 0, error: "This computer's server cannot hand over its Chrome profile yet. The agent signs in again once." }); return "partial"; }
      // the slow steps are over: the desktop must still be asleep, or its Chrome files could be torn (a wake, a take over or a tool call may have started it meanwhile)
      if (!asleep(ctx, c.computerId)) return "retry";
      // the Space browser must be able to take the import before anything is read from the desktop
      if (p.browserReady) await p.browserReady(ctx, { agentId: c.agentId, profileId });
      // a browser profile that already holds sign-ins is never written over: they were made there since the agent's browser calls went to the Space browser. The exception is the folder of an import
      // of ours that a restart cut short (the mark below). With no way to ask, nothing is decided: the move waits (not now), because nothing final may be recorded from a guess.
      ours = ownImport(ctx, c.computerId);
      if (!ours) {
        if (!p.profileInUse) throw Object.assign(new Error("The Space browser cannot yet say whether this agent's browser profile is in use."), { code: "unavailable" });
        if (await p.profileInUse(ctx, { agentId: c.agentId, profileId })) {
          record(ctx, c, "partial", { workspaceId, profileId, attempts, bytes: 0, error: `${await nameOf(ctx, c.agentId)} already uses its browser on the Space, so the sign-ins from its older desktop were not copied. Open the older desktop to see them, or sign in again.` });
          return "partial";
        }
      }
      if (ours) importStarted = true;   // a profile that was ever marked is only ever finished by a complete import
      const data = await host.chromeData(c.computerId);
      // it must have stayed asleep from before the copy to after it
      if (!asleep(ctx, c.computerId)) return "retry";
      // The computer answered that it has no Chrome folder. One that was never started has none to give, and moves with nothing to import. One that has run does have one, so "not found" means the
      // sign-ins were not handed over: that is said (partial, with the reason), never recorded as a move that carried them.
      if (data === null && c.lastActiveAt !== undefined) {
        if (ours) throw new Error("This computer's Chrome profile was not found, so the interrupted import cannot be finished yet.");
        record(ctx, c, "partial", { workspaceId, profileId, attempts, bytes: 0, error: "This computer's Chrome profile was not found, so its sign-ins did not move. The agent signs in again once." });
        ctx.log.warn("computers: the old computer had no Chrome profile to hand over", { computerId: c.computerId, agentId: c.agentId });
        return "partial";
      }
      // what is copied is only sign-ins and settings (no caches); that, not the disk, is measured
      if (data !== null && data.tar.length > MAX_COPY_BYTES) {
        if (ours) throw new Error("This computer's Chrome sign-ins are too large to copy, so the interrupted import cannot be finished.");
        record(ctx, c, "partial", { workspaceId, profileId, attempts, bytes: 0, error: `This computer's Chrome sign-ins and settings are ${Math.round(data.tar.length / 1_048_576)} MB, more than the ${MAX_COPY_BYTES / 1_048_576} MB that can be copied safely, so they did not move. The agent signs in again once.` });
        return "partial";
      }
      if (data !== null) { markImporting(ctx, c, { workspaceId, profileId, attempts: attempts - 1 }); importStarted = true; }
      const bytes = data ? (await p.importChromeData(ctx, { agentId: c.agentId, profileId, data })).bytes : 0;
      nowWaits.delete(c.computerId);
      record(ctx, c, "done", { workspaceId, profileId, attempts, bytes, error: null });
      ctx.log.warn("computers: moved to a workspace and a browser profile", { computerId: c.computerId, agentId: c.agentId, chromeBytes: bytes });
      return "done";
    } catch (e) {
      // not now: no attempt is used and the wait before the next try grows. If the import had not begun nothing is recorded; if it had, its mark stays unless the Space browser refused it before touching the profile.
      if (notNow(e)) {
        if (importStarted && (ours || !BEFORE_TOUCH(e))) { markImporting(ctx, c, { workspaceId, profileId, attempts: attempts - 1 }); /* the mark stays: the folder may be half written */ } else if (importStarted) clearMark(ctx, c, prior);
        waitMore(ctx, c, say(e));
        return "retry";
      }
      nowWaits.delete(c.computerId);
      record(ctx, c, "failed", { workspaceId, profileId, attempts, bytes: null, error: `${importStarted ? IMPORTING : ""}${say(e)}` });
      ctx.log.warn("computers: the move to a workspace and a browser profile failed", { computerId: c.computerId, attempts, reason: say(e) });
      return "failed";
    }
  })().finally(() => { moving.delete(c.computerId); });
  moving.set(c.computerId, run);
  return run;
}

async function nameOf(ctx: CompCtx, agentId: string): Promise<string> {
  try { const o = (await ctx.call("agents.get", { agentId })) as { agent?: { name?: string } }; if (o.agent?.name) return o.agent.name; } catch { /* the plain word below */ }
  return "This agent";
}

/** Move every asleep computer that has not moved. Returns what happened; a computer that is awake is `waiting`. Never throws: one computer's failure is its own row. */
export async function migrateComputers(ctx: CompCtx): Promise<MigrationResult> {
  const out: MigrationResult = { done: 0, partial: 0, failed: 0, waiting: 0 };
  const p = boundPorts();
  if (!p) return out;
  const todo = rowsOf(ctx.db, "SELECT * FROM computers_computers WHERE computer_id NOT IN (SELECT computer_id FROM computers_migration WHERE state IN ('done', 'partial')) ORDER BY agent_id").map(computerOf);
  for (const c of todo) {
    if (c.state !== "asleep") { out.waiting++; continue; }
    if (ctx.now() < dueAt(ctx, c.computerId) || waitingNotNow(ctx, c.computerId)) continue;
    const r = await moveOne(ctx, p, c);
    if (r === "done" || r === "partial" || r === "failed") out[r]++;
  }
  return out;
}

/**
 * Has this agent's old desktop moved to its workspace and its Space browser profile (or has it none)? An agent's browser calls go to the Space browser only once this is true. The move copies the old Chrome's
 * folder into the profile, so it has to come before the profile is used. Asked at an agent's first browser call:
 *   - a move in flight is waited for, and so is one this call starts, for WAIT_MS at most: after that the call answers that the browser is being moved and the move carries on;
 *   - a desktop that is asleep is moved now, not at the next pass of the idle job (unless `start` is false: a status or a stop never starts a move);
 *   - a desktop that is awake cannot be copied safely (Chrome's cookie files are SQLite and a copy taken while it runs can be torn): false, and the call stays on that desktop, where the sign-ins are,
 *     until the idle job has put it to sleep and moved it;
 *   - a process where the move is not bound at all does not hold the browser back.
 */
export async function settleMove(ctx: CompCtx, agentId: string, o: { start?: boolean } = {}): Promise<boolean> {
  const p = boundPorts();
  if (!p) return true;
  for (const c of rowsOf(ctx.db, "SELECT * FROM computers_computers WHERE agent_id = ?", agentId).map(computerOf)) {
    if (settled(ctx, c.computerId)) continue;
    const flying = moving.get(c.computerId);
    if (flying === undefined && (o.start === false || c.state !== "asleep" || ctx.now() < dueAt(ctx, c.computerId) || waitingNotNow(ctx, c.computerId))) return false;
    const run = flying ?? moveOne(ctx, p, c);
    if (o.start === false) return false;
    const done = await Promise.race([run.then(() => true, () => true), new Promise<boolean>((r) => { const t = setTimeout(() => r(false), waitMs); t.unref?.(); })]);
    if (!done) raise(ctx, "provider.unavailable", "This agent's browser is being moved from its older desktop. Try again in a minute.", { moving: true });
    if (!settled(ctx, c.computerId)) return false;
  }
  return true;
}

function record(ctx: CompCtx, c: ComputerRow, state: "done" | "partial" | "failed", a: { workspaceId: string | null; profileId: string | null; attempts: number; bytes: number | null; error: string | null }): void {
  ctx.db.run(
    "INSERT OR REPLACE INTO computers_migration (computer_id, agent_id, state, workspace_id, profile_id, chrome_bytes, attempts, error, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    c.computerId, c.agentId, state, a.workspaceId, a.profileId, a.bytes, a.attempts, a.error, ctx.now(),
  );
}

/** What moved, for the report a person or the doctor reads. */
export function migrationRows(ctx: Pick<CompCtx, "db">): Array<{ computerId: string; agentId: string; state: string; workspaceId?: string; profileId?: string; chromeBytes?: number; error?: string }> {
  return rowsOf(ctx.db, "SELECT * FROM computers_migration ORDER BY agent_id").map((r) => ({
    computerId: String(r["computer_id"]), agentId: String(r["agent_id"]), state: String(r["state"]),
    ...(r["workspace_id"] ? { workspaceId: String(r["workspace_id"]) } : {}), ...(r["profile_id"] ? { profileId: String(r["profile_id"]) } : {}),
    ...(r["chrome_bytes"] !== null && r["chrome_bytes"] !== undefined ? { chromeBytes: Number(r["chrome_bytes"]) } : {}), ...(r["error"] ? { error: String(r["error"]) } : {}),
  }));
}

/** How this computer's move ended, for the lists a person reads; absent while it is still to be tried (or being retried). */
export function moveOf(ctx: Pick<CompCtx, "db">, computerId: string): { state: "done" | "partial" | "failed"; at: number; error?: string } | undefined {
  const r = rowsOf(ctx.db, "SELECT state, at, error, attempts FROM computers_migration WHERE computer_id = ?", computerId)[0];
  if (!r) return undefined;
  const state = String(r["state"]);
  if (state !== "done" && state !== "partial" && state !== "failed") return undefined;
  return { state: state as "done" | "partial" | "failed", at: Number(r["at"]), ...(r["error"] ? { error: String(r["error"]).startsWith(IMPORTING) ? INTERRUPTED : String(r["error"]) } : {}) };
}
