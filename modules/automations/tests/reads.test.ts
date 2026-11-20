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

test("a form link made in one step is usable in the email after it, and a mistyped output is caught", () => {
  const flow = (url: string) =>
    def(
      [{ key: "form_submit" }],
      node("link", "forms.link_create", { formId: "frm_a1b2c3", recordId: "{{trigger.recordId}}" }),
      node("mail", "send_email", { to: "{{trigger.record.email}}", subject: "s", body: url }),
    );
  assert.deepEqual(say(flow("Finish here: {{steps.link.out.url}}")), []);
  assert.match(say(flow("{{steps.link.out.link}}"))[0]!, /After steps\.link\.out you can use expiresAt, url/);
});

test("a {{journey.x}} has to be a value some Journey carries: refused at save and said by validate, with what they carry", async () => {
  const h = harness();
  h.callee("journeys.list", () => ({
    journeys: [
      {
        variables: [
          { key: "plan", title: "Plan" },
          { key: "owner", title: "Owner" },
        ],
      },
    ],
  }));
  const flow = (text: string) =>
    goodDefinition({
      triggers: [{ key: "record_change", filter: { type: "contact" } }],
      nodes: [
        node("a", "records.update", { type: "contact", recordId: "{{trigger.recordId}}", patch: { note: text } }),
      ],
    });
  const ok = await h.call("automations.validate", { definition: flow("Plan: {{journey.plan}}") }, alice);
  assert.equal(
    ok.issues.some((i: { message: string }) => /journey/.test(i.message)),
    false,
  );
  const bad = await h.call("automations.validate", { definition: flow("{{journey.colour}}") }, alice);
  assert.equal(bad.ok, false);
  assert.match(
    bad.issues.map((i: { message: string }) => i.message).join("\n"),
    /\{\{journey\.colour\}\} is not a value any Journey carries\. They carry Plan, Owner\./,
  );
  await assert.rejects(
    h.call("automations.create", create({ definition: flow("{{journey.colour}}") }), alice),
    (e) => codeOf(e) === "validation.bad_input",
  );
  await h.call("automations.create", create({ definition: flow("{{journey.plan}}") }), alice);
});

test("an AI step names its skills: the save refuses one the Space does not have and says which it has; naming skills clears the 'switch to Task' warning", async () => {
  const h = harness();
  h.callee("skills.list", () => ({
    skills: [
      { name: "intake", enabled: true },
      { name: "letters", enabled: true },
      { name: "old", enabled: false },
    ],
  }));
  const flow = (skills: string[]) =>
    goodDefinition({
      triggers: [{ key: "manual" }],
      nodes: [
        {
          id: "a",
          key: "ai",
          input: { prompt: "Draft the welcome email with the intake skill." },
          ai: { skills },
        } as never,
      ],
    });
  const ok = await h.call("automations.validate", { definition: flow(["intake"]) }, alice);
  assert.equal(
    ok.issues.some((i: { message: string }) => /skill/.test(i.message)),
    false,
    "no warning, no refusal",
  );
  const bad = await h.call("automations.validate", { definition: flow(["intake", "nope", "old"]) }, alice);
  const lines = bad.issues.map((i: { message: string }) => i.message).join("\n");
  assert.match(lines, /The skill "nope" is not in this Space\. Skills: intake, letters\./);
  assert.match(lines, /The skill "old" is not in this Space/, "a switched-off skill is not there");
  await assert.rejects(
    h.call("automations.create", create({ definition: flow(["nope"]) }), alice),
    (e) => codeOf(e) === "validation.bad_input",
  );
  await h.call("automations.create", create({ definition: flow(["intake"]) }), alice);
  const plain = await h.call(
    "automations.validate",
    {
      definition: goodDefinition({
        triggers: [{ key: "manual" }],
        nodes: [{ id: "a", key: "ai", input: { prompt: "Use the intake skill." } } as never],
      }),
    },
    alice,
  );
  assert.ok(
    plain.issues.some((i: { message: string }) => /cannot load a skill/.test(i.message)),
    "without skills the warning stays",
  );
});


test("a text of nothing but `{{` is read in linear time (no backtracking on hostile input)", () => {
  const hostile = "{{".repeat(50_000);
  const t0 = Date.now();
  assert.deepEqual(readsOf(hostile), []);
  assert.ok(Date.now() - t0 < 100, `took ${Date.now() - t0} ms`);
  assert.deepEqual(readsOf("a {{ trigger.x }} b {{ steps.s.out.y }} {{ open"), [
    { text: "trigger.x", root: "trigger", segs: ["x"], fallback: false },
    { text: "steps.s.out.y", root: "steps", segs: ["s", "out", "y"], fallback: false },
  ]);
});

test("a version the server saved is marked checked; a version saved before the check has no mark, and an edit marks the new one", async () => {
  const { isChecked } = await import("../projections.ts");
  const h = harness();
  const made = await h.call("automations.create", create(), alice);
  const id = made.automation.id as string;
  assert.equal(isChecked(h.db, id, made.automation.version), true);
  h.db.run("DELETE FROM automations_checked WHERE automation_id = ?", id); // what a version saved before the check looks like
  assert.equal(isChecked(h.db, id, made.automation.version), false);
  const edited = await h.call(
    "automations.update",
    {
      automationId: id,
      definition: goodDefinition({
        nodes: [node("a", "records.update", { type: "contact", recordId: "rec_x", patch: {} })],
      }),
    },
    alice,
  );
  assert.equal(edited.automation.version, made.automation.version + 1);
  assert.equal(isChecked(h.db, id, edited.automation.version), true, "the edit passed the check");
  assert.equal(isChecked(h.db, id, made.automation.version), false, "the old version stays as it was");
});

test("a version made from a checked one stays checked, whether it came from a restore, a copy, a promote or a schedule-limit change; one made from an unchecked one stays unchecked", async () => {
  const { isChecked } = await import("../projections.ts");
  const h = harness();
  const made = await h.call("automations.create", create(), alice);
  const id = made.automation.id as string;
  // a copy of a checked Space automation is checked
  await h.call("automations.promote", { automationId: id, confirm: true }, alice);
  const copy = await h.call("automations.make_personal_copy", { automationId: id, name: "Copy" }, alice);
  assert.equal(isChecked(h.db, copy.automation.id, copy.automation.version), true, "copy of a checked one");
  // a restore of a checked version is checked; of an unchecked one is not
  await h.call(
    "automations.update",
    {
      automationId: id,
      definition: goodDefinition({
        nodes: [node("a", "records.update", { type: "contact", recordId: "rec_x", patch: {} })],
      }),
    },
    alice,
  );
  const versions = (await h.call("automations.versions", { automationId: id }, alice)).versions as {
    versionId: string;
    n: number;
  }[];
  const first = versions.find((v) => v.n === 1)!;
  const restored = await h.call("automations.restore_version", { automationId: id, versionId: first.versionId }, alice);
  assert.equal(isChecked(h.db, id, restored.automation.version), true, "restore of a checked version");
  h.db.run("DELETE FROM automations_checked WHERE automation_id = ?", id);
  const again = await h.call("automations.restore_version", { automationId: id, versionId: first.versionId }, alice);
  assert.equal(isChecked(h.db, id, again.automation.version), false, "restore of an unchecked version");
});
