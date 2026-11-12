// The Space browser on the host's budget (capacity.ts): a profile's browser holds back a little memory while it runs and is not started when the host has none to give. The module asks before a call that
// would start one (claimRoom is the same ask twice), says the plain line when there is no room, and drops a claim when the browser stopped by itself after idle (browserd tells us in its profile list).
// A waiting profile is started by the starter when something stops (drainWaiting). The claims are read from the table, not from memory, so a claim left from before a restart of the daemon is dropped too;
// the periodic pass (impl.ts, computers.browser_room) does this every half minute, so a waiting profile starts when room opens without waiting for some other browser call.
import { claimRoom, drainWaiting, releaseRoom, bindStarter } from "../capacity.ts";
import { raise, rowsOf } from "../projections.ts";
import type { CompCtx } from "../projections.ts";
import { spaceBrowser } from "./port.ts";
import type { ProfileRow, SpaceBrowser } from "./port.ts";
import { syncHolds } from "./hold.ts";

const RECONCILE_MS = 20_000;
/** A claim this young may belong to a browser that is still starting: it is not taken for a stopped one. */
const START_GRACE_MS = 90_000;
let lastReconcile = 0;

/** Claims of browsers that are not running any more are released, and whatever was waiting for room gets its turn. Looks at the service at most every 20 seconds unless `force` (the periodic pass). */
export async function reconcileClaims(ctx: CompCtx, sb: SpaceBrowser, o: { force?: boolean } = {}): Promise<void> {
  const at = ctx.now();
  if (!o.force && at - lastReconcile < RECONCILE_MS) return;
  const claims = rowsOf(ctx.db, "SELECT claim_key, since FROM computers_claim WHERE kind = 'browser' AND state = 'running'");
  const waiting = rowsOf(ctx.db, "SELECT 1 FROM computers_claim WHERE state = 'waiting' LIMIT 1").length > 0;
  const holds = rowsOf(ctx.db, "SELECT 1 FROM computers_browser_hold LIMIT 1").length > 0;
  // a browser that runs holds a claim, so a takeover browserd kept on its own (it missed a give back) is seen here too
  if (claims.length === 0 && !waiting && !holds) return;
  lastReconcile = at;
  let running: Set<string>;
  let rows: ProfileRow[];
  const readAt = Date.now();
  try { rows = (await sb.profiles()).profiles; running = new Set(rows.filter((p) => p.running).map((p) => p.profileId)); } catch { return; }
  await syncHolds(ctx, sb, rows, readAt);
  for (const r of claims) {
    const key = String(r["claim_key"]);
    if (!running.has(key) && at - Number(r["since"]) >= START_GRACE_MS) releaseRoom(ctx, key);
  }
  if (waiting) await drainWaiting(ctx).catch(() => []);
}

/** Profiles with a call of this daemon on its way to the browser service (from its claim to its answer): never closed to make room, though browserd does not see them busy yet (scale test, 12 Nov). */
const inFlight = new Map<string, number>();
export function callStarted(profileId: string): void { inFlight.set(profileId, (inFlight.get(profileId) ?? 0) + 1); }
export function callEnded(profileId: string): void { const n = (inFlight.get(profileId) ?? 1) - 1; if (n > 0) inFlight.set(profileId, n); else inFlight.delete(profileId); }

// One make-room at a time in this process, first come first served: the call at the head of the line looks for room, closes one browser if one may be closed, or waits for one to free up; the others queue
// behind it. Each call waits at most ROOM_WAIT_MS in all (queue and look), then fails with the plain line; a Docker call that hangs is cut off after DOCKER_MS, so one stuck call never stalls the daemon.
let roomTurn: Promise<unknown> = Promise.resolve();
let queued = 0;
// long enough for a browser in use to finish its turn and pass its 90 s of grace, and for the one ahead in line to be served
let ROOM_WAIT_MS = 300_000;
/** Tests: a shorter wait for room (default 5 minutes). */
export function setRoomWaitMs(ms: number | null): void { ROOM_WAIT_MS = ms ?? 300_000; }
/** A browser that took a step this recently is not closed to make room: an agent between two steps of its turn keeps its page, form input and refs (fourth look, 12 Nov). */
export const RECENT_STEP_MS = 90_000;
const DOCKER_MS = 15_000;
const LOOK_EVERY_MS = 2_000;
export const FULL_LINE = "Every browser on this server is in use. Yours opens as soon as one is free.";
/** The line the next step of an agent whose browser was closed to make room gives (its pages were reloaded: refs from before are gone). */
export const REOPENED_LINE = "Your browser was reopened and its pages reloaded. Take a new snapshot before you click.";

/**
 * The turns in progress of each agent, from the engine's turn events (computers.browser_turns): an agent mid-turn keeps its browser however long it thinks between steps. Read from the events and not
 * from agents.status, which answers only for agents the caller may see (an Assistant is its person's alone), so a Space could never close another person's Assistant's quiet browser. A turn heard from
 * for TURN_STALE_MS (one parked on a person's answer, or whose end was lost) no longer holds the browser.
 */
const turns = new Map<string, Map<string, number>>();
export const TURN_STALE_MS = 30 * 60_000;
export function turnStarted(space: string, agentId: string, turnId: string, at: number): void {
  const k = `${space}|${agentId}`;
  const m = turns.get(k) ?? new Map<string, number>();
  m.set(turnId, at);
  turns.set(k, m);
}
export function turnEnded(space: string, agentId: string, turnId: string): void {
  const k = `${space}|${agentId}`;
  const m = turns.get(k);
  if (!m) return;
  m.delete(turnId);
  if (m.size === 0) turns.delete(k);
}
/** Has this agent a turn in progress now? */
export function inTurn(space: string, agentId: string, now: number): boolean {
  const m = turns.get(`${space}|${agentId}`);
  if (!m) return false;
  for (const [id, at] of m) { if (now - at < TURN_STALE_MS) return true; m.delete(id); }
  return false;
}

const evicted = new Set<string>();
/** Was this profile's browser closed to make room since its last step? Asked once: the answer is forgotten. */
export function takeEvicted(profileId: string): boolean { return evicted.delete(profileId); }
/** How many of this daemon's browser calls are waiting for room now (the Console's line). */
export function waitingForRoom(): number { return queued; }

const within = <T>(ms: number, p: Promise<T>, what: string): Promise<T> => new Promise<T>((ok, fail) => {
  const t = setTimeout(() => fail(new Error(`${what} did not answer in ${Math.round(ms / 1000)} s`)), ms);
  p.then((v) => { clearTimeout(t); ok(v); }, (e: unknown) => { clearTimeout(t); fail(e); });
});

/**
 * Room for this profile's browser (owner, 12 Nov: it has to work for many agents without anything extra; fourth look: and never break work in progress). Two limits apply: the host's memory budget
 * (capacity.ts) and how many browsers the container holds (browserd's own limit, which every Space on a shared container shares and which binds first behind the runner). This module alone decides which
 * browser is closed, and only one of its own Space's: never while its agent has a turn in progress, while a call is on its way, while a send waits for approval, while anyone watches or has the controls,
 * nor within RECENT_STEP_MS of its last step; the least recently used of the rest goes. When none may be closed, the call waits its turn and gets the first room that frees up, or the plain line.
 * `force`: the browser service said it is full although this profile holds a claim (another Space filled it): look again.
 */
export async function needRoom(ctx: CompCtx, sb: SpaceBrowser, profileId: string, o: { force?: boolean } = {}): Promise<void> {
  await reconcileClaims(ctx, sb);
  // a claim that is already running is the same ask and needs no turn
  const prior = rowsOf(ctx.db, "SELECT state FROM computers_claim WHERE claim_key = ?", profileId)[0];
  if (!o.force && prior && String(prior["state"]) === "running") return;
  const deadline = Date.now() + ROOM_WAIT_MS;
  queued += 1;
  try {
    const turn = roomTurn.then(() => admit(ctx, sb, profileId, deadline));
    roomTurn = turn.catch(() => undefined);
    // the look itself stops at the deadline with its own line; this bound is for a turn that never comes (a call ahead that hung)
    await within(Math.max(1, deadline - Date.now()) + DOCKER_MS, turn, "room");
  } catch (e) {
    // the host's memory is held by other work (no browser of this Space runs to make room from): the host's own waiting line; otherwise every browser is in use
    const line = e instanceof RoomError && e.line ? e.line : FULL_LINE;
    raise(ctx, "provider.unavailable", line, { waiting: true, reason: "browser_full" });
  } finally { queued -= 1; }
}

class RoomError extends Error { readonly line: string | undefined; constructor(line: string | undefined) { super(FULL_LINE); this.line = line; } }

async function admit(ctx: CompCtx, sb: SpaceBrowser, profileId: string, deadline: number): Promise<void> {
  let line: string | undefined;
  while (Date.now() < deadline) {
    let rows: ProfileRow[] = [];
    let limit = Infinity;
    try { const got = await within(DOCKER_MS, sb.profiles(), "the browser service"); rows = got.profiles; if (got.maxRunning > 0) limit = got.maxRunning; } catch { /* unknown: the budget alone decides this look */ }
    const others = rows.filter((r) => r.running && r.profileId !== profileId).length;
    const mineRuns = rows.some((r) => r.running && r.profileId === profileId);
    const got = await claimRoom(ctx, { kind: "browser", key: profileId });
    if (got.state === "running" && (mineRuns || others < limit)) return;
    // no room in the budget or in the container: the claim does not stand while this one does not run
    if (got.state === "running") releaseRoom(ctx, profileId);
    const oursRun = rows.some((r) => r.running && r.profileId !== profileId && (r.spaceId === undefined || r.spaceId === ctx.space));
    line = got.state === "waiting" && !oursRun && others < limit ? got.line : FULL_LINE;
    const pick = closable(ctx, rows, profileId);
    if (pick) {
      ctx.log.info("sbrowser: closed the least recently used quiet browser to make room", { closed: pick, for: profileId });
      try { await within(DOCKER_MS, sb.stop(pick), "the browser service"); } catch { /* looked at again */ }
      releaseRoom(ctx, pick);
      evicted.add(pick);
      continue;
    }
    await new Promise((r) => setTimeout(r, Math.min(LOOK_EVERY_MS, Math.max(0, deadline - Date.now()))));
  }
  throw new RoomError(line);
}

/** The one of this Space's browsers that may be closed to make room now, least recently used first, or null. */
function closable(ctx: CompCtx, rows: readonly ProfileRow[], profileId: string): string | null {
  const held = new Set(rowsOf(ctx.db, "SELECT profile_id FROM computers_browser_hold").map((r) => String(r["profile_id"])));
  // this Space's own browsers (another Space's are never closed by this one: each closes only its own, and waits when all of its own are in use)
  const ours = new Set(rowsOf(ctx.db, "SELECT claim_key FROM computers_claim WHERE kind = 'browser' AND state = 'running'").map((r) => String(r["claim_key"])));
  const now = Date.now();
  const quiet = rows.filter((r) => r.running && ours.has(r.profileId) && (r.spaceId === undefined || r.spaceId === ctx.space) && r.profileId !== profileId && !inFlight.has(r.profileId)
    && !r.busy && !r.takeover && r.viewers === 0 && r.held === 0 && !held.has(r.profileId) && now - r.lastActiveAt >= RECENT_STEP_MS).sort((a, b) => a.lastActiveAt - b.lastActiveAt);
  // a turn in progress keeps its browser, however long it has been thinking between steps
  return quiet.find((r) => !inTurn(ctx.space, r.profileId, ctx.now()))?.profileId ?? null;
}

/** A profile that waited and now has room is opened: a tab list starts its browser, and nothing else of the agent's turn is guessed. */
bindStarter("browser", async (_ctx, key) => {
  const sb = spaceBrowser();
  if (!sb) return;
  await sb.tool({ profileId: key, tool: "chrome_tabs", args: { action: "list" }, timeoutMs: 30_000 });
});

/** Tests: forget what was claimed. */
export function resetRoom(): void { lastReconcile = 0; evicted.clear(); turns.clear(); roomTurn = Promise.resolve(); }
