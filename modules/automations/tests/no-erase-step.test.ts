// F77: deleting an agent for good is a person's own press; no Automation step can do it, so it is not in the step catalog.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";

test("neither deleting an agent for good nor purging a folder is a step an Automation can run", () => {
  const keys = (registry as unknown as { steps: Array<{ key: string }> }).steps.map((s) => s.key);
  for (const k of ["agents.delete_for_good", "agents.delete", "agents.delete_preview", "files.folder.purge"])
    assert.ok(!keys.includes(k), `${k} is not an Automation step`);
});
