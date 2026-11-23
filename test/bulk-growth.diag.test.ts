import test from "node:test";
import { DatabaseSync, StatementSync } from "node:sqlite";
const agg = new Map<string, { ms: number; n: number }>();
const note = (sql: string, ms: number): void => {
  const k = sql.replace(/\s+/g, " ").slice(0, 110);
  const a = agg.get(k) ?? { ms: 0, n: 0 };
  a.ms += ms;
  a.n++;
  agg.set(k, a);
};
for (const m of ["run", "all", "get"] as const) {
  const orig = (StatementSync.prototype as any)[m];
  (StatementSync.prototype as any)[m] = function (...a: unknown[]) {
    const t = performance.now();
    try { return orig.apply(this, a); } finally { note(String((this as any).sourceSQL ?? "?"), performance.now() - t); }
  };
}
const oe = DatabaseSync.prototype.exec;
(DatabaseSync.prototype as any).exec = function (sql: string) {
  const t = performance.now();
  try { return oe.call(this, sql); } finally { note("EXEC " + sql, performance.now() - t); }
};
import { call } from "./support/eco-live.ts";
import { world } from "./support/sync-live.ts";

test("bulk growth", { timeout: 600_000 }, async () => {
  const w = await world(true, {}, {});
  const d = w.d;
  const r = await call(d, "schema.apply", { idempotencyKey: "t", ops: [{ op: "type.create", type: "contact2", def: { title: "C", plural: "Cs", icon: "table", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }, { key: "email", type: "text", title: "E" }, { key: "phone", type: "text", title: "P" }, { key: "city", type: "text", title: "C" }] } }] });
  if (r.status !== 200) throw new Error(JSON.stringify(r.data));
  const out: string[] = [];
  let snap = new Map<string, { ms: number; n: number }>();
  const batchAgg: Array<Map<string, { ms: number; n: number }>> = [];
  for (let b = 0; b < 10; b++) {
    snap = new Map([...agg].map(([k, v]) => [k, { ...v }]));
    const t0 = performance.now();
    const res = await call(d, "records.bulk_upsert", { idempotencyKey: `b${b}`, type: "contact2", match: ["name"], createOnly: true, runAutomations: false,
      rows: Array.from({ length: 500 }, (_, i) => ({ name: `P ${b}-${i}`, email: `p${b}${i}@example.com`, phone: `+1${b}${i}`, city: "Town" })) });
    if (res.status !== 200) throw new Error(JSON.stringify(res.data).slice(0, 300));
    out.push(String(Math.round(performance.now() - t0)));
    batchAgg.push(new Map([...agg].map(([k, v]) => [k, { ms: v.ms - (snap.get(k)?.ms ?? 0), n: v.n - (snap.get(k)?.n ?? 0) }])));
  }
  process.stderr.write(`[bulk] batch ms: ${out.join(" ")}\n`);
  for (const bi of [0, 9]) {
    const top = [...batchAgg[bi]!].sort((x, y) => y[1].ms - x[1].ms).slice(0, 9);
    const tot = [...batchAgg[bi]!].reduce((n, [, v]) => n + v.ms, 0);
    process.stderr.write(`[sql] batch ${bi}: total sql ${Math.round(tot)} ms\n`);
    for (const [k, v] of top) process.stderr.write(`[sql]    ${Math.round(v.ms)} ms x${v.n} ${k.slice(0, 100)}\n`);
  }
  const drained: string[] = [];
  for (let b = 10; b < 20; b++) {
    await d.hooks!.pump();
    await d.projections!.pump();
    await new Promise((r) => setTimeout(r, 300));
    await d.hooks!.pump();
    const t0 = performance.now();
    const res = await call(d, "records.bulk_upsert", { idempotencyKey: `b${b}`, type: "contact2", match: ["name"], createOnly: true, runAutomations: false,
      rows: Array.from({ length: 500 }, (_, i) => ({ name: `P ${b}-${i}`, email: `p${b}${i}@example.com`, phone: `+1${b}${i}`, city: "Town" })) });
    if (res.status !== 200) throw new Error(JSON.stringify(res.data).slice(0, 300));
    drained.push(String(Math.round(performance.now() - t0)));
  }
  process.stderr.write(`[bulk] drained-before batch ms (table 5,000 to 10,000): ${drained.join(" ")}\n`);
  await w.close();
});
