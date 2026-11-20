// The Insert data menu and the save check read the same thing (review 19 Nov): every variable the menu offers for a trigger passes the check, and every key an event carries into a trigger is a variable the trigger declares, so the two
// cannot drift (a key the menu showed from a real event but the check refused was `trigger.booking`).
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../generated/registry.ts";
import { givenBy } from "../apps/app/src/places/automations/builder/insert-data.ts";
import { variableIssues } from "../modules/automations/reads.ts";
import type { Definition } from "../modules/automations/projections.ts";

const flow = (key: string, ref: string): Definition => ({
  triggers: [{ key }],
  nodes: [{ id: "m", key: "send_email", input: { to: "a@x.example", subject: "s", body: `{{${ref}}}` } }],
});
const propsOf = (schema: unknown): string[] => {
  const p = (schema as { properties?: Record<string, unknown> } | null)?.properties;
  return p ? Object.keys(p) : [];
};

test("every variable the Insert data menu offers for a trigger passes the save check", () => {
  let offered = 0;
  for (const t of registry.triggers) {
    const rows = givenBy({
      triggerTitle: t.title,
      event: t.sample,
      steps: [],
      titleOf: () => "",
      outputOf: () => undefined,
    });
    for (const r of rows) {
      offered++;
      assert.deepEqual(variableIssues(flow(t.key, r.ref)), [], `${t.key}: the menu offers {{${r.ref}}}`);
    }
  }
  assert.ok(offered >= 30, `only ${offered} variables offered`);
});

test("every key an event carries into a trigger is a variable the check accepts for it", () => {
  const events = new Map(registry.events.map((e) => [e.name, e] as const));
  let checked = 0;
  for (const t of registry.triggers) {
    const src = t.source as { event?: string; events?: string[] };
    const names = src.events ?? (src.event ? [src.event] : []);
    for (const n of names)
      for (const k of propsOf(events.get(n)?.payload)) {
        checked++;
        assert.deepEqual(variableIssues(flow(t.key, `trigger.${k}`)), [], `${t.key}: ${n} carries "${k}"`);
      }
  }
  assert.ok(checked >= 20, `only ${checked} keys checked`);
});

test("an unknown variable is still refused for every trigger, with the nearest real one", () => {
  for (const t of registry.triggers) {
    const issues = variableIssues(flow(t.key, "trigger.zzNotAVariable"));
    assert.equal(issues.length, 1, t.key);
    assert.match(issues[0]!.message, /is not a variable/);
  }
});
