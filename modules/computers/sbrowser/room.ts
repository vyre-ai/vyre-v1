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
/** A browser call by an agent is also the surest sign its turn is still working: it refreshes the turn's protection (fifth look), or, when no turn of it is known, makes its state unknown. */
export function callStarted(profileId: string, space?: string, at?: number): void {
  inFlight.set(profileId, (inFlight.get(profileId) ?? 0) + 1);
  if (space !== undefined && at !== undefined) agentActive(space, profileId, at);
}
export function callEnded(profileId: string): void { const n = (inFlight.get(profileId) ?? 1) - 1; if (n > 0) inFlight.set(profileId, n); else inFlight.delete(profileId); }

// One make-room at a time in this process, first come first served: the call at the head of the line looks for room, closes one browser if one may be closed, or waits for one to free up; the others queue
// behind it. Each call waits at most ROOM_WAIT_MS in all (queue and look), then fails with the plain line; a Docker call that hangs is cut off after DOCKER_MS, so one stuck call never stalls the daemon.
let roomTurn: Promise<unknown> = Promise.resolve();
const line: string[] = [];
let ROOM_WAIT_MS = 300_000;
/** Tests: a shorter wait for room (default 5 minutes). */
export function setRoomWaitMs(ms: number | null): void { ROOM_WAIT_MS = ms ?? 300_000; }
/**
 * How long after its last step a browser is kept although nothing else holds it (lead, 12 Nov, after the fourth look). With the agent's turn state known, the turn is the protection, and the grace only
 * covers the gap between a turn's last tool call and its end event, and a person who has just stopped watching: SHORT_GRACE_MS. When the turn state is not known (this daemon just started, or the agent is
 * calling with no turn of it heard of: the engine's events are behind), UNKNOWN_GRACE_MS.
 */
export const SHORT_GRACE_MS = 10_000;
export const UNKNOWN_GRACE_MS = 90_000;
/** A call waiting this long says so, with its place in line, in the browser's row (so nobody thinks it is stuck). */
let SAY_WAIT_MS = 10_000;
/** Tests: say the wait sooner (default 10 s). */
export function setSayWaitMs(ms: number | null): void { SAY_WAIT_MS = ms ?? 10_000; }
const DOCKER_MS = 15_000;
const LOOK_EVERY_MS = 2_000;
export const FULL_LINE = "Every browser on this server is in use. Yours opens as soon as one is free.";
/** The line every answer after a reopen carries once, and the refusal of an act on stale refs (browserd gives the same line). */
export const REOPENED_LINE = "Your browser was reopened and its pages reloaded. Take a new snapshot before you click.";
export const waitLineOf = (ahead: number): string => `Waiting for a free browser on this server. ${ahead === 0 ? "Next in line." : `${ahead} ahead.`}`;

/**
 * Agents' turns, from the engine's turn events (computers.browser_turns) and from the agent's own browser calls. A turn in progress keeps its browser however long it thinks between steps. Read from the
 * events and not from agents.status, which answers only for agents the caller may see (an Assistant is its person's alone). Fifth look:
 * - a turn's protection is refreshed by every browser call of its agent and by the engine's turn.block events, so a long turn that is still working never goes stale (TURN_STALE_MS counts from the last
 *   sign of life, not from the start);
 * - turn.waiting ends the protection (a turn parked on a person: a send held for approval is protected by the held send itself; the turn's continuation starts again with turn.started);
 * - an agent whose state is not known (nothing heard since this daemon started, or a call with no turn of it heard of) gets UNKNOWN_GRACE_MS, never the short grace. After a daemon restart the map is
 *   empty, so every browser is "unknown" until its agent's next turn event: kept for 90 s after its last step, as before turns were tracked.
 */
interface AgentTurns { turns: Map<string, number>; known: boolean }
const agents = new Map<string, AgentTurns>();
const turnOwner = new Map<string, string>();
export const TURN_STALE_MS = 30 * 60_000;
const keyOf = (space: string, agentId: string): string => `${space}|${agentId}`;
const entry = (k: string): AgentTurns => { let a = agents.get(k); if (!a) { a = { turns: new Map(), known: false }; agents.set(k, a); } return a; };
export function turnStarted(space: string, agentId: string, turnId: string, at: number): void {
  const k = keyOf(space, agentId);
  const a = entry(k);
  a.turns.set(turnId, at);
  a.known = true;
  turnOwner.set(turnId, k);
}
export function turnEnded(space: string, agentId: string, turnId: string): void {
  const k = turnOwner.get(turnId) ?? (agentId ? keyOf(space, agentId) : undefined);
  if (!k) return;
  const a = entry(k);
  a.turns.delete(turnId);
  a.known = true;
  turnOwner.delete(turnId);
}
/** The engine persisted part of a running turn (turn.block): it is alive. */
export function turnActive(turnId: string, at: number): void {
  const k = turnOwner.get(turnId);
  const a = k ? agents.get(k) : undefined;
  if (a?.turns.has(turnId)) a.turns.set(turnId, at);
}
function agentActive(space: string, agentId: string, at: number): void {
  const a = entry(keyOf(space, agentId));
  if (a.turns.size > 0) { for (const id of a.turns.keys()) a.turns.set(id, at); return; }
  // a call with no turn of it heard of: the engine's events are behind (or this daemon just started); not known until they arrive
  a.known = false;
}
/** "turn": a turn in progress; "idle": known to have none; "unknown". */
export function turnState(space: string, agentId: string, now: number): "turn" | "idle" | "unknown" {
  const a = agents.get(keyOf(space, agentId));
  if (!a) return "unknown";
  for (const [id, at] of a.turns) { if (now - at < TURN_STALE_MS) return "turn"; a.turns.delete(id); turnOwner.delete(id); }
  return a.known ? "idle" : "unknown";
}
/** Has this agent a turn in progress now? */
export const inTurn = (space: string, agentId: string, now: number): boolean => turnState(space, agentId, now) === "turn";

/**
 * Which start of each profile's browser this daemon last heard from, and which start its last snapshot was taken under (browserd's `browserStart` on every answer). A browser closed to make room, or
 * stopped by browserd when idle, starts again with its pages reloaded: the next answer to the agent says so once (REOPENED_LINE), and an act on refs from a snapshot taken under an older start is
 * refused by browserd, every time, until a new snapshot (fifth look).
 */
const seenStart = new Map<string, string>();
const snapStart = new Map<string, string>();
/** An answer came from this start: true when it is a different start than the last answer's (the browser was reopened since). */
export function answerFrom(profileId: string, start: string): boolean {
  if (!start) return false;
  const prev = seenStart.get(profileId);
  seenStart.set(profileId, start);
  return prev !== undefined && prev !== start;
}
export function snapshotFrom(profileId: string, start: string): void { if (start) snapStart.set(profileId, start); }
/** The start the refs of this profile's last snapshot belong to, or undefined (no snapshot seen by this daemon). */
export const refsStart = (profileId: string): string | undefined => snapStart.get(profileId);

/** How many of this daemon's browser calls are waiting for room now (the Console's line). */
export function waitingForRoom(): number { return line.length; }
/** The line a profile waiting for room for more than SAY_WAIT_MS shows in its row, with how many are ahead of it, or null. */
const waitStarted = new Map<string, number>();
export function roomWaitLine(profileId: string): string | null {
  const at = waitStarted.get(profileId);
  const ahead = line.indexOf(profileId);
  if (at === undefined || ahead < 0 || Date.now() - at < SAY_WAIT_MS) return null;
  return waitLineOf(ahead);
}
/** The profiles waiting for room now, in line. */
export const waitingProfiles = (): readonly string[] => [...line];

const within = <T>(ms: number, p: Promise<T>, what: string): Promise<T> => new Promise<T>((ok, fail) => {
  const t = setTimeout(() => fail(new Error(`${what} did not answer in ${Math.round(ms / 1000)} s`)), ms);
  p.then((v) => { clearTimeout(t); ok(v); }, (e: unknown) => { clearTimeout(t); fail(e); });
});

/**
 * Room for this profile's browser (owner, 12 Nov: it has to work for many agents without anything extra; fourth look: and never break work in progress). Two limits apply: the host's memory budget
 * (capacity.ts) and how many browsers the container holds (browserd's own limit, which every Space on a shared container shares and which binds first behind the runner). This module alone decides which
 * of its own Space's browsers is closed (closable); when none may be and the container is full of another Space's quiet browsers, browserd is asked to close the least recently used of those that has been
 * quiet for UNKNOWN_GRACE_MS (it cannot see that Space's turns, so the longer grace). When nothing may be closed the call waits its turn and gets the first room that frees up, or the plain line.
 * `force`: the browser service said it is full although this profile holds a claim (another Space filled it): look again.
 */
export async function needRoom(ctx: CompCtx, sb: SpaceBrowser, profileId: string, o: { force?: boolean } = {}): Promise<void> {
  // a claim that is already running is the same ask and needs no turn (read again after the reconcile, which may have released it)
  const running = (): boolean => String(rowsOf(ctx.db, "SELECT state FROM computers_claim WHERE claim_key = ?", profileId)[0]?.["state"] ?? "") === "running";
  if (!o.force && running()) { await reconcileClaims(ctx, sb); if (running()) return; }
  // in line from the moment it asks: first come, first served
  const deadline = Date.now() + ROOM_WAIT_MS;
  line.push(profileId);
  if (!waitStarted.has(profileId)) waitStarted.set(profileId, Date.now());
  try {
    await reconcileClaims(ctx, sb);
    const turn = roomTurn.then(() => admit(ctx, sb, profileId, deadline));
    roomTurn = turn.catch(() => undefined);
    // the look itself stops at the deadline with its own line; this bound is for a turn that never comes (a call ahead that hung)
    await within(Math.max(1, deadline - Date.now()) + DOCKER_MS, turn, "room");
  } catch (e) {
    // the host's memory is held by other work (no browser of this Space runs to make room from): the host's own waiting line; otherwise every browser is in use
    const said = e instanceof RoomError && e.line ? e.line : FULL_LINE;
    raise(ctx, "provider.unavailable", said, { waiting: true, reason: "browser_full" });
  } finally {
    const at = line.indexOf(profileId);
    if (at >= 0) line.splice(at, 1);
    if (!line.includes(profileId)) waitStarted.delete(profileId);
  }
}

class RoomError extends Error { readonly line: string | undefined; constructor(said: string | undefined) { super(FULL_LINE); this.line = said; } }

async function admit(ctx: CompCtx, sb: SpaceBrowser, profileId: string, deadline: number): Promise<void> {
  let said: string | undefined;
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
    said = got.state === "waiting" && !oursRun && others < limit ? got.line : FULL_LINE;
    const pick = closable(ctx, rows, profileId);
    if (pick) {
      ctx.log.info("sbrowser: closed the least recently used quiet browser to make room", { closed: pick, for: profileId });
      try { await within(DOCKER_MS, sb.stop(pick), "the browser service"); } catch { /* looked at again */ }
      releaseRoom(ctx, pick);
      continue;
    }
    // the container (not this Space's budget) is what is full, and of another Space's browsers: browserd closes the longest quiet of those, by the unknown-turn rule
    if (others >= limit && sb.closeOther && rows.some((r) => r.running && r.spaceId !== undefined && r.spaceId !== ctx.space)) {
      let closed: string | null = null;
      try { closed = await within(DOCKER_MS, sb.closeOther(ctx.space, UNKNOWN_GRACE_MS), "the browser service"); } catch { /* looked at again */ }
      if (closed) { ctx.log.info("sbrowser: another Space's quiet browser was closed to make room", { for: profileId }); continue; }
    }
    await new Promise((r) => setTimeout(r, Math.min(LOOK_EVERY_MS, Math.max(0, deadline - Date.now()))));
  }
  throw new RoomError(said);
}

/**
 * The one of this Space's browsers that may be closed to make room now, least recently used first, or null. Never one whose agent has a turn in progress, with a call on its way, with a send held for
 * approval, with anyone watching or at the controls; and not within the grace of its last step: SHORT_GRACE_MS when its agent is known to have no turn, UNKNOWN_GRACE_MS when that is not known.
 */
function closable(ctx: CompCtx, rows: readonly ProfileRow[], profileId: string): string | null {
  const held = new Set(rowsOf(ctx.db, "SELECT profile_id FROM computers_browser_hold").map((r) => String(r["profile_id"])));
  // this Space's own browsers (another Space's are never closed by this module: browserd is asked, by the longer rule, only when the container is what is full)
  const ours = new Set(rowsOf(ctx.db, "SELECT claim_key FROM computers_claim WHERE kind = 'browser' AND state = 'running'").map((r) => String(r["claim_key"])));
  const now = Date.now();
  const quiet = rows.filter((r) => r.running && ours.has(r.profileId) && (r.spaceId === undefined || r.spaceId === ctx.space) && r.profileId !== profileId && !inFlight.has(r.profileId)
    && !r.busy && !r.takeover && r.viewers === 0 && r.held === 0 && !held.has(r.profileId)).sort((a, b) => a.lastActiveAt - b.lastActiveAt);
  for (const r of quiet) {
    const st = turnState(ctx.space, r.profileId, ctx.now());
    if (st === "turn") continue;
    if (now - r.lastActiveAt < (st === "idle" ? SHORT_GRACE_MS : UNKNOWN_GRACE_MS)) continue;
    return r.profileId;
  }
  return null;
}

/** A profile that waited and now has room is opened: a tab list starts its browser, and nothing else of the agent's turn is guessed. */
bindStarter("browser", async (_ctx, key) => {
  const sb = spaceBrowser();
  if (!sb) return;
  await sb.tool({ profileId: key, tool: "chrome_tabs", args: { action: "list" }, timeoutMs: 30_000 });
});

/** Tests: forget what was claimed. */
export function resetRoom(): void { lastReconcile = 0; seenStart.clear(); snapStart.clear(); agents.clear(); turnOwner.clear(); line.length = 0; waitStarted.clear(); roomTurn = Promise.resolve(); }
