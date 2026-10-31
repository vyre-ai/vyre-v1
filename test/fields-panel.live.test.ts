// The Fields panel's new calls on a live daemon: Link to another record type (relation.add through schema.diff then schema.apply, both ends made), and the sensitive data check
// (schema.sensitivity.scan, then schema.set_label on the field it suggests).
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, seededDir } from "./memory-live-kit.ts";
import { addFieldOps, applyInput, createTypeOps, linkFieldOps } from "../apps/app/src/places/records/typeedit/model.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

let n = 0;
const ok = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `fp-${cap}-${++n}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};
const change = async (d: Daemon, ops: unknown[]): Promise<void> => {
  const preview = await ok(d, "schema.diff", { ops });
  assert.deepEqual(preview.problems, []);
  await ok(d, "schema.apply", applyInput(preview, ops as never));
};

test("fields panel live: Link to a record type makes both ends; the sensitive check suggests a field and Mark sets its label", async () => {
  const d = await boot(seededDir());
  try {
    const taken = ((await ok(d, "schema.types.list", {})).types as Array<{ key: string }>).map((t) => t.key);
    const made = createTypeOps({ name: "Deals", plural: "", icon: "table", takenKeys: taken });
    await change(d, made.ops);
    const contact = ((await ok(d, "schema.types.list", {})).types as Array<{ key: string; title: string; plural: string }>).find((t) => t.key === "contact")!;
    const far = ((await ok(d, "schema.types.get", { type: "contact" })).type.fields as Array<{ key: string }>).map((f) => f.key);
    const mine = ((await ok(d, "schema.types.get", { type: made.key })).type.fields as Array<{ key: string }>).map((f) => f.key);
    const link = linkFieldOps({ type: made.key, plural: "Deals", name: "", to: contact, takenKeys: mine, farKeys: far });
    await change(d, link.ops);
    const nearDef = ((await ok(d, "schema.types.get", { type: made.key })).type.fields as Array<{ key: string; type: string }>).find((f) => f.key === link.key);
    assert.equal(nearDef?.type, "relation");
    const farFields = (await ok(d, "schema.types.get", { type: "contact" })).type.fields as Array<{ key: string; type: string }>;
    assert.ok(farFields.some((f) => f.type === "relation" && f.key === (link.ops[0]!.def as { inverse: string }).inverse), "the Contact type got the other end");

    // sensitive data check: a field named like an ID number is suggested, and Mark sets its label
    const add = addFieldOps({ type: made.key, name: "SSN", fieldType: "text", required: false, takenKeys: [...mine, link.key] });
    await change(d, add.ops);
    await ok(d, "records.create", { type: made.key, fields: { name: "Acme", [add.key]: "123-45-6789" } });
    const scan = (await ok(d, "schema.sensitivity.scan", { type: made.key })).suggestions as Array<{ field: string; kind: string; matches: number; suggestedLabel: string }>;
    const hit = scan.find((s) => s.field === add.key);
    assert.ok(hit, `the scan suggests ${add.key}`);
    assert.equal(hit.kind, "id_number");
    assert.ok(hit.matches >= 1);
    await ok(d, "schema.set_label", { type: made.key, field: add.key, label: hit.suggestedLabel });
    const labelled = ((await ok(d, "schema.types.get", { type: made.key })).type.fields as Array<{ key: string; label?: string }>).find((f) => f.key === add.key);
    assert.equal(labelled?.label, hit.suggestedLabel);
  } finally { await d.stop(); }
});
