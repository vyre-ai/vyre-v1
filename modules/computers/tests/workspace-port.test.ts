// The host calls the agent workspaces use for room (6 Nov): claim before a container starts, release when it stops, the waiting line, and the starter that starts a waiting workspace by itself when room
// opens. The terminal module cannot import this one, so the daemon binds the two with these. The machine and its report are the fakes of capacity.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { workspaceClaim, workspaceRelease, workspaceWaiting, workspaceKey, bindWorkspaceStart } from "../workspace-port.ts";
import { hostCalls } from "../impl.ts";
import { heldOn, LIMITS } from "../capacity.ts";
import { harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const MB = 1024 * 1024;
function report(h: Harness, o: { memMb: number; usedMb?: number }): void {
  h.respond["machines.list"] = () => ({ machines: [{ machineId: "space", name: "Space", cores: 4, memBytes: o.memMb * MB, load: { memUsedBytes: (o.usedMb ?? 512) * MB, diskFreeBytes: 50_000 * MB } }] });
}

test("the calls are host calls, never capabilities, and name the workspace by its container", () => {
  assert.equal(hostCalls["computers.workspace_claim"], workspaceClaim);
  assert.equal(hostCalls["computers.workspace_release"], workspaceRelease);
  assert.equal(hostCalls["computers.workspace_waiting"], workspaceWaiting);
  assert.equal(workspaceKey("agt_dex"), "vyre-ws-agt_dex");
});

test("a claim holds back 64 MB, asking twice is one claim, a release gives it back", async () => {
  const h = harness();
  report(h, { memMb: 16384 });
  assert.deepEqual(await workspaceClaim(h.ctx, { agentId: "agt_dex" }), { state: "running" });
  assert.deepEqual(await workspaceClaim(h.ctx, { agentId: "agt_dex" }), { state: "running" });
  assert.equal(heldOn(h.ctx.db, "space").reserveMb, LIMITS.workspace.reserveMb);
  await workspaceRelease(h.ctx, { agentId: "agt_dex" });
  assert.equal(heldOn(h.ctx.db, "space").reserveMb, 0);
});

test("a full host queues the claim with the plain line, and a release that opens room starts the waiting workspace by itself", async () => {
  const h = harness();
  // room for exactly one workspace beside the headroom
  report(h, { memMb: 1536 + LIMITS.workspace.reserveMb, usedMb: 100 });
  const started: string[] = [];
  bindWorkspaceStart(async (agentId) => { started.push(agentId); });
  assert.deepEqual(await workspaceClaim(h.ctx, { agentId: "agt_a" }), { state: "running" });
  const b = await workspaceClaim(h.ctx, { agentId: "agt_b" });
  assert.equal(b.state, "waiting");
  assert.match(b.line ?? "", /^Waiting for room on the Space server\. Add a compute server in Console > Computers to run more\.$/);
  assert.deepEqual(await workspaceWaiting(h.ctx, { agentId: "agt_b" }), { line: b.line });
  assert.deepEqual(await workspaceWaiting(h.ctx, { agentId: "agt_a" }), { line: null });
  assert.deepEqual(started, []);
  await workspaceRelease(h.ctx, { agentId: "agt_a" });
  assert.deepEqual(started, ["agt_b"], "it starts when room opens");
  assert.deepEqual(await workspaceWaiting(h.ctx, { agentId: "agt_b" }), { line: null });
  bindWorkspaceStart(null);
});
