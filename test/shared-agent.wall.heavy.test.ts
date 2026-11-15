// @heavy docker
// The shared agent's wall, walked end to end (F30 and F75, rc.29): Ada owns the agent Nova and shares it with Bea at Use. On a booted daemon, a real workspace container.
import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./support/agentpc-world.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1" && process.env["VYRE_WORKSPACE_TEST_IMAGE"] !== undefined;
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE (the workspace is a real container)";

test("PROBE a chat with two people and one agent: who each message runs for", { skip, timeout: 900_000 }, async (t) => {
  const w = await world();
  t.after(() => w.close());
  const ada = w.owner;
  const bea = w.ana;
  const ch = await ada.call("channels.create", { name: "pair", visibility: "invite", memberIds: [bea.id], agentIds: [w.agent] });
  assert.equal(ch.status, 200, JSON.stringify(ch.data));
  const threadId = ch.data.channel.mainThreadId as string;
  console.log("CHANNEL", JSON.stringify(ch.data).slice(0, 300));
  const say = async (who: typeof ada, key: string, steps: unknown[]) => {
    await who.call("threads.set_mode", { threadId, mode: "auto" });
    const posted = await who.call("chat.post", {
      threadId,
      body: `RUN ${key} ${JSON.stringify(steps)}`,
      mentions: [{ kind: "agent", id: w.agent }],
    });
    assert.equal(posted.status, 200, JSON.stringify(posted.data));
    return w.waitFor(key);
  };
  const a = await say(ada, "pc-ada", [{ cmd: 'echo "$(id -u)|$HOME|$(pwd)"' }]);
  const b = await say(bea, "pc-bea", [{ cmd: 'echo "$(id -u)|$HOME|$(pwd)"' }]);
  console.log("PROBE ADA", JSON.stringify(a), "BEA", JSON.stringify(b));
  const turns = await ada.call("engine.turns.list", { threadId });
  console.log("TURNS", JSON.stringify(turns.data).slice(0, 800));
});
