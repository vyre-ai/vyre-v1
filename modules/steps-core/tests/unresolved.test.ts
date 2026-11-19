// A `{{ }}` the Run cannot fill fails the step with a line that names it, instead of the step sending an empty value (r40 audit, gap 4).
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { callOf, node } from "../fixtures/seed.ts";
import { runStep } from "../handlers/control.ts";

const post = (text: string) =>
  node("m", "records.update", { type: "contact", recordId: "rec_a1", patch: { note: text } });
const failure = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return (e as { error?: { message?: string } }).error?.message ?? String(e);
  }
  return "";
};
const withTrigger = (kind: string) =>
  harness({ "records.update": () => ({ recordId: "rec_a1", version: 2 }) }, { run: { id: "run_t1", trigger: kind } });

test("a name that starts nowhere fails the step and says what a name starts with", async () => {
  const h = harness();
  const said = await failure(runStep(h.env, post("Hi {{ contact.name }}"), callOf({ trigger: {} })));
  assert.match(said, /\{\{contact\.name\}\} is not a variable\. A variable starts with trigger/);
  assert.equal(h.log.length, 0, "nothing was sent");
});

test("a part the trigger kind does not carry fails with the nearest it does, and nothing is sent", async () => {
  const h = withTrigger("form_submit");
  const said = await failure(
    runStep(
      h.env,
      post("{{trigger.recordtype}}"),
      callOf({ trigger: { formId: "frm_1", recordId: "rec_1", type: "contact", matched: true, record: {} } }),
    ),
  );
  assert.match(said, /Did you mean trigger\.type\?/);
  assert.equal(h.log.length, 0);
});

test("a part the trigger always carries and did not fails; a record field with no value is empty", async () => {
  const h = withTrigger("form_submit");
  const said = await failure(
    runStep(
      h.env,
      post("{{trigger.record.email}}"),
      callOf({ trigger: { formId: "frm_1", recordId: "rec_1", type: "contact", matched: true } }),
    ),
  );
  assert.match(said, /\{\{trigger\.record\.email\}\} has nothing to read: this trigger should carry "record"/);
  const ok = await runStep(
    h.env,
    post("[{{trigger.record.email}}]"),
    callOf({ trigger: { formId: "frm_1", recordId: "rec_1", type: "contact", matched: true, record: { name: "A" } } }),
  );
  assert.ok(ok);
  assert.deepEqual(h.only("records.update")[0]!.input, { type: "contact", recordId: "rec_a1", patch: { note: "[]" } });
});

test("a step with no result fails; one that ran is read; a single step tried alone is not held to earlier steps", async () => {
  const h = withTrigger("manual");
  const said = await failure(
    runStep(h.env, post("{{steps.find.out.count}}"), callOf({ trigger: {}, outputs: { other: {} } })),
  );
  assert.match(said, /step "find", which has no result in this run/);
  await runStep(h.env, post("{{steps.find.out.count}}"), callOf({ trigger: {}, outputs: { find: { count: 2 } } }));
  assert.equal((h.only("records.update")[0]!.input as { patch: { note: unknown } }).patch.note, 2);
  await runStep(h.env, post("{{steps.find.out.count}}"), callOf({ trigger: {}, sandbox: true, outputs: {} }));
});

test("a text of nothing but braces renders in linear time, and ordinary templates still render", async () => {
  const { renderText } = await import("../projections.ts");
  const t0 = Date.now();
  renderText("{{".repeat(50_000), {});
  renderText("{{ 1 }} }} ".repeat(8_000), {});
  assert.ok(Date.now() - t0 < 100, `took ${Date.now() - t0} ms`);
  assert.equal(renderText("a {{ 1 + 1 }} b {{ 'c' }} {{ open", {}), "a 2 b c {{ open");
  assert.equal(renderText("  {{ 2 * 3 }} ", {}), 6);
});
