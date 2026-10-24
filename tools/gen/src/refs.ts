// Cross-reference extraction shared by validation and the derived `requires` list.
import type { Manifest } from '../../../packages/contracts/src/index.ts';

export interface Refs { caps: string[]; events: string[] }

/** Every capability and event name a manifest points at. The caller removes the ones it declares itself. */
export function refsOf(m: Manifest): Refs {
  const caps: string[] = [];
  const events: string[] = [];
  for (const s of m.steps ?? []) { if (s.cap) caps.push(s.cap); if (s.compensate) caps.push(s.compensate); for (const e of s.waits?.cancelsOn ?? []) events.push(e); }
  for (const tr of m.triggers ?? []) {
    if ('event' in tr.source) events.push(tr.source.event);
    if ('events' in tr.source) events.push(...tr.source.events);
  }
  for (const c of m.connectors ?? []) { for (const a of c.actions ?? []) caps.push(a); for (const so of c.sources ?? []) events.push(so.event); }
  for (const a of m.agentTools ?? []) if (a.cap) caps.push(a.cap);
  for (const b of m.blocks ?? []) for (const a of b.actions ?? []) caps.push(a.cap);
  for (const sc of m.screens ?? []) {
    for (const q of Object.values(sc.queries)) caps.push(q.cap);
    for (const a of Object.values(sc.actions)) caps.push(a.cap);
  }
  for (const h of m.health ?? []) caps.push(h.cap);
  for (const g of m.gateActs ?? []) caps.push(g.sendsOnApprove);
  for (const tk of m.taskKinds ?? []) for (const a of tk.actions) if (a.cap) caps.push(a.cap);
  for (const n of m.notificationKinds ?? []) for (const a of n.actions ?? []) caps.push(a.cap);
  for (const i of m.importSources ?? []) caps.push(i.parse);
  for (const l of m.lists ?? []) caps.push(l.items);
  for (const e of m.entities ?? []) for (const f of Object.values(e.fields)) for (const c of f.writeOnlyBy ?? []) caps.push(c);
  for (const r of m.recordTypes ?? []) for (const f of r.fields) for (const c of f.writeOnlyBy ?? []) caps.push(c);
  for (const c of m.capabilities ?? []) for (const e of c.emits) events.push(e);
  return { caps, events };
}
