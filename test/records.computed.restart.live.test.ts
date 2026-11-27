// A fill of a computed field on a big type survives a real restart of the server: the daemon is stopped while the fill runs (the fill sees the stop at its next slice and keeps its event), a new daemon starts on the
// same directory, and the fill goes on from its cursor: each record is written once, none is missing, the job ends with the right count. Real server-role daemon, stopped and started again by Hour.restart().
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { bootHour } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";

let h: Hour;
before(async () => {
  h = await bootHour("computedrestart", { keepDir: true });
});
after(async () => {
  await h?.stop();
  if (h?.dir) fs.rmSync(h.dir, { recursive: true, force: true });
});

const spaceDb = (): string => {
  const walk = (d: string): string[] =>
    fs
      .readdirSync(d, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  return walk(h.dir).find((f) => /space\.db$/.test(f))!;
};
const rows = <T>(sql: string, ...a: unknown[]): T[] => {
  const db = new DatabaseSync(spaceDb(), { readOnly: true });
  try {
    return db.prepare(sql).all(...(a as never[])) as T[];
  } catch {
    return [];
  } finally {
    db.close();
  }
};

test("the server is stopped while a 9,500-record fill runs and started again: the fill finishes from its cursor, each record once, every value right", async () => {
  const type = "linerestart";
  const N = 9_500;
  await h.owner.call("schema.apply", {
    idempotencyKey: "rs-type",
    ops: [
      {
        op: "type.create",
        type,
        def: {
          title: "Line",
          plural: "Lines",
          icon: "table",
          titleField: "name",
          fields: ["name", "qty", "price"].map((key) => ({
            key,
            type: key === "name" ? "text" : "number",
            title: key,
          })),
        },
      },
    ],
  });
  for (let at = 0; at < N; at += 500)
    await h.owner.call("records.bulk_upsert", {
      idempotencyKey: `rs-${at}`,
      type,
      match: ["name"],
      createOnly: true,
      runAutomations: false,
      rows: Array.from({ length: 500 }, (_, i) => ({ name: `R${at + i}`, qty: (at + i) % 9, price: 3 })),
    });
  await h.d.hooks?.pump?.();
  await new Promise((r) => setTimeout(r, 300));
  await h.d.hooks?.pump?.();
  assert.equal(
    rows("SELECT 1 FROM records_computed WHERE type = ?", type).length,
    0,
    "control: nothing is computed before the field exists",
  );
  await h.owner.call("schema.apply", {
    idempotencyKey: "rs-field",
    ops: [
      {
        op: "field.add",
        type,
        field: "total",
        def: { type: "formula", title: "Total", options: { expr: "qty * price" } },
      },
    ],
  });
  // wait for the fill to be under way, then stop the server in the middle of it
  const progress = (): { state: string; done: number } | undefined =>
    rows<{ state: string; done: number }>(
      "SELECT state, done FROM records_computed_job WHERE type = ? AND field = 'total'",
      type,
    )[0];
  const end = Date.now() + 60_000;
  for (;;) {
    // no pump here: a pump would wait for the whole fill; the daemon starts its own pass when the schema change commits
    const p = progress();
    if (p && p.state === "running" && p.done >= 3000) break;
    assert.ok(Date.now() < end && !(p && p.state === "done"), `the fill was caught partway (${JSON.stringify(p)})`);
    await new Promise((r) => setTimeout(r, 1));
  }
  let at: { state: string; done: number } | undefined;
  let first: Array<{ id: string; computed_at: number }> = [];
  const t0 = performance.now();
  await h.restart(() => {
    // the files as the stop left them: what the fill had written, and what its job says
    at = progress();
    first = rows<{ id: string; computed_at: number }>(
      "SELECT id, computed_at FROM records_computed WHERE type = ? AND field = 'total'",
      type,
    );
  });
  console.log(
    `the stop and the start took ${Math.round(performance.now() - t0)} ms; ${first.length} of ${N} written before the stop`,
  );
  assert.equal(at!.state, "running", "after the stop the job says it is still running (a stop is not a failure)");
  assert.ok(
    first.length > 0 && first.length < N,
    `some, not all, were written before the stop (${first.length} of ${N})`,
  );
  assert.equal(first.length, at!.done, "the progress row says exactly what was written");
  // the new daemon hands the kept event over again and the fill finishes
  const stamp = new Map(first.map((r) => [r.id, r.computed_at]));
  const end2 = Date.now() + 120_000;
  while (progress()?.state !== "done") {
    assert.ok(Date.now() < end2, `the fill finished after the restart (${JSON.stringify(progress())})`);
    await h.d.hooks?.pump?.();
    await new Promise((r) => setTimeout(r, 100));
  }
  const all = rows<{ id: string; value: string; computed_at: number }>(
    "SELECT id, value, computed_at FROM records_computed WHERE type = ? AND field = 'total'",
    type,
  );
  assert.equal(all.length, N, "every record has its value");
  assert.equal(progress()!.done, N, "the job's count is the number of records, not more");
  const data = new Map(
    rows<{ id: string; data: string }>(`SELECT id, data FROM rt_${type}`).map((r) => [
      r.id,
      JSON.parse(r.data) as { qty: number; price: number },
    ]),
  );
  for (const r of all)
    assert.equal(JSON.parse(r.value), data.get(r.id)!.qty * data.get(r.id)!.price, `a value is right (${r.id})`);
  // none written before the stop was written again (its stamp is the one it had)
  const again = all.filter((r) => stamp.has(r.id) && stamp.get(r.id) !== r.computed_at);
  assert.deepEqual(
    again.map((r) => r.id),
    [],
    "no record written before the stop was written again after the restart",
  );
});
