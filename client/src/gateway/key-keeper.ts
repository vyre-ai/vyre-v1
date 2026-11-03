// The person key for the length of one app session, in memory only: never written to disk, a cookie or storage. It is kept after the one password entry at launch so that a daemon that restarts behind
// an open app (a crash, the sidecar restarting, a Space server restarting) gets the key again by itself, with no prompt. Sign-out and quitting the app drop it. The key only ever goes to this computer's own
// loopback node, or to the Space server the session signed in to over https (local-key.ts keyDoor).
import { holdKeyOnOwnNode, keyDoor, keyStatusOnOwnNode } from "./local-key.ts";

let kept: Uint8Array | null = null;

/** Keeps a copy of the key for this session. The caller still wipes its own. */
export function keepKey(key: Uint8Array): void { forgetKey(); kept = Uint8Array.from(key); }
export function forgetKey(): void { kept?.fill(0); kept = null; }
export const keyIsKept = (): boolean => kept !== null;

/** If the daemon lost the key (a restart) and the app still has it, hands it back. True when the daemon holds the key afterwards. Silent: no prompt, no error. */
export async function rehandKey(baseUrl: string, token: string, f?: typeof fetch): Promise<boolean> {
  if (keyDoor(baseUrl) === null) return false;
  if ((await keyStatusOnOwnNode(baseUrl, token, f)) === "held") return true;
  if (!kept) return false;
  try { return await holdKeyOnOwnNode(baseUrl, token, kept, f); } catch { return false; }
}

/**
 * Whether a change of the Space link means "hand the key again": the link has just become live (the first time after the session opened, or back after a drop: a restart, a deploy, a sleep)
 * and this Space is reached through a key door. Cheap to say yes: rehandKey asks the server first and sends nothing when it already holds the key.
 */
export const handOnLive = (was: string, now: string, door: boolean): boolean => door && now === "live" && was !== "live";

/** How often an open app asks a Space server whether it still holds the person's key (a server that restarted under an open link, a key swept away). */
export const KEY_WATCH_MS = 30_000;

/**
 * While the app is open and holds the key, a Space server that lost it gets it again within one beat, with no prompt. Does nothing for a device that holds no key (a resumed session after a relaunch:
 * it was never unlocked here) and asks nothing of an address with no key door. Returns the stop function.
 */
export function watchKey(baseUrl: string, token: () => string | null, o: { every?: number; rehand?: typeof rehandKey; set?: typeof setInterval; clear?: typeof clearInterval } = {}): () => void {
  if (keyDoor(baseUrl) === null) return () => undefined;
  const rehand = o.rehand ?? rehandKey;
  const timer = (o.set ?? setInterval)(() => { const t = token(); if (kept && t) void rehand(baseUrl, t).catch(() => false); }, o.every ?? KEY_WATCH_MS);
  return () => (o.clear ?? clearInterval)(timer);
}
