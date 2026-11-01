// @tsx
// Run on a code block (rc.9): only a finished one-line shell block offers it; a read-only command runs and brings its output back, anything else is typed and waits for Enter, a refusal is a sentence.
import test from "node:test";
import assert from "node:assert/strict";
import { commandOf, runThis, sessionOn } from "./runthis.ts";
import type { HostChoice } from "./hosts.ts";

const device: HostChoice = { key: "device:dev_1", label: "This computer", kind: "device", online: true, deviceId: "dev_1" };
const server: HostChoice = { key: "server", label: "Space server", kind: "server", online: true };
const agent: HostChoice = { key: "agent:cmt_1", label: "Intake's computer", kind: "agent", online: true, agentId: "agt_1", computerId: "cmt_1" };

test("only a finished one-line shell block offers Run, with the prompt sign taken off", () => {
  assert.equal(commandOf("bash", "ls -la\n", true), "ls -la");
  assert.equal(commandOf("sh", "$ git status", true), "git status");
  assert.equal(commandOf("zsh", "# list them\nls", true), "ls", "a comment line is not a command");
  assert.equal(commandOf("bash", "npm run \\\n  build", true), "npm run build", "a continued line is one command");
  assert.equal(commandOf("bash", "ls", false), null, "a block still being written");
  assert.equal(commandOf("bash", "cd app\nrm -rf dist", true), null, "two commands: a newline would run the first before anyone looks");
  assert.equal(commandOf("python", "print(1)", true), null);
  assert.equal(commandOf("", "ls", true), null, "no language, no guess");
  assert.equal(commandOf("bash", "  \n", true), null);
});

test("the session is the newest live one on that machine, else a new one opened there", async () => {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "terminal.list") return { terminals: [
      { terminalId: "d_old", host: "device", deviceId: "dev_1", state: "idle", lastActiveAt: 1 }, { terminalId: "d_new", host: "device", deviceId: "dev_1", state: "idle", lastActiveAt: 5 },
      { terminalId: "d_other", host: "device", deviceId: "dev_2", state: "idle", lastActiveAt: 9 }, { terminalId: "d_gone", host: "device", deviceId: "dev_1", state: "exited", lastActiveAt: 8 },
      { terminalId: "a_1", host: "agent_computer", agentId: "agt_1", state: "idle", lastActiveAt: 2 },
    ] };
    return { terminal: { terminalId: "trm_made" } };
  };
  const d = { call, newKey: () => "key" };
  assert.equal(await sessionOn(d, device), "d_new");
  assert.equal(await sessionOn(d, agent), "a_1");
  assert.equal(await sessionOn(d, server), "trm_made");
  assert.deepEqual(calls.find((c) => c.cap === "terminal.open_server")?.input, { idempotencyKey: "key" });
});

test("a read-only command runs and returns its output; a refusal says why", async () => {
  const calls: Array<{ cap: string; input: unknown }> = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input });
    if (cap === "terminal.list") return { terminals: [{ terminalId: "t1", host: "device", deviceId: "dev_1", state: "idle", lastActiveAt: 1 }] };
    if (cap === "terminal.run") return { exitCode: 0, output: "a\nb\n" };
    throw new Error("unexpected");
  };
  const r = await runThis({ call, newKey: () => "k" }, device, "ls", "read");
  assert.deepEqual(r, { s: "ran", terminalId: "t1", exitCode: 0, output: "a\nb\n" });
  assert.deepEqual(calls.find((c) => c.cap === "terminal.run")?.input, { command: "ls", terminalId: "t1", idempotencyKey: "k" });
  const refused = await runThis({ call: async (cap) => { if (cap === "terminal.run") throw Object.assign(new Error("A rule of yours stops that command."), { code: "permission.role_lacks_permission" }); return { terminals: [{ terminalId: "t1", host: "device", deviceId: "dev_1", state: "idle", lastActiveAt: 1 }] }; }, newKey: () => "k" }, device, "ls", "read");
  assert.deepEqual(refused, { s: "refused", why: "A rule of yours stops that command." });
});

test("a command that changes something, or is destructive, is typed without Enter and never run for the person", async () => {
  for (const risk of ["change", "danger"] as const) {
    const calls: Array<{ cap: string; input: unknown }> = [];
    const call = async (cap: string, input: unknown): Promise<unknown> => {
      calls.push({ cap, input });
      if (cap === "terminal.list") return { terminals: [{ terminalId: "t1", host: "device", deviceId: "dev_1", state: "idle", lastActiveAt: 1 }] };
      if (cap === "terminal.read") return { next: 7 };
      return {};
    };
    const r = await runThis({ call, newKey: () => "k" }, device, "rm -rf build", risk);
    assert.deepEqual(r, { s: "typed", terminalId: "t1", cursor: 7 });
    assert.ok(!calls.some((c) => c.cap === "terminal.run"), risk);
    assert.deepEqual(calls.find((c) => c.cap === "terminal.input")?.input, { terminalId: "t1", data: "rm -rf build" }, "no newline");
  }
});
