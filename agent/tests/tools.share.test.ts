// A large object several tools take is shown to the model once (rc.41): the three SyncSpec tools said the same 6.6 kB spec three times. The first shows it in full, the others point at it, and the server still checks every field of every call.
import test from "node:test";
import assert from "node:assert/strict";
import { loadGenerated } from "../src/tools/harness.ts";
import { shareRepeats, SHARE_MIN_CHARS } from "../src/tools/share.ts";
import { validateInput } from "../../generated/validators.ts";
import { spec } from "../../test/support/sync-live.ts";

const { catalog } = loadGenerated();
const tool = (n: string) => catalog.byName(n)!;
const specOf = (n: string): { description?: string; properties?: unknown } =>
  (tool(n).inputSchema as { properties: Record<string, { description?: string; properties?: unknown }> }).properties[
    "spec"
  ]!;

test("the SyncSpec is shown in full by one tool and pointed at by the other two", () => {
  const full = ["sync_specs_validate", "sync_specs_preview", "sync_specs_apply"].filter(
    (n) => specOf(n).properties !== undefined,
  );
  assert.deepEqual(full, ["sync_specs_validate"], "the one a model meets first carries the shape");
  for (const n of ["sync_specs_preview", "sync_specs_apply"])
    assert.match(specOf(n).description ?? "", /The same spec as sync_specs_validate: read its shape there\./);
  assert.ok(JSON.stringify(specOf("sync_specs_validate")).length >= SHARE_MIN_CHARS);
});

test("no other tool is shared: the Automation definition and the goal finish keep their own copies", () => {
  for (const n of ["automations_validate", "automations_update", "automations_draft_save", "goals_update"]) {
    const props = (tool(n).inputSchema as { properties: Record<string, { description?: string }> }).properties;
    assert.ok(!Object.values(props).some((p) => /read its shape there/.test(p.description ?? "")), n);
  }
});

test("a full real spec is still accepted by each of the three capabilities, and a spec missing a required part is still refused by each", () => {
  const real = spec();
  for (const cap of ["sync_specs.validate", "sync_specs.preview", "sync_specs.apply"]) {
    const input = cap === "sync_specs.apply" ? { spec: real, idempotencyKey: "k1" } : { spec: real };
    assert.deepEqual(validateInput(cap, 1, input), [], `${cap} takes a real spec`);
    const broken = { ...real, app: undefined };
    assert.notDeepEqual(
      validateInput(cap, 1, cap === "sync_specs.apply" ? { spec: broken, idempotencyKey: "k1" } : { spec: broken }),
      [],
      `${cap} still checks the spec`,
    );
  }
});

test("only what repeats and is large is shared: small properties and the first occurrence are left whole", () => {
  const d = (name: string, p: unknown) => ({ name, inputSchema: { type: "object", properties: p } }) as never;
  const big = {
    type: "object",
    properties: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`field_${i}`, { type: "string" }])),
  };
  const small = { type: "string" };
  const out = shareRepeats(
    [
      d("a", { x: big, y: small }),
      d("b", { x: big, y: small }),
      d("c", { z: { ...big, extra: 1 } }),
      d("e", { x: big }),
    ],
    [["a", "b", "c"]],
  );
  assert.deepEqual((out[0]!.inputSchema as { properties: unknown }).properties, { x: big, y: small });
  const b = (out[1]!.inputSchema as { properties: Record<string, { description?: string }> }).properties;
  assert.match(b["x"]!.description!, /same x as a/);
  assert.deepEqual(b["y"], small);
  assert.deepEqual(
    (out[2]!.inputSchema as { properties: unknown }).properties,
    { z: { ...big, extra: 1 } },
    "not equal, so not shared",
  );
  assert.deepEqual(
    (out[3]!.inputSchema as { properties: unknown }).properties,
    { x: big },
    "a tool outside every group keeps its own copy",
  );
});
