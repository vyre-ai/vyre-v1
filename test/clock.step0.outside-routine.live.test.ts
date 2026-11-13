// P1 step 0 (CONTRACTS-2026-11-13/P1-clock-wake.md, section 4): a characterisation test. It RECORDS what happens today to a routine that belongs to an outside agent (one that connects over MCP, like Claude Code),
// before the wake table changes anything. Question (b): does a routine's run, started by its time or by Run Now, reach that agent (agents_next), or does anything else happen?
import assert from "node:assert/strict";
import { expectStatus } from "../golden/steps/02-space.ts";
import test from "node:test";
import { bootAgentGateSpace } from "../golden/steps/07-agent-gate.ts";
import { Client, OUTSIDE_LIVE, signIn } from "./support/outside-client.ts";
import { connect, scriptedModel } from "./support/live.ts";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

test("RECORDS TODAY: a routine of an outside agent, started by Run Now and by its time (a model account is connected, so the turn could run)", async () => {
  const notices: string[] = [];
  const s = await bootAgentGateSpace(OUTSIDE_LIVE, {
    engineOpenSession: scriptedModel(async function* (input) {
      notices.push(String((input as { notice?: string }).notice ?? ""));
      yield { type: "text", text: "ok" };
    }),
  });
  try {
    await connect(s.d);
    const owner = s.signedIn("usr_olivia");
    const c = new Client(`${s.d.url}/mcp`);
    const { agentId } = await signIn(s, c, owner);
    await c.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-code", version: "2.1" },
    });
    const saved = await s.call("agents.routine.save", owner, {
      agentId,
      title: "Monday summary",
      cron: "* * * * *",
      prompt: "Summarise the week.",
      idempotencyKey: "s0b-save",
    });
    console.log(`OBSERVED step 0 (b) save: ${saved.status} ${JSON.stringify(saved.body).slice(0, 300)}`);
    const routineId = (saved.body?.data?.routine?.routineId ?? saved.body?.routine?.routineId) as string | undefined;
    const jobs: Json[] = [];
    const poll = async (ms: number): Promise<void> => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        await s.d.hooks?.pump?.();
        const job = (await c.tool("agents_next")).json.result.structuredContent.data.job;
        if (job) jobs.push({ kind: job.kind, keys: Object.keys(job), text: String(job.text ?? "").slice(0, 80) });
        await new Promise((r) => setTimeout(r, 200));
      }
    };
    const lastRun = async (): Promise<unknown> =>
      (
        expectStatus(await s.call("agents.routines.list", owner, { agentId }), 200, "agents.routines.list")
          .routines as Json[]
      ).find((r) => r.routineId === routineId)?.lastRun ?? null;
    assert.ok(routineId, "an outside agent may save a routine");
    {
      const ran = await s.call("agents.routine.run_now", owner, { agentId, routineId, idempotencyKey: "s0b-now" });
      console.log(`OBSERVED step 0 (b) run_now: ${ran.status} ${JSON.stringify(ran.body).slice(0, 300)}`);
      await poll(5_000);
      console.log(
        `OBSERVED step 0 (b) after Run Now: jobs ${JSON.stringify(jobs)}; lastRun ${JSON.stringify(await lastRun())}`,
      );
      // its time: the routine runs every minute, so within about 70 seconds the scheduler job starts it
      const end = Date.now() + 75_000;
      while (Date.now() < end) {
        await s.d.hooks!.runPeriodic("agents.routines_due");
        await poll(2_000);
      }
      console.log(
        `OBSERVED step 0 (b) after its time: jobs ${JSON.stringify(jobs)}; lastRun ${JSON.stringify(await lastRun())}`,
      );
    }
    const threads = expectStatus(
      await s.call("threads.list", owner, { kind: ["chat"], limit: 50 }),
      200,
      "threads.list",
    ).threads as Json[];
    const chat = threads.find((t) => t.title === "Monday summary");
    console.log(`OBSERVED step 0 (b) chat: ${JSON.stringify(chat ?? null)}`);
    if (chat) {
      const turns = expectStatus(
        await s.call("engine.turns.list", owner, { threadId: chat.threadId }),
        200,
        "turns",
      ).turns;
      console.log(
        `OBSERVED step 0 (b) turns on the routine chat: ${JSON.stringify(turns.map((t: Json) => [t.state, t.error]))}`,
      );
      // RECORDED 13 Nov 2026: the routine never reaches the outside agent. No agents_next job is made (the job kinds are mention, task and answer). Instead the engine, which has no branch for an outside
      // agent in routine-run.ts, wakes it as if Vyre ran it: with a model account connected a turn runs on Vyre's own model in the routine's chat and the routine's Last run reads succeeded; without
      // one the same turn fails with no_account (seen in the first draft of this test). P1 section 6 item 7 adds a "routine" job kind; these assertions go with that step.
      assert.deepEqual(jobs, [], "no job reached the outside agent");
      assert.ok(turns.length >= 1 && turns.every((t: Json) => t.state === "completed"));
    }
    assert.equal(((await lastRun()) as { status: string } | null)?.status, "succeeded");
    const woken = notices.filter((n) => /Monday summary/.test(n)).length;
    console.log(`OBSERVED step 0 (b) Vyre's own model was woken for the routine: ${woken} times`);
    assert.ok(woken >= 2, "Vyre's own model ran the outside agent's routine turns (Run Now and its time)");
  } finally {
    await s.stop();
  }
});
