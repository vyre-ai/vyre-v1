// The person key for the length of one app session, in memory only: never written to disk, a cookie or storage. It is kept after the one password entry at launch so that a daemon that restarts behind
// an open app (a crash, the sidecar restarting) gets the key again by itself, with no prompt. Sign-out and quitting the app drop it. The key only ever goes to this computer's own loopback node.
import { holdKeyOnOwnNode, isLoopbackUrl, keyStatusOnOwnNode } from "./local-key.ts";

let kept: Uint8Array | null = null;

/** Keeps a copy of the key for this session. The caller still wipes its own. */
export function keepKey(key: Uint8Array): void { forgetKey(); kept = Uint8Array.from(key); }
export function forgetKey(): void { kept?.fill(0); kept = null; }
export const keyIsKept = (): boolean => kept !== null;

/** If the daemon lost the key (a restart) and the app still has it, hands it back. True when the daemon holds the key afterwards. Silent: no prompt, no error. */
export async function rehandKey(baseUrl: string, token: string, f?: typeof fetch): Promise<boolean> {
  if (!isLoopbackUrl(baseUrl)) return false;
  if ((await keyStatusOnOwnNode(baseUrl, token, f)) === "held") return true;
  if (!kept) return false;
  try { return await holdKeyOnOwnNode(baseUrl, token, kept, f); } catch { return false; }
}
