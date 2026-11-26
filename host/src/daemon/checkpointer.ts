// The checkpointer (27 Nov 2026, the Mac-hosted freeze): modules.db's write-ahead log is moved back into the database by a worker thread (checkpoint-worker.ts), not by the commit that crosses SQLite's
// 1,000-page mark on the main thread (36 ms at p999, 66 ms at worst in test/loop.guard.live.test.ts). The main connection's wal_autocheckpoint goes to 0 here; if the worker cannot start or dies, it is
// put back at once, so the log never grows without a checkpointer.
import { Worker } from "node:worker_threads";
import type { HostDb } from "./sqlite.ts";

export interface Checkpointer {
  /** Stops the worker (its connection closed) and, if it never ran or already died, leaves autocheckpoint as it is. */
  stop(): Promise<void>;
}

/** The log size from which the worker checkpoints: the size SQLite's own 1,000 pages of 4 KiB reach. */
export const CHECKPOINT_BYTES = 4 * 1024 * 1024;

export function startCheckpointer(db: HostDb, file: string, o: { minBytes?: number; everyMs?: number } = {}): Checkpointer {
  let live = true;
  let worker: Worker | null = null;
  const giveBack = (): void => {
    if (!live) return;
    live = false;
    try {
      db.exec("PRAGMA wal_autocheckpoint = 1000");
    } catch {
      /* the database is closed */
    }
  };
  try {
    db.exec("PRAGMA wal_autocheckpoint = 0");
    worker = new Worker(new URL("./checkpoint-worker.ts", import.meta.url), {
      workerData: { path: file, minBytes: o.minBytes ?? CHECKPOINT_BYTES, everyMs: o.everyMs ?? 1000 },
    });
    worker.unref();
    worker.on("error", giveBack);
    worker.on("exit", giveBack);
  } catch {
    giveBack();
  }
  return {
    async stop() {
      const w = worker;
      worker = null;
      if (!w) return;
      live = false; // the stop is the owner's: the worker's exit is not a failure
      w.ref(); // waited for: an unreferenced worker would let the process end (exit 13) before its stop is answered
      await new Promise<void>((done) => {
        const t = setTimeout(() => {
          void w.terminate().then(() => done());
        }, 2000);
        t.unref();
        w.once("exit", () => {
          clearTimeout(t);
          done();
        });
        w.postMessage("stop");
      });
      try {
        db.exec("PRAGMA wal_autocheckpoint = 1000");
      } catch {
        /* the database is closed */
      }
    },
  };
}
