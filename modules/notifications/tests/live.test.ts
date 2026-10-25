// Lane L6 goes live (P-L6_LIVE): the notifications handler table equals the frozen manifest, capability for capability, so the loader finds a handler for every one and none is left over.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../impl.ts";

const mine = registry.capabilities.filter((c) => c.module === "notifications").map((c) => c.name).sort();

test("notifications live: the handler map equals the manifest's 20 capabilities", () => {
  assert.equal(mine.length, 20);
  assert.deepEqual(Object.keys(handlers).sort(), mine);
  for (const name of mine) assert.equal(typeof (handlers as Record<string, unknown>)[name], "function", `${name} has a handler function`);
});

// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.
