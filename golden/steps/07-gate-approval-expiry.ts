// Golden flow 7: Gate approval and expiry (spec 2.14; ARCH 4.6). An agent's mail send is held by the Gate; a person approves one, and another expires untouched. The agent's send comes from a real
// engine turn (the CLI calling the mail tool over the loopback MCP session), so the whole flow lives in 07-agent-gate.ts and runs in the l2-heavy job (07-gate.heavy.test.ts) where the sandbox,
// bwrap and the fake CLI exist. The harness entry below runs the same steps when the heavy environment is on.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LIVE_FOR_GATE_REPLY, runAgentGate } from "./07-agent-gate.ts";
import type { Observed } from "../harness/index.ts";

const FAKE_CLI = fileURLToPath(new URL("../../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ";

export default async function steps(): Promise<Observed[]> {
  if (process.env["VYRE_HEAVY_DOCKER"] !== "1") throw new Error("flow 7 needs the sandbox: run it with VYRE_HEAVY_DOCKER=1 (the l2-heavy job)");
  const { events, trail } = await runAgentGate(LIVE_FOR_GATE_REPLY, {
    vault: { secret: async () => KEY, signRs256: async () => "" },
    engineCli: { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)] },
  });
  if (trail.failures.length) throw new Error(`flow 7 failed:\n${trail.report()}`);
  return events;
}
