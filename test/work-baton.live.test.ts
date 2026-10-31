// The work baton on a booted daemon (work baton, item 9). The daemon, the engine, the tasks, chat, runs and automations modules are real; the model is a stand-in that reads the "Your task" section of its
// turn context and ends its turn with the baton call a good agent would make, so what is proved is the wiring: the Automation's agent-task step makes a task and a thread, wakes the agent in it with
// the right role each time the baton moves, the tools move the one state machine, the thread holds the brief, the fixes and the deliverable, and the waiting Run goes on with the submitted outputs.
//   1. an agent does the work, an agent reviewer sends it back once with fixes and then approves, an agent approver approves
//   2. an agent that ends its turns without a baton call is nudged once, then the task goes to a person after nudgeMinutes, and the person's answer wakes it again
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, clock, connect, hostLog, newAgent, seededDir, waitFor } from "./memory-live-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";

let keys = 0;
const ok = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `wb-${cap}-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

interface Wake { agent: string; role: "assigned" | "reviewer" | "approver" | "none"; taskId: string; section: string; nth: number }
type Move = { tool: string; input: Record<string, unknown> } | null;

/** A model that does what its task section tells it: it reads the seat, and `decide` says which baton call that seat makes this time. */
function model(decide: (w: Wake) => Move): { open: OpenSession; wakes: Wake[]; tools: Array<{ agent: string; tool: string; ok: boolean }> } {
  const wakes: Wake[] = [];
  const tools: Array<{ agent: string; tool: string; ok: boolean }> = [];
  const counts = new Map<string, number>();
  const open: OpenSession = async () => {
    const waiting = new Map<string, (r: { ok: boolean; content: unknown }) => void>();
    return {
      warm: true,
      async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
        const section = input.context?.sections.find((s) => s.id === "task")?.text ?? "";
        const taskId = /taskId (tsk_[a-z0-9]+)/.exec(section)?.[1];
        if (!taskId) { yield { type: "text", text: "Nothing for me here." }; yield { type: "done" }; return; }
        const role = /You are the Reviewer, and it is your turn/.test(section) ? "reviewer" : /You are the Approver, and it is your turn/.test(section) ? "approver" : /You are the one who does the work \(Assigned\), and it is your turn/.test(section) ? "assigned" : "none";
        const key = `${input.agent.id}:${taskId}`;
        const nth = (counts.get(key) ?? 0) + 1;
        counts.set(key, nth);
        const wake: Wake = { agent: input.agent.id, role, taskId, section, nth };
        wakes.push(wake);
        const move = role === "none" ? null : decide(wake);
        if (!move) { yield { type: "text", text: "I looked at it." }; yield { type: "done" }; return; }
        const id = `call_${wakes.length}`;
        const result = new Promise<{ ok: boolean; content: unknown }>((resolve) => waiting.set(id, resolve));
        yield { type: "tool_call", id, name: move.tool, input: { taskId, ...move.input } };
        const r = await result;
        tools.push({ agent: input.agent.id, tool: move.tool, ok: r.ok });
        yield { type: "text", text: `${move.tool}: ${r.ok ? "done" : JSON.stringify(r.content)}` };
        yield { type: "done" };
      },
      sendToolResult(callId: string, result: { ok: boolean; content: unknown }) { waiting.get(callId)?.(result); },
      inject() {}, async cancel() {}, async close() {},
    } as EngineSession;
  };
  return { open, wakes, tools };
}

async function world(m: ReturnType<typeof model>) {
  const d = await boot(seededDir(), m.open);
  const pumping = setInterval(() => void d.hooks?.pump?.(), 100);
  await connect(d);
  return { d, stop: async () => { clearInterval(pumping); await d.stop(); } };
}
async function agentTaskAutomation(d: Daemon, over: Record<string, unknown>, ai: Record<string, unknown>): Promise<string> {
  const made = await ok(d, "automations.create", {
    name: "New client letter",
    definition: {
      triggers: [{ key: "manual" }],
      nodes: [{
        id: "work", key: "ai", title: "Draft the letter",
        input: { prompt: "Draft the engagement letter for the new client.\nKeep it to one page.", inputs: { client: "Dana Ortiz", fee: 1500 }, outputSchema: { type: "object", required: ["letter"], properties: { letter: { type: "string" } } }, ...over },
        ai: { mode: "task", doneMeans: ["Names the client", "States the fee"], ...ai },
      }],
    },
  });
  const id = String(made.automation.id);
  await ok(d, "automations.set_enabled", { automationId: id, enabled: true });
  return id;
}
async function startRun(d: Daemon, automationId: string): Promise<string> { return String((await ok(d, "automations.run", { automationId })).runId); }
async function runStatus(d: Daemon, runId: string): Promise<string> { return String((await ok(d, "runs.get", { runId })).run.status); }
async function taskOf(d: Daemon, runId: string): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  return waitFor(async () => ((await ok(d, "tasks.list", { scope: "run", runId })).tasks as any[])[0] ?? null, 30_000, () => hostLog(d));   // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function threadLines(d: Daemon, threadId: string): Promise<string[]> {
  return ((await ok(d, "chat.messages.list", { threadId, limit: 100 })).messages as Array<{ body?: string }>).map((m) => m.body ?? "");
}
const outputOf = (d: Daemon, runId: string, step: string): any => JSON.parse((d.db!.all("SELECT output_json FROM runs_steps WHERE run_id = ? AND step = ?", runId, step)[0] as { output_json: string }).output_json);   // eslint-disable-line @typescript-eslint/no-explicit-any

test("work baton live: an agent does it, an agent reviewer sends it back once and then approves, an agent approver approves, and the Run goes on with the outputs", async () => {
  const m = model((w) => {
    if (w.role === "assigned") {
      const fixed = /Fixes asked for, do every one:\n1\. Use her full name/.test(w.section);
      return fixed
        ? { tool: "task_submit", input: { outputs: { letter: "Dear Ms Dana Ortiz, we will act for you for a fee of 1500." }, summary: "Used her full name; fee and name are both in the letter" } }
        : { tool: "task_submit", input: { outputs: { letter: "Dear Dana, we will act for you for a fee of 1500." }, summary: "Drafted the letter with the fee" } };
    }
    if (w.role === "reviewer") return w.nth === 1 ? { tool: "task_review", input: { verdict: "send_back", fixes: ["Use her full name in the greeting"] } } : { tool: "task_review", input: { verdict: "approve" } };
    return { tool: "task_decide", input: { verdict: "approve", reason: "Fine to send" } };
  });
  const w = await world(m);
  try {
    const doer = await newAgent(w.d, "Drafter"), checker = await newAgent(w.d, "Checker"), boss = await newAgent(w.d, "Signer");
    const id = await agentTaskAutomation(w.d, {}, { agentId: doer.id, reviewer: { kind: "agent", id: checker.id }, approver: { kind: "agent", id: boss.id } });
    const runId = await startRun(w.d, id);
    const task = await taskOf(w.d, runId);
    assert.equal(task.kind, "work");
    assert.deepEqual(task.assigned, { kind: "agent", id: doer.id });
    assert.ok(task.threadId, "the task has a thread");

    await waitFor(async () => ((await runStatus(w.d, runId)) === "succeeded" ? true : null), 60_000, () => `${hostLog(w.d)} wakes ${JSON.stringify(m.wakes.map((x) => [x.agent, x.role, x.nth]))} tools ${JSON.stringify(m.tools)}`);

    // woken in order, each with the right seat: doer, reviewer, doer for the fixes, reviewer, approver
    assert.deepEqual(m.wakes.map((x) => [x.agent, x.role]), [[doer.id, "assigned"], [checker.id, "reviewer"], [doer.id, "assigned"], [checker.id, "reviewer"], [boss.id, "approver"]]);
    assert.deepEqual(m.tools.map((x) => [x.tool, x.ok]), [["task_submit", true], ["task_review", true], ["task_submit", true], ["task_review", true], ["task_decide", true]]);
    assert.match(m.wakes[0]!.section, /Brief:\n## Goal\nDraft the engagement letter/);
    assert.match(m.wakes[0]!.section, /Done means:\n- Names the client\n- States the fee/);
    assert.match(m.wakes[1]!.section, /Handed in by Drafter: Drafted the letter with the fee/);
    assert.match(m.wakes[2]!.section, /Fixes asked for, do every one:\n1\. Use her full name in the greeting/);
    assert.match(m.wakes[2]!.section, /sent back 1 time\./);
    assert.match(m.wakes[4]!.section, /You are the Approver/);

    // the thread holds the brief, the deliverable, the fixes and the verdicts
    const lines = (await threadLines(w.d, task.threadId)).join("\n---\n");
    assert.match(lines, /## Goal\nDraft the engagement letter for the new client\./, "the brief");
    assert.match(lines, /Submitted: Drafted the letter with the fee\n\nDeliverable:\n\{\n  "letter": "Dear Dana/, "the deliverable");
    assert.match(lines, /Sent back with fixes:\n1\. Use her full name in the greeting/, "the fixes");
    assert.match(lines, /Reviewed: looks good/);
    assert.match(lines, /Approved\. Fine to send/);

    // the task ended Done with the second version, and the Run went on with it
    const done = (await ok(w.d, "tasks.get", { taskId: task.id })).task;
    assert.equal(done.state, "done");
    assert.equal(done.reviewLoops, 1);
    const out = outputOf(w.d, runId, "work");
    assert.deepEqual(out.data, { letter: "Dear Ms Dana Ortiz, we will act for you for a fee of 1500." });
    assert.equal(out.text, "Used her full name; fee and name are both in the letter");
    assert.equal(out.taskId, task.id);
  } finally { await w.stop(); }
});

test("work baton live: an agent that ends its turns without a baton call is nudged once, then the task goes to a person, and their answer wakes it", async () => {
  const m = model((w) => (w.nth >= 3 ? { tool: "task_submit", input: { outputs: { letter: "Dear Dana" }, summary: "Drafted after the nudge and the hand-over" } } : null));
  const w = await world(m);
  try {
    const doer = await newAgent(w.d, "Drafter");
    const id = await agentTaskAutomation(w.d, {}, { agentId: doer.id, nudgeMinutes: 10 });
    const runId = await startRun(w.d, id);
    const task = await taskOf(w.d, runId);

    // woken, ends its turn with nothing, is nudged in the thread and woken again
    await waitFor(async () => (m.wakes.length >= 2 ? true : null), 40_000, () => `${hostLog(w.d)} wakes ${m.wakes.length}`);
    const nudged = await waitFor(async () => { const l = (await threadLines(w.d, task.threadId)).filter((x) => /Finish with exactly one baton call/.test(x)); return l.length > 0 ? l : null; }, 20_000);
    assert.equal(nudged.length, 1, "one nudge");
    assert.match(nudged[0]!, /task_submit when the work is done, task_ask[^\n]*task_block/);
    assert.equal(m.wakes.length, 2);
    assert.equal(await runStatus(w.d, runId), "waiting", "the Run waits; nothing was handed in");

    // after nudgeMinutes it goes to the person who asked, in Needs you
    clock.t += 11 * 60_000;
    await w.d.hooks!.runPeriodic("engine.task_baton_sweep");
    const stuck = await waitFor(async () => ((await ok(w.d, "tasks.needs_you", {})).items as Array<{ task: { id: string; title: string; kind: string } }>).find((i) => /An agent stopped on/.test(i.task.title)) ?? null, 20_000, () => hostLog(w.d));
    assert.equal(stuck.task.kind, "unblock");
    assert.ok((await threadLines(w.d, task.threadId)).some((x) => /No hand-over after 10 minutes, so this went to a person\./.test(x)));
    await w.d.hooks!.runPeriodic("engine.task_baton_sweep");
    assert.equal(((await ok(w.d, "tasks.needs_you", {})).items as Array<{ task: { title: string } }>).filter((i) => /An agent stopped on/.test(i.task.title)).length, 1, "escalated once");

    // the person looks, marks it done, and the agent is woken a third time and hands the work in
    await ok(w.d, "tasks.act", { taskId: stuck.task.id, action: "resolved", note: "I checked: carry on" });
    await waitFor(async () => ((await runStatus(w.d, runId)) === "succeeded" ? true : null), 60_000, () => `${hostLog(w.d)} wakes ${m.wakes.length} tools ${JSON.stringify(m.tools)}`);
    assert.equal(m.wakes.length, 3, "woken at the start, after the nudge, and after the person answered");
    assert.deepEqual(m.wakes.map((x) => x.role), ["assigned", "assigned", "assigned"]);
    assert.deepEqual(outputOf(w.d, runId, "work").data, { letter: "Dear Dana" });
  } finally { await w.stop(); }
});
