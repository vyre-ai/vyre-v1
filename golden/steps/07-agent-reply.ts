// Golden flow 7, first half: a person talks to an agent on a booted daemon and the agent's reply streams back (spec 2.14 and 4.6; ARCH 4.8). The person's own Claude account is a Vault
// item (kind ai_subscription, Mine); their client unlocks the person key on this node (POST /local/vault/key/unlock, loopback, ruling 62); the engine opens a session with the CLI driver, the
// account's token is filled in at the last moment, and the reply lands in the thread with a turn row that holds the usage. Every call goes through the gateway with a real token.
// The CLI is the test stand-in for `claude` (host/tests/fixtures/fake-cli-driver/fake-cli.mjs): the first word of the prompt picks what it streams ("hello" is two text deltas and usage).
import assert from "node:assert/strict";
import { bootFlowSpace, expectStatus, short, Trail } from "./02-space.ts";
import type { Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";

export const LIVE_FOR_REPLY = ["vault", "engine", "agents", "files", "access", "devices", "tasks", "runs", "chat"];

/** Why this is a todo today. Each line names the PR it waits on. */
export const REPLY_GAPS: Gap[] = [
  { packet: "L2 engine (steward)", lane: "L2", what: "in the l2-heavy job every step up to the message passes (account in the Vault, agent, chat, engine bound), but the agent never answers within 40 s: the thread is created private (the stored message reads enc 2) and the engine has no runtime key to open it, or the reply is not delivered; the steward's own chat.live test fails in the same job" },
];

const TOKEN = "sk-ant-oat01-GOLDENFAKE0123456789abcdefXYZ";

export async function runAgentReply(live: readonly string[], opts: Parameters<typeof bootFlowSpace>[1] = {}): Promise<{ events: Observed[]; trail: Trail }> {
  const s = await bootFlowSpace(live, opts);
  const trail = new Trail();
  try {
    const admin = s.d.token;   // the owner bootstrap token: Olivia, on this node
    await trail.step("her client unlocks her person key on this node", async () => {
      // any 32 bytes will do as the person key: the client would have unwrapped it from the sign-in bundle (the heavy job installs no packages, so the client's key code is not imported here)
      const personKey = globalThis.crypto.getRandomValues(new Uint8Array(32));
      const res = await fetch(`${s.d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${admin}` }, body: JSON.stringify({ key: Buffer.from(personKey).toString("base64") }) });
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
      expectStatus(await s.call("engine.pool.status", admin, {}), 200, "engine.pool.status");   // the first engine call builds and binds the runtime, so the bridge has an engine to hand the message to
      expectStatus(await s.call("chat.post", admin, { idempotencyKey: "golden-7-hello", threadId: thread!, body: "hello", mentions: [{ kind: "agent", id: agent! }] }), 200, "chat.post");
    }, ["she starts a chat with the agent", "her Claude account is a Mine ai_subscription item"]);
    await trail.step("the agent's streamed reply lands in the thread", async () => {
      const end = Date.now() + 40_000;
      for (;;) {
        await s.d.hooks?.pump?.();   // the bridge consumer runs on the hook interval; force a pass the way the daemon's own timer does
        const msgs = expectStatus(await s.call("chat.messages.list", admin, { threadId: thread! }), 200, "chat.messages.list").messages as { author?: { kind?: string }; body?: string }[];
        if (msgs.some((m) => m.author?.kind === "agent" && (m.body ?? "").includes("Hello from the fake engine."))) return;
        if (Date.now() > end) throw new Error(`no reply from the agent after 40 s: ${short(msgs)}`);
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
