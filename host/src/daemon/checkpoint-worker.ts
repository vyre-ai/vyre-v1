// The checkpoint worker (27 Nov 2026, the Mac-hosted freeze): the only thread that moves modules.db's write-ahead log back into the database file. SQLite's own checkpoint runs inside the commit that
// crosses 1,000 pages, on the main thread: 36 ms at p999 and 66 ms at worst in the guard, and an explicit one 80 to 130 ms. The main thread's connection has wal_autocheckpoint at 0 (checkpointer.ts); this
// connection looks at the log's size every second and runs a PASSIVE checkpoint when it has grown past the threshold. PASSIVE never waits for a reader or a writer, so it can never hold the main thread
// (TRUNCATE and RESTART do): the file is reused from its start once everything in it is checkpointed, and the last connection to close removes it.
import { parentPort, workerData } from "node:worker_threads";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const init = workerData as { path: string; minBytes: number; everyMs: number };
const port = parentPort!;
const db = new DatabaseSync(init.path);
db.exec("PRAGMA busy_timeout = 2000");
let stopped = false;

// The log file keeps its size once it has grown (it is reused from its start, not shortened), so its size says nothing after the first checkpoint: what is looked at is whether it was written to since the
// last pass (size and modification time), and a pass is made when it was and the file is past the threshold.
let seen = "";
function tick(): void {
  if (stopped) return;
  let size = 0;
  let stamp = "";
  try {
    const st = fs.statSync(`${init.path}-wal`);
    size = st.size;
    stamp = `${st.size}:${st.mtimeMs}`;
  } catch {
    /* no log file yet */
  }
  if (size < init.minBytes || stamp === seen) return;
  seen = stamp;
  try {
    db.exec("PRAGMA wal_checkpoint(PASSIVE)");
  } catch {
    /* a reader or writer holds it: the next second takes it */
  }
}
const timer = setInterval(tick, init.everyMs);
port.on("message", (m: unknown) => {
  if (m !== "stop") return;
  stopped = true;
  clearInterval(timer);
  try {
    db.close();
  } catch {
    /* already closed */
  }
  port.postMessage("stopped");
  port.close();
});
port.postMessage("ready");
