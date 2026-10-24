// Event envelope (ARCH 4.2): what the log stores and what sync, automations and webhooks receive.
import { createHash } from 'node:crypto';

export interface EventEnvelope<P = unknown> {
  seq: number;                       // monotonic per Space; the cursor
  id: string;                        // uuidv7 minted by the emitter
  type: string;                      // 'record.updated'
  sv: number;                        // event schema version
  hlc: string;
  at: number;                        // server wall ms
  traceId: string;                   // 32 hex
  spanId?: string;
  actor: string;                     // usr_, agt_, act_, svc_
  onBehalf?: string;
  device?: string;
  runId?: string;
  cause?: string;
  origin?: string;                   // 'automation:aut_x' | 'agent:agt_x' | 'sync:con_x' | 'user'
  depth: number;                     // self-trigger chain depth, limit 8
  entity?: string;
  entityId?: string;
  fields?: string[];                 // changed field keys, no values
  label: 0 | 1 | 2 | 3;
  vis: 'space' | 'participants' | 'owner' | 'private';
  enc: 0 | 1 | 2;                    // plain, Space key, owner key (E2E)
  payload: P;
}

function sort(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sort);
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => [k, sort(o[k])]));
  }
  return v;
}

export function canonicalJson(v: unknown): string {
  return JSON.stringify(sort(v));
}

/** Hash of the canonical envelope without `seq` (the chain hash adds prev in the kernel). */
export function envelopeHash(e: EventEnvelope): string {
  const { seq: _seq, ...rest } = e;
  return createHash('sha256').update(canonicalJson(rest)).digest('hex');
}

export function roundTrip<P>(e: EventEnvelope<P>): EventEnvelope<P> {
  return JSON.parse(canonicalJson(e)) as EventEnvelope<P>;
}
