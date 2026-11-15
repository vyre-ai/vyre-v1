import test from "node:test";
import assert from "node:assert/strict";
import { givenBy, wordsOf } from "./insert-data.ts";

test("what the trigger and earlier steps give is listed by step in words with samples; ids are never offered", () => {
  const rows = givenBy({
    triggerTitle: "A form is submitted",
    event: { email: "sam@brightpath.example", firstName: "Sam", formId: "frm_a1b2c3" },
    steps: [{ id: "find", key: "records.find" }],
    titleOf: () => "Find the lead",
    outputOf: () => ({ properties: { name: { type: "string", examples: ["Sam Reyes"] }, taskId: { type: "string" } } }),
  });
  assert.deepEqual(
    rows.map((r) => `${r.source} | ${r.name} | ${r.sample} | ${r.ref}`),
    [
      "A form is submitted | Email | sam@brightpath.example | trigger.email",
      "A form is submitted | First name | Sam | trigger.firstName",
      "Find the lead | Name | Sam Reyes | steps.find.out.name",
    ],
  );
  assert.equal(wordsOf("recordId"), null);
  assert.equal(wordsOf("created_at"), "Created at");
});
