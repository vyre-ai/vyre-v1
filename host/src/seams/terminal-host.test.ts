// The terminal seam's host half: a command's environment carries nothing of the daemon's, a session lives here only on the person's computer, and where a turn runs is read as the person.
import test from "node:test";
import assert from "node:assert/strict";
import { commandEnv, createTerminalHostSeam, shellArgv } from "./terminal-host.ts";

test("a command starts with who and where the person is, never the daemon's own variables", () => {
  const env = commandEnv({ HOME: "/Users/dana", USER: "dana", SHELL: "/bin/zsh", PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", VYRE_TOKEN: "x", VYRE_SETUP: "y", ANTHROPIC_API_KEY: "z", AWS_SECRET_ACCESS_KEY: "w" });
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "PATH", "SHELL", "TERM", "USER"]);
  assert.ok(env["PATH"]!.startsWith("/usr/bin:/bin"));
  assert.deepEqual(shellArgv({ SHELL: "/bin/zsh" }, "echo hi"), ["/bin/zsh", ["-l", "-c", "echo hi"]]);
  assert.deepEqual(shellArgv({ SHELL: "/bin/sh" }, "echo hi"), ["/bin/sh", ["-c", "echo hi"]]);
});

test("sessions live here only on the person's computer, and only when this daemon is it", () => {
  const read = async (): Promise<unknown> => null;
  const device = createTerminalHostSeam({ roles: ["space", "device"], team: false, readAs: read, computerOf: () => "dev_mac", env: { HOME: "/tmp" } });
  assert.equal(device.runsHere({ host: "device", deviceId: "dev_mac" }), true);
  assert.equal(device.runsHere({ host: "space_server" }), false);
  assert.equal(device.runsHere({ host: "agent_computer", agentId: "agt_a" }), false);
  const server = createTerminalHostSeam({ roles: ["space"], team: true, readAs: read, computerOf: () => "dev_mac", env: { HOME: "/tmp" } });
  assert.equal(server.runsHere({ host: "device", deviceId: "dev_mac" }), false);
});

test("where a turn runs is read as the person: this computer, the agent's computer, a server pin; a server is never someone's computer", async () => {
  const calls: Array<[string, string]> = [];
  const seam = (roles: string[], decided: unknown, hasComputer: boolean) => createTerminalHostSeam({
    roles, team: false, env: { HOME: "/tmp" }, computerOf: (p) => (p === "usr_dana" ? "dev_mac" : undefined),
    readAs: async (person, cap) => { calls.push([person, cap]); return cap === "agents.get" ? { agent: { hasComputer } } : decided; },
  });
  const a = { space: "spc_x", threadId: "thr_1", agentId: "agt_a", person: "usr_dana" };
  assert.deepEqual(await seam(["space", "device"], { placement: "device", reason: "device" }, false).place(a), { team: false, agentComputer: false, runsOn: "device", deviceId: "dev_mac" });
  assert.deepEqual(calls, [["usr_dana", "engine.placement.decide"], ["usr_dana", "agents.get"]]);
  assert.deepEqual(await seam(["space", "device"], { placement: "host", reason: "no_daemon" }, false).place(a), { team: false, agentComputer: false, runsOn: "device", deviceId: "dev_mac" });
  assert.deepEqual(await seam(["space", "device"], { placement: "host", reason: "agent_computer" }, true).place(a), { team: false, agentComputer: true, runsOn: "agent_computer" });
  assert.deepEqual(await seam(["space", "device"], { placement: "host", reason: "chosen_server", nodeId: "srv_1" }, false).place(a), { team: false, agentComputer: false, runsOn: "server" });
  assert.deepEqual(await seam(["space"], { placement: "device", reason: "device" }, false).place(a), { team: false, agentComputer: false, runsOn: "device" });
  assert.deepEqual(await seam(["space"], { placement: "host", reason: "shared_thread" }, false).place(a), { team: false, agentComputer: false, runsOn: "space" });
});

test("agent workspaces: handed over only when the machine can run them, with the image of the release (VYRE_WORKSPACE_IMAGE) or the default, and the rest as given", () => {
  const read = async (): Promise<unknown> => null;
  const none = createTerminalHostSeam({ roles: ["space"], team: true, readAs: read, computerOf: () => undefined, env: { HOME: "/tmp" } });
  assert.equal(none.workspaces, undefined, "no container runtime: no workspaces, and agents' commands go where the turn runs");
  const was = process.env["VYRE_WORKSPACE_IMAGE"];
  try {
    delete process.env["VYRE_WORKSPACE_IMAGE"];
    const projectsOf = async (): Promise<string[]> => ["prj_a"];
    const dflt = createTerminalHostSeam({ roles: ["space"], team: true, readAs: read, computerOf: () => undefined, env: { HOME: "/tmp" }, workspaces: { runner: { socket: "/run/vyre-sites/runner.sock", token: () => "t" }, projectsOf, idleMs: 1000 } });
    assert.equal(dflt.workspaces?.image, "vyre/agent-workspace:1");
    assert.equal(dflt.workspaces?.runner?.socket, "/run/vyre-sites/runner.sock");
    assert.equal(dflt.workspaces?.projectsOf, projectsOf);
    assert.equal(dflt.workspaces?.idleMs, 1000);
    process.env["VYRE_WORKSPACE_IMAGE"] = `ghcr.io/vyre-ai/agent-workspace@sha256:${"c".repeat(64)}`;
    const locked = createTerminalHostSeam({ roles: ["space"], team: true, readAs: read, computerOf: () => undefined, env: { HOME: "/tmp" }, workspaces: { socketPath: "/var/run/docker.sock" } });
    assert.equal(locked.workspaces?.image, `ghcr.io/vyre-ai/agent-workspace@sha256:${"c".repeat(64)}`);
    const named = createTerminalHostSeam({ roles: ["space"], team: true, readAs: read, computerOf: () => undefined, env: { HOME: "/tmp" }, workspaces: { image: "vyre/agent-workspace:test" } });
    assert.equal(named.workspaces?.image, "vyre/agent-workspace:test", "an image named by the caller wins");
  } finally { if (was === undefined) delete process.env["VYRE_WORKSPACE_IMAGE"]; else process.env["VYRE_WORKSPACE_IMAGE"] = was; }
});
