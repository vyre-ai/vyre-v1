// Lane L6 goes live (P-L6_LIVE): the journeys handler table equals the frozen manifest, capability for capability, so the loader finds a handler for every one and none is left over.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../impl.ts";

const mine = registry.capabilities.filter((c) => c.module === "journeys").map((c) => c.name).sort();

test("journeys live: the handler map equals the manifest's 15 capabilities", () => {
  assert.equal(mine.length, 15);
  assert.deepEqual(Object.keys(handlers).sort(), mine);
  for (const name of mine) assert.equal(typeof (handlers as Record<string, unknown>)[name], "function", `${name} has a handler function`);
});
