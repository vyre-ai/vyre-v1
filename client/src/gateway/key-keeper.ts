// The person key for the length of the signed-in session (owner ruling 6 Nov: signed in means unlocked). It is kept in this app's memory and sealed on this device (key-seal.ts), so a relaunch, a new tab,
// a daemon that restarts behind an open app or a Space server that restarts gets the key again by itself, with no prompt. Sign-out and a session that ended drop both. The key only ever goes to this
// computer's own loopback node, or to the Space server the session signed in to over https (local-key.ts keyDoor).
import { holdKeyOnOwnNode, keyDoor, keyStatusOnOwnNode } from "./local-key.ts";
import { indexedDbStore, sealKey, unsealGone, unsealKey } from "./key-seal.ts";
import type { SealStore } from "./key-seal.ts";

let kept: Uint8Array | null = null;
let store: SealStore | null | undefined;
const deviceStore = (): SealStore | null => (store === undefined ? (store = indexedDbStore()) : store);
/** Tests give the device store; undefined puts the browser's back. */
export function useSealStore(s: SealStore | null | undefined): void { store = s; }

/** Keeps a copy of the key for this session, in memory and sealed on this device. The caller still wipes its own. Resolves when the sealed copy is written (or could not be). */
export async function keepKey(key: Uint8Array): Promise<boolean> {
  memoryOnly(key);
  const copy = Uint8Array.from(key);   // the caller wipes its own right after this call returns its promise
  try { return await sealKey(deviceStore(), copy); } finally { copy.fill(0); }
}
function memoryOnly(key: Uint8Array): void { kept?.fill(0); kept = Uint8Array.from(key); }
/** Signing out, or a session that ended: the key leaves memory and the device. */
export function forgetKey(): void { kept?.fill(0); kept = null; void unsealGone(deviceStore()); }
/** The app closed: memory goes, the sealed copy on this device stays for the next launch (the app runs this on its way out; tests use it to stand for a relaunch). */
export function leaveMemory(): void { kept?.fill(0); kept = null; }
export const keyIsKept = (): boolean => kept !== null;
/** After a launch: the sealed key of this device's signed-in session comes back into memory. True when this app holds a key afterwards. */
export async function restoreKey(): Promise<boolean> {
  if (kept) return true;
  const k = await unsealKey(deviceStore());
  if (!k) return false;
  if (!kept) kept = Uint8Array.from(k);
  k.fill(0);
  return true;
}

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
