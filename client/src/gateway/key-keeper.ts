// The person key for the length of the signed-in session (owner ruling 6 Nov: signed in means unlocked). It is kept in this app's memory and sealed on this device (key-seal.ts), so a relaunch, a new tab,
// a daemon that restarts behind an open app or a Space server that restarts gets the key again by itself, with no prompt. Sign-out and a session that ended drop both. The key only ever goes to this
// computer's own loopback node, or to the Space server the session signed in to over https (local-key.ts keyDoor).
import { holdKeyOnOwnNode, keyDoor, keyStatusOnOwnNode } from "./local-key.ts";
import { indexedDbStore, sealKey, sealRow, unsealGone, unsealKey } from "./key-seal.ts";
import type { SealStore } from "./key-seal.ts";

// One key per signed-in session (rc.23.1). A device signed in to several Spaces holds each account's own key, found by that session's token: a key is only ever handed to the node of the session it
// was opened for, so one Space never receives another account's key, and signing in to one Space never takes another's away.
const kept = new Map<string, Uint8Array>();
let store: SealStore | null | undefined;
const deviceStore = (): SealStore | null => (store === undefined ? (store = indexedDbStore()) : store);
/** Tests give the device store; undefined puts the browser's back. */
export function useSealStore(s: SealStore | null | undefined): void { store = s; }

/** Keeps a copy of the session's key, in memory and sealed on this device. The caller still wipes its own. Resolves when the sealed copy is written (or could not be). */
export async function keepKey(key: Uint8Array, token: string): Promise<boolean> {
  memoryOnly(key, token);
  const copy = Uint8Array.from(key);   // the caller wipes its own right after this call returns its promise
  try { const row = await sealRow(token); return row ? await sealKey(deviceStore(), row, copy) : false; } finally { copy.fill(0); }
}
function memoryOnly(key: Uint8Array, token: string): void { kept.get(token)?.fill(0); kept.set(token, Uint8Array.from(key)); }
/** Signing out, or a session that ended: that session's key leaves memory and the device. With no token, every session's key goes (the last Space on this device signed out). */
export function forgetKey(token?: string): void {
  if (token === undefined) { for (const k of kept.values()) k.fill(0); kept.clear(); void unsealGone(deviceStore()); return; }
  kept.get(token)?.fill(0); kept.delete(token);
  void sealRow(token).then((row) => row ? unsealGone(deviceStore(), row) : undefined);
}
/** The app closed: memory goes, the sealed copies on this device stay for the next launch (the app runs this on its way out; tests use it to stand for a relaunch). */
export function leaveMemory(): void { for (const k of kept.values()) k.fill(0); kept.clear(); }
/** Whether this app holds a key: the session's own when a token is given, any when not. */
export const keyIsKept = (token?: string): boolean => token === undefined ? kept.size > 0 : kept.has(token);
/** After a launch: the sealed key of this session comes back into memory. True when this app holds that session's key afterwards. */
export async function restoreKey(token: string): Promise<boolean> {
  if (kept.has(token)) return true;
  const row = await sealRow(token);
  const k = row ? await unsealKey(deviceStore(), row) : null;
  if (!k) return false;
  if (!kept.has(token)) kept.set(token, Uint8Array.from(k));
  k.fill(0);
  return true;
}

/** If the daemon lost the key (a restart) and the app still has this session's key, hands it back. True when the daemon holds the key afterwards. Silent: no prompt, no error. */
export async function rehandKey(baseUrl: string, token: string, f?: typeof fetch): Promise<boolean> {
  if (keyDoor(baseUrl) === null) return false;
  if ((await keyStatusOnOwnNode(baseUrl, token, f)) === "held") return true;
  const key = kept.get(token);
  if (!key) return false;
  try { return await holdKeyOnOwnNode(baseUrl, token, key, f); } catch { return false; }
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
  const timer = (o.set ?? setInterval)(() => { const t = token(); if (t && kept.has(t)) void rehand(baseUrl, t).catch(() => false); }, o.every ?? KEY_WATCH_MS);
  return () => (o.clear ?? clearInterval)(timer);
}
