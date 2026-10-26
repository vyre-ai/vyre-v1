// @heavy docker
// P-GF_07b: on a failure the no-hold message carries the thread; the fake CLI times its MCP calls out at 20 s, so a hang reads as "mcp error" in the thread.
// P-L11_08: golden flow 7 on the real engine: an agent's send is held by the Gate, a person approves it, and a second send expires untouched. Runs only with VYRE_HEAVY_DOCKER=1 (the l2-heavy job).
// It runs the harness entry of the flow (07-gate-approval-expiry.ts), so the flow's own event list is checked by the same path golden/ uses.
import test from "node:test";
import assert from "node:assert/strict";
import { checkSequence } from "../harness/index.ts";
import flow from "../flows/07-gate-approval-expiry.flow.ts";
import steps from "./07-gate-approval-expiry.ts";
import { todoOf } from "./02-space.ts";
import { GATE_GAPS } from "./07-agent-gate.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the CLI runs in the real sandbox)";

test("golden 7: an agent's send is held by the Gate, approved once, and a second one expires", { skip, todo: todoOf(GATE_GAPS) }, async () => {
  const events = await steps();
  assert.deepEqual(checkSequence(flow.events, events), [], `events: ${events.map((e) => e.type).join(", ")}`);
});
