// @heavy docker
// P-L11_08: golden flow 7, first half, on the real engine: a person talks to an agent and the reply streams back from the fake CLI running in the platform's default sandbox (bubblewrap with the
// network wall on the Linux runner). Runs only with VYRE_HEAVY_DOCKER=1 (the l2-heavy job). A todo until the PRs in REPLY_GAPS land; then it must pass with no todo.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { todoOf } from "./02-space.ts";
import { LIVE_FOR_REPLY, REPLY_GAPS, runAgentReply } from "./07-agent-reply.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the CLI runs in the real sandbox)";
const FAKE_CLI = fileURLToPath(new URL("../../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ";

test("golden 7: a person talks to an agent and the reply streams back from the sandboxed CLI", { skip, todo: todoOf(REPLY_GAPS) }, async () => {
  const { trail } = await runAgentReply(LIVE_FOR_REPLY, {
    vault: { secret: async () => KEY, signRs256: async () => "" },
    engineCli: { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)] },
  });
  assert.deepEqual(trail.failures, [], `\n${trail.report()}`);
});
