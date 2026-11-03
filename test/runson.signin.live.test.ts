// The engine on her computer signs in the way Claude Code does there by itself (lane l-runson; owner, 3 Nov): signed in on her Mac, the engine runs with her own engine home (~/.claude) and the
// account the Space would fill in is taken out; not signed in there, the Space's fill of her own account stands. Two real daemons, the engine in the computer's real sandbox.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { KEY, bootDevice, bootSpace, makeAgent, replyAfter, send, startChat } from "./support/runson.ts";

test("signed in on her computer: the engine there uses her own ~/.claude and no key from the Space; not signed in there: the Space's fill of her account", { timeout: 60_000 }, async () => {
  const s = await bootSpace();
  const own = await bootDevice({ signedIn: "claude" });
  try {
    const agentId = await makeAgent(s.d, "Own");
    await own.link(s);
    const threadId = await startChat(s, agentId, "rs-own");
    assert.equal(await replyAfter(s, threadId, await send(s, threadId, agentId, "whereami", "rs-own-1")), "ran-on=device handover=no");
    const env = own.spawns[0]!.env;
    assert.equal(env["CLAUDE_CONFIG_DIR"], path.join(own.home, ".claude"), "her own engine home on her computer");
    assert.ok(!Object.values(env).includes(KEY), "the account the Space holds was not sent into the engine");
    assert.equal(env["CLAUDE_CODE_OAUTH_TOKEN"], undefined);
    const access = JSON.parse(env["VYRE_ENGINE_ACCESS"] ?? "{}") as { where?: string; folders?: string[] };
    assert.equal(access.where, "own");
    assert.ok(access.folders?.includes(path.join(own.home, ".claude")), "the sandbox lets the engine use its own home");
  } finally { await own.stop(); }

  const plain = await bootDevice();
  try {
    const agentId = await makeAgent(s.d, "Filled");
    await plain.link(s);
    const threadId = await startChat(s, agentId, "rs-fill");
    assert.equal(await replyAfter(s, threadId, await send(s, threadId, agentId, "whereami", "rs-fill-1")), "ran-on=device handover=no");
    const env = plain.spawns[0]!.env;
    assert.equal(env["CLAUDE_CONFIG_DIR"], undefined, "not signed in on this computer");
    assert.ok(Object.values(env).includes(KEY), "her account, as the Space holds it, signs the engine in");
  } finally { await plain.stop(); await s.stop(); }
});
