// providers.local_signins: which Claude Code and Codex sign-ins are on the computer this Space runs on, yes or no each. A signed-in person may ask; an agent may not; a Space whose host gave no reader
// (a Team Space) answers no for both. The answer is two booleans and nothing else (prototype scene personal-3-ai: the AI card shows an "on this computer" row only for a yes).
// @reads /modules/vault/handlers/providers.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as u from "../handlers/use.ts";
import * as p from "../handlers/providers.ts";
import { AGENT, contractErrors, harness } from "../fixtures/harness.ts";

const port = (present: { claudeCode: boolean; codex: boolean }) => ({
  has: () => true,
  active: () => false,
  start: async () => ({ url: "", needsCode: false, expiresInSec: 900 }),
  step: async () => ({ state: "failed" as const, message: "" }),
  cancel: () => undefined,
  localPresent: () => present,
});

test("a person gets a yes or no for each engine, and nothing else", async () => {
  const h = harness();
  u.configureVault({ sinks: {}, signin: port({ claudeCode: true, codex: false }) });
  try {
    const got = await p.localSignins(h.ctx, {});
    assert.deepEqual(got, { claudeCode: true, codex: false });
    assert.deepEqual(contractErrors("providers.local_signins", "out", got), []);
  } finally {
    u.configureVault(null);
  }
});

test("both no where the host gave no reader, and an agent is refused", async () => {
  const h = harness();
  u.configureVault({ sinks: {} });
  try {
    assert.deepEqual(await p.localSignins(h.ctx, {}), { claudeCode: false, codex: false });
    h.actAs("agent", AGENT);
    await assert.rejects(() => p.localSignins(h.ctx, {}), /something a person does/);
  } finally {
    u.configureVault(null);
  }
});
