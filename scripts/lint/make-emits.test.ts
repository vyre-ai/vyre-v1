import test from "node:test";
import assert from "node:assert/strict";
import { checkMakeEmits } from "./make-emits.ts";

const events = [
  { name: "form.created", subject: { type: "form", id: "/formId" } },
  { name: "form.deleted", subject: { type: "form", id: "/formId" } },
  { name: "record.created", subject: { type: "record", id: "/recordId" } },
  { name: "audit.noted", subject: { type: "entity", id: "/id" } },
];
const cap = (name: string, type: string, emits: string[], create = true) => ({ name, emits, resource: { create, type } });

test("make-emits: a creating capability with no event on its type is a finding", () => {
  const hits = checkMakeEmits([cap("forms.create", "form", []), cap("campaigns.create", "campaign", ["audit.noted"])], events);
  assert.deepEqual(hits.map((h) => h.cap), ["forms.create", "campaigns.create"]);
  assert.match(hits[0]!.message, /emits nothing/);
  assert.match(hits[1]!.message, /emits: audit.noted/);
});

test("make-emits: an event whose subject is the made type passes; an ending event or another type does not count", () => {
  assert.deepEqual(checkMakeEmits([cap("forms.create", "form", ["form.created"])], events), []);
  assert.equal(checkMakeEmits([cap("forms.create", "form", ["form.deleted"])], events).length, 1, "deleted never registers");
  assert.equal(checkMakeEmits([cap("forms.create", "form", ["record.created"])], events).length, 1, "a record event does not register a form");
});

test("make-emits: capabilities that do not create a resource are ignored", () => {
  assert.deepEqual(checkMakeEmits([cap("forms.list", "form", [], false)], events), []);
});
