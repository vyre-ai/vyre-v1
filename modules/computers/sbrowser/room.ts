// The Space browser on the host's budget (capacity.ts): a profile's browser holds back a little memory while it runs and is not started when the host has none to give. The module asks before a call that
// would start one (claimRoom is the same ask twice), says the plain line when there is no room, and drops a claim when the browser stopped by itself after idle (browserd tells us in its profile list).
// A waiting profile is started by the starter when something stops (drainWaiting). The claims are read from the table, not from memory, so a claim left from before a restart of the daemon is dropped too;
// the periodic pass (impl.ts, computers.browser_room) does this every half minute, so a waiting profile starts when room opens without waiting for some other browser call.
import { claimRoom, drainWaiting, releaseRoom, bindStarter } from "../capacity.ts";
import { raise, rowsOf } from "../projections.ts";
import type { CompCtx } from "../projections.ts";
import { spaceBrowser } from "./port.ts";
import type { SpaceBrowser } from "./port.ts";

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
  if (claims.length === 0 && !waiting) return;
  lastReconcile = at;
  let running: Set<string>;
  try { running = new Set((await sb.profiles()).profiles.filter((p) => p.running).map((p) => p.profileId)); } catch { return; }
  for (const r of claims) {
    const key = String(r["claim_key"]);
    if (!running.has(key) && at - Number(r["since"]) >= START_GRACE_MS) releaseRoom(ctx, key);
  }
  if (waiting) await drainWaiting(ctx).catch(() => []);
}

/** Room for this profile's browser, or the plain line for the agent: "Waiting for room on the Space server...". */
export async function needRoom(ctx: CompCtx, sb: SpaceBrowser, profileId: string): Promise<void> {
  await reconcileClaims(ctx, sb);
  const got = await claimRoom(ctx, { kind: "browser", key: profileId });
  if (got.state === "running") return;
  raise(ctx, "provider.unavailable", got.line ?? "Waiting for room on the Space server.", { waiting: true });
}

/** A profile that waited and now has room is opened: a tab list starts its browser, and nothing else of the agent's turn is guessed. */
bindStarter("browser", async (_ctx, key) => {
  const sb = spaceBrowser();
  if (!sb) return;
  await sb.tool({ profileId: key, tool: "chrome_tabs", args: { action: "list" }, timeoutMs: 30_000 });
});

/** Tests: forget what was claimed. */
export function resetRoom(): void { lastReconcile = 0; }
