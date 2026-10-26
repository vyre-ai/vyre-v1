// Lane L3 goes live (P-L3_LIVE): the projects handler table equals the frozen manifest, capability for capability, so the loader finds a handler for every one and none is left over.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../impl.ts";

const mine = registry.capabilities.filter((c) => c.module === "projects").map((c) => c.name).sort();

test("projects live: the handler map equals the manifest's 24 capabilities", () => {
  assert.equal(mine.length, 22);
  assert.deepEqual(Object.keys(handlers).sort(), mine);
  for (const name of mine) assert.equal(typeof (handlers as Record<string, unknown>)[name], "function", `${name} has a handler function`);
});
