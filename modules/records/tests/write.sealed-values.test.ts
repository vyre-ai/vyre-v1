// @reads /modules/records/migrations/0001_init.sql
// A value given for a sealed field is sealed on write (r40, a firm's import: it had to load dates of birth as text and retype them to sealed afterwards). create, update and bulk_upsert take
// the plain value (a string, or { sealed: true, value }), put it in the Vault and keep the reference only; nothing plain reaches the row, the log, an event or the history.
import test from "node:test";
import assert from "node:assert/strict";
import { mintRecordId } from "../../../lib/ids.ts";
import { openRecords, setRecordsVault } from "../impl.ts";
import { createMergeHandlers } from "../handlers/merge.ts";
import { PERSON } from "../fixtures/seed.ts";

const ctx = {
  trace: { traceId: "0123456789abcdef0123456789abcdef" },
  emit: () => undefined,
  actor: "usr_dana",
  authorize: () => ({ effect: "allow" }),
};

function vault() {
  const kept = new Map<string, string>();
  let n = 0;
  setRecordsVault({
    put: async (o) => {
      const ref = o.ref ?? `vit_${++n}`;
      kept.set(ref, o.value);
      return ref;
    },
    reveal: async (ref) => kept.get(ref) ?? "",
  });
  return kept;
}
const everything = (rec: ReturnType<typeof openRecords>): string =>
  rec.host.store
    .read({ limit: 5000 })
    .map((e) => new TextDecoder().decode(e.payload))
    .join("\n") +
  rec.host.tx
    .all<{ data: string }>("SELECT data FROM rt_person")
    .map((r) => r.data)
    .join("\n");

test("bulk_upsert seals a plain value for a sealed field, on create and on update, and keeps nothing plain", async () => {
  const kept = vault();
  try {
    const rec = openRecords({ space: "sp_sealval" });
    await rec.store.define({ add_types: [PERSON] });
    const merge = createMergeHandlers({ store: rec.store, tx: rec.host.tx });
    const out = await merge["records.bulk_upsert"](ctx as never, {
      type: "person",
      match: ["name"],
      rows: [
        { name: "A", ssn: "111-22-3333" },
        { name: "B", ssn: "444-55-6666" },
        { name: "C", ssn: "" },
      ],
    });
    assert.equal(out.created, 3);
    assert.equal(out.refused, undefined);
    assert.deepEqual([...kept.values()].sort(), ["111-22-3333", "444-55-6666"]);
    const rows = rec.host.tx
      .all<{ data: string }>("SELECT data FROM rt_person ORDER BY id")
      .map((r) => JSON.parse(r.data));
    const a = rows.find((r) => r.name === "A");
    assert.equal(a.ssn.sealed, "ssn");
    assert.equal(a.ssn.present, true);
    assert.match(a.ssn.ref, /^vit_/);
    assert.ok(!rows.find((r) => r.name === "C").ssn, "an empty cell is no value");
    // a second import with a new value for A goes into the same Vault item
    const ref = a.ssn.ref as string;
    const again = await merge["records.bulk_upsert"](ctx as never, {
      type: "person",
      match: ["name"],
      rows: [{ name: "A", ssn: "999-88-7777" }],
    });
    assert.equal(again.updated, 1);
    assert.equal(kept.get(ref), "999-88-7777");
    const text = everything(rec);
    for (const v of ["111-22-3333", "444-55-6666", "999-88-7777"]) assert.equal(text.includes(v), false, v);
  } finally {
    setRecordsVault(null);
  }
});

test("create and update seal a plain value too; with no Vault a plain value is refused and nothing is saved", async () => {
  const kept = vault();
  try {
    const rec = openRecords({ space: "sp_sealval2" });
    await rec.store.define({ add_types: [PERSON] });
    const made = await rec.handlers["records.create"](ctx as never, {
      type: "person",
      fields: { name: "A", ssn: "123-45-6789" },
      idempotencyKey: "k1",
    });
    assert.equal((made.record.fields.ssn as { sealed: string }).sealed, "ssn");
    const upd = await rec.handlers["records.update"](ctx as never, {
      type: "person",
      recordId: made.record.id,
      patch: { ssn: "987-65-4321" },
      baseVersion: made.record.version,
    });
    assert.equal(kept.get((upd.record.fields.ssn as { ref: string }).ref), "987-65-4321");
    assert.equal(everything(rec).includes("987-65-4321"), false);
    assert.equal(everything(rec).includes("123-45-6789"), false);
    setRecordsVault(null);
    await assert.rejects(
      () => rec.store.create("person", mintRecordId(), { name: "Z", ssn: "555-44-3333" }),
      (e: unknown) => (e as { code?: string }).code === "sealed_value_refused",
    );
    assert.equal(everything(rec).includes("555-44-3333"), false);
  } finally {
    setRecordsVault(null);
  }
});
