// @heavy docker
// P-L11_08: golden flow 7, second half, on the real engine: an agent's send is held by the Gate, a person approves it, and a second send expires untouched. Runs only with VYRE_HEAVY_DOCKER=1
// (the l2-heavy job). A todo until the gaps in GATE_GAPS close; then it must pass with no todo.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { todoOf } from "./02-space.ts";
import { GATE_GAPS, LIVE_FOR_GATE_REPLY, runAgentGate } from "./07-agent-gate.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the CLI runs in the real sandbox)";
const FAKE_CLI = fileURLToPath(new URL("../../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake

test("golden 7: an agent's send is held by the Gate, approved once, and a second one expires", { skip, todo: todoOf(GATE_GAPS) }, async () => {
  const { trail } = await runAgentGate(LIVE_FOR_GATE_REPLY, {
    vault: { secret: async () => KEY, signRs256: async () => "" },
    engineCli: { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)] },
  });
  assert.deepEqual(trail.failures, [], `\n${trail.report()}`);
});
