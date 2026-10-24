import test from "node:test";
import assert from "node:assert/strict";
import { conformance } from "./suite.ts";
import { openRecordStore } from "../src/store/records.ts";

// The RecordStore over the records.rows inline projection passes the whole suite (revision 7).
const make = async () => openRecordStore({ path: ":memory:", space: "sp_conf" }).store;
conformance(make, { test, assert }, "recordstore");

// The suite has teeth: stores that break one rule each are caught.
async function failures(wrapped: () => Promise<any>): Promise<string[]> {
  const cases: [string, () => Promise<void>][] = [];
  conformance(wrapped, { test: (name, fn) => { cases.push([name, fn]); }, assert }, "broken");
  const out: string[] = [];
  for (const [name, fn] of cases) { try { await fn(); } catch { out.push(name); } }
  return out;
}
const broken: Record<string, (s: any) => any> = {
  "a store that does not keep our id": (s) => ({ ...s, create: (t: string, id: string, d: any) => s.create(t, id, d).then((r: any) => ({ ...r, id: id.replace(/.$/, id.endsWith("0") ? "1" : "0") })) }),
  "a store that ignores the version": (s) => ({ ...s, update: (t: string, id: string, p: any, v: number) => s.get(t, id).then((r: any) => s.update(t, id, p, r ? r.version : v)) }),
  "a store that stores a sealed value": (s) => ({ ...s, create: (t: string, id: string, d: any) => s.create(t, id, { ...d, ssn: d.ssn && typeof d.ssn === "string" ? { sealed: "ssn", ref: d.ssn, present: true, valid_format: true, set_at: 1 } : d.ssn }) }),
  "a store that hands out its own objects": (s) => {
    const inner = new Map<string, any>();
    return { ...s, get: async (t: string, id: string, o: any) => { const r = await s.get(t, id, o); if (!r) return r; const k = t + id; if (!inner.has(k)) inner.set(k, r); return inner.get(k); } };
  },
  "a store with offset paging that repeats rows": (s) => ({
    ...s,
    query: async (t: string, spec: any) => { const p = await s.query(t, { ...spec, page: { limit: spec.page.limit } }); return p.rows.length ? { ...p, next_cursor: p.next_cursor && "AAAA" } : p; },
  }),
};
for (const [name, wrap] of Object.entries(broken)) {
  test(`conformance has teeth: ${name} fails the suite`, async () => {
    const lost = await failures(async () => wrap(await make()));
    assert.ok(lost.length > 0, "the suite passed a broken store");
  });
}
