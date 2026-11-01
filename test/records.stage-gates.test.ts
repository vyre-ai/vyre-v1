// Lives in test/ because it crosses two modules (records and schema): the stage gates the schema writes are what the records store enforces.
// Records: stage gates on any type. A status field whose stages list fields to fill (kept as `stageGates` by the schema module) refuses a stage change while they are empty, for every caller.
import test from "node:test";
import assert from "node:assert/strict";
import { mintRecordId } from "../lib/ids.ts";
import { openRecords } from "../modules/records/impl.ts";
import { stageGatesOf, toStoreField } from "../modules/schema/projections.ts";

const TYPE = {
  name: "deal", fields: [
    { name: "name", kind: "text", label: "Name" }, { name: "amount", kind: "number", label: "Amount" }, { name: "contract", kind: "text", label: "Contract" },
    { name: "stage", kind: "text", label: "Stage", ftype: "status", options: ["lead", "won", "paid"], stageGates: { won: { enter: ["amount"], leave: [] }, lead: { enter: [], leave: ["name"] }, paid: { enter: ["contract"], leave: [] } } },
  ],
};
const ctx = { trace: { traceId: "0123456789abcdef0123456789abcdef" }, emit: (_n: string, _s: string, _p: Record<string, unknown>) => {} };
const refused = (fields: string[], toStage: string) => (e: unknown) => {
  const er = (e as { error?: { code?: string; details?: { reason?: string; fields?: { key: string; title: string; when: string }[]; toStage?: string } } }).error;
  assert.equal(er?.code, "validation.precondition_failed");
  assert.equal(er?.details?.reason, "fields_required");
  assert.deepEqual(er?.details?.fields?.map((f) => f.key), fields);
  assert.equal(er?.details?.toStage, toStage);
  return true;
};
async function setup(data: Record<string, unknown> = { name: "A", stage: "lead" }) {
  const rec = openRecords({ space: "sp_gate" });
  await rec.store.define({ add_types: [TYPE as never] });
  const id = mintRecordId();
  await rec.store.create("deal", id, data as never);
  return { rec, id };
}

test("the schema module keeps each stage's gates on the store field", () => {
  const g = stageGatesOf({ stages: [{ key: "a", title: "A", needToEnter: ["x"] }, { key: "b", title: "B" }, { key: "c", title: "C", needToLeave: ["y", ""] }] });
  assert.deepEqual(g, { a: { enter: ["x"], leave: [] }, c: { enter: [], leave: ["y"] } });
  assert.equal(stageGatesOf({ stages: [{ key: "a", title: "A" }] }), undefined);
  const f = toStoreField({ fieldTypes: [] } as never, { key: "stage", type: "status", title: "Stage", options: { stages: [{ key: "a", title: "A", needToEnter: ["x"] }] } } as never);
  assert.deepEqual(f["stageGates"], { a: { enter: ["x"], leave: [] } });
});

test("a stage change is refused while the fields to leave or enter are empty, and the refusal lists them with their titles", async () => {
  const { rec, id } = await setup({ name: "  ", stage: "lead" });
  await assert.rejects(rec.handlers["records.update"](ctx, { type: "deal", recordId: id, patch: { stage: "won" } }), (e) => {
    refused(["name", "amount"], "won")(e);
    assert.deepEqual((e as { error: { details: { fields: { title: string; when: string }[] } } }).error.details.fields.map((f) => [f.title, f.when]), [["Name", "leave"], ["Amount", "enter"]]);
    return true;
  });
  assert.equal((await rec.store.get("deal", id))?.data.stage, "lead", "nothing changed");
});

test("one update can fill the fields and change the stage", async () => {
  const { rec, id } = await setup();
  await assert.rejects(rec.handlers["records.update"](ctx, { type: "deal", recordId: id, patch: { stage: "won" } }), refused(["amount"], "won"));
  const r = await rec.handlers["records.update"](ctx, { type: "deal", recordId: id, patch: { stage: "won", amount: 0 } });
  assert.equal(r.record.fields.stage, "won");
  assert.equal(r.record.fields.amount, 0, "zero is an answer");
});

test("a change that does not move the stage, or a stage with no gate, is not held", async () => {
  const { rec, id } = await setup();
  await rec.handlers["records.update"](ctx, { type: "deal", recordId: id, patch: { name: "B" } });
  await rec.handlers["records.update"](ctx, { type: "deal", recordId: id, patch: { stage: "lead" } });
  const r = await rec.handlers["records.update"](ctx, { type: "deal", recordId: id, patch: { stage: "won", amount: 5 } });
  assert.equal(r.record.fields.stage, "won");
  await assert.rejects(rec.handlers["records.update"](ctx, { type: "deal", recordId: id, patch: { stage: "paid" } }), refused(["contract"], "paid"));
});
