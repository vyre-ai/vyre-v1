import test from "node:test";
import assert from "node:assert/strict";
import { asFixture, fieldsFromSchema, fixtureNote, shelfLines } from "./fields.ts";

const schema = {
  type: "object",
  required: ["type", "recordId"],
  properties: {
    type: { type: "string" },
    recordId: { type: "string" },
    limit: { type: "integer" },
    mailboxId: { type: "string" },
    mode: { type: "string", enum: ["skip", "run_once"] },
  },
};

test("schema fields include a missing required field and skip the account", () => {
  const fields = fieldsFromSchema(schema, { type: "contact" });
  assert.deepEqual(fields.map((field) => [field.name, field.presence, field.required, field.valueType]), [
    ["type", "value", true, "string"],
    ["recordId", "missing", true, "string"],
    ["limit", "missing", false, "number"],
    ["mode", "missing", false, "string"],
  ]);
  assert.deepEqual(fields.find((field) => field.name === "mode")?.enumValues, ["skip", "run_once"]);
});

test("the shelf names type, presence, and the fixture version", () => {
  const lines = shelfLines({ id: "evt_1" }, [
    { id: "find", title: "Find", output: asFixture(4, "records.find", { rows: [] }) },
    { id: "wait", title: "Wait", output: undefined },
  ]);
  assert.equal(lines[0]?.text, 'Trigger (object, value): {"id":"evt_1"}');
  assert.match(lines[1]?.text ?? "", /Find, version 4 \(object, value\)/);
  assert.equal(lines.length, 2);
  assert.equal(fixtureNote(4, "records.find"), "Fixture for records.find on definition version 4. Reads may run live. Writes and sends stay stubbed.");
});
