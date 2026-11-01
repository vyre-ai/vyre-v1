// Headless thread starters and the Auto default (rc.8, owner 1 Nov): a task's thread is Auto, because its agent is meant to work (the Reviewer and Approver seats are the check), and an outward
// send from it is still held at the Gate. A Kit builder chat and the Console assistant are a person watching, so they keep the default.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, hostLog, newAgent, seededDir, waitFor } from "./memory-live-kit.ts";
import { bindHost } from "../modules/terminal/impl.ts";
import type { TerminalHost } from "../modules/terminal/projections.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const ok = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, input);
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};
const quiet: TerminalHost = {
  async open() { return { cwd: "/home/olivia", title: "This computer" }; }, async input() {}, async interrupt() {}, async resize() {}, async read() { return { text: "", next: 0 }; },
  async run(_id, o) { return { exitCode: 0, output: `ran: ${o.command}`, truncated: false, durationMs: 5 }; }, async status(ids) { return ids.map((id) => ({ terminalId: id, state: "idle" as const, exitCode: null })); },
  async close() {}, async health() { return { ok: true, sessions: 0 }; },
};
const holds = async (d: Daemon): Promise<Array<{ capName: string; act: string }>> => ((await call(d, "gate.holds.list", { states: ["held"] })).data.holds as Array<{ capName: string; act: string }> | undefined) ?? [];

test("a task's thread is Auto, and an outward act the agent tries from it is held at the Gate", async () => {
  bindHost(quiet);
  const d = await boot(seededDir());
  try {
    await connect(d);
    const agent = await newAgent(d, "Drafter");
    const task = (await ok(d, "tasks.create", { title: "Write to the client", assigned: { kind: "agent", id: agent.id }, idempotencyKey: "hm-task" })).task;
    const threadId = await waitFor(async () => { const t = (await ok(d, "tasks.get", { taskId: task.id })).task; return t.threadId ?? null; }, 20_000, () => hostLog(d));
    const thread = (await ok(d, "threads.get", { threadId })).thread;
    assert.equal(thread.mode, "auto", "a task's agent works on its own");
    assert.equal(thread.scopeType, "task");

    // a destructive command the agent runs from the task thread is outward: the Gate holds it even in Auto, while a read-only one runs
    const terminalId = (await ok(d, "terminal.open", { host: "agent_computer", agentId: agent.id, idempotencyKey: "hm-term" })).terminal.terminalId as string;
    const run = (command: string, key: string): Promise<unknown> => ok(d, "chat.post", { threadId, body: `TOOL terminal_run ${JSON.stringify({ terminalId, command, idempotencyKey: key })}`, mentions: [{ kind: "agent", id: agent.id }], idempotencyKey: `${key}-p` });
    // the agent's first turn on a new task (the baton wake) may still be running when the first ask arrives, so the ask is repeated until a turn takes it
    let tries = 0, lastAsk = 0;
    const held = await waitFor(async () => {
      await d.hooks?.pump?.();
      if (Date.now() - lastAsk > 10_000) { lastAsk = Date.now(); await run("rm -rf /tmp/build", `hm-red-${++tries}`); }
      return (await holds(d)).find((h) => h.capName === "terminal.run") ?? null;
    }, 90_000, () => hostLog(d));
    assert.ok(held, "the destructive command waits for a yes even in Auto");
  } finally { await d.stop(); bindHost(null); }
});

test("a Kit builder chat and the Console assistant thread start in the default mode (a person is watching)", async () => {
  const d = await boot(seededDir());
  try {
    await connect(d);
    const agent = await newAgent(d, "Builder");
    const chat = (await ok(d, "chat.start", { kind: "chat", agentIds: [agent.id], title: "Kit builder", scopeType: "kit", scopeId: "kit_x", idempotencyKey: "hm-kit" })).thread.threadId as string;
    assert.equal((await ok(d, "threads.get", { threadId: chat })).thread.mode, "auto");
    const assistant = (await ok(d, "console.assistant_open", { page: "console.overview", idempotencyKey: "hm-console" })).threadId as string;
    assert.equal((await ok(d, "threads.get", { threadId: assistant })).thread.mode, "auto");
  } finally { await d.stop(); }
});
