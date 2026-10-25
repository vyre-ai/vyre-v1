// @heavy docker
// The core proof for agents (P-L2_23): a person's message to an agent produces a streamed reply through the REAL chain, with a CLI engine running in the REAL sandbox. The turn engine, the session
// opener (Vault fill, pool), the default sandbox plan (bubblewrap with the network wall on the Linux runner), the work folder and the socket MCP bridge are the production ones. Fakes: the CLI program
// itself (host/tests/fixtures/fake-cli-driver/fake-cli.mjs, swapped in for `claude` through the engine host's `cli` option and exposed read-only in the sandbox), the Vault value, the minted MCP session,
// and the capabilities the engine calls on other modules. Asserted: the reply lands in the chat thread through the bridge, once, under the engine's message id; usage is recorded with the Vault item.
// Runs only with VYRE_HEAVY_DOCKER=1 (the l2-heavy job); with it on, a missing bwrap fails the test.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { hostSeams } from "../impl.ts";
import { handlers } from "../impl.ts";
import { closeDefaultSandbox, ensureRuntime } from "../runtime.ts";
import { harness } from "../fixtures/harness.ts";
import type { EngineHostSeam } from "../runtime.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1";
const FAKE_CLI = fileURLToPath(new URL("../../../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const THREAD = "thr_cli";
/** A real process takes real time: wait on the clock, not on event-loop turns. */
async function waitFor(cond: () => boolean, ms = 30_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("waitFor: condition never became true");
    await new Promise<void>((r) => setTimeout(r, 50));
  }
}
const THREADS = [{ threadId: THREAD, kind: "chat", starter: "usr_dana", agents: [{ agentId: "agt_intake", mode: "lead" as const }] }];
const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-engine-cli-")));
fs.chmodSync(data, 0o755);
after(async () => { await closeDefaultSandbox(); fs.rmSync(data, { recursive: true, force: true }); });

test("a message to an agent on a Claude Code account streams a reply into the chat, from a CLI running in the sandbox, and the usage is recorded against the Vault item", { skip }, async () => {
  assert.equal(spawnSync("bwrap", ["--version"]).status, 0, "bwrap is not installed");
  const mcp = http.createServer((_q, r) => { r.writeHead(200, { "content-type": "application/json" }); r.end("{}"); });
  await new Promise<void>((ok) => mcp.listen(0, "127.0.0.1", ok));
  const calls: Array<{ cap: string; input: Record<string, unknown>; as: string | undefined }> = [];
  const posts: Array<{ agentId: string; threadId: string; body: string; clientId: string }> = [];
  const host: EngineHostSeam = {
    holder: "host:spc_clitest", now: () => 1_760_000_000_000, dataDir: data,
    cli: { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)] },
    async call(cap, input, as) {
      calls.push({ cap, input: input as Record<string, unknown>, as });
      if (cap === "engine.account.resolve") return { accountRef: "#Dana_Claude", payer: "usr_dana", reason: "starter", allowed: true, itemId: "vit_claude" };
      if (cap === "engine.accounts.list") return { accounts: [{ ref: "#Dana_Claude", driver: "claude_code", kind: "subscription" }] };
      if (cap === "engine.turn.record_usage") return {};
      if (cap === "agents.get") return { agent: { name: "Intake", role: "You answer intake questions." } };
      throw new Error(`unexpected ${cap}`);
    },
    session: {
      source: { lookup: async (handle) => (handle === "#Dana_Claude.setup_token" ? { kind: "value", itemId: "vit_claude", value: "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ", spaceOnly: false, injectIntoDeployments: false } : { kind: "unknown" }) },
      reportMiss: () => undefined,
      mcp: {
        mint: async () => ({ sessionId: "ses_1", sessionToken: "vys_token_1_0123456789abcdef0123456789", url: `http://127.0.0.1:${(mcp.address() as AddressInfo).port}/mcp`, expiresAt: 9_999_999_999_999 }),
        close: async () => undefined,
      },
    },
    postAs: async (agentId, post) => { posts.push({ agentId, threadId: post.threadId, body: post.body, clientId: post.clientId }); return {}; },
  };
  const h = harness({ threads: THREADS });
  hostSeams.setEngineHost(host);
  try {
    const engine = (await ensureRuntime(h.ctx))!;
    assert.ok(engine, "the runtime is built from the host half");
    await handlers["engine.stop"]!(h.ctx as never, { threadId: THREAD } as never).catch(() => undefined);   // opens the thread through threads.get
    engine.receive({ threadId: THREAD, author: { kind: "person", id: "usr_dana" }, body: "hello" });
    await waitFor(() => posts.length > 0);
    await engine.idle(THREAD);
    assert.equal(posts.length, 1, "one reply in the chat");
    assert.deepEqual([posts[0]!.agentId, posts[0]!.threadId, posts[0]!.body], ["agt_intake", THREAD, "Hello from the fake engine."]);
    assert.equal(posts[0]!.clientId, engine.messages(THREAD).filter((m) => m.author.kind === "agent")[0]!.id, "the chat message id is the engine message id");
    const usage = calls.filter((c) => c.cap === "engine.turn.record_usage");
    assert.equal(usage.length, 1);
    assert.deepEqual([usage[0]!.input["tokensIn"], usage[0]!.input["tokensOut"], usage[0]!.input["itemId"], usage[0]!.as], [11, 7, "vit_claude", "usr_dana"]);
    assert.ok(fs.existsSync(path.join(data, "work", "usr_dana", THREAD)), "the CLI worked in the person-and-thread folder");
  } finally {
    hostSeams.setEngineHost(null);
    mcp.close();
  }
});
