// @heavy docker
// An agent's workspace on a server that joined the Space (6 Nov), on a booted Personal Space that has no container runtime of its own and a booted node that has Docker. The node only dials out: the Space
// asks its Docker over the node's live socket, the node puts each question to the runner's policy and then to its engine. A person runs `echo hi` in an agent's workspace; the container is made on the node's
// Docker, named for the agent, with its own tmux session that a second tab sits beside. The node here runs in this process (runComputeNode) against the real Docker of this machine.
// Runs only with VYRE_HEAVY_DOCKER=1; the image is VYRE_WORKSPACE_TEST_IMAGE (already built), as in the other workspace live tests.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { startWorkspaceDocker } from "../src/compute/docker-ask.ts";
import { boot as bootRig, enroll, OWNER_TOKEN, post } from "./node-rig.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1" && process.env["VYRE_WORKSPACE_TEST_IMAGE"] !== undefined;
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE (the workspace is a real container)";

const docker = (args: string[]): Promise<{ code: number; out: string }> => new Promise((resolve) => {
  execFile("docker", args, { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ code: err ? 1 : 0, out: `${stdout}\n${stderr}` }));
});
const ok = async (d: Parameters<typeof post>[0], cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await post(d, `/v1/${cap.replaceAll(".", "/")}`, { idempotencyKey: `wn-${cap}-${Math.random().toString(36).slice(2, 8)}`, ...input }, OWNER_TOKEN);
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.json)}`);
  return r.json.data;
};

test("a Personal Space with no runtime of its own runs an agent's workspace on a server that joined, through the node's socket and the runner's policy", { skip, timeout: 300_000 }, async (t) => {
  const savedImage = process.env["VYRE_WORKSPACE_IMAGE"];
  process.env["VYRE_WORKSPACE_IMAGE"] = process.env["VYRE_WORKSPACE_TEST_IMAGE"]!;
  const { d, dir } = await bootRig(bootCore, { workspaceRuntimeOff: true } as never);
  const nodeDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-wsnode-"));
  const node = await startWorkspaceDocker(nodeDir);
  const log: string[] = [];
  let name = "";
  const joinedRef: { abort?: AbortController; running?: Promise<string> } = {};
  t.after(async () => {
    joinedRef.abort?.abort();
    await joinedRef.running?.catch(() => undefined);
    process.env["VYRE_WORKSPACE_IMAGE"] = savedImage ?? "";
    if (savedImage === undefined) delete process.env["VYRE_WORKSPACE_IMAGE"];
    if (name !== "") { await docker(["rm", "-f", name]); await docker(["volume", "rm", "-f", `${name}-home`, `${name}-files`]); }
    await d.stop();
    await node.close();
    fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(nodeDir, { recursive: true, force: true });
  });
  const joined = await enroll(d, nodeDir, log, { spawn: async () => { throw new Error("no engine here"); } }, {
    facts: () => ({ os: "linux", arch: "x64", docker: true, version: "t" }),
    makeHost: () => ({ run: async (kind, input) => { if (kind === "docker") return node.ask(input); throw new Error(`unexpected ${kind}`); } }),
  });

  joinedRef.abort = joined.abort; joinedRef.running = joined.running;
  const agent = (await ok(d, "agents.create", { name: "Dex", role: "You help." })).agent.agentId as string;
  name = `vyre-ws-${agent}`;
  assert.equal((await docker(["inspect", name])).code === 0, false, "nothing before the first command");
  const run = await ok(d, "terminal.run", { command: "echo hi", host: "agent_computer", agentId: agent });
  assert.deepEqual([run.exitCode, run.output], [0, "hi"]);
  assert.equal((await docker(["inspect", "-f", "{{.State.Running}}", name])).out.trim().split("\n")[0], "true", "the container is on the node's Docker");
  const sessions = (await docker(["exec", name, "tmux", "list-sessions", "-F", "#{session_name}"])).out.trim().split("\n")[0];
  assert.equal(sessions, `vyre-${run.terminalId}`);
  // a second tab beside it, and the person attaches and sees the first's screen
  const tab = await ok(d, "terminal.open", { host: "agent_computer", agentId: agent, name: "server" });
  const rows = (await ok(d, "terminal.list", {})).terminals as Array<{ name: string; host: string; hostTitle: string }>;
  assert.deepEqual(rows.map((r) => [r.name, r.host]).sort(), [["agent", "agent_computer"], ["server", "agent_computer"]]);
  assert.equal(rows[0]!.hostTitle, "Workspace");
  const att = await ok(d, "terminal.attach", { terminalId: run.terminalId });
  assert.match(att.replay, /echo hi/);
  assert.equal((await docker(["exec", name, "tmux", "list-sessions", "-F", "#{session_name}"])).out.trim().split("\n").length, 2);
  assert.equal(tab.terminal.name, "server");
});
