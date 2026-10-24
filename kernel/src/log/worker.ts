// The db worker: the only thread that touches events.db. Appends queue here and commit as one transaction when 2 ms have passed or 64 are waiting (group commit);
// every other call runs at once. The main thread never runs SQL.
import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { LogStore } from "./store.ts";
import { IdempotencyTable } from "../idempotency/table.ts";
import type { NewEvent } from "./types.ts";

export interface WorkerInit { path: string; space: string; windowMs: number; maxBatch: number }
const init = workerData as WorkerInit;
const port = parentPort!;

let store: LogStore = undefined as unknown as LogStore;
let idem: IdempotencyTable = undefined as unknown as IdempotencyTable;
try {
  store = new LogStore({ db: new DatabaseSync(init.path), space: init.space });
  idem = new IdempotencyTable(store.db);
  port.postMessage({ ready: true, head: store.head });
} catch (e) {
  port.postMessage({ ready: false, error: { code: (e as { code?: string }).code ?? "internal", message: (e as Error).message } });
}

let queue: { req: number; ev: NewEvent }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!queue.length) return;
  const batch = queue; queue = [];
  const results = store.appendBatch(batch.map((b) => b.ev));
  batch.forEach((b, i) => port.postMessage({ req: b.req, ok: true, value: results[i], batch: batch.length }));
}

port.on("message", (m: { req: number; op: string; args?: any }) => {
  try {
    switch (m.op) {
      case "append":
        queue.push({ req: m.req, ev: m.args });
        if (queue.length >= init.maxBatch) flush(); else if (!timer) timer = setTimeout(flush, init.windowMs);
        return;
      case "flush": flush(); return port.postMessage({ req: m.req, ok: true, value: null });
      case "get": return port.postMessage({ req: m.req, ok: true, value: store.get(m.args.seq) });
      case "read": return port.postMessage({ req: m.req, ok: true, value: store.read(m.args) });
      case "verify": return port.postMessage({ req: m.req, ok: true, value: store.verify(m.args) });
      case "proves": return port.postMessage({ req: m.req, ok: true, value: store.proves(m.args.seq) });
      case "erase": return port.postMessage({ req: m.req, ok: true, value: store.erase(m.args.seq) });
      case "head": return port.postMessage({ req: m.req, ok: true, value: store.head });
      case "idem_get": return port.postMessage({ req: m.req, ok: true, value: idem.get(m.args.key, Date.now()) });
      case "idem_put": return port.postMessage({ req: m.req, ok: true, value: idem.put(m.args.key, m.args.principal, m.args.cap, m.args.rec, Date.now()) });
      case "idem_purge": return port.postMessage({ req: m.req, ok: true, value: idem.purge(Date.now()) });
      case "close": flush(); store.close(); return port.postMessage({ req: m.req, ok: true, value: null });
      default: return port.postMessage({ req: m.req, ok: false, error: { code: "internal", message: `unknown op ${m.op}` } });
    }
  } catch (e) {
    port.postMessage({ req: m.req, ok: false, error: { code: (e as { code?: string }).code ?? "internal", message: (e as Error).message } });
  }
});
