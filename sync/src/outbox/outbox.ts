// The device outbox (ARCH 5.4). enqueue turns a local change into an op: a uuidv7 id that is also its idempotency key, an hlc from the device clock, and for a patch the seq each field had when the person
// edited it (`baseSeq`) with a link to this device's previous queued op on the same field (`after`). batch hands the server the due ops in order; acknowledge settles them from the push result.
// A failure that is not an answer (no network, a 5xx) leaves the ops queued with the same ids and a growing delay, so retrying is exact.
import { formatHlc, parseHlc, receiveHlc, tickHlc } from "../../../lib/hlc.ts";
import type { Hlc } from "../../../lib/hlc.ts";
import { mintUuid } from "../../../lib/ids.ts";
import { MAX_PUSH_OPS } from "../protocol.ts";
import type { Op, PushRes } from "../protocol.ts";
import type { Ack, OutboxStore } from "./types.ts";

export interface OutboxOpts {
  store: OutboxStore;
  deviceId: string;
  /** Wall clock, ms. */
  now?: () => number;
  /** Ids; the defaults are uuidv7 for an op and 32 hex digits for a trace. */
  newOpId?: () => string;
  newTraceId?: () => string;
  /** Delay before the n-th retry of a failed op, ms. */
  backoffMs?: (tries: number) => number;
  /** Hlc to continue from after a restart (the highest this device issued or saw). */
  lastHlc?: string;
}

export interface NewOp {
  cap: string;
  v?: number;
  entity?: string;
  id?: string;
  input: unknown;
  /** For a patch: the seq of each field as the person saw it. A field not listed counts as 0. */
  seqOf?: Record<string, number>;
  traceId?: string;
  enc?: { key: string; nonce: string };
}

export const BACKOFF_BASE_MS = 500;
export const BACKOFF_CAP_MS = 30_000;
/** 500 ms, doubling, capped at 30 s. */
export const defaultBackoff = (tries: number): number => Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, tries - 1));

const trace = (): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

function fieldsOf(op: Op): string[] {
  const input = op.input;
  if (input === null || typeof input !== "object" || Array.isArray(input)) return [];
  const f = (input as Record<string, unknown>)["fields"];
  return f !== null && typeof f === "object" && !Array.isArray(f) ? Object.keys(f) : [];
}

export interface Outbox {
  /** Queue a local change. Returns the op that will be pushed. */
  enqueue(n: NewOp): Op;
  /** Due ops in outbox order, at most `max`. An op still in its retry delay holds back the ops after it, so order is never broken. */
  batch(max?: number): Op[];
  /** Settle ops from a push result: applied ops leave, refused ops move to Rejected with their values, held ops wait for approval. */
  acknowledge(res: PushRes): Ack;
  /** The push did not get an answer (offline, 5xx). Ops stay queued with the same ids. */
  failed(opIds: readonly string[], error: string): void;
  /** Take in the server's clock so the next local hlc is after everything seen. */
  observe(serverHlc: string): void;
  /** Ops waiting, queued or held ("3 changes waiting"). */
  pending(): number;
  /** The hlc the device clock has reached. */
  clock(): string | null;
  /** Drop a held op once its approval is decided. */
  settleHeld(opId: string): void;
  /** When the next retry is due, ms, or null. */
  nextDue(): number | null;
}

export function createOutbox(o: OutboxOpts): Outbox {
  const now = o.now ?? Date.now;
  const store = o.store;
  const backoff = o.backoffMs ?? defaultBackoff;
  const newOpId = o.newOpId ?? (() => mintUuid(now()));
  const newTrace = o.newTraceId ?? trace;
  let last: Hlc | null = o.lastHlc ? parseHlc(o.lastHlc) : null;
  const retryAt = new Map<string, number>();
  const observe = (serverHlc: string): void => {
    const remote = parseHlc(serverHlc);
    if (remote) last = receiveHlc(o.deviceId, now(), last, remote);
  };

  return {
    enqueue(n) {
      last = tickHlc(o.deviceId, now(), last);
      const op: Op = {
        opId: newOpId(), traceId: n.traceId ?? newTrace(), hlc: formatHlc(last), cap: n.cap, v: n.v ?? 1,
        ...(n.entity !== undefined ? { entity: n.entity } : {}), ...(n.id !== undefined ? { id: n.id } : {}),
        input: n.input, baseSeq: {}, ...(n.enc ? { enc: n.enc } : {}),
      };
      const fields = fieldsOf(op);
      if (op.entity !== undefined && op.id !== undefined && fields.length) {
        const queued = store.forRow(op.entity, op.id);
        const after: Record<string, string> = {};
        for (const f of fields) {
          const touching = queued.filter((r) => fieldsOf(r.op).includes(f));
          const first = touching[0], prev = touching[touching.length - 1];
          // With a queued op on the field, the base is the first queued op's base: the server's value never moved under this device since then, or it conflicts.
          op.baseSeq[f] = first ? (first.op.baseSeq[f] ?? 0) : (n.seqOf?.[f] ?? 0);
          if (prev) after[f] = prev.op.opId;
        }
        if (Object.keys(after).length) op.after = after;
      }
      store.insert(op, now());
      return op;
    },
    batch(max = MAX_PUSH_OPS) {
      const t = now();
      const out: Op[] = [];
      for (const r of store.queued()) {
        if (out.length >= Math.min(max, MAX_PUSH_OPS)) break;
        if ((retryAt.get(r.op.opId) ?? 0) > t) break;
        out.push(r.op);
      }
      return out;
    },
    acknowledge(res) {
      const at = now();
      const ack: Ack = { applied: [], rejected: res.rejected, held: res.held, conflicts: res.conflicts };
      for (const a of res.applied) { store.remove(a.opId); retryAt.delete(a.opId); ack.applied.push(a.opId); }
      for (const r of res.rejected) { store.reject({ opId: r.opId, error: r.error, copyOut: r.copyOut, at }); store.remove(r.opId); retryAt.delete(r.opId); }
      for (const h of res.held) { store.setHeld(h.opId, h.taskId); retryAt.delete(h.opId); }
      observe(res.serverHlc);
      return ack;
    },
    failed(opIds, error) {
      const t = now();
      const byId = new Map(store.queued().map((r) => [r.op.opId, r] as const));
      for (const id of opIds) {
        const row = byId.get(id);
        if (!row) continue;
        store.bump(id, error);
        retryAt.set(id, t + backoff(row.tries + 1));
      }
    },
    observe,
    pending: () => store.count(),
    clock: () => (last ? formatHlc(last) : null),
    settleHeld(opId) { store.remove(opId); },
    nextDue() {
      const ids = store.queued().map((r) => retryAt.get(r.op.opId)).filter((x): x is number => x !== undefined);
      return ids.length ? Math.min(...ids) : null;
    },
  };
}
