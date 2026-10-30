// The company-wide Google and Microsoft connection can be changed by a person, never silently by an agent or an automation: the Gate holds it for approval.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";

test("an agent or automation changing the company-wide connection is held by the Gate; a person is not", async () => {
  for (const cap of ["google.dwd.setup", "google.dwd.set_excluded", "google.dwd.disable", "ms.consent.setup", "ms.consent.set_excluded", "ms.consent.disable"]) {
    const def = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
    assert.ok(def?.gate, `${cap} has a Gate rule`);
    assert.equal(def.gate.when, "actor.kind != 'person'", cap);
  }
});
