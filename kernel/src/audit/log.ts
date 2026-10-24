// The audit module reads and appends the log through this small shape (the 0.6 event log's): latestSeq, head, get, read by type, verify, append. `auditLogOf` adapts the v1 LogStore.
// A checkpoint event is `checkpoint.signed` whose payload is `{ checkpoint }`, read back as `e.data.checkpoint`.
import type { LogStore } from "../log/store.ts";
import type { NewEvent, StoredEvent, VerifyResult } from "../log/types.ts";

export interface AuditEvent { seq: number; hash: string; type: string; prev: string; data: any; [k: string]: unknown }
export interface AuditLog {
  latestSeq(): number;
  head(): string;
  get(seq: number): AuditEvent | null;
  read(f?: { type?: string }): AuditEvent[];
  verify(o?: { from?: number; prev?: string }): { ok: boolean; seq?: number; at?: number; why?: string; head?: string };
  append(ev: { type: string; sv: number; subject: string; data: unknown }): unknown;
}

const TRACE = (): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
const asAudit = (e: StoredEvent): AuditEvent => {
  let data: unknown = null;
  try { data = JSON.parse(new TextDecoder().decode(e.payload)); } catch { /* an erased or encrypted payload has no data */ }
  return { ...e, data } as unknown as AuditEvent;
};

/** `append` defaults to a one-event batch on the store; pass `host.append` to run inline projections too. */
export function auditLogOf(store: LogStore, append?: (ev: NewEvent) => StoredEvent): AuditLog {
  const put = append ?? ((ev: NewEvent): StoredEvent => {
    const r = store.appendBatch([ev])[0]!;
    if (!r.ok) throw new Error(r.message);
    return r.event;
  });
  return {
    latestSeq: () => store.head.seq,
    head: () => store.head.hash,
    get: (seq) => { const e = store.get(seq); return e ? asAudit(e) : null; },
    read: (f = {}) => {
      const out: AuditEvent[] = [];
      for (let after = 0; ;) {
        const page = store.read({ after, limit: 5000, ...(f.type ? { type: f.type } : {}) });
        out.push(...page.map(asAudit));
        if (page.length < 5000) return out;
        after = page[page.length - 1]!.seq;
      }
    },
    verify: (o) => store.verify(o) as VerifyResult & { why?: string },
    append: (ev) => put({ type: ev.type, sv: ev.sv, trace_id: TRACE(), actor: "svc_audit", vis: "space", entity: "audit", entity_id: ev.subject, payload: ev.data }),
  };
}
