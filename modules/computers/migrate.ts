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
import { computerOf, hostFor, rowsOf } from "./projections.ts";
import type { CompCtx, ComputerRow } from "./projections.ts";

export interface ChromeData { tar: Uint8Array }
export interface MigrationPorts {
  /** The agent's workspace, made when it has none. Safe to repeat. (l-ws) */
  ensureWorkspace(ctx: CompCtx, a: { agentId: string; computerId: string }): Promise<{ workspaceId: string }>;
  /** The agent's Space browser profile, made when it has none. Safe to repeat. (l-sbrowser) */
  ensureBrowserProfile(ctx: CompCtx, a: { agentId: string; computerId: string }): Promise<{ profileId: string }>;
  /** Put Chrome's user-data (the tar of the old computer's folder) into the profile, replacing what the profile holds. The profile is not running. (l-sbrowser) */
  importChromeData(ctx: CompCtx, a: { agentId: string; profileId: string; data: ChromeData }): Promise<{ bytes: number }>;
}
let ports: MigrationPorts | null = null;
const parts: Partial<MigrationPorts> = {};
/** All three at once (a test, or one binder that owns them all). */
export function bindMigration(p: MigrationPorts | null): void { ports = p; }
/** One at a time, each by the lane that owns it (l-ws: ensureWorkspace; l-sbrowser: the profile and Chrome's data). The move runs once all three are bound. */
export function bindMigrationPort<K extends keyof MigrationPorts>(k: K, f: MigrationPorts[K] | null): void { if (f) parts[k] = f; else delete parts[k]; }
const boundPorts = (): MigrationPorts | null => ports ?? (parts.ensureWorkspace && parts.ensureBrowserProfile && parts.importChromeData ? (parts as MigrationPorts) : null);

export const MAX_ATTEMPTS = 3;

export interface MigrationResult { done: number; partial: number; failed: number; waiting: number }

const say = (e: unknown): string => (e instanceof Error ? e.message.slice(0, 300) : "unknown");

type Step = "done" | "partial" | "failed" | "retry";
/** Moves in flight, by computer: the idle pass and an agent's first browser call never move one computer twice at once, and a call waits for the move that is already running. */
const moving = new Map<string, Promise<Step>>();

/** Has this computer's move reached its end: moved (done), moved without its sign-ins (partial), or given up on after the attempts? */
function settled(ctx: Pick<CompCtx, "db">, computerId: string): boolean {
  return rowsOf(ctx.db, "SELECT 1 FROM computers_migration WHERE computer_id = ? AND (state IN ('done', 'partial') OR attempts >= ?)", computerId, MAX_ATTEMPTS).length > 0;
}

/** Move one asleep computer. A failed step is its own row, never a throw. */
function moveOne(ctx: CompCtx, p: MigrationPorts, c: ComputerRow): Promise<Step> {
  const flying = moving.get(c.computerId);
  if (flying) return flying;
  const run = (async (): Promise<Step> => {
    const prior = rowsOf(ctx.db, "SELECT attempts, workspace_id, profile_id FROM computers_migration WHERE computer_id = ?", c.computerId)[0];
    const attempts = Number(prior?.["attempts"] ?? 0) + 1;
    let workspaceId = prior?.["workspace_id"] ? String(prior["workspace_id"]) : null;
    let profileId = prior?.["profile_id"] ? String(prior["profile_id"]) : null;
    try {
      workspaceId = (await p.ensureWorkspace(ctx, { agentId: c.agentId, computerId: c.computerId })).workspaceId;
      profileId = (await p.ensureBrowserProfile(ctx, { agentId: c.agentId, computerId: c.computerId })).profileId;
      const host = hostFor(ctx, c.computerId);
      if (!host?.chromeData) { record(ctx, c, "partial", { workspaceId, profileId, attempts, bytes: 0, error: "This computer's server cannot hand over its Chrome profile yet. The agent signs in again once." }); return "partial"; }
      const data = await host.chromeData(c.computerId);
      // The computer answered that it has no Chrome folder. One that was never started has none to give, and moves with nothing to import. One that has run does have one, so "not found" means the
      // sign-ins were not handed over: that is said (partial, with the reason), never recorded as a move that carried them.
      if (data === null && c.lastActiveAt !== undefined) {
        record(ctx, c, "partial", { workspaceId, profileId, attempts, bytes: 0, error: "This computer's Chrome profile was not found, so its sign-ins did not move. The agent signs in again once." });
        ctx.log.warn("computers: the old computer had no Chrome profile to hand over", { computerId: c.computerId, agentId: c.agentId });
        return "partial";
      }
      const bytes = data ? (await p.importChromeData(ctx, { agentId: c.agentId, profileId, data })).bytes : 0;
      record(ctx, c, "done", { workspaceId, profileId, attempts, bytes, error: null });
      ctx.log.warn("computers: moved to a workspace and a browser profile", { computerId: c.computerId, agentId: c.agentId, chromeBytes: bytes });
      return "done";
    } catch (e) {
      const final = attempts >= MAX_ATTEMPTS;
      record(ctx, c, "failed", { workspaceId, profileId, attempts, bytes: null, error: say(e) });
      ctx.log.warn("computers: the move to a workspace and a browser profile failed", { computerId: c.computerId, attempts, final, reason: say(e) });
      return final ? "failed" : "retry";
    }
  })().finally(() => { moving.delete(c.computerId); });
  moving.set(c.computerId, run);
  return run;
}

/** Move every asleep computer that has not moved. Returns what happened; a computer that is awake is `waiting`. Never throws: one computer's failure is its own row. */
export async function migrateComputers(ctx: CompCtx): Promise<MigrationResult> {
  const out: MigrationResult = { done: 0, partial: 0, failed: 0, waiting: 0 };
  const p = boundPorts();
  if (!p) return out;
  const todo = rowsOf(ctx.db, "SELECT * FROM computers_computers WHERE computer_id NOT IN (SELECT computer_id FROM computers_migration WHERE state IN ('done', 'partial') OR attempts >= ?) ORDER BY agent_id", MAX_ATTEMPTS).map(computerOf);
  for (const c of todo) {
    if (c.state !== "asleep") { out.waiting++; continue; }
    const r = await moveOne(ctx, p, c);
    if (r === "done" || r === "partial" || r === "failed") out[r]++;
  }
  return out;
}

/**
 * Has this agent's old desktop moved to its workspace and its Space browser profile (or has it none)? An agent's browser calls go to the Space browser only once this is true. The move copies the old Chrome's
 * folder into the profile and replaces what the profile holds, so a profile that was already in use would lose what was signed in since: the move has to come first. Asked at an agent's first browser call:
 *   - a move in flight is waited for;
 *   - a desktop that is asleep is moved now, not at the next pass of the idle job;
 *   - a desktop that is awake cannot be copied safely (Chrome's cookie files are SQLite and a copy taken while it runs can be torn): false, and the call stays on that desktop, where the sign-ins are,
 *     until the idle job has put it to sleep and moved it;
 *   - a process where the move is not bound at all (it never runs) does not hold the browser back.
 */
export async function settleMove(ctx: CompCtx, agentId: string): Promise<boolean> {
  const p = boundPorts();
  if (!p) return true;
  for (const c of rowsOf(ctx.db, "SELECT * FROM computers_computers WHERE agent_id = ?", agentId).map(computerOf)) {
    if (settled(ctx, c.computerId)) continue;
    const flying = moving.get(c.computerId);
    if (flying) await flying;
    else if (c.state === "asleep") await moveOne(ctx, p, c);
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
