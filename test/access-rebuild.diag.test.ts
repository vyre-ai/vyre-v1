import test from "node:test";
import { call } from "./support/eco-live.ts";
import { world } from "./support/sync-live.ts";

test("file write cost vs Space size", { timeout: 1_800_000 }, async () => {
  const w = await world(true, {}, {});
  const d = w.d;
  const cpu = (): number => { const u = (process as any).threadCpuUsage(); return (u.user + u.system) / 1000; };
  const r = await call(d, "schema.apply", { idempotencyKey: "t", ops: [{ op: "type.create", type: "contact2", def: { title: "C", plural: "Cs", icon: "table", titleField: "name", fields: ["name", "email"].map((key) => ({ key, type: "text", title: key })) } }] });
  if (r.status !== 200) throw new Error(JSON.stringify(r.data));
  let total = 0, fileN = 0;
  const sizes = (process.env.SIZES ?? "1000,4000,12000").split(",").map(Number);
  for (const size of sizes) {
    while (total < size) {
      const n = Math.min(500, size - total);
      const res = await call(d, "records.bulk_upsert", { idempotencyKey: `b${total}`, type: "contact2", match: ["name"], createOnly: true, runAutomations: false,
        rows: Array.from({ length: n }, (_, i) => ({ name: `P ${total + i}`, email: `p${total + i}@example.com` })) });
      if (res.status !== 200) throw new Error("bulk " + JSON.stringify(res.data).slice(0, 200));
      total += n;
    }
    // let the consumers catch up so only the file write is timed
    for (let i = 0; i < 30; i++) { await d.hooks!.pump(); await d.projections!.pump(); }
    await new Promise((x) => setTimeout(x, 300));
    await d.hooks!.pump();
    const costs: number[] = [];
    for (let i = 0; i < 12; i++) {
      const t = cpu();
      const f = await call(d, "files.create", { name: `f${fileN++}.txt`, content: { text: `file ${fileN}` }, idempotencyKey: `fc-${fileN}` });
      costs.push(cpu() - t);
      if (f.status !== 200) throw new Error("file " + JSON.stringify(f.data).slice(0, 200));
    }
    costs.sort((a, b) => a - b);
    process.stderr.write(`[access] records ${total}: CPU per file write median ${costs[6]!.toFixed(1)} ms, p90 ${costs[10]!.toFixed(1)} ms, max ${costs[11]!.toFixed(1)} ms\n`);
  }
  await w.close();
});
