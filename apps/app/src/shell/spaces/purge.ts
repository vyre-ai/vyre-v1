// The shell's purge client (ARCH 5.7, golden flow 9). A device that is told to purge (hello_ok in mode purge, a pull that resets to purge, a live purge frame) wipes its replica, and when the wipe
// finished it tells the server with devices.purge_ack: once per device and epoch, retried in the background, never after a failed wipe. The wipe itself is the sync package's; the ack is the
// client package's createPurgeAcker; this file puts them together the way the shell needs them (client/src/store/purge-ack.ts says to).
import { clearStored, readStoredSessions } from "../session/stored.ts";
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
  return p.subscribe((epoch) => {
    void p.client.onFrame({ t: "purge", epoch }).catch((e: unknown) => onError?.(e));
  });
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
        await acker.afterWipe(o.deviceId, frame.epoch, async () => {
          await o.wipe(frame.epoch);
        });
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

type Store = { length: number; key(i: number): string | null; removeItem(k: string): void };
const browserKeys = (): Store | undefined => (globalThis as { localStorage?: Store }).localStorage;

/** Remove every key this browser keeps under a prefix. Blocked storage is not an error: there is nothing to remove. Used only where the whole browser is meant to go; clearing one Space uses wipeSpaceStorage. */
export function wipeBrowserStorage(prefix = "vyre."): void {
  const ls = browserKeys();
  if (!ls) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k !== null && k.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) ls.removeItem(k);
  } catch {
    /* blocked storage */
  }
}

/**
 * Remove what this browser keeps for ONE Space and nothing of any other: its sign-in (the entry for its address inside the one stored-sessions key), and every per-Space key (the sidebar's folds, the
 * remembered tabs, the look, the inbox hints). A key kept for the person alone (their look, their time-zone flag, the sidebar's device and person key) goes only when no other Space on this browser has the same
 * person. Kept on purpose, because they belong to the device and not to a Space: the list of other Spaces' sign-ins, the updater's flags (auto, from, what is new), the interface's own state (ui.v1),
 * onboarding hints, the Apps tab, the calendar's video choice and the muted-agent note. The caller removes the sign-in entry itself with clearStored(undefined, baseUrl), which also removes the drafts.
 */
export function wipeSpaceStorage(
  space: { spaceId: string; personId: string },
  others: ReadonlyArray<{ spaceId: string; personId: string }> = [],
): void {
  const ls = browserKeys();
  if (!ls) return;
  const { spaceId, personId } = space;
  const personAlone = !others.some((o) => o.personId === personId && o.spaceId !== spaceId);
  const mine = (k: string): boolean =>
    k === `vyre.sidebar.folded.${spaceId}` ||
    k === `vyre.sidebar.v2.${spaceId}` ||
    (k.startsWith("vyre.tabs.v1:") && k.endsWith(`:${personId}:${spaceId}`)) ||
    k === `vyre.appearance.v1:${personId}:${spaceId}` ||
    k === `vyre.inbox.has.${personId}.${spaceId}` ||
    k === `vyre.inbox.tip.${personId}.${spaceId}` ||
    (personAlone &&
      (k === `vyre.look.${personId}` ||
        k === `vyre.tz.seeded:${personId}` ||
        (k.startsWith("vyre.sidebar.v2:") && k.endsWith(`:${personId}`))));
  try {
    const keys: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k !== null && mine(k)) keys.push(k);
    }
    for (const k of keys) ls.removeItem(k);
  } catch {
    /* blocked storage */
  }
}

/** What clearing one Space from this browser does: its per-Space keys and its own sign-in, never another Space's (the other sign-ins stay, so those Spaces open as before). */
export function removeSpaceFromBrowser(stored: { baseUrl: string; personId: string; def: { spaceId: string } }): void {
  wipeSpaceStorage(
    { spaceId: stored.def.spaceId, personId: stored.personId },
    readStoredSessions().map((o) => ({ spaceId: o.def.spaceId, personId: o.personId })),
  );
  clearStored(undefined, stored.baseUrl);
}
