// The shell's purge client (ARCH 5.7, golden flow 9). A device that is told to purge (hello_ok in mode purge, a pull that resets to purge, a live purge frame) wipes its replica, and when the wipe
// finished it tells the server with devices.purge_ack: once per device and epoch, retried in the background, never after a failed wipe. The wipe itself is the sync package's; the ack is the
// client package's createPurgeAcker; this file puts them together the way the shell needs them (client/src/store/purge-ack.ts says to).
import { createPurgeAcker } from "../../../../../client/src/store/purge-ack.ts";
import type { PurgeAckOpts } from "../../../../../client/src/store/purge-ack.ts";
import { createPurgeClient } from "../../../../../sync/src/purge/client.ts";
import type { PurgeClient, PurgeClientOpts } from "../../../../../sync/src/purge/client.ts";

export interface ShellPurge {
  /** The client the connection's purge signals go to. */
  client: PurgeClient;
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
