// Client side of the handshake (ARCH 5.2, spec 3.10). The device keeps one small state machine for the answer to its hello:
//   live             normal
//   update_required  read-only: everything on the device can be read, nothing can be written, and the banner says to update. Changes already waiting stay in the outbox.
//   resync           the replica no longer matches the server (registry or schema drift, or a cursor from a restored server): drop it, take a snapshot, then go live. Runs once however often it is asked.
//   purge            revoked: the purge client takes over (sync/src/purge).
import type { HelloOk, Mode } from "../protocol.ts";
import { minorsBehind } from "./version.ts";
import { updateRequiredError } from "./errors.ts";

export type DeviceMode = Mode | "starting" | "resyncing" | "resync_failed";

export interface Resync {
  /** Remove the replica's rows, FTS, documents and cursor (the outbox stays). */
  dropReplica(): Promise<void>;
  /** Take the snapshot (snapshot.begin, pages, then pull from as-of). */
  snapshot(): Promise<void>;
}

export interface ModeBanner {
  title: string;
  body: string;
  action: "Update" | "Try again" | null;
}

export interface ModeState {
  mode: DeviceMode;
  readOnly: boolean;
  serverVersion: string | null;
  banner: ModeBanner | null;
}

export interface ModeMachineOpts {
  appVersion: string;
  resync?: Resync;
  /** The state changed: the shell shows or hides the banner. */
  onChange?(s: ModeState): void;
  /** The server said purge: hand over to the purge client. */
  onPurge?(epoch: number): void;
}

export interface ModeMachine {
  state(): ModeState;
  /** Apply the answer to a hello. Resolves when the device is in its final mode for this answer (after a resync, live). */
  apply(ok: HelloOk): Promise<ModeState>;
  /** Throws permission.update_required while read-only. Call before queueing a local write. */
  guardWrite(traceId: string): void;
  /** The connection dropped: the next hello decides again. */
  disconnected(): void;
}

function bannerFor(mode: DeviceMode, appVersion: string, serverVersion: string | null): ModeBanner | null {
  if (mode === "update_required") {
    const behind = serverVersion ? minorsBehind(appVersion, serverVersion) : 0;
    return {
      title: "Update required",
      body: behind > 0 && Number.isFinite(behind)
        ? "This app is several versions behind your Space. You can read everything. Update to make changes."
        : "This app is too old for your Space. You can read everything. Update to make changes.",
      action: "Update",
    };
  }
  if (mode === "resync_failed") return { title: "Could not refresh", body: "Your Space data could not be refreshed. Your changes are safe on this device.", action: "Try again" };
  return null;
}

export function createModeMachine(o: ModeMachineOpts): ModeMachine {
  let cur: ModeState = { mode: "starting", readOnly: false, serverVersion: null, banner: null };
  let running: Promise<ModeState> | null = null;

  const set = (mode: DeviceMode, serverVersion: string | null): ModeState => {
    cur = { mode, readOnly: mode === "update_required", serverVersion, banner: bannerFor(mode, o.appVersion, serverVersion) };
    o.onChange?.(cur);
    return cur;
  };

  return {
    state: () => cur,
    apply(ok) {
      if (ok.mode === "resync") {
        // One resync at a time; a second hello during it joins the first.
        if (running) return running;
        const resync = o.resync;
        if (!resync) return Promise.resolve(set("resync_failed", ok.serverVersion));
        set("resyncing", ok.serverVersion);
        running = (async () => {
          try {
            await resync.dropReplica();
            await resync.snapshot();
            return set("live", ok.serverVersion);
          } catch {
            return set("resync_failed", ok.serverVersion);
          } finally {
            running = null;
          }
        })();
        return running;
      }
      if (ok.mode === "purge") {
        set("purge", ok.serverVersion);
        o.onPurge?.(ok.epoch);
        return Promise.resolve(cur);
      }
      return Promise.resolve(set(ok.mode, ok.serverVersion));
    },
    guardWrite(traceId) {
      if (cur.readOnly) throw updateRequiredError(traceId, o.appVersion);
    },
    disconnected() {
      if (cur.mode !== "resyncing" && cur.mode !== "purge") set("starting", cur.serverVersion);
    },
  };
}

