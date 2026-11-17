// A big first pull does not hold the server's event loop (17 Nov 2026: a firm's first sync, seven large tables, about 100,000 records: scheduler.loop_blocked, 2,000 ms at a time, so every request and the
// live stream stalled). While several large types pull at once and a bulk writer fills another type, no stretch of synchronous work holds the loop longer than the budget.
import test from "node:test";
import assert from "node:assert/strict";
import { call, hostLog, waitFor } from "./support/eco-live.ts";
import { pump, spec, world } from "./support/sync-live.ts";

const BUDGET_MS = 200;
const BIG = 1200;
const TYPES: Record<string, number> = { person: BIG + 2, matter: BIG, contact: BIG, company: BIG, note: 5 };
const FIELDS = 40;

/** The longest time the loop went without running a timer that asked for 10 ms. */
function watchLoop(): { stop(): { maxMs: number; over: number } } {
  let last = performance.now();
  let max = 0;
  let over = 0;
  const t = setInterval(() => {
    const at = performance.now();
    const lag = at - last - 10;
    last = at;
    if (lag > max) max = lag;
    if (lag > BUDGET_MS) over++;
  }, 10);
  return {
    stop: () => {
      clearInterval(t);
      return { maxMs: Math.round(max), over };
    },
  };
}

test("the event loop is never held longer than the budget while large types pull and a bulk writer runs", async () => {
  const w = await world(true, { bulk: BIG, big: BIG }, {});
  try {
    assert.equal(w.item.status, 200, JSON.stringify(w.item.data));
    const s = spec();
    for (const o of s.objects) o.list.cursor.size = 100;
    const applied = await call(w.d, "sync_specs.apply", { spec: s, idempotencyKey: "apply-lag" });
    assert.equal(applied.status, 200, JSON.stringify(applied.data));
    const made = await call(w.d, "schema.apply", {
      idempotencyKey: "lagw-type",
      ops: [
        {
          op: "type.create",
          type: "rt_lagw",
          def: {
            title: "Bulk",
            plural: "Bulks",
            icon: "table",
            titleField: "name",
            fields: [
              { key: "name", type: "text", title: "Name", required: true },
              ...Array.from({ length: FIELDS }, (_, f) => ({ key: `f${f}`, type: "text", title: `F${f}` })),
            ],
          },
        },
      ],
    });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const watch = watchLoop();
    const writer = (async () => {
      for (let b = 0; b < 12; b++) {
        const r = await call(w.d, "records.bulk_upsert", {
          idempotencyKey: `lw-${b}`,
          type: "rt_lagw",
          match: ["name"],
          rows: Array.from({ length: 100 }, (_, i) => ({
            name: `W ${b}-${i}`,
            ...Object.fromEntries(Array.from({ length: FIELDS }, (_, f) => [`f${f}`, `v ${b} ${i} ${f} lorem ipsum`])),
          })),
          createOnly: true,
          runAutomations: false,
        });
        assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
      }
    })();
    await waitFor(
      async () => {
        await pump(w.d);
        for (const [type, total] of Object.entries(TYPES)) {
          const st = (await call(w.d, "sync_types.status", { type })).data;
          if (!(st.records >= total && !st.catchingUp)) return null;
        }
        return true;
      },
      170_000,
      () => hostLog(w.d),
    );
    await writer;
    const seen = watch.stop();
    process.stderr.write(`[looplag] longest block ${seen.maxMs} ms, ${seen.over} blocks over ${BUDGET_MS} ms\n`);
    assert.ok(seen.maxMs <= BUDGET_MS, `the loop was held for ${seen.maxMs} ms (budget ${BUDGET_MS} ms)`);
  } finally {
    await w.close();
  }
});
