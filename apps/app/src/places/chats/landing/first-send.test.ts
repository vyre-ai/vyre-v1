import test from "node:test";
import assert from "node:assert/strict";
import { realAssistant } from "./model.ts";

test("a first message sent before the Assistant exists waits for its real id", async () => {
  let asked = 0;
  const call = (): unknown => (++asked < 3 ? { agents: [] } : { agents: [{ agentId: "agt_real", kind: "assistant" }] });
  assert.equal(await realAssistant("assistant", call, () => Promise.resolve()), "agt_real");
  assert.equal(asked, 3);
});

test("a real id needs no wait, and no Assistant at all is a plain null, never a refused call", async () => {
  assert.equal(await realAssistant("agt_known", () => { throw new Error("not asked"); }), "agt_known");
  assert.equal(await realAssistant("assistant", () => ({ agents: [] }), () => Promise.resolve(), 3), null);
});
