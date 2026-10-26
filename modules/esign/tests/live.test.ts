// Lane L8 goes live (P-L8_LIVE): the esign handler table equals the frozen manifest, capability for capability, so the loader finds a handler for every one and none is left over.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../impl.ts";

const mine = registry.capabilities.filter((c) => c.module === "esign").map((c) => c.name).sort();

test("esign live: the handler map equals the manifest's capabilities", () => {
  assert.ok(mine.length > 0);
  assert.deepEqual(Object.keys(handlers).sort(), mine);
  for (const name of mine) assert.equal(typeof (handlers as Record<string, unknown>)[name], "function", `${name} has a handler function`);
});
