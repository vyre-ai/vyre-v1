// The Space's automations.* settings reach Automations: the settings module announces a change and the module keeps the copy it reads. Nothing else ever wrote automations_policy.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { consumers } from "../impl.ts";
import { readPolicy } from "../projections.ts";

const announce = (h: ReturnType<typeof harness>, key: string, after: unknown): Promise<unknown> => consumers["automations.settings_sync"].run({ db: h.db } as never, { payload: { key, scope: "space", after } });

test("changing an automations setting changes the policy every run reads", async () => {
  const h = harness();
  assert.equal(readPolicy(h.db).runOnImport, false);
  assert.deepEqual(await announce(h, "automations.run_automations_on_import", true), ["automations.run_automations_on_import"]);
  assert.equal(readPolicy(h.db).runOnImport, true);
  await announce(h, "automations.max_chain_depth", 3);
  assert.equal(readPolicy(h.db).maxChainDepth, 3);
  assert.deepEqual(await announce(h, "gate.timeout_hours", 3), []);
});
