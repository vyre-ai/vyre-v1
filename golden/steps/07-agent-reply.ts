// Golden flow 7, first half: a person talks to an agent on a booted daemon and the agent's reply streams back (spec 2.14 and 4.6; ARCH 4.8). The person's own Claude account is a Vault
// item (kind ai_subscription, Mine); their client unlocks the person key on this node (POST /local/vault/key/unlock, loopback, ruling 62); the engine opens a session with the CLI driver, the
// account's token is filled in at the last moment, and the reply lands in the thread with a turn row that holds the usage. Every call goes through the gateway with a real token.
// The CLI is the test stand-in for `claude` (host/tests/fixtures/fake-cli-driver/fake-cli.mjs): the first word of the prompt picks what it streams ("hello" is two text deltas and usage).
import assert from "node:assert/strict";
import { makeBundle } from "../../client/src/crypto/keys.ts";
import { bootFlowSpace, expectStatus, short, Trail } from "./02-space.ts";
import type { Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";

export const LIVE_FOR_REPLY = ["vault", "engine", "agents", "files", "access", "devices", "tasks", "runs", "chat"];

/** Why this is a todo today. Each line names the PR it waits on. */
export const REPLY_GAPS: Gap[] = [
  { packet: "PR 472 (P-L4_LIVE)", lane: "L4", what: "files migrations never create files_file, so agents.create answers 500" },
  { packet: "chat live (no open PR)", lane: "L2", what: "the chat module has no handlers, so a host that boots it live is refused and chat.start and chat.post do not exist" },
  { packet: "PR 471 (P-L7_LIVE)", lane: "L7", what: "signed-in steps and the vault need the L7 modules live" },
  { packet: "lead", lane: "L11", what: "how the daemon is told to launch host/tests/fixtures/fake-cli-driver/fake-cli.mjs instead of claude: startDaemon takes engineCli (cli options only), the launcher wrap is not reachable from a booted daemon" },
];

const TOKEN = "sk-ant-oat01-GOLDENFAKE0123456789abcdefXYZ";
/** Argon cost for the throwaway person key: the minimum the module accepts. */
const TEST_ARGON = { memoryKiB: 8, iterations: 1, parallelism: 1 };

export async function runAgentReply(live: readonly string[], engineCli?: unknown): Promise<{ events: Observed[]; trail: Trail }> {
  const s = await bootFlowSpace(live, engineCli === undefined ? {} : { engineCli });
  const trail = new Trail();
  try {
    const admin = s.d.token;   // the owner bootstrap token: Olivia, on this node
    await trail.step("her client unlocks her person key on this node", async () => {
      const made = await makeBundle("seed-test-password-1", "recovery-code-1", { argon: TEST_ARGON });
      const res = await fetch(`${s.d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${admin}` }, body: JSON.stringify({ key: Buffer.from(made.personKey).toString("base64") }) });
      assert.equal(res.status, 204, `unlock: ${res.status} ${await res.text()}`);
    });
    const folder = await trail.step("a Mine folder holds her account", async () =>
      expectStatus(await s.call("vault.folders.create", admin, { idempotencyKey: "golden-7-folder", name: "Accounts", scope: "mine" }), 200, "vault.folders.create").folder.id as string,
    ["her client unlocks her person key on this node"]);
    await trail.step("her Claude account is a Mine ai_subscription item", async () => {
      expectStatus(await s.call("vault.item.put", admin, { idempotencyKey: "golden-7-item", folderId: folder!, name: "Olivia_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: TOKEN, secret: true }] }), 200, "vault.item.put");
    }, ["a Mine folder holds her account"]);
    const agent = await trail.step("an agent exists", async () => expectStatus(await s.call("agents.create", admin, { idempotencyKey: "golden-7-agent", name: "Mailer", role: "Writes the weekly note" }), 200, "agents.create").agent.agentId as string);
    const thread = await trail.step("she starts a chat with the agent", async () =>
      expectStatus(await s.call("chat.start", admin, { idempotencyKey: "golden-7-chat", kind: "chat", agentIds: [agent!] }), 200, "chat.start").thread.threadId as string,
    ["an agent exists"]);
    await trail.step("she says hello", async () => {
      expectStatus(await s.call("chat.post", admin, { idempotencyKey: "golden-7-hello", threadId: thread!, body: "hello" }), 200, "chat.post");
    }, ["she starts a chat with the agent", "her Claude account is a Mine ai_subscription item"]);
    await trail.step("the agent's streamed reply lands in the thread", async () => {
      const end = Date.now() + 10_000;
      for (;;) {
        const msgs = expectStatus(await s.call("chat.messages.list", admin, { threadId: thread! }), 200, "chat.messages.list").messages as { author?: { id?: string }; body?: string }[];
        if (msgs.some((m) => m.author?.id === agent)) return;
        if (Date.now() > end) throw new Error(`no reply from the agent after 10 s: ${short(msgs)}`);
        await new Promise((r) => setTimeout(r, 100));
      }
    }, ["she says hello"]);
    await trail.step("a turn row holds the usage", async () => {
      const turns = expectStatus(await s.call("engine.turns.list", admin, { threadId: thread! }), 200, "engine.turns.list").turns as { state: string; tokensIn: number; tokensOut: number }[];
      assert.ok(turns.some((t) => t.state === "completed" && t.tokensIn > 0 && t.tokensOut > 0), `turns ${short(turns)}`);
    }, ["the agent's streamed reply lands in the thread"]);
    return { events: await s.events(), trail };
  } finally { await s.stop(); }
}
