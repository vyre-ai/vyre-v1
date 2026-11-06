// The Space browser on the host's budget (capacity.ts): a profile's browser holds back a little memory while it runs and is not started when the host has none to give. The module asks before a call that
// would start one (claimRoom is the same ask twice), says the plain line when there is no room, and drops a claim when the browser stopped by itself after idle (browserd tells us in its profile list).
// A waiting profile is started by the starter when something stops (drainWaiting).
import { claimRoom, drainWaiting, releaseRoom, bindStarter } from "../capacity.ts";
import { raise } from "../projections.ts";
import type { CompCtx } from "../projections.ts";
import { spaceBrowser } from "./port.ts";
import type { SpaceBrowser } from "./port.ts";

const RECONCILE_MS = 20_000;
let lastReconcile = 0;
const claimed = new Set<string>();

/** Claims of browsers that are not running any more are released, and whatever was waiting for room gets its turn. Looks at the service at most every 20 seconds. */
export async function reconcileClaims(ctx: CompCtx, sb: SpaceBrowser): Promise<void> {
  const at = ctx.now();
  if (at - lastReconcile < RECONCILE_MS || claimed.size === 0) return;
  lastReconcile = at;
  let running: Set<string>;
  try { running = new Set((await sb.profiles()).profiles.filter((p) => p.running).map((p) => p.profileId)); } catch { return; }
  let freed = false;
  for (const key of [...claimed]) if (!running.has(key)) { releaseRoom(ctx, key); claimed.delete(key); freed = true; }
  if (freed) await drainWaiting(ctx).catch(() => []);
}

/** Room for this profile's browser, or the plain line for the agent: "Waiting for room on the Space server...". */
export async function needRoom(ctx: CompCtx, sb: SpaceBrowser, profileId: string): Promise<void> {
  await reconcileClaims(ctx, sb);
  const got = await claimRoom(ctx, { kind: "browser", key: profileId });
  if (got.state === "running") { claimed.add(profileId); return; }
  raise(ctx, "provider.unavailable", got.line ?? "Waiting for room on the Space server.", { waiting: true });
}

/** A profile that waited and now has room is opened: a tab list starts its browser, and nothing else of the agent's turn is guessed. */
bindStarter("browser", async (_ctx, key) => {
  const sb = spaceBrowser();
  if (!sb) return;
  claimed.add(key);
  await sb.tool({ profileId: key, tool: "chrome_tabs", args: { action: "list" }, timeoutMs: 30_000 });
});

/** Tests: forget what was claimed. */
export function resetRoom(): void { claimed.clear(); lastReconcile = 0; }
