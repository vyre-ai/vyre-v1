// An agent made on either computer of a Personal Space works on both (lane l-multidevice): its folder, its principal and its grants come with it, so the other computer can open it and make
// agents of its own, before and after it restarts. Before, the rows arrived without the resource and principal events behind them and the other computer answered "not found".
import test from "node:test";
import assert from "node:assert/strict";
import { createRelay } from "../relay/node/server.js";
import { boot, call, firstComputer, stageSecond } from "./peers-kit.mjs";

test("an agent made on the second computer reaches the first, and both can make agents, also after a restart", { timeout: 60_000 }, async () => {
  const relay = createRelay();
  const base = await relay.listen();
  let A = null, B = null;
  try {
    const first = await firstComputer(base);
    A = first.A;
    assert.equal((await call(A, "/v1/agents/create", { name: "Made on A", role: "x" })).status, 200);
    const { dirB } = await stageSecond(A, first.dirA);
    B = await boot(dirB, ["--space", "spc_staged", "--relay", base, "--peer-name", "Home laptop"]);
    await B.peers.tick(); await B.peers.sync.round(); await A.peers.sync.round();
    const onB = await call(B, "/v1/agents/create", { name: "Made on B", role: "x" });
    assert.equal(onB.status, 200, JSON.stringify(onB.body));
    const id = onB.body.data.agent.agentId;
    await A.peers.sync.round();
    const seen = await call(A, "/v1/agents/get", { agentId: id });
    assert.equal(seen.status, 200, `A opens the agent made on B: ${JSON.stringify(seen.body).slice(0, 200)}`);
    await A.stop();
    A = await boot(first.dirA, ["--relay", base, "--peer-name", "Office iMac"]);
    await A.peers.tick(); await A.peers.sync.round();
    const again = await call(A, "/v1/agents/create", { name: "Made on A after a restart", role: "x" });
    assert.equal(again.status, 200, JSON.stringify(again.body).slice(0, 300));
    await B.peers.sync.round();
    assert.equal((await call(B, "/v1/agents/get", { agentId: again.body.data.agent.agentId })).status, 200, "and it reaches B");
  } finally {
    await B?.stop();
    await A?.stop();
    await relay.close();
  }
});
