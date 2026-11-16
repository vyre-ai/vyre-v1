import test from "node:test";
import assert from "node:assert/strict";
import { controlsFor } from "./form-model.ts";

import { arrangeControls } from "./form-model.ts";
import { fallbackKinds, fieldsOf, hasEntry } from "./form-table.ts";
import { registry } from "../../../../../../generated/registry.ts";

test("the form table has an entry for every step kind the server lists, or names the kinds that fall back", () => {
  const kinds = registry.steps.map((s) => s.key);
  assert.deepEqual(fallbackKinds(kinds), [], "every server kind is in the table");
  for (const s of registry.steps) {
    const props = Object.keys((s.input as { properties?: object } | undefined)?.properties ?? {});
    const spec = fieldsOf(s.key) ?? [];
    // a listed field must exist in the schema (a typo in the table would hide a field); every schema field is reachable (listed or under Details)
    for (const f of spec) assert.ok(props.includes(f.name), `${s.key}: ${f.name} is not a field of the step`);
  }
  assert.ok(hasEntry("send_email"));
});

test("a step's controls come in a person's order with their words, and a needed field is never under Details", () => {
  const schema = {
    properties: {
      cc: { type: "string" },
      body: { type: "string" },
      subject: { type: "string" },
      to: { type: "string" },
    },
    required: ["to", "body"],
  };
  const { main, details } = arrangeControls("send_email", controlsFor(schema));
  assert.deepEqual(
    main.map((c) => `${c.name}:${c.label}`),
    ["to:To", "subject:Subject", "body:Message"],
  );
  assert.deepEqual(
    details.map((c) => c.label),
    ["Cc"],
  );
});
