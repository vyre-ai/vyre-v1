// Lane L6 goes live (P-L6_LIVE): the automations handler table equals the frozen manifest, capability for capability, so the loader finds a handler for every one and none is left over.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../impl.ts";

const mine = registry.capabilities
  .filter((c) => c.module === "automations")
  .map((c) => c.name)
  .sort();

test("automations live: the handler map equals the manifest capabilities", () => {
  assert.equal(mine.length, 81); // 80, and automations.home (the first page's one read, AUTOMATIONS-BUILD-RC29 round four); 77, and the three for building by asking (automations.draft.propose, .proposal.accept, .proposal.discard, AUTOMATIONS-BUILD-RC29 phase 2); 73, and the four draft ones (automations.draft.save, .draft.discard, .make_live, .test_events, AUTOMATIONS-BUILD-RC29 1c and 1f); 61, the five Chrome watch capabilities (automations.watches.*, l-chrome2b), automations.set_owner (Make owner, l-share2) and automations.key_hosts.list, .allow, .remove, .pending, .pending_bind (where a Vault key may go, f-auto); and automations.runs_as.get (f-vaultuse, 12 Nov)
  assert.deepEqual(Object.keys(handlers).sort(), mine);
  for (const name of mine)
    assert.equal(typeof (handlers as Record<string, unknown>)[name], "function", `${name} has a handler function`);
});
