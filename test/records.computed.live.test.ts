// Computed fields (formula), kept by the records.computed consumer on the host's hook pump: a value follows its record's changes, a field added to a type that already has records is filled for all of them in slices
// that never hold the loop for 100 ms, and the progress is a row ("updating") while it runs. The values are read from records_computed directly here; the read side has its own tests. Real server-role daemon.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { bootHour } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";

let h: Hour;
before(async () => {
  h = await bootHour("computed");
});
after(async () => {
  await h?.stop();
});

const spaceDb = (): string => {
  const walk = (d: string): string[] =>
    fs
      .readdirSync(d, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  return walk(h.dir).find((f) => /space\.db$/.test(f))!;
};
const table = <T>(sql: string, ...a: unknown[]): T[] => {
  const db = new DatabaseSync(spaceDb(), { readOnly: true });
  try {
    return db.prepare(sql).all(...(a as never[])) as T[];
  } catch {
    return [];
  } finally {
    db.close();
  }
};
const valueOf = (type: string, id: string, field: string): unknown => {
  const r = table<{ value: string | null }>(
    "SELECT value FROM records_computed WHERE type = ? AND id = ? AND field = ?",
    type,
    id,
    field,
  )[0];
  return r === undefined ? undefined : r.value === null ? null : JSON.parse(r.value);
};
const pumpUntil = async (ok: () => boolean, ms = 60_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("the consumer never got there");
    await h.d.hooks?.pump?.();
    await new Promise((r) => setTimeout(r, 100));
  }
};
const makeType = async (type: string, extra: unknown[] = []): Promise<void> => {
  await h.owner.call("schema.apply", {
    idempotencyKey: `ct-${type}`,
    ops: [
      {
        op: "type.create",
        type,
        def: {
          title: "Line",
          plural: "Lines",
          icon: "table",
          titleField: "name",
          fields: [
            { key: "name", type: "text", title: "name" },
            { key: "qty", type: "number", title: "qty" },
            { key: "price", type: "number", title: "price" },
            ...extra,
          ],
        },
      },
    ],
  });
};
const addFormula = async (type: string, key: string, expr: string): Promise<void> => {
  await h.owner.call("schema.apply", {
    idempotencyKey: `cf-${type}-${key}-${expr}`,
    ops: [{ op: "field.add", type, field: key, def: { type: "formula", title: key, options: { expr } } }],
  });
};

test("a formula value follows its record: made with it, changed with it, gone with it", async () => {
  const type = "lineone";
  await makeType(type);
  await addFormula(type, "total", "qty * price");
  const made = (await h.owner.call("records.create", { type, fields: { name: "A", qty: 3, price: 4 } })) as {
    record: { id: string };
  };
  const id = made.record.id;
  await pumpUntil(() => valueOf(type, id, "total") === 12);
  assert.equal(valueOf(type, id, "total"), 12, "computed from the record when it is made");
  await h.owner.call("records.update", { type, recordId: id, patch: { qty: 5 } });
  await pumpUntil(() => valueOf(type, id, "total") === 20);
  assert.equal(valueOf(type, id, "total"), 20, "recomputed when an input changes");
  await h.owner.call("records.delete", { type, recordId: id });
  await pumpUntil(() => valueOf(type, id, "total") === undefined);
  assert.equal(valueOf(type, id, "total"), undefined, "no value for a record in Trash");
  // control: the side table is the only place the value is kept: the record's own data never holds it
  const own = table<{ data: string }>(`SELECT data FROM rt_${type} WHERE id = ?`, id)[0];
  assert.equal(own ? "total" in JSON.parse(own.data) : false, false, "nothing is written into the record's data");
});

test("a formula chain: a formula over a formula is computed in order", async () => {
  const type = "linechain";
  await makeType(type);
  await addFormula(type, "sub", "qty * price");
  await addFormula(type, "withtax", "sub + sub / 10");
  const r = (await h.owner.call("records.create", { type, fields: { name: "B", qty: 2, price: 50 } })) as {
    record: { id: string };
  };
  await pumpUntil(() => valueOf(type, r.record.id, "withtax") === 110);
  assert.equal(valueOf(type, r.record.id, "sub"), 100);
  assert.equal(valueOf(type, r.record.id, "withtax"), 110);
});

/** The longest time the loop went without running a 2 ms timer. */
function watchLoop(): { stop(): Promise<number> } {
  let last = performance.now(),
    max = 0;
  const t = setInterval(() => {
    const at = performance.now();
    max = Math.max(max, at - last - 2);
    last = at;
  }, 2);
  return {
    stop: async () => {
      await new Promise<void>((r) => setTimeout(r, 10));
      clearInterval(t);
      return Math.round(max);
    },
  };
}

test("a formula added to a type with 9,500 records is filled for all of them in slices: the loop never waits 100 ms, and the field shows as updating while it runs", async () => {
  const type = "linebig";
  const N = 9_500;
  await makeType(type);
  for (let at = 0; at < N; at += 500)
    await h.owner.call("records.bulk_upsert", {
      idempotencyKey: `big-${at}`,
      type,
      match: ["name"],
      createOnly: true,
      runAutomations: false,
      rows: Array.from({ length: 500 }, (_, i) => ({ name: `L${at + i}`, qty: (at + i) % 7, price: 2 })),
    });
  await h.d.hooks?.pump?.();
  await new Promise((r) => setTimeout(r, 300));
  await h.d.hooks?.pump?.();
  assert.equal(
    table("SELECT 1 FROM records_computed WHERE type = ?", type).length,
    0,
    "control: nothing is computed before the field exists",
  );
  await addFormula(type, "total", "qty * price");
  const probe = ((await h.owner.call("records.query", { type, limit: 1 })) as { rows: Array<{ id: string }> }).rows[0]!
    .id;
  const states: Array<{ updating?: string[]; computedAt?: Record<string, number> }> = [];
  let polling = true;
  const poller = (async () => {
    while (polling) {
      const got = (await h.owner.call("records.get", { type, recordId: probe })) as {
        record: { updating?: string[]; computedAt?: Record<string, number> };
      };
      states.push({
        ...(got.record.updating ? { updating: got.record.updating } : {}),
        ...(got.record.computedAt ? { computedAt: got.record.computedAt } : {}),
      });
      await new Promise((r) => setTimeout(r, 20));
    }
  })();
  const watch = watchLoop();
  const seen: string[] = [];
  const poll = setInterval(() => {
    const j = table<{ state: string; done: number; total: number }>(
      "SELECT state, done, total FROM records_computed_job WHERE type = ? AND field = 'total'",
      type,
    )[0];
    if (j) seen.push(`${j.state}:${j.done}/${j.total}`);
  }, 50);
  const t0 = performance.now();
  await pumpUntil(
    () =>
      table<{ state: string }>("SELECT state FROM records_computed_job WHERE type = ? AND field = 'total'", type)[0]
        ?.state === "done",
    300_000,
  );
  const took = Math.round(performance.now() - t0);
  clearInterval(poll);
  polling = false;
  await poller;
  const longest = await watch.stop();
  const filled = table<{ c: number }>(
    "SELECT count(*) AS c FROM records_computed WHERE type = ? AND field = 'total'",
    type,
  )[0]!.c;
  console.log(
    `backfill of ${N}: ${took} ms, longest loop block ${longest} ms, ${seen.length} progress samples (first ${seen[0]}, last ${seen.at(-1)})`,
  );
  assert.equal(filled, N, "every record has its value");
  const sample = table<{ id: string; data: string }>(`SELECT id, data FROM rt_${type} ORDER BY id LIMIT 5`);
  for (const r of sample) {
    const d = JSON.parse(r.data) as { qty: number; price: number };
    assert.equal(valueOf(type, r.id, "total"), d.qty * d.price, "a value is right");
  }
  assert.ok(
    seen.some((s) => s.startsWith("running:")),
    `the job was seen running (updating): ${seen.slice(0, 5).join(", ")}`,
  );
  assert.ok(longest < 100, `the longest stretch the loop was held was ${longest} ms (limit 100)`);
  // the record says so while its field is being filled, and says when each value was computed once it is
  assert.ok(
    states.some((x) => x.updating?.includes("total")),
    `a read during the fill said the field is updating (${states.length} reads)`,
  );
  const after = (await h.owner.call("records.get", { type, recordId: probe })) as {
    record: { updating?: string[]; computedAt?: Record<string, number> };
  };
  assert.equal(after.record.updating, undefined, "nothing is updating once the fill is done");
  assert.equal(typeof after.record.computedAt?.["total"], "number", "the value says when it was computed");
});

test("a lookup follows the relation and a rollup sums, counts and averages the linked records; both follow link, unlink, change and delete on either end", async () => {
  const a = "acct";
  const i = "inv";
  await h.owner.call("schema.apply", {
    idempotencyKey: "lr-types",
    ops: [
      {
        op: "type.create",
        type: a,
        def: {
          title: "Account",
          plural: "Accounts",
          icon: "table",
          titleField: "name",
          fields: [{ key: "name", type: "text", title: "name" }],
        },
      },
      {
        op: "type.create",
        type: i,
        def: {
          title: "Invoice",
          plural: "Invoices",
          icon: "table",
          titleField: "name",
          fields: [
            { key: "name", type: "text", title: "name" },
            { key: "amount", type: "number", title: "amount" },
          ],
        },
      },
      { op: "relation.add", type: i, field: "account", def: { to: a, inverse: "invoices" } },
    ],
  });
  await h.owner.call("schema.apply", {
    idempotencyKey: "lr-calc",
    ops: [
      {
        op: "field.add",
        type: i,
        field: "account_name",
        def: { type: "lookup", title: "Account name", options: { via: "account", field: "name" } },
      },
      {
        op: "field.add",
        type: a,
        field: "billed",
        def: { type: "rollup", title: "Billed", options: { via: "invoices", field: "amount", fn: "sum" } },
      },
      {
        op: "field.add",
        type: a,
        field: "n_invoices",
        def: { type: "rollup", title: "Invoices", options: { via: "invoices", field: "amount", fn: "count" } },
      },
      {
        op: "field.add",
        type: a,
        field: "average",
        def: { type: "rollup", title: "Average", options: { via: "invoices", field: "amount", fn: "avg" } },
      },
      {
        op: "field.add",
        type: a,
        field: "billed_k",
        def: { type: "formula", title: "Billed k", options: { expr: "billed / 1000" } },
      },
    ],
  });
  const acc = (
    (await h.owner.call("records.create", { type: a, fields: { name: "Acme" } })) as { record: { id: string } }
  ).record.id;
  const mk = async (name: string, amount: number): Promise<string> => {
    const r = (await h.owner.call("records.create", { type: i, fields: { name, amount } })) as {
      record: { id: string };
    };
    await h.owner.call("records.relate", { type: i, recordId: r.record.id, field: "account", toId: acc });
    return r.record.id;
  };
  const i1 = await mk("I1", 1000);
  const i2 = await mk("I2", 3000);
  await pumpUntil(
    () => valueOf(a, acc, "billed") === 4000 && JSON.stringify(valueOf(i, i1, "account_name")) === '["Acme"]',
  );
  assert.equal(valueOf(a, acc, "n_invoices"), 2);
  assert.equal(valueOf(a, acc, "average"), 2000);
  assert.equal(valueOf(a, acc, "billed_k"), 4, "a formula over a rollup (a chain across the two)");
  assert.deepEqual(
    valueOf(i, i2, "account_name"),
    ["Acme"],
    "a lookup over a relation that may hold many links is a list",
  );
  // an invoice changes: the rollup on the account follows it
  await h.owner.call("records.update", { type: i, recordId: i2, patch: { amount: 5000 } });
  await pumpUntil(() => valueOf(a, acc, "billed") === 6000);
  assert.equal(valueOf(a, acc, "billed_k"), 6);
  // the account is renamed: the lookup on every invoice follows it
  await h.owner.call("records.update", { type: a, recordId: acc, patch: { name: "Acme Inc" } });
  await pumpUntil(
    () =>
      JSON.stringify(valueOf(i, i1, "account_name")) === '["Acme Inc"]' &&
      JSON.stringify(valueOf(i, i2, "account_name")) === '["Acme Inc"]',
  );
  // an invoice is unlinked, then another goes to Trash
  await h.owner.call("records.relate", { type: i, recordId: i1, field: "account", toId: acc, unlink: true });
  await pumpUntil(() => valueOf(a, acc, "billed") === 5000);
  assert.equal(valueOf(a, acc, "n_invoices"), 1);
  assert.deepEqual(valueOf(i, i1, "account_name"), [], "an unlinked invoice looks up nothing");
  await h.owner.call("records.delete", { type: i, recordId: i2 });
  await pumpUntil(() => valueOf(a, acc, "n_invoices") === 0);
  assert.equal(valueOf(a, acc, "billed"), null, "a sum of nothing is empty, not zero");
});

test("the doctor's remedy works: a fill left failed halfway is finished by saving the field again without changing it", async () => {
  const type = "linestuck";
  await makeType(type);
  for (let i = 0; i < 40; i++)
    await h.owner.call("records.create", { type, fields: { name: `S${i}`, qty: i, price: 3 } });
  await addFormula(type, "total", "qty * price");
  await pumpUntil(
    () => table<{ state: string }>("SELECT state FROM records_computed_job WHERE type = ?", type)[0]?.state === "done",
  );
  assert.equal(table("SELECT 1 FROM records_computed WHERE type = ?", type).length, 40, "control: all 40 are filled");
  // what a fill the pump gave up on looks like: the job failed with its cursor at the start, and half of the values are missing
  const db = new DatabaseSync(spaceDb());
  try {
    db.prepare(
      "UPDATE records_computed_job SET state = 'failed', cursor = NULL, done = 0, error = 'boom' WHERE type = ?",
    ).run(type);
    db.prepare(
      "DELETE FROM records_computed WHERE type = ? AND id IN (SELECT id FROM records_computed WHERE type = ? ORDER BY id LIMIT 20)",
    ).run(type, type);
  } finally {
    db.close();
  }
  assert.equal(table("SELECT 1 FROM records_computed WHERE type = ?", type).length, 20);
  // the remedy: save the field again, changing nothing
  await h.owner.call("schema.apply", {
    idempotencyKey: `resave-${type}`,
    ops: [{ op: "field.update", type, field: "total", def: { title: "total" } }],
  });
  await pumpUntil(
    () => table<{ state: string }>("SELECT state FROM records_computed_job WHERE type = ?", type)[0]?.state === "done",
  );
  assert.equal(
    table("SELECT 1 FROM records_computed WHERE type = ?", type).length,
    40,
    "every record has its value again",
  );
});
