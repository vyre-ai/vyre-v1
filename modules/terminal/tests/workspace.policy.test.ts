// The module and the runner hold the same profile: what modules/terminal/workspace.ts creates is what host/src/sites-runner/workspaces-policy.ts lets through, and the helper's script is one text.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PROJECT_INIT_SCRIPT, projectInitBody, workspaceContainerConfig, workspaceName, workspaceNetworkName } from "../workspace.ts";
import { WS_INIT_SCRIPT, workspaceBody, workspaceInitBody, workspaceNetworkBody, workspaceVolumeBody } from "../../../host/src/sites-runner/workspaces-policy.ts";

const netOk = (agent: string, n: string): boolean => n === `vyre-wsnet-${createHash("sha256").update(agent).digest("hex").slice(0, 16)}`;

test("the container the module makes passes the runner's policy, with and without a project, with and without a host Files folder (the runner never sees that one)", () => {
  for (const agent of ["agt_dex", "agt_a1b2c3", "agt_with-dash_and_under"]) {
    const cfg = workspaceContainerConfig(agent, "ghcr.io/vyre-ai/agent-workspace@sha256:" + "b".repeat(64), { projects: ["prj_site", "prj_book"], filesHost: null }, { runner: true });
    const r = workspaceBody(workspaceName(agent), cfg, netOk);
    assert.ok("body" in r, "why" in r ? r.why : "");
    assert.equal(workspaceNetworkName(agent), `vyre-wsnet-${createHash("sha256").update(agent).digest("hex").slice(0, 16)}`);
  }
  const plain = workspaceContainerConfig("agt_dex", "vyre/agent-workspace:1", { projects: [], filesHost: null }, { runner: true });
  assert.ok("body" in workspaceBody(workspaceName("agt_dex"), plain, netOk));
  const withHost = workspaceContainerConfig("agt_dex", "vyre/agent-workspace:1", { projects: [], filesHost: "/srv/files" }, { runner: true });
  const refused = workspaceBody(workspaceName("agt_dex"), withHost, netOk);
  assert.ok("why" in refused && /host folders/.test(refused.why), "behind the runner a host folder is refused, so the module never sends one");
});

test("the project folder helper the module makes is the one the runner allows, and the script is one text", () => {
  assert.equal(PROJECT_INIT_SCRIPT, WS_INIT_SCRIPT);
  const body = projectInitBody("prj_site", "vyre/agent-workspace:1");
  assert.ok("body" in workspaceInitBody("vyre-wsinit-prj_site", body), "the helper passes");
  assert.deepEqual((workspaceInitBody("vyre-wsinit-prj_site", body) as { body: unknown }).body, body, "the runner writes back the same body");
});

test("the network and volume bodies the module sends pass the runner's", () => {
  assert.ok("body" in workspaceNetworkBody({ Name: workspaceNetworkName("agt_dex"), Driver: "bridge", CheckDuplicate: true, Labels: { "vyre.workspace": "agt_dex" } }));
  assert.ok("body" in workspaceVolumeBody({ Name: "vyre-wsproj-prj_site", Labels: { "vyre.workspace.project": "prj_site" } }));
});
