// A button trigger needs a Button field on its record type (r40 audit, gap 6): pressing it for a type without one says so in plain words, and the check says the same before the Flow goes live.
import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, create, goodDefinition, node } from "../fixtures/seed.ts";

const fieldsOf =
  (...fields: { key: string; type: string }[]) =>
  () => ({
    types: [{ key: "matter", title: "Matter", fields }],
  });
const make = async (h: Harness, config?: Record<string, unknown>): Promise<string> =>
  (
    await h.call(
      "automations.create",
      create({
        definition: goodDefinition({
          triggers: [{ key: "button", ...(config ? { config } : {}) }],
          nodes: [node("a", "records.update", { type: "matter", recordId: "{{trigger.recordId}}", patch: { x: 1 } })],
        }),
      }),
      alice,
    )
  ).automation.id as string;

test("pressing for a type with no Button field is refused in plain words", async () => {
  const h = harness();
  h.callee("schema.describe", fieldsOf({ key: "name", type: "text" }));
  const id = await make(h);
  await assert.rejects(
    h.call(
      "automations.run",
      { automationId: id, trigger: "button", payload: { type: "matter", recordId: "rec_1" } },
      alice,
    ),
    (e) => {
      assert.equal(codeOf(e), "validation.precondition_failed");
      assert.equal(reasonOf(e), "no_button_field");
      assert.match((e as { error: { message: string } }).error.message, /Matter has no Button field/);
      return true;
    },
  );
});

test("a type with a Button field runs; a press with no type named is not held up", async () => {
  const h = harness();
  h.callee("schema.describe", fieldsOf({ key: "go", type: "button" }));
  h.callee("records.get", () => ({ record: { fields: { name: "A" } } }));
  const id = await make(h);
  assert.ok(
    (
      await h.call(
        "automations.run",
        { automationId: id, trigger: "button", payload: { type: "matter", recordId: "rec_1" } },
        alice,
      )
    ).runId,
  );
  assert.ok((await h.call("automations.run", { automationId: id, trigger: "button" }, alice)).runId);
});

test("the record type the trigger names is checked when it is pressed with no type, and in validate", async () => {
  const h = harness();
  h.callee("schema.describe", fieldsOf({ key: "name", type: "text" }));
  const id = await make(h, { type: "matter" });
  await assert.rejects(
    h.call("automations.run", { automationId: id, trigger: "button" }, alice),
    (e) => reasonOf(e) === "no_button_field",
  );
  const def = goodDefinition({ triggers: [{ key: "button", config: { type: "matter" } }] });
  const checked = await h.call("automations.validate", { definition: def }, alice);
  assert.equal(checked.ok, false);
  assert.match(checked.issues.map((i: { message: string }) => i.message).join("\n"), /Matter has no Button field/);
  h.callee("schema.describe", fieldsOf({ key: "go", type: "button" }));
  assert.equal((await h.call("automations.validate", { definition: def }, alice)).ok, true);
});
