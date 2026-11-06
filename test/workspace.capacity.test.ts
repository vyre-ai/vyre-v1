// The workspace container and the host's capacity book say the same numbers (6 Nov). The terminal module cannot import the computers module, so each holds the numbers itself and this test, which may
// reach across modules, holds them together; the runner's policy accepts exactly what both say.
import test from "node:test";
import assert from "node:assert/strict";
import { hostConfigLimits } from "../modules/computers/capacity.ts";
import { workspaceContainerConfig, workspaceName, workspaceNetworkName } from "../modules/terminal/workspace.ts";
import { workspaceBody } from "../host/src/sites-runner/workspaces-policy.ts";
import { createHash } from "node:crypto";

test("a workspace container is made with the limits capacity.ts hands out, and the runner lets it through", () => {
  const want = hostConfigLimits("workspace");
  const c = workspaceContainerConfig("agt_dex", "vyre/agent-workspace:1", { projects: ["prj_a"] }, { runner: true });
  const h = c.HostConfig;
  assert.deepEqual({ NanoCpus: h.NanoCpus, Memory: h.Memory, MemorySwap: h.MemorySwap, PidsLimit: h.PidsLimit, MemoryReservation: h.MemoryReservation, CpuShares: h.CpuShares }, want);
  const net = (agent: string, n: string): boolean => n === `vyre-wsnet-${createHash("sha256").update(agent).digest("hex").slice(0, 16)}` && n === workspaceNetworkName(agent);
  const r = workspaceBody(workspaceName("agt_dex"), c, net);
  assert.ok("body" in r, "why" in r ? r.why : "");
});
