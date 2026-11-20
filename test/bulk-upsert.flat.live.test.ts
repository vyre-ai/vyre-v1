// records.bulk_upsert (createOnly): the CPU one row costs does not grow with the rows the table already holds. r40-redos measured batches of 500 getting slower (1.0 s to 2.2 s) and asked whether the write
// path scans; it does not: with the consumers (search, logs, events) caught up before each batch, 500 rows cost 0.9 to 1.1 s from 5,000 rows to 10,000 (Nov 2026). What grew was the consumers' work on the earlier
// batches' events, done on the same loop while the next batch wrote.
import test from "node:test";
import assert from "node:assert/strict";
import { call } from "./support/eco-live.ts";
import { world } from "./support/sync-live.ts";

const threadCpu = (process as unknown as { threadCpuUsage?: (p?: { user: number; system: number }) => { user: number; system: number } }).threadCpuUsage?.bind(process);
const cpuStart = (): { user: number; system: number } => threadCpu?.() ?? { user: performance.now() * 1000, system: 0 };
const cpuSince = (t: { user: number; system: number }): number => {
  const u = threadCpu ? threadCpu(t) : { user: performance.now() * 1000 - t.user, system: 0 };
  return (u.user + u.system) / 1000;
};

test("the CPU of a bulk_upsert row stays flat as the table grows", { timeout: 300_000 }, async () => {
  const w = await world(true, {}, {});
  const d = w.d;
  try {
    const made = await call(d, "schema.apply", {
      idempotencyKey: "flat-type",
      ops: [
        {
          op: "type.create",
          type: "contact2",
          def: {
            title: "C",
            plural: "Cs",
            icon: "table",
            titleField: "name",
            fields: ["name", "email", "phone", "city"].map((key) => ({ key, type: "text", title: key })),
          },
        },
      ],
    });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const BATCH = 300;
    const costs: number[] = [];
    for (let b = 0; b < 11; b++) {
      // the consumers catch up first: what is timed is the write of the batch
      await d.hooks!.pump();
      await d.projections!.pump();
      await new Promise((r) => setTimeout(r, 200));
      await d.hooks!.pump();
      const t = cpuStart();
      const r = await call(d, "records.bulk_upsert", {
        idempotencyKey: `flat-${b}`,
        type: "contact2",
        match: ["name"],
        createOnly: true,
        runAutomations: false,
        rows: Array.from({ length: BATCH }, (_, i) => ({ name: `P ${b}-${i}`, email: `p${b}${i}@example.com`, phone: `+1${b}${i}`, city: "Town" })),
      });
      costs.push(cpuSince(t));
      assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
    }
    process.stderr.write(`[flat] CPU ms per batch of ${BATCH}: ${costs.map((c) => Math.round(c)).join(" ")}\n`);
    const early = costs.slice(1, 4).reduce((a, b) => a + b, 0) / 3; // the first batch warms the code
    const late = costs.slice(8, 11).reduce((a, b) => a + b, 0) / 3;
    assert.ok(late <= early * 1.5, `a row costs ${Math.round((late / BATCH) * 100) / 100} ms with 2,400 rows in the table and ${Math.round((early / BATCH) * 100) / 100} ms with 300-900 (at most 1.5 times)`);
  } finally {
    await w.close();
  }
});
