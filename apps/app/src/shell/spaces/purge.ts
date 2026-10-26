// The shell's purge client (ARCH 5.7, golden flow 9). A device that is told to purge (hello_ok in mode purge, a pull that resets to purge, a live purge frame) wipes its replica, and when the wipe
// finished it tells the server with devices.purge_ack: once per device and epoch, retried in the background, never after a failed wipe. The wipe itself is the sync package's; the ack is the
// client package's createPurgeAcker; this file puts them together the way the shell needs them (client/src/store/purge-ack.ts says to).
import { createPurgeAcker } from "../../../../../client/src/store/purge-ack.ts";
import type { PurgeAckOpts } from "../../../../../client/src/store/purge-ack.ts";
import { createPurgeClient } from "../../../../../sync/src/purge/client.ts";
import type { PurgeClient, PurgeClientOpts } from "../../../../../sync/src/purge/client.ts";

export interface ShellPurge {
  /** The client the connection's purge signals go to. */
  client: { onFrame(frame: { t: "purge"; epoch: number }): Promise<unknown> };
  /** Hears the connection's purge signals (an epoch) and returns how to stop. The session builds this over the connection manager's `on.purge`. */
  subscribe(listener: (epoch: number) => void): () => void;
}

export interface ShellPurgeOpts {
  deviceId: string;
  /** One capability call as the signed-in person: devices.purge_ack goes through it. */
  call: (cap: string, input: unknown) => Promise<unknown>;
  /** What a purge deletes (the driver, the open store, documents, keychain, folder and status line). */
  purge: PurgeClientOpts["purge"];
  personActive?: PurgeClientOpts["personActive"];
  currentEpoch?: PurgeClientOpts["currentEpoch"];
  ack?: PurgeAckOpts;
}

/** The purge client with the purge ack wired around every wipe. */
export function shellPurgeClient(o: ShellPurgeOpts): PurgeClient {
  const acker = createPurgeAcker(o.call, o.ack);
  return createPurgeClient({
    purge: o.purge,
    ...(o.personActive ? { personActive: o.personActive } : {}),
    ...(o.currentEpoch ? { currentEpoch: o.currentEpoch } : {}),
    around: (epoch, wipe) => acker.afterWipe(o.deviceId, epoch, wipe),
  });
}

/** Send each purge signal the connection hears to the client; a purge that fails is left for the next signal (the client clears its running state), never thrown into the shell. Returns how to stop. */
export function watchPurge(p: ShellPurge, onError?: (error: unknown) => void): () => void {
  return p.subscribe((epoch) => { void p.client.onFrame({ t: "purge", epoch }).catch((e: unknown) => onError?.(e)); });
}

export interface WebPurgeOpts {
  deviceId: string;
  /** One capability call as the signed-in person: devices.purge_ack goes through it (the session still holds its token while the ack is tried). */
  call: (cap: string, input: unknown) => Promise<unknown>;
  /** Everything this browser keeps of the Space: the stored session and the remembered tabs. */
  wipe(epoch: number): void | Promise<void>;
  /** Runs once the ack has been taken or given up on: the shell goes back to sign-in. */
  done?(epoch: number): void;
  ack?: PurgeAckOpts;
  /** How long the ack may take before the shell leaves anyway. Default 15 s. */
  settleMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The purge of the web shell, which keeps no replica: the stored session and the tabs are what is on this device. Once per epoch, the wipe, then devices.purge_ack (retried by the client's acker, never after
 * a failed wipe), then `done`. The token stays in memory until the ack is taken, so the ack can be sent after the stored copy is gone.
 */
export function webPurgeClient(o: WebPurgeOpts): ShellPurge["client"] {
  const acker = createPurgeAcker(o.call, o.ack);
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  const max = o.ack?.maxTries ?? 8;
  const seen = new Set<number>();
  return {
    async onFrame(frame) {
      if (seen.has(frame.epoch)) return null;
      seen.add(frame.epoch);
      try {
        await acker.afterWipe(o.deviceId, frame.epoch, async () => { await o.wipe(frame.epoch); });
      } catch (e) {
        seen.delete(frame.epoch); // a wipe that failed is tried again on the next signal
        throw e;
      }
      const until = now() + (o.settleMs ?? 15_000);
      while (now() < until) {
        const st = acker.status(o.deviceId, frame.epoch);
        if (st.acked || st.tries >= max) break;
        await sleep(100);
      }
      o.done?.(frame.epoch);
      return { epoch: frame.epoch };
    },
  };
}

/** Remove everything this browser keeps under the app's own prefix (the stored session, the remembered tabs, the sidebar's collapsed state). Blocked storage is not an error: there is nothing to remove. */
export function wipeBrowserStorage(prefix = "vyre."): void {
  const ls = (globalThis as { localStorage?: { length: number; key(i: number): string | null; removeItem(k: string): void } }).localStorage;
  if (!ls) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k !== null && k.startsWith(prefix)) keys.push(k); }
    for (const k of keys) ls.removeItem(k);
  } catch { /* blocked storage */ }
}
