// A Flow's filters and `{{ }}` are checked when it is saved (r40 audit, gaps 2, 3, 4): the key must exist on the trigger, the variable must exist in the scope, and the line names the nearest valid one.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { readsOf } from "../../../lib/flow-reads.ts";
import { codeOf, harness } from "../fixtures/db.ts";
import { alice, create, goodDefinition, node } from "../fixtures/seed.ts";
import { filterIssues, filterKeys, readIssues, variableIssues } from "../reads.ts";
import type { Definition } from "../projections.ts";

const def = (triggers: Definition["triggers"], ...nodes: Definition["nodes"]): Definition => ({ triggers, nodes });
const say = (d: Definition): string[] => readIssues(d).map((i) => i.message);

test("the scanner finds the names a text reads and leaves functions, quotes and words alone", () => {
  const names = (s: string): string[] => readsOf(s).map((r) => r.text);
  assert.deepEqual(names("Hi {{trigger.record.name}}, {{ steps.send.out.messageId }}"), [
    "trigger.record.name",
    "steps.send.out.messageId",
  ]);
  assert.deepEqual(names("{{ len(trigger.rows) > 2 && vars.go }}"), ["trigger.rows", "vars.go"]);
  assert.deepEqual(names("{{ 'trigger.nope' + 1 }}"), []);
  assert.deepEqual(names("{{ now() }}"), []);
  assert.deepEqual(names("{{ steps.a.out.rows[0].id }}"), ["steps.a.out.rows[0].id"]);
});

test("a record_change filter written with `field` is refused, and the line says `fields`", () => {
  const out = filterIssues(def([{ key: "record_change", filter: { type: "contact", field: "status" } }]));
  assert.equal(out.length, 1);
  assert.match(out[0]!.message, /uses "field", which this trigger does not have\. Use "fields"\./);
  assert.deepEqual(filterIssues(def([{ key: "record_change", filter: { type: "contact", fields: ["status"] } }])), []);
});

test("a form_submit filter on `recordType` is refused and points at `type`; the keys it accepts are the keys its payload carries", () => {
  const out = filterIssues(def([{ key: "form_submit", filter: { recordType: "contact" } }]));
  assert.equal(out.length, 1);
  assert.match(out[0]!.message, /Use "type"/);
  assert.deepEqual(filterIssues(def([{ key: "form_submit", filter: { type: "contact" } }])), []);
});

test("the class: every event trigger accepts exactly the keys its payload and filter declare, and refuses any other", () => {
  let checked = 0;
  for (const t of registry.triggers) {
    const keys = filterKeys(t.key);
    if (!keys) continue;
    checked++;
    assert.ok(keys.length > 0, `${t.key} accepts no filter key`);
    assert.equal(
      keys.includes("record"),
      false,
      `${t.key} lets a filter name the record, which its event does not carry`,
    );
    assert.deepEqual(
      filterIssues(
        def([{ key: t.key, filter: Object.fromEntries(keys.map((k) => [k, k === "fields" ? ["x"] : "x"])) }]),
      ),
      [],
    );
    assert.equal(filterIssues(def([{ key: t.key, filter: { zzzNotAKey: 1 } }])).length, 1, t.key);
  }
  assert.ok(checked >= 6, `only ${checked} event triggers checked`);
});

test("an unknown variable is an error that names it and the nearest valid one", () => {
  const form = [{ key: "form_submit" }];
  const email = (to: string) => node("m", "send_email", { to, subject: "s", body: "b" });
  assert.match(
    say(def(form, email("{{trigger.recordtype}}")))[0]!,
    /\{\{trigger\.recordtype\}\} is not a variable\. Did you mean trigger\.type\?/,
  );
  assert.match(say(def(form, email("{{trigger.email}}")))[0]!, /After trigger you can use/);
  assert.match(say(def(form, email("{{ trigr.type }}")))[0]!, /Did you mean trigger\.type\?/);
  assert.match(say(def(form, email("{{ nope.x }}")))[0]!, /A variable starts with trigger/);
  assert.match(say(def(form, email("{{ now }}")))[0]!, /Use now\(\)/);
  assert.deepEqual(say(def(form, email("{{trigger.type}} {{trigger.record.email}} {{ now() }}"))), []);
});

test("steps.<id>.out is checked: an unknown step, a missing .out and a part the step does not return", () => {
  const d = (to: string) =>
    def(
      [{ key: "manual" }],
      node("find", "records.find", { type: "contact" }),
      node("m", "send_email", { to, subject: "s", body: "b" }),
    );
  assert.match(
    say(d("{{steps.fnd.out.rows}}"))[0]!,
    /step called "fnd", which this Flow does not have\. Did you mean steps\.find\.out/,
  );
  assert.match(say(d("{{steps.find.rows}}"))[0]!, /under steps\.find\.out, so use steps\.find\.out\.rows/);
  assert.match(say(d("{{steps.find.out.records}}"))[0]!, /Did you mean steps\.find\.out\.rows\?/);
  assert.deepEqual(say(d("{{steps.find.out.rows}} {{steps.find.out.rows.0.email}} {{steps.find.out.count}}")), []);
});

test("every trigger's own sample keys are valid in {{trigger.*}} (the sample is what a test run reads)", () => {
  for (const t of registry.triggers) {
    for (const k of Object.keys(t.sample as Record<string, unknown>))
      assert.deepEqual(
        variableIssues(
          def([{ key: t.key }], node("m", "send_email", { to: `{{trigger.${k}}}`, subject: "s", body: "b" })),
        ),
        [],
        `${t.key}.${k}`,
      );
  }
});

test("the save refuses a Flow with a variable or filter that cannot work, and validate says the same", async () => {
  const h = harness();
  const bad = goodDefinition({
    triggers: [{ key: "record_change", filter: { type: "contact", field: "status" } }],
    nodes: [node("a", "records.update", { type: "contact", recordId: "{{trigger.id}}", patch: {} })],
  });
  await assert.rejects(h.call("automations.create", create({ definition: bad }), alice), (e) => {
    assert.equal(codeOf(e), "validation.bad_input");
    return true;
  });
  const checked = await h.call("automations.validate", { definition: bad }, alice);
  assert.equal(checked.ok, false);
  const lines = checked.issues.map((i: { message: string }) => i.message).join("\n");
  assert.match(lines, /Use "fields"/);
  assert.match(lines, /\{\{trigger\.id\}\} is not a variable\. Did you mean trigger\.recordId\?/);
});
