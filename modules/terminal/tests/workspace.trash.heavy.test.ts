// @heavy docker
// Third look T1 on a real Docker engine: an agent goes to Trash (its container goes, its volumes stay), the clock moves past the Space's Trash retention, the hourly pass runs through the fleet as in
// production, and `docker volume ls` shows neither of its volumes. Runs only with VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { buildWorkspaceManager, filesVolume, homeVolume, workspaceName } from "../workspace.ts";
import { createWorkspaceFleet } from "../fleet.ts";
import { forgetExpiredWorkspaces, onAgentGone } from "../handlers/sessions.ts";
import type { TermCtx } from "../projections.ts";
import { unixSocketHttp } from "../../../sandbox/src/docker.ts";
import { harness, reset } from "../fixtures/harness.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1" && process.env["VYRE_WORKSPACE_TEST_IMAGE"] !== undefined;
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE";
const AGENT = `agt_trash${Math.random().toString(36).slice(2, 8)}`;
const docker = (args: string[]): Promise<string> => new Promise((r) => { execFile("docker", args, { timeout: 120_000 }, (_e, out) => r(String(out))); });
const vols = async (): Promise<string[]> => (await docker(["volume", "ls", "--format", "{{.Name}}"])).split("\n").filter((v) => v === homeVolume(AGENT) || v === filesVolume(AGENT));

test("real Docker: an agent in Trash past the retention has neither volume left after the hourly pass", { skip, timeout: 300_000 }, async (t) => {
  const space = buildWorkspaceManager({ http: unixSocketHttp(), image: process.env["VYRE_WORKSPACE_TEST_IMAGE"] ?? "", idleMs: 3_600_000, owner: "spc_trashtest" });
  const fleet = createWorkspaceFleet({ space, node: () => { throw new Error("no servers"); }, place: async () => null });
  t.after(async () => { fleet.close(); await docker(["rm", "-f", workspaceName(AGENT)]); await docker(["volume", "rm", "-f", homeVolume(AGENT), filesVolume(AGENT)]); });
  reset();
  const hn = harness();
  const ctx: TermCtx = { ...hn.ctx, call: (async (cap: string) => (cap === "governance.retention.get" ? { kinds: [{ key: "trash", value: "7d" }] } : undefined)) as never };
  assert.equal((await fleet.exec(AGENT, ["sh", "-c", "echo kept > ~/Vyre/note.txt"])).code, 0);
  assert.deepEqual((await vols()).sort(), [filesVolume(AGENT), homeVolume(AGENT)].sort(), "both volumes made");
  // agent.deleted: the container goes, the volumes stay
  await onAgentGone(ctx, { payload: { agentId: AGENT } }, (id) => fleet.remove(id, { keepVolumes: true }), () => true);
  assert.equal((await docker(["ps", "-a", "-q", "--filter", `name=^${workspaceName(AGENT)}$`])).trim(), "", "container gone");
  assert.equal((await vols()).length, 2, "volumes kept while in Trash");
  hn.advance(6 * 86_400_000);
  assert.deepEqual(await forgetExpiredWorkspaces(ctx, (id) => fleet.remove(id), () => true), [], "inside the retention: kept");
  assert.equal((await vols()).length, 2);
  hn.advance(2 * 86_400_000);
  assert.deepEqual(await forgetExpiredWorkspaces(ctx, (id) => fleet.remove(id), () => true), [AGENT], "past it: the pass removes them");
  assert.deepEqual(await vols(), [], "docker volume ls shows neither");
});
