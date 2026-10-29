// Package export stays off until a later review. The handlers and the table remain.
import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness } from "../fixtures/db.ts";
import { alice, create } from "../fixtures/seed.ts";

test("package export and import are not available yet", async () => {
  const h = harness();
  const made = await h.call("automations.create", create({ name: "Welcome" }), alice);
  const id = made.automation.id as string;
  const calls = [
    h.call("automations.packages.list", {}, alice),
    h.call("automations.packages.export", { automationId: id, name: "Welcome pack" }, alice),
    h.call("automations.packages.import", { packageId: "pkg_missing" }, alice),
  ];
  for (const call of calls) {
    await assert.rejects(call, (e: unknown) => {
      assert.equal(codeOf(e), "internal.unavailable");
      assert.match(String((e as { error?: { message?: string } }).error?.message ?? ""), /not available yet/);
      return true;
    });
  }
});

test("moving runs onto a new version is not available yet", async () => {
  const h = harness();
  const id = (await h.call("automations.create", create({ name: "Welcome" }), alice)).automation.id as string;
  const calls = [
    h.call("automations.migration_preview", { automationId: id, toVersion: 1 }, alice),
    h.call("automations.migrate_runs", { automationId: id, toVersion: 1, runIds: ["run_a1b2c3"] }, alice),
  ];
  for (const call of calls) {
    await assert.rejects(call, (e: unknown) => {
      assert.equal(codeOf(e), "internal.unavailable");
      assert.match(String((e as { error?: { message?: string } }).error?.message ?? ""), /not available yet/);
      return true;
    });
  }
});
