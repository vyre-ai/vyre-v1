// A goal's check-in turn fails for a reason that is the person's to fix, for an AI account at its limit, or for a passing trouble, on a booted daemon (the model is a stand-in that fails the turn with a real engine code).
// The owner's own Space, 4 to 11 Nov 2026: three causes, each retried once a minute later, each dropped, six days of check-ins gone and nobody told. What must be true instead: the owner is told once, in words, in Needs you
// and on the goal; the wake-up waits for what clears the cause and runs then; the goal's numbers count what ran.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { boot, call, clock, connect, hostLog, newAgent, seededDir, waitFor } from "./memory-live-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";

let keys = 0;
const ok = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> => {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `gw-${cap}-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

interface Fail {
  code: string;
  message: string;
  resetsAt?: number;
}
/** The lead: it checks in when the model is well; when it is not, the turn fails with the given error. It keeps what each goal turn was told. */
function lead(): { open: OpenSession; mode: { fail: Fail | null }; briefs: string[]; failed: () => number } {
  const mode: { fail: Fail | null } = { fail: null };
  const briefs: string[] = [];
  let failures = 0;
  const open: OpenSession = async () => {
    const waiting = new Map<string, (r: { ok: boolean; content: unknown }) => void>();
    let n = 0;
    const found = new Set<string>();
    return {
      warm: true,
      async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
        const goal = input.context?.sections.find((s) => s.id === "goal")?.text ?? "";
        const f = mode.fail;
        if (f) {
          failures += 1;
          yield {
            type: "error",
            code: f.code,
            message: f.message,
            ...(f.resetsAt !== undefined ? { resetsAt: f.resetsAt } : {}),
          };
          return;
        }
        briefs.push(goal);
        const goalId = /goalId (gol_[a-z0-9]+)/.exec(goal)?.[1];
        const wakeId = /wakeId (\S+)\. End this turn/.exec(goal)?.[1];
        if (goalId && wakeId) {
          const name = "goals_checkin_post";
          if (!found.has(name)) {
            const id = `c${++n}`;
            const p = new Promise<{ ok: boolean; content: unknown }>((r) => waiting.set(id, r));
            yield { type: "tool_call", id, name: "tool_search", input: { query: name } };
            await p;
            found.add(name);
          }
          const id = `c${++n}`;
          const p = new Promise<{ ok: boolean; content: unknown }>((r) => waiting.set(id, r));
          yield { type: "tool_call", id, name, input: { goalId, wakeId, summary: "Checked." } };
          await p;
        }
        yield { type: "text", text: "Done for now." };
        yield { type: "done" };
      },
      sendToolResult(callId: string, result: { ok: boolean; content: unknown }) {
        waiting.get(callId)?.(result);
      },
      inject() {},
      async cancel() {},
      async close() {},
    } as EngineSession;
  };
  return { open, mode, briefs, failed: () => failures };
}

async function up(dir: string, open: OpenSession): Promise<{ d: Daemon; stop: () => Promise<void> }> {
  const d = await boot(dir, open);
  const pumping = setInterval(() => void d.hooks?.pump?.(), 100);
  return {
    d,
    stop: async () => {
      clearInterval(pumping);
      await d.stop();
    },
  };
}

const wakeRows = (d: Daemon): Array<{ reason: string; state: string; attempt: number; due_at: number }> =>
  new DatabaseSync(d.paths.modules, { readOnly: true })
    .prepare("SELECT reason, state, attempt, due_at FROM goals_wake ORDER BY created_at")
    .all() as Array<{ reason: string; state: string; attempt: number; due_at: number }>;
const goalOf = async (d: Daemon, goalId: string): Promise<any> => (await ok(d, "goals.get", { goalId })).goal; // eslint-disable-line @typescript-eslint/no-explicit-any
const wakeLines = async (d: Daemon, goalId: string): Promise<string[]> =>
  ((await ok(d, "goals.activity", { goalId, limit: 200 })).activity as Array<{ kind: string; text: string }>)
    .filter((x) => x.kind === "wake" || x.kind === "status")
    .map((x) => x.text);
const needsYou = async (d: Daemon): Promise<Array<{ title: string; summary: string }>> =>
  ((await ok(d, "tasks.needs_you", {})).items as Array<{ task: { title: string; summary?: string } }>).map((x) => ({
    title: x.task.title,
    summary: x.task.summary ?? "",
  }));
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** The clock's pass, then a moment for the events it causes to be read. */
const tickClock = async (d: Daemon, ms = 2_500): Promise<void> => {
  await d.hooks!.runPeriodic("goals.clock");
  await pause(ms);
};

const TITLE = "5 registrations for Lab 9";
const told = async (d: Daemon): Promise<number> => (await needsYou(d)).filter((x) => x.title.includes(TITLE)).length;
const heldRow = (d: Daemon): unknown => JSON.stringify(wakeRows(d));
const waitHeld = (d: Daemon): Promise<true> =>
  waitFor(
    async () => (wakeRows(d).some((r) => r.state === "waiting") ? true : null),
    30_000,
    () => heldRow(d),
  );
/** A goal with a daily check-in at 09:00, its lead well for the start. `nextDay` moves the clock to the next check-in and returns it. */
async function dailyGoal(w: { d: Daemon }) {
  await connect(w.d);
  const desk = await newAgent(w.d, "Dex");
  const made = await ok(w.d, "goals.create", {
    title: TITLE,
    finish: {
      kind: "number",
      line: "Lab 9 registrations reach 5",
      target: 5,
      unit: "registrations",
      source: { kind: "records", type: "contact", label: "Lab 9 registrations" },
    },
    deadline: clock.t + 12 * 86_400_000,
    leadAgentId: desk.id,
    rhythm: { every: "day", at: "09:00" },
    quiet: null,
    zone: "UTC",
    stuckAfter: 10,
    budget: { turns: 500 },
  });
  const goalId = made.goal.id as string;
  await waitFor(
    async () => (wakeRows(w.d).some((r) => r.state === "reported") ? true : null),
    40_000,
    () => hostLog(w.d),
  );
  const turnsBefore = (await goalOf(w.d, goalId)).turns as number;
  return {
    goalId,
    turnsBefore,
    nextDay: async (): Promise<number> => {
      const g = await goalOf(w.d, goalId);
      clock.t = g.nextCheckinAt + 1_000;
      return clock.t;
    },
  };
}

test(
  "the Vault is locked: the owner is told once with the one thing to do, the wake-up waits, missed days are counted not replayed, and it runs when the cause clears",
  { timeout: 240_000 },
  async () => {
    const m = lead();
    const w = await up(seededDir(), m.open);
    try {
      const g = await dailyGoal(w);
      m.mode.fail = { code: "engine.vault_locked", message: "Your Vault is locked on this computer." };
      await g.nextDay();
      await tickClock(w.d, 0);
      await waitHeld(w.d);

      // told, in words, once: Needs you, the goal's status, its Activity line
      const goal = await goalOf(w.d, g.goalId);
      assert.equal(goal.status, "waiting");
      assert.match(
        goal.statusReason,
        /^Not being worked: your Vault key is not on this server\. Open Vyre on your computer and unlock your Vault\./,
      );
      assert.equal(goal.blocked.cause, "person");
      const needs = (await needsYou(w.d)).filter((x) => x.title.includes(TITLE));
      assert.equal(needs.length, 1, JSON.stringify(needs));
      assert.equal(needs[0]!.title, `Check-ins paused: ${TITLE}`);
      assert.match(
        needs[0]!.summary,
        new RegExp(
          `^Dex could not check in on ${TITLE}: your Vault key is not on this server\\. Open Vyre on your computer and unlock your Vault\\.`,
        ),
      );
      assert.doesNotMatch(needs[0]!.summary, /engine\.|vault_locked|no words/);
      const lines = await wakeLines(w.d, g.goalId);
      assert.ok(
        lines.some((l) => /could not check in: your Vault key is not on this server\. Open Vyre/.test(l)),
        JSON.stringify(lines),
      );
      assert.ok(!lines.some((l) => /Stuck|no words|engine\.|Asking once more/.test(l)), JSON.stringify(lines));
      assert.match(
        JSON.stringify(await ok(w.d, "notifications.list", {})),
        /Check-ins paused/,
        "a notification, when they have them on",
      );

      // not asked again every minute: the wake-up stays on its first attempt
      for (let i = 0; i < 2; i++) {
        clock.t += 61_000;
        await tickClock(w.d, 1_500);
      }
      assert.deepEqual(
        wakeRows(w.d)
          .filter((r) => r.reason.includes("checkin"))
          .map((r) => [r.state, r.attempt]),
        [["waiting", 1]],
        heldRow(w.d) as string,
      );

      // two more days: one attempt at each check-in, nothing said twice, nothing replayed
      for (let i = 0; i < 2; i++) {
        await g.nextDay();
        await tickClock(w.d, 4_000);
      }
      assert.equal(await told(w.d), 1, "told once");
      assert.equal((await goalOf(w.d, g.goalId)).checkins, 0, "no check-in ran, so none is counted");
      assert.equal((await goalOf(w.d, g.goalId)).turns, g.turnsBefore, "turns that failed are not turns of the budget");

      // the cause clears: the lead's turn runs, reports, and everything held lets go
      m.mode.fail = null;
      const after = await waitFor(
        async () => {
          await tickClock(w.d, 1_000);
          const x = await goalOf(w.d, g.goalId);
          return x.blocked === undefined && x.status === "planning" ? x : null;
        },
        90_000,
        () => `${heldRow(w.d)} ${hostLog(w.d)}`,
      );
      assert.equal(after.checkins, 1, "one check-in ran");
      assert.equal(await told(w.d), 0, "the item is withdrawn");
      assert.ok(
        m.briefs.some((b) =>
          /earlier check-ins? (?:was|were) missed because your Vault key is not on this server/.test(b),
        ),
        `the run says how many were missed: ${JSON.stringify(m.briefs.map((b) => b.slice(-500)))}`,
      );
    } finally {
      await w.stop();
    }
  },
);

test(
  "the AI account is at its limit: the owner is told when it resets and the choice they have, the wake-up waits for the reset and runs then",
  { timeout: 240_000 },
  async () => {
    const m = lead();
    const w = await up(seededDir(), m.open);
    try {
      const g = await dailyGoal(w);
      const at = await g.nextDay();
      const resetsAt = at + 3 * 3_600_000;
      m.mode.fail = { code: "provider.rate_limited", message: "You've hit your weekly limit", resetsAt };
      await tickClock(w.d, 0);
      await waitHeld(w.d);
      const goal = await goalOf(w.d, g.goalId);
      assert.equal(goal.status, "waiting");
      assert.equal(goal.blocked.cause, "limit");
      assert.equal(goal.blocked.until, resetsAt + 60_000);
      assert.match(
        goal.statusReason,
        /^Not being worked: your AI account reached its usage limit\. It resets \w{3} \d+ \w{3}, 12:00 \(UTC\)\./,
      );
      const needs = (await needsYou(w.d)).filter((x) => x.title.includes(TITLE));
      assert.equal(needs.length, 1);
      assert.match(
        needs[0]!.summary,
        /^Dex could not check in on 5 registrations for Lab 9: your AI account reached its usage limit\. It resets \w{3} \d+ \w{3}, 12:00 \(UTC\)\. The check-in runs then\. To go on sooner, let the agent use another AI account\./,
      );
      // until the reset nothing is asked: no turn at +1 minute, +5 minutes, +2 hours
      const failedAtStart = m.failed();
      for (const step of [61_000, 5 * 60_000, 2 * 3_600_000]) {
        clock.t += step;
        await tickClock(w.d, 1_500);
      }
      assert.equal(m.failed(), failedAtStart, "no attempt before the reset");
      assert.deepEqual(
        wakeRows(w.d)
          .filter((r) => r.reason.includes("checkin"))
          .map((r) => [r.state, r.attempt]),
        [["waiting", 1]],
      );
      // the reset passes and the account is well: the check-in runs by itself
      m.mode.fail = null;
      clock.t = resetsAt + 2 * 60_000;
      const after = await waitFor(
        async () => {
          await tickClock(w.d, 1_000);
          const x = await goalOf(w.d, g.goalId);
          return x.blocked === undefined && x.status === "planning" ? x : null;
        },
        60_000,
        () => `${heldRow(w.d)} ${hostLog(w.d)}`,
      );
      assert.equal(after.checkins, 1);
      assert.equal(await told(w.d), 0);
    } finally {
      await w.stop();
    }
  },
);

test(
  "the server was lost mid-turn: tried again by itself with a longer wait each time, nobody is told until it keeps failing",
  { timeout: 240_000 },
  async () => {
    const m = lead();
    const w = await up(seededDir(), m.open);
    try {
      const g = await dailyGoal(w);
      m.mode.fail = { code: "host_lost", message: "The turn failed." };
      await g.nextDay();
      await tickClock(w.d, 0);
      const waits = [60_000, 5 * 60_000, 20 * 60_000];
      for (let i = 0; i < waits.length; i++) {
        await waitFor(
          async () => (wakeRows(w.d).some((r) => r.state === "pending" && r.attempt === i + 1) ? true : null),
          30_000,
          () => heldRow(w.d),
        );
        const said = (await wakeLines(w.d, g.goalId)).filter((l) => /Trying again in/.test(l));
        assert.match(
          said[0]!,
          new RegExp(
            `could not check in: the server stopped while this was running\\. Trying again in ${waits[i]! / 60_000} minutes?\\.`,
          ),
        );
        assert.equal(await told(w.d), 0, "not told for a passing trouble");
        assert.notEqual((await goalOf(w.d, g.goalId)).status, "waiting", "a passing trouble does not stop the goal");
        // before it is due, nothing runs
        clock.t += waits[i]! - 5_000;
        const before = m.failed();
        await tickClock(w.d, 1_200);
        assert.equal(m.failed(), before, "not before its time");
        clock.t += 10_000;
        await tickClock(w.d, 0);
      }
      // the fourth failure: it keeps failing, so the owner is told, once
      await waitHeld(w.d);
      const goal = await goalOf(w.d, g.goalId);
      assert.equal(goal.blocked.cause, "transient");
      assert.equal(goal.status, "waiting");
      const needs = (await needsYou(w.d)).filter((x) => x.title.includes(TITLE));
      assert.equal(needs.length, 1);
      assert.match(
        needs[0]!.summary,
        /the server stopped while this was running\. It kept failing, so check-ins wait\./,
      );
    } finally {
      await w.stop();
    }
  },
);

test(
  "a passing trouble that clears on the retry is never told to the owner, and the check-in counts once",
  { timeout: 180_000 },
  async () => {
    const m = lead();
    const w = await up(seededDir(), m.open);
    try {
      const g = await dailyGoal(w);
      m.mode.fail = { code: "host_lost", message: "The turn failed." };
      await g.nextDay();
      await tickClock(w.d, 0);
      await waitFor(
        async () => (wakeRows(w.d).some((r) => r.state === "pending" && r.attempt === 1) ? true : null),
        30_000,
        () => heldRow(w.d),
      );
      m.mode.fail = null;
      clock.t += 61_000;
      const after = await waitFor(
        async () => {
          await tickClock(w.d, 800);
          const x = await goalOf(w.d, g.goalId);
          return x.checkins === 1 ? x : null;
        },
        60_000,
        () => `${heldRow(w.d)} ${hostLog(w.d)}`,
      );
      assert.notEqual(after.status, "waiting");
      assert.equal(await told(w.d), 0);
      assert.equal(after.blocked, undefined);
    } finally {
      await w.stop();
    }
  },
);

test(
  "a goal whose deadline passes while its check-ins waited ends missed and says why, in the words the owner was told",
  { timeout: 180_000 },
  async () => {
    const m = lead();
    const w = await up(seededDir(), m.open);
    try {
      const g = await dailyGoal(w);
      m.mode.fail = { code: "engine.vault_locked", message: "Your Vault is locked on this computer." };
      const at = await g.nextDay();
      await tickClock(w.d, 0);
      await waitHeld(w.d);
      assert.equal(await told(w.d), 1);
      const deadline = (await goalOf(w.d, g.goalId)).deadline as number;
      clock.t = Math.max(deadline + 1_000, at + 1_000);
      await tickClock(w.d, 1_500);
      const ended = await goalOf(w.d, g.goalId);
      assert.equal(ended.status, "missed");
      assert.match(
        ended.summary,
        /From \w{3} \d+ \w{3}, 09:00 the lead agent could not check in: your Vault key is not on this server\. \d+ check-ins? did not run\./,
      );
      await waitFor(
        async () => ((await told(w.d)) === 0 ? true : null),
        20_000,
        () => `still told ${hostLog(w.d)}`,
      );
    } finally {
      await w.stop();
    }
  },
);
