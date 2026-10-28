// A package is a copy of a definition. The list is empty until someone exports one.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { alice, bob, create } from "../fixtures/seed.ts";

test("export stores a package, import makes a draft, and another person sees neither", async () => {
  const h = harness();
  const made = await h.call("automations.create", create({ name: "Welcome" }), alice);
  const id = made.automation.id as string;
  const empty = await h.call("automations.packages.list", {}, alice);
  assert.deepEqual(empty.packages, []);
  const saved = await h.call("automations.packages.export", { automationId: id, name: "Welcome pack" }, alice);
  assert.equal(saved.package.name, "Welcome pack");
  assert.equal(saved.package.sourceAutomationId, id);
  const listed = await h.call("automations.packages.list", {}, alice);
  assert.equal(listed.packages.length, 1);
  const imported = await h.call("automations.packages.import", { packageId: saved.package.id }, alice);
  assert.equal(imported.automation.name, "Welcome pack");
  assert.equal(imported.automation.status, "draft");
  assert.notEqual(imported.automation.id, id);
  const hidden = await h.call("automations.packages.list", {}, bob);
  assert.deepEqual(hidden.packages, []);
});
