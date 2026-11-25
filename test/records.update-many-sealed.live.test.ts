// records.update_many with 200 sealed overwrites on a booted server with the real Vault seam: each value goes in over its existing reference after the group commits, and nothing is ever read back
// from the Vault to do it. The Vault logs every reveal (a vault.revealed event and a reveal row in the item's history), so the window around the call must hold none; the owner's own reveal afterwards is outside it.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { bootHour } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";

let h: Hour;
before(async () => {
  h = await bootHour("umsealed");
});
after(async () => {
  await h?.stop();
});

const count = (file: string, sql: string): number => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return Number((db.prepare(sql).get() as { c: number }).c);
  } finally {
    db.close();
  }
};

test("update_many of 200 sealed overwrites logs zero vault.revealed events and zero reveal history rows, and each value reads its new text through the owner's own reveal", async () => {
  await h.owner.call("schema.apply", {
    ops: [
      {
        op: "type.create",
        type: "rt_person",
        def: {
          title: "Person",
          plural: "People",
          icon: "table",
          titleField: "name",
          fields: [
            { key: "name", type: "text", title: "Name", required: true },
            { key: "ssn", type: "sealed", title: "SSN" },
          ],
        },
      },
    ],
  });
  const N = 200;
  await h.owner.call("records.bulk_upsert", {
    type: "rt_person",
    match: ["name"],
    rows: Array.from({ length: N }, (_, i) => ({ name: `P${i}`, ssn: `old-${i}` })),
    createOnly: true,
    runAutomations: false,
  });
  const rows = (await h.owner.call("records.query", { type: "rt_person", limit: 500 })).rows as Array<{
    id: string;
    fields?: Record<string, { ref: string }>;
    data?: Record<string, { ref: string }>;
  }>;
  assert.equal(rows.length, N);
  const refs = new Map(rows.map((r) => [r.id, (r.fields ?? r.data)!["ssn"]!.ref]));
  const events = (): number =>
    count(h.d.paths.events, "SELECT count(*) AS c FROM events WHERE json_extract(event, '$.type') = 'vault.revealed'");
  const history = (): number =>
    count(h.d.paths.modules, `SELECT count(*) AS c FROM vault_history WHERE action = 'revealed'`);
  const e0 = events();
  const h0 = history();
  const out = await h.owner.call("records.update_many", {
    idempotencyKey: "um-sealed-200",
    type: "rt_person",
    items: rows.map((r, i) => ({ recordId: r.id, patch: { ssn: `new-${i}` } })),
  });
  const results = out.results as Array<{ error?: unknown }>;
  assert.equal(results.filter((r) => r.error).length, 0, "every overwrite was made");
  assert.equal(events() - e0, 0, "zero vault.revealed events across the 200 overwrites");
  assert.equal(history() - h0, 0, "zero reveal rows in the Vault history across the 200 overwrites");
  // after the window: the owner's normal reveal reads the new value under the same reference
  for (const i of [0, 99, 199]) {
    const r = rows[i]!;
    const ref = refs.get(r.id)!;
    const got = (await h.owner.call("vault.item.reveal", { itemId: ref, fields: ["value"], reason: "test" })).fields as {
      key: string;
      value: string;
    }[];
    assert.equal(got.find((f) => f.key === "value")?.value, `new-${i}`);
  }
});
