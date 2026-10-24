// An outbox store in memory (tests, and a web device that has not opened its replica yet).
import type { Op } from "../protocol.ts";
import type { OutboxRow, OutboxStore, RejectedRow } from "./types.ts";

export function memoryOutboxStore(): OutboxStore {
  let n = 0;
  const rows: OutboxRow[] = [];
  const rej: RejectedRow[] = [];
  const find = (opId: string): OutboxRow | undefined => rows.find((r) => r.op.opId === opId);
  return {
    insert(op: Op, at: number) {
      if (find(op.opId)) return rows.find((r) => r.op.opId === op.opId)!.n;
      n += 1;
      rows.push({ n, op: structuredClone(op), state: "queued", tries: 0, lastError: null, at });
      return n;
    },
    queued: () => rows.filter((r) => r.state === "queued").map((r) => ({ ...r, op: structuredClone(r.op) })),
    forRow: (entity, id) => rows.filter((r) => r.op.entity === entity && r.op.id === id).map((r) => ({ ...r, op: structuredClone(r.op) })),
    remove(opId) { const i = rows.findIndex((r) => r.op.opId === opId); if (i >= 0) rows.splice(i, 1); },
    setHeld(opId, taskId) { const r = find(opId); if (r) { r.state = "held"; r.lastError = taskId; } },
    bump(opId, error) { const r = find(opId); if (r) { r.tries += 1; r.lastError = error; } },
    reject(r) { rej.push(structuredClone(r)); },
    rejected: () => structuredClone(rej),
    count: () => rows.length,
  };
}
