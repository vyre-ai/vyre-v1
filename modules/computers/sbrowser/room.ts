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

// One make-room at a time in this process: two browsers that need room at once never close the same quiet one and then both fail to fit.
let roomTurn: Promise<unknown> = Promise.resolve();

/**
 * Room for this profile's browser (owner, 12 Nov: it has to work for many agents without anything extra). The host's memory budget decides (capacity.ts: a browser holds back 256 MB). When it is full, the
 * least recently used QUIET browser (no step in flight, nobody watching, nobody at the controls, nothing held for a person, not this one) is closed at once, its room released, and this one starts; it opens
 * again with its tabs and sign-ins at its own next step. Only when every running browser is in use does this one wait, with the plain line.
 */
export async function needRoom(ctx: CompCtx, sb: SpaceBrowser, profileId: string): Promise<void> {
  await reconcileClaims(ctx, sb);
  // a claim that is already running is the same ask and needs no turn; any other claim takes its turn: the budget check reads what is held and then writes, with awaits between, so two claims at
  // once would both fit in the last place (scale test, 12 Nov: 23 browsers on a budget of 20)
  const prior = rowsOf(ctx.db, "SELECT state FROM computers_claim WHERE claim_key = ?", profileId)[0];
  if (prior && String(prior["state"]) === "running") return;
  const turn = roomTurn.then(() => makeRoomFor(ctx, sb, profileId));
  roomTurn = turn.catch(() => undefined);
  const got = await turn;
  if (got.state === "running") return;
  raise(ctx, "provider.unavailable", got.line ?? "Waiting for room on the Space server.", { waiting: true });
}

async function makeRoomFor(ctx: CompCtx, sb: SpaceBrowser, profileId: string): Promise<{ state: "running" | "waiting"; line?: string }> {
  for (let tries = 0; tries < 4; tries++) {
    const again = await claimRoom(ctx, { kind: "browser", key: profileId });
    if (again.state === "running") return again;
    let rows: ProfileRow[];
    try { rows = (await sb.profiles()).profiles; } catch { return again; }
    const held = new Set(rowsOf(ctx.db, "SELECT profile_id FROM computers_browser_hold").map((r) => String(r["profile_id"])));
    // this Space's own browsers: they are what its budget counts (another Space's on a shared container are made room for by browserd's own limit, which both share)
    const ours = new Set(rowsOf(ctx.db, "SELECT claim_key FROM computers_claim WHERE kind = 'browser' AND state = 'running'").map((r) => String(r["claim_key"])));
    const quiet = rows.filter((r) => r.running && ours.has(r.profileId) && r.profileId !== profileId && !inFlight.has(r.profileId) && !r.busy && !r.takeover && r.viewers === 0 && r.held === 0 && !held.has(r.profileId)).sort((a, b) => a.lastActiveAt - b.lastActiveAt);
    const pick = quiet[0];
    if (!pick) return again;
    ctx.log.info("sbrowser: closed the least recently used quiet browser to make room", { closed: pick.profileId, for: profileId });
    try { await sb.stop(pick.profileId); } catch { return again; }
    releaseRoom(ctx, pick.profileId);
  }
  return claimRoom(ctx, { kind: "browser", key: profileId });
}

/** A profile that waited and now has room is opened: a tab list starts its browser, and nothing else of the agent's turn is guessed. */
bindStarter("browser", async (_ctx, key) => {
  const sb = spaceBrowser();
  if (!sb) return;
  await sb.tool({ profileId: key, tool: "chrome_tabs", args: { action: "list" }, timeoutMs: 30_000 });
});

/** Tests: forget what was claimed. */
export function resetRoom(): void { lastReconcile = 0; }
