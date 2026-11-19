// Warm before asked (lane r42-computer, slice 2). An agent's first browser call of a turn used to pay for the browser's start (Chromium and its first page: 755 ms to 1.5 s on box C). When a turn starts for an
// agent that has browsed before, its profile's browser is started in the background, so the first call finds it up.
//
// A warm start is a courtesy and never takes anything from anyone:
// - only a profile that already holds Chrome data (the agent has browsed before); an agent that never browsed is not given a browser it may not use;
// - only when there is room without closing anything: the host's budget (capacity.ts) and the service's own limit are asked, and a no ends it quietly (a real call asks for room itself, and may close a quiet browser);
// - never while a person holds the controls, never twice at once for one profile, and not again within WARM_EVERY_MS;
// - it never raises: a warm that fails leaves nothing behind (the claim it made is dropped) and the real call starts the browser as it always did.
import { claimRoom, releaseRoom } from "../capacity.ts";
import { rowsOf } from "../projections.ts";
import type { CompCtx } from "../projections.ts";
import { agentInfo } from "./agentinfo.ts";
import { heldBy } from "./hold.ts";
import { profileIdOf } from "./policy.ts";
import { spaceBrowser } from "./port.ts";

/** A profile warmed this recently is not warmed again (a turn that follows another within seconds). */
export const WARM_EVERY_MS = 15_000;
/** A warm that has not finished by now is given up on (the real call, if it comes, starts the browser itself). */
export const WARM_MS = 20_000;

const inFlight = new Set<string>();
const lastAt = new Map<string, number>();

export type Warmed =
  | "warmed"
  | "no_service"
  | "bad_profile"
  | "never_browsed"
  | "running"
  | "held"
  | "busy"
  | "recent"
  | "no_room"
  | "failed";

const within = <T>(ms: number, p: Promise<T>): Promise<T> =>
  new Promise<T>((ok, fail) => {
    const t = setTimeout(() => fail(new Error("warm timed out")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        ok(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        fail(e);
      },
    );
  });

/** Start the browser of this agent's profile in the background if that is free and useful. Resolves to what it did; never rejects. */
export async function warmBrowser(ctx: CompCtx, agentId: string, profileId?: string): Promise<Warmed> {
  try {
    return await warmNow(ctx, agentId, profileId);
  } catch (e) {
    ctx.log.info("sbrowser: warm failed", { reason: e instanceof Error ? e.message.slice(0, 160) : "unknown" });
    return "failed";
  }
}

async function warmNow(ctx: CompCtx, agentId: string, profileId?: string): Promise<Warmed> {
  const sb = spaceBrowser();
  if (!sb || !sb.warm) return "no_service";
  const pid = profileId ?? profileIdOf(agentId);
  if (!pid) return "bad_profile";
  if (inFlight.has(pid)) return "busy";
  const at = ctx.now();
  if (heldBy(ctx, pid) !== null) return "held";
  inFlight.add(pid);
  // a claim this call made, to be dropped when the warm does not end in a running browser (one that was already there is the real call's and stays)
  const had = String(rowsOf(ctx.db, "SELECT state FROM computers_claim WHERE claim_key = ?", pid)[0]?.["state"] ?? "");
  try {
    // a call of its own already waits for room under this key: it is first in line, and not touched
    if (had === "waiting") return "no_room";
    if (!(await sb.profileUsed(pid).catch(() => false))) return "never_browsed";
    const got = await within(WARM_MS, sb.profiles()).catch(() => null);
    if (!got) return "failed";
    const mine = got.profiles.find((r) => r.profileId === pid);
    if (mine?.running) return "running";
    // not running: one that was warmed seconds ago and has gone again is not started over and over
    const last = lastAt.get(pid);
    if (last !== undefined && at - last < WARM_EVERY_MS) return "recent";
    if (mine?.takeover) return "held";
    // room without closing anything: the service's own limit, then the host's budget
    const others = got.profiles.filter((r) => r.running && r.profileId !== pid).length;
    if (got.maxRunning > 0 && others >= got.maxRunning) return "no_room";
    const claim = await claimRoom(ctx, { kind: "browser", key: pid });
    if (claim.state !== "running") {
      releaseRoom(ctx, pid);
      return "no_room";
    }
    lastAt.set(pid, at);
    const who = await agentInfo(ctx, agentId).catch(() => null);
    try {
      await within(WARM_MS, sb.warm({ profileId: pid, space: ctx.space, ...(who ? { agentName: who.name } : {}) }));
    } catch (e) {
      if (had !== "running") releaseRoom(ctx, pid);
      ctx.log.info("sbrowser: warm failed", { reason: e instanceof Error ? e.message.slice(0, 160) : "unknown" });
      return "failed";
    }
    return "warmed";
  } finally {
    inFlight.delete(pid);
  }
}

/** What a person's ask is told: the browser is starting or was started, it was already up, or nothing was started and nothing is owed. */
export const warmAnswer = (w: Warmed): "warming" | "up" | "skipped" =>
  w === "warmed" || w === "busy" ? "warming" : w === "running" ? "up" : "skipped";

/** Tests: forget what was warmed. */
export function resetWarm(): void {
  inFlight.clear();
  lastAt.clear();
}
