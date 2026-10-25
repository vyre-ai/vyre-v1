// The client's purge triggers (ARCH 5.7). Three signals mean the same thing: `hello_ok` with mode `purge`, a pull that answers `reset: "purge"`, and a live `{t:'purge', epoch}` frame.
// A device handles each epoch once: the live frame and the pull reset usually both arrive, and the second finds the first already running or done.
import type { Frame, HelloOk, PullRes } from "../protocol.ts";
import { purgeReplica } from "./purge.ts";
import type { PurgeOpts, PurgeReport } from "./purge.ts";
import type { PurgeReason } from "./ports.ts";

export interface PurgeClientOpts {
  /** What a purge deletes and tells: the driver, the open store, documents, keychain, folder and status line. */
  purge: Omit<PurgeOpts, "reason" | "epoch" | "personActive">;
  /**
   * Whether the person can still use Vyre (asked of the server, or remembered). An unsure answer must be false: with nobody to hand the outbox to, it is deleted.
   * Called once per purge, before anything is deleted.
   */
  personActive?: (reason: PurgeReason) => boolean | Promise<boolean>;
  /** The epoch this device last took part in, so an old frame is ignored. */
  currentEpoch?: () => number;
}

export interface PurgeClient {
  onFrame(frame: Frame): Promise<PurgeReport | null>;
  onHello(ok: Pick<HelloOk, "mode" | "epoch">): Promise<PurgeReport | null>;
  onPull(res: Pick<PullRes, "reset" | "epoch">): Promise<PurgeReport | null>;
  /** The person leaves the Space (or the Remove wizard ran): the same path. */
  leave(epoch: number): Promise<PurgeReport>;
  /** True once a purge finished or is running. */
  purged(): boolean;
}

export function createPurgeClient(o: PurgeClientOpts): PurgeClient {
  let running: Promise<PurgeReport> | null = null;
  let done = -1;
  const run = (reason: PurgeReason, epoch: number): Promise<PurgeReport> => {
    if (running) return running;
    const p = (async () => {
      const personActive = o.personActive ? await Promise.resolve(o.personActive(reason)).catch(() => false) : false;
      const report = await purgeReplica({ ...o.purge, reason, epoch, personActive });
      done = epoch;
      return report;
    })();
    running = p;
    // While a purge runs every signal shares it; once it ends (done or failed) the next epoch, or a retry after a failure, starts a new one.
    const clear = (): void => { if (running === p) running = null; };
    p.then(clear, clear);
    return p;
  };
  const stale = (epoch: number): boolean => epoch <= done || (o.currentEpoch !== undefined && epoch < o.currentEpoch());
  const signal = (epoch: number): Promise<PurgeReport | null> => (stale(epoch) ? Promise.resolve(null) : run("revoked", epoch));
  return {
    onFrame: (f) => (f.t === "purge" ? signal(f.epoch) : Promise.resolve(null)),
    onHello: (ok) => (ok.mode === "purge" ? signal(ok.epoch) : Promise.resolve(null)),
    onPull: (res) => (res.reset === "purge" ? signal(res.epoch) : Promise.resolve(null)),
    leave: (epoch) => run("leave", epoch),
    purged: () => running !== null || done >= 0,
  };
}
