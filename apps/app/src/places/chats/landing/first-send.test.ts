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

test("the Assistant picked while it was still the placeholder starts the chat with the real one; nobody picked is the Assistant", async () => {
  const { startInput, startFailure } = await import("./model.ts");
  const placeholder = { id: "assistant", name: "Assistant", kind: "assistant" as const };
  assert.deepEqual(startInput([placeholder], "agt_real"), { agentIds: ["agt_real"] });
  assert.deepEqual(startInput([placeholder, { id: "agt_scout", name: "Scout", kind: "agent" as const }], "agt_real"), { agentIds: ["agt_real", "agt_scout"] });
  assert.deepEqual(startInput([], "agt_real"), { agentIds: ["agt_real"] });
  assert.deepEqual(startInput([{ id: "usr_maya", name: "Maya", kind: "person" as const }], "agt_real"), { agentIds: [], personId: "usr_maya" });
  assert.match(startFailure(new Error("no assistant yet")), /not ready yet/);
  assert.equal(startFailure(new Error("422")), "Could not start the chat.");
});
