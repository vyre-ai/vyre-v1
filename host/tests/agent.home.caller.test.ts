import test from "node:test";
import assert from "node:assert/strict";
import { createAgentHomeCaller } from "../src/daemon/daemon.ts";

test("agent home caller resolves the current owner on every pass", async () => {
  let owner = "usr_a";
  const calls: unknown[] = [];
  const call = createAgentHomeCaller({
    spaceId: "spc_test",
    db: { all: () => owner ? [{ ownerId: owner }] : [] },
    invoke: async (_cap, _input, seed) => { calls.push(seed); return { status: "ok", output: {} }; },
  });
  await call("agt_home", "files.list", {});
  owner = "usr_b";
  await call("agt_home", "files.list", {});
  assert.deepEqual((calls as Array<{ principal: { id: string }; actingFor: string }>).map((s) => [s.principal.id, s.actingFor]), [["agt_home", "usr_a"], ["agt_home", "usr_b"]]);
  owner = "";
  await assert.rejects(() => call("agt_home", "files.list", {}), /active owner/);
});
