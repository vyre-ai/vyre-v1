// Lane L6 goes live (P-L6_LIVE): the automations handler table equals the frozen manifest, capability for capability, so the loader finds a handler for every one and none is left over.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../impl.ts";

const mine = registry.capabilities.filter((c) => c.module === "automations").map((c) => c.name).sort();

test("automations live: the handler map equals the manifest capabilities", () => {
  assert.equal(mine.length, 68);   // 61, the five Chrome watch capabilities (automations.watches.*, l-chrome2b), automations.set_owner (Make owner, l-share2) and automations.runs_as.get (f-vaultuse, 12 Nov)
  assert.deepEqual(Object.keys(handlers).sort(), mine);
  for (const name of mine) assert.equal(typeof (handlers as Record<string, unknown>)[name], "function", `${name} has a handler function`);
});
