// A refused engine.policy.set leaves the stored policy as it was: every field is checked before the first write (ruling 90, P-L11_32).
import test from "node:test";
import assert from "node:assert/strict";
import { extraHandlers } from "../handlers/extra/index.ts";
import { codeOf, harness } from "../fixtures/harness.ts";

const H = extraHandlers;

test("engine.policy.set: a bad label refuses the whole call, so the models and providers sent with it are not kept", async () => {
  const h = harness();
  const ctx = { ...h.ctx, call: async (cap: string, input: unknown) => (cap === "settings.get" ? { row: { value: null } } : cap === "settings.set_space" ? {} : h.ctx.call(cap, input)) };
  const before = JSON.stringify(await H["engine.policy.get"](ctx, {}));
  h.emitted.length = 0;
  let code = "none";
  try { await H["engine.policy.set"](ctx, { allowedAccounts: "company", allowedModels: ["claude-sonnet-5-5"], allowedProviders: ["anthropic"], labelProviders: { secret: ["anthropic"] } }); } catch (e) { code = codeOf(e); }
  assert.equal(code, "validation.bad_input");
  assert.equal(JSON.stringify(await H["engine.policy.get"](ctx, {})), before, "the stored policy is unchanged");
  assert.deepEqual(h.emitted, [], "and no policy_changed event was emitted");
});
