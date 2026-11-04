// What /usage tells an owner whose chat runs on their Claude Code subscription (owner test 4 Nov): the model the engine really ran, the cached input shown apart from the fresh, the size of the chat as the
// model last saw it, and the session limit the engine reported, read by the assistant itself. The real engine, the real CLI driver and the real sandbox around a CLI process: the fake claude of
// host/tests/fixtures/fake-cli-driver, which makes three requests in a turn and sums them in its result line the way Claude Code does.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, call, connect, hostLog, makeAgent, post, seededDir } from "./support/live.ts";

const FAKE_CLI = fileURLToPath(new URL("../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const cli = { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)] };

test("a Claude Code turn is recorded with the model the engine ran, its cached input apart from the fresh, and the size of the chat; the assistant reads the limit it reported", { timeout: 120_000 }, async () => {
  const dir = seededDir();
  const d = await boot(dir, null, { engineCli: cli });
  try {
    await connect(d);
    const agentId = await makeAgent(d, "Keeper");
    const threadId = (await call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "use-start" })).data.thread.threadId as string;
    assert.match(await post(d, threadId, agentId, "steps", "use-1"), /three requests made/);
    await d.hooks?.pump?.();

    const byModel = (await call(d, "engine.usage.query", { by: "model" })).data;
    assert.deepEqual(byModel.rows.map((r: { key: string }) => r.key), ["claude-sonnet-4-5"], `the model the engine named, not "unknown": ${JSON.stringify(byModel.rows)}`);
    const total = byModel.totals;
    // 3 requests of 5 fresh + 40,000 cached + 100, 200 and 300 written
    assert.deepEqual([total.turns, total.tokensIn, total.cachedIn, total.tokensOut], [1, 15 + 120_000 + 600, 120_000, 60]);

    // the chat's size is what the last request carried (5 + 40,000 + 300), not the sum of three requests
    const use = (await call(d, "engine.usage.get", { threadId, agentId })).data;
    assert.equal(use.context.used, 40_305, JSON.stringify(use));
    assert.equal(Math.round(use.session.pct), 42);
    assert.equal(use.source, "provider");

    // what the latest turn really ran on is on the record, and the usage by account names the account that paid
    assert.equal(use.lastTurn.model, "claude-sonnet-4-5");
    assert.equal(use.lastTurn.account.provider, "anthropic");
    assert.match(use.lastTurn.paid, / · your sign-in$/, "the Paid by line names the account and says it is the asker's own sign-in (agent/src/accounts/paid.ts)");
    const byAccount = (await call(d, "engine.usage.query", { by: "account" })).data;
    assert.deepEqual(byAccount.rows.map((r: { key: string }) => r.key), [use.lastTurn.account.ref]);
    assert.equal(byAccount.rows[0].title, use.account.name, "the account has the name the person gave it");

    // the assistant reads the same limit with its own tool (the call that answered auth.unauthenticated)
    assert.match(await post(d, threadId, agentId, `tool tool_search ${JSON.stringify({ query: "usage limits context" })}`, "use-2a"), /tool_search answered/);
    const asked = await post(d, threadId, agentId, `tool engine_usage_get ${JSON.stringify({ threadId, agentId })}`, "use-2");
    assert.match(asked, /engine_usage_get answered/, `${asked} ${hostLog(d)}`);
    assert.doesNotMatch(asked, /unauthenticated/);
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
