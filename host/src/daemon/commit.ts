// Turning what the invoke pipeline commits (contract EventEnvelope) into what the kernel log stores (NewEvent), and back with the seq the log assigned.
import type { NewEvent, StoredEvent } from "../../../kernel/src/log/index.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";

const drop = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export function toNew(e: EventEnvelope): NewEvent {
  return drop({
    id: e.id, type: e.type, sv: e.sv, hlc: e.hlc, trace_id: e.traceId, span_id: e.spanId, actor: e.actor, on_behalf: e.onBehalf, device: e.device, run_id: e.runId,
    cause: e.cause, origin: e.origin, depth: e.depth, entity: e.entity, entity_id: e.entityId, fields: e.fields, label: e.label, vis: e.vis, enc: e.enc, payload: e.payload,
  }) as NewEvent;
}

export const fromStored = (s: StoredEvent, orig: EventEnvelope): EventEnvelope => ({ ...orig, seq: s.seq, id: s.id, hlc: s.hlc, at: s.at });
