// Run this (rc.8): type the command, wait for Enter, watch it finish, hand the output back.
import test from "node:test";
import assert from "node:assert/strict";
import { answerOf, sessionFor, typeCommand, waitForRun } from "./request.ts";

const tick = async (): Promise<void> => undefined;

test("the command goes to the newest live session of that host, or a new session when there is none", async () => {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "terminal.list") return { terminals: [{ terminalId: "old", host: "device", state: "idle", lastActiveAt: 1 }, { terminalId: "new", host: "device", state: "idle", lastActiveAt: 9 }, { terminalId: "gone", host: "device", state: "exited", lastActiveAt: 99 }] };
    return { terminal: { terminalId: "trm_new" } };
  };
  assert.equal(await sessionFor({ call, newKey: () => "k" }, {}), "new");
  assert.equal(await sessionFor({ call, newKey: () => "k" }, { host: "agent_computer", agentId: "agt_a" }), "trm_new");
  assert.deepEqual(calls.find((c) => c.cap === "terminal.open")?.input, { host: "agent_computer", agentId: "agt_a", idempotencyKey: "k" });
});

test("typing sends the command without Enter after reading where the screen was", async () => {
  const calls: Array<{ cap: string; input: unknown }> = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => { calls.push({ cap, input }); return { next: 42 }; };
  assert.deepEqual(await typeCommand({ call, newKey: () => "k" }, "trm_1", "sudo apt install ffmpeg"), { cursor: 42 });
  assert.deepEqual(calls.map((c) => c.cap), ["terminal.read", "terminal.input"]);
  assert.deepEqual(calls[1]!.input, { terminalId: "trm_1", data: "sudo apt install ffmpeg" }, "no newline: the person presses Enter");
});

test("waiting: idle before Enter keeps waiting, running then idle is done, and what printed since the cursor comes back", async () => {
  const states = ["idle", "idle", "running", "running", "idle"];
  let i = 0;
  const reads: unknown[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    if (cap === "terminal.status") return { rows: [{ state: states[Math.min(i++, states.length - 1)] }] };
    reads.push(input);
    return { text: "ffmpeg installed" };
  };
  const w = await waitForRun({ call, newKey: () => "k", sleep: tick }, "trm_1", 42);
  assert.deepEqual(w, { state: "done", output: "ffmpeg installed" });
  assert.deepEqual(reads, [{ terminalId: "trm_1", since: 42 }]);
});

test("a closed terminal ends the wait, and a person who never presses Enter times out", async () => {
  const closed = await waitForRun({ call: async (cap) => (cap === "terminal.status" ? { rows: [{ state: "exited" }] } : { text: "x" }), newKey: () => "k", sleep: tick }, "t", 0);
  assert.equal(closed.state, "exited");
  const never = await waitForRun({ call: async (cap) => (cap === "terminal.status" ? { rows: [{ state: "idle" }] } : { text: "" }), newKey: () => "k", sleep: tick }, "t", 0, { everyMs: 1000, timeoutMs: 3000 });
  assert.equal(never.state, "timeout");
});

test("the answer says it ran and what it printed, the tail when long", () => {
  assert.equal(answerOf({ state: "done", output: "ok" }, "ls").other, "Ran in my terminal.\n$ ls\nok");
  assert.match(answerOf({ state: "timeout", output: "" }, "ls").other, /still running/);
  assert.match(answerOf({ state: "done", output: "x".repeat(5000) }, "ls").other, /…x{4000}$/);
});

test("the line being typed follows the keys: letters add, Backspace removes, Enter and Ctrl-C clear", async () => {
  const { lineAfter } = await import("./model.ts");
  assert.equal(lineAfter("", "sudo"), "sudo");
  assert.equal(lineAfter("sudo ls", "\x7f\x7f"), "sudo ");
  assert.equal(lineAfter("rm -rf x", "\r"), "");
  assert.equal(lineAfter("rm -rf x", "\x03"), "");
  assert.equal(lineAfter("ls", "\x1b[A"), "ls", "an arrow key is not text");
});
