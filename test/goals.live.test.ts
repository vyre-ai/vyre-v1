// Goals on a booted daemon: the daemon, the engine, goals, tasks, chat, files, access and the Gate are real; the model is a stand-in that reads the "goal" and "task" sections of its turn context
// and does what the working-on-goals skill asks of a good lead: research before planning, a plan whose steps each say why, check-ins on the real number, one ask per decision, a retrospective.
// The story: the owner gives Lab Desk a goal counted from records; it researches, plans two tasks, does them through the baton, asks once, the server restarts, the number stays flat until the goal is
// stuck, then the number rises past the line, the goal is done and the lead writes its retrospective into the goal's folder.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, clock, connect, hostLog, newAgent, seededDir, waitFor } from "./memory-live-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";

let keys = 0;
const ok = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `gl-${cap}-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

interface Turn { agent: string; kind: "goal" | "task" | "none"; reason: string; tools: string[]; goal: string }
/** The lead a good model would be. Each turn records the tools it called, in order, and what its goal section said. */
function lead(): { open: OpenSession; turns: Turn[]; results: Array<{ tool: string; ok: boolean; content: unknown }> } {
  const turns: Turn[] = [];
  const results: Array<{ tool: string; ok: boolean; content: unknown }> = [];
  const open: OpenSession = async () => {
    const waiting = new Map<string, (r: { ok: boolean; content: unknown }) => void>();
    let n = 0;
    const found = new Set<string>();
    return {
      warm: true,
      async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
        const goal = input.context?.sections.find((s) => s.id === "goal")?.text ?? "";
        const task = input.context?.sections.find((s) => s.id === "task")?.text ?? "";
        const turn: Turn = { agent: input.agent.id, kind: goal && !task ? "goal" : task ? "task" : "none", reason: /You were woken because: ([^\n]*)/.exec(goal)?.[1] ?? "", tools: [], goal };
        turns.push(turn);
        async function* use(tool: string, args: Record<string, unknown>): AsyncGenerator<DriverEvent, { ok: boolean; content: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
          if (!found.has(tool)) {
            const id = `c${++n}`;
            const p = new Promise<{ ok: boolean; content: unknown }>((r) => waiting.set(id, r));
            yield { type: "tool_call", id, name: "tool_search", input: { query: tool } };
            await p; found.add(tool);
          }
          const id = `c${++n}`;
          const p = new Promise<{ ok: boolean; content: unknown }>((r) => waiting.set(id, r));
          yield { type: "tool_call", id, name: tool, input: args };
          const r = await p;
          turn.tools.push(tool); results.push({ tool, ok: r.ok, content: r.content });
          return r as { ok: boolean; content: any };   // eslint-disable-line @typescript-eslint/no-explicit-any
        }
        const taskId = /taskId (tsk_[a-z0-9]+)/.exec(task)?.[1];
        if (taskId && /You are the one who does the work \(Assigned\), and it is your turn/.test(task)) {
          yield* use("task_submit", { taskId, summary: "Sent the reminder from the Lab template to 40 past attendees" });
        } else if (goal) {
          const goalId = /goalId (gol_[a-z0-9]+)/.exec(goal)![1]!;
          const wakeId = /wakeId (\S+)\. End this turn/.exec(goal)?.[1];
          const number = /read by Vyre from [^:]+: (\d+|not read yet)/.exec(goal)?.[1] ?? "?";
          if (/There is no plan yet/.test(goal)) {
            yield* use("goals_search_past", { query: "lab registrations" });
            yield* use("goals_sources", {});
            yield* use("goals_plan_update", {
              goalId, children: [
                { key: "reminder", title: "Remind Lab 7 attendees", why: "Past attendees registered at 31% after one reminder", impact: "+1", assigned: { kind: "agent", id: input.agent.id } },
                { key: "skool", title: "Post Lab 8 in the community", why: "The last post brought most first-time registrations", impact: "+1", assigned: { kind: "agent", id: input.agent.id }, dependsOn: ["reminder"] },
              ],
            });
            yield* use("goals_ask", { goalId, decision: "no-shows", question: "Email the Lab 7 no-shows too?", options: ["Yes", "Only attendees"] });
            yield* use("goals_ask", { goalId, decision: "no-shows", question: "Should the no-shows get the email?" });
            yield* use("goals_checkin_post", { goalId, ...(wakeId ? { wakeId } : {}), summary: `${number} so far. Planned two steps from what worked for Lab 7.`, next: ["Remind Lab 7 attendees"] });
          } else if (/goals_complete/.test(goal)) {
            yield* use("goals_complete", { goalId, retro: { summary: `Reached the line at ${number}.`, worked: ["The Lab 7 reminder"], didNot: ["Waiting three days on the no-show question"], playbook: "1. Remind the last Lab's attendees first." } });
            yield* use("goals_checkin_post", { goalId, ...(wakeId ? { wakeId } : {}), summary: "Retrospective saved in Reports. Say so and the playbook becomes a skill." });
          } else if (wakeId) {
            yield* use("goals_checkin_post", { goalId, wakeId, summary: `${number} now. ${turn.reason}.` });
          }
        }
        yield { type: "text", text: "Done for now." };
        yield { type: "done" };
      },
      sendToolResult(callId: string, result: { ok: boolean; content: unknown }) { waiting.get(callId)?.(result); },
      inject() {}, async cancel() {}, async close() {},
    } as EngineSession;
  };
  return { open, turns, results };
}

async function up(dir: string, open: OpenSession): Promise<{ d: Daemon; stop: () => Promise<void> }> {
  const d = await boot(dir, open);
  const pumping = setInterval(() => void d.hooks?.pump?.(), 100);
  return { d, stop: async () => { clearInterval(pumping); await d.stop(); } };
}
const goalOf = async (d: Daemon, goalId: string): Promise<any> => (await ok(d, "goals.get", { goalId }));   // eslint-disable-line @typescript-eslint/no-explicit-any
async function contacts(d: Daemon, n: number, tag: string): Promise<void> { for (let i = 0; i < n; i++) await ok(d, "records.create", { type: "contact", fields: { name: `Lab 8 guest ${tag}${i}` } }); }

test("goals live: research, plan as tasks, the baton does them, one ask, a restart, stuck when flat, done when the number rises, a retrospective in the folder", { timeout: 120_000 }, async () => {
  const m = lead();
  const dir = seededDir();
  let w = await up(dir, m.open);
  try {
    await connect(w.d);
    const desk = await newAgent(w.d, "Lab Desk");
    const t0 = clock.t;
    const made = await ok(w.d, "goals.create", {
      title: "3 registrations for Lab 8", finish: { kind: "number", line: "Lab 8 registrations reach 3", target: 3, unit: "registrations", source: { kind: "records", type: "contact", label: "Lab 8 registrations" } },
      deadline: t0 + 4 * 86_400_000, leadAgentId: desk.id, rhythm: { every: "hours", hours: 6 }, quiet: null, zone: "UTC", stuckAfter: 2, budget: { turns: 60 },
      permissions: [{ act: "send", target: "mail.send", label: "Send email from the Lab template" }],
    });
    const goalId = made.goal.id as string;
    assert.equal(made.goal.status, "planning");
    assert.equal(made.goal.permissions[0].granted, true, "the owner's press in the app");
    assert.ok(made.goal.threadId && made.goal.rootTaskId);

    // the first wake-up: research first, then a plan whose steps each say why, one ask, a check-in
    await waitFor(async () => (m.turns.some((t) => t.tools.includes("goals_checkin_post")) ? true : null), 40_000, () => `${hostLog(w.d)} ${JSON.stringify(m.turns.map((t) => [t.kind, t.tools]))} ${JSON.stringify(m.results.filter((r) => !r.ok))}`);
    const first = m.turns.find((t) => t.kind === "goal")!;
    assert.equal(first.agent, desk.id);
    assert.equal(first.reason, "the goal started");
    assert.deepEqual(first.tools, ["goals_search_past", "goals_sources", "goals_plan_update", "goals_ask", "goals_ask", "goals_checkin_post"], "research comes before the plan");
    assert.ok(m.results.every((r) => r.ok), JSON.stringify(m.results.filter((r) => !r.ok)));
    const asks = m.results.filter((r) => r.tool === "goals_ask").map((r) => (r.content as { data: { asked: boolean; taskId: string } }).data);
    assert.deepEqual(asks.map((a) => a.asked), [true, false], `asked once per decision: ${JSON.stringify(m.results.filter((r) => r.tool === "goals_ask"))}`);
    assert.equal(asks[0]!.taskId, asks[1]!.taskId);

    let lastGet: unknown;
    // the plan is two tasks under the goal; the baton wakes the lead in each task's thread and it hands them in
    const done = await waitFor(async () => { const g = await goalOf(w.d, goalId); lastGet = { tasks: g.tasks, status: g.goal.status }; return g.tasks.length === 2 && g.tasks.every((t: { state: string }) => t.state === "done") ? g : null; }, 40_000, () => `${JSON.stringify(lastGet)} ${hostLog(w.d)} ${JSON.stringify(m.turns.map((t) => [t.kind, t.tools]))}`);
    assert.deepEqual(done.tasks.map((t: { title: string }) => t.title).sort(), ["Post Lab 8 in the community", "Remind Lab 7 attendees"]);
    assert.equal(done.goal.status, "waiting", "the no-show question waits on the owner");
    assert.deepEqual(done.waiting.map((x: { title: string }) => x.title), ["Email the Lab 7 no-shows too?"]);
    assert.ok(done.goal.folderId, "the goal has its folder");
    const firstCheckin = (await ok(w.d, "chat.messages.list", { threadId: made.goal.threadId, limit: 100 })).messages.map((x: { body: string }) => x.body).find((b: string) => /Planned two steps/.test(b));
    assert.match(firstCheckin, /^0 of 3 registrations\. 0 so far\. Planned two steps/, "the check-in carries the number Vyre read");

    // the server restarts: the goal goes on from its tables
    await w.stop();
    w = await up(dir, m.open);
    await connect(w.d).catch(() => undefined);
    const before = m.turns.length;
    // two check-ins with the number flat: stuck, with the reason, and the owner hears once
    for (let i = 0; i < 2; i++) {
      const g = (await goalOf(w.d, goalId)).goal;
      clock.t = g.nextCheckinAt + 1_000;
      await w.d.hooks!.runPeriodic("goals.clock");
      await waitFor(async () => ((await goalOf(w.d, goalId)).goal.checkins === i + 1 ? true : null), 20_000, () => hostLog(w.d));
      await waitFor(async () => (m.turns.filter((t) => t.reason.includes("check-in")).length >= i + 1 ? true : null), 30_000, () => `${hostLog(w.d)} ${JSON.stringify(m.turns.slice(before).map((t) => [t.kind, t.reason, t.tools]))}`);
    }
    const flat = (await goalOf(w.d, goalId)).goal;
    assert.equal(flat.status, "stuck");
    assert.match(flat.statusReason, /^No progress in 2 check-ins; 0 of 3 registrations/);
    const needs = (await ok(w.d, "tasks.needs_you", {})).items as Array<{ task: { title: string } }>;
    assert.equal(needs.filter((x) => x.task.title === "Stuck: 3 registrations for Lab 8").length, 1);
    assert.ok(m.turns.filter((t) => t.reason.includes("check-in")).every((t) => /0 now\./.test(JSON.stringify(m.results)) || t.tools.includes("goals_checkin_post")));

    // the number rises past the line: done, an honest summary, and the retrospective lands in Reports
    await contacts(w.d, 3, "a");
    clock.t += 16 * 60_000;
    await w.d.hooks!.runPeriodic("goals.clock");
    const ended = await waitFor(async () => { const g = (await goalOf(w.d, goalId)).goal; return g.status === "done" ? g : null; }, 20_000, () => hostLog(w.d));
    assert.match(ended.summary, /^Reached 3 of 3 registrations \(100%\)\. 2 of 2 tasks done\./);
    const retro = await waitFor(async () => { const g = (await goalOf(w.d, goalId)).goal; return g.retro ? g.retro : null; }, 30_000, () => `${hostLog(w.d)} ${JSON.stringify(m.turns.slice(-3).map((t) => [t.kind, t.reason, t.tools]))}`);
    assert.equal(retro.summary, "Reached the line at 3.");
    const reports = await ok(w.d, "goals.folder", { goalId, sub: "Reports" });
    const files = (await ok(w.d, "files.list", { folder: reports.folderId })).files as Array<{ name: string }>;
    assert.deepEqual(files.map((f) => f.name), ["Retrospective.md"]);
    // everything the goal did is in its activity, with why
    const activity = (await ok(w.d, "goals.activity", { goalId, limit: 200 })).activity as Array<{ kind: string; text: string }>;
    for (const kind of ["started", "plan", "task", "checkin", "reading", "status", "ended", "retro"]) assert.ok(activity.some((a) => a.kind === kind), `activity has ${kind}`);
    assert.ok(activity.some((a) => a.kind === "plan" && /Why: Past attendees registered at 31%/.test(a.text)));
  } finally { await w.stop(); }
});
