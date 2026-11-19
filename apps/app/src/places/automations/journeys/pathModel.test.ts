import test from "node:test";
import assert from "node:assert/strict";
import { columns, pathTest, runOf, strip, testLine, whereLine } from "./pathModel.ts";
import type { PathTest, PathTestEvent } from "./pathModel.ts";
import type { Journey } from "./model.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const j = (over: Record<string, unknown> = {}): Journey =>
  ({
    id: "jrn_1",
    name: "Onboarding",
    subjectType: "client",
    recordType: "client",
    version: 1,
    inFlight: 0,
    createdAt: 0,
    updatedAt: 0,
    stages: [
      { key: "won", title: "Active", order: 2, final: true, exit: { requireTasks: false }, tasks: [], automations: [] },
      {
        key: "lead",
        title: "Lead",
        order: 0,
        exit: { requireTasks: false },
        tasks: [],
        automations: ["aut_a", "aut_gone"],
      },
      {
        key: "prop",
        title: "Proposal",
        order: 1,
        exit: { requireTasks: false },
        tasks: [],
        automations: [],
        timeLimit: { hours: 168, escalateTo: { kind: "person", id: "usr_maya" } },
      },
    ],
    ...over,
  }) as unknown as Journey;
const names: Record<string, { name: string; sentence?: string; state: "on" | "off" | "needs" }> = {
  aut_a: { name: "Greet", sentence: "When a lead is created, email them hello.", state: "on" },
  usr_maya: { name: "Maya", state: "off" },
};
const name = (id: string) => names[id];

test("columns come in stage order with counts, limits in words and a name for every member, even one that is gone", () => {
  const c = columns(j(), [{ stage: "prop", count: 3, overLimit: 1 }], name);
  assert.deepEqual(
    c.map((x) => x.key),
    ["lead", "prop", "won"],
  );
  assert.deepEqual(c[1], {
    key: "prop",
    title: "Proposal",
    count: 3,
    over: 1,
    limit: "7 days, then Maya is told",
    final: false,
    cards: [],
  });
  assert.deepEqual(c[0]!.cards, [
    { id: "aut_a", name: "Greet", sentence: "When a lead is created, email them hello.", state: "on" },
    { id: "aut_gone", name: "An Automation", state: "off" },
  ]);
  assert.equal(c[0]!.limit, undefined, "a stage with no limit says nothing about it");
  assert.equal(c[2]!.final, true);
});

test("the strip says how a record gets in, where it ends and what travels with it", () => {
  assert.deepEqual(strip(j()), { starts: "Records are added by hand", finishes: "Active", carried: "Nothing" });
  assert.equal(strip(j({ startRule: { event: "lead.created", enabled: true } })).starts, "A lead is created");
  assert.equal(
    strip(j({ startRule: { event: "invoice.submitted", enabled: false } })).starts,
    "An invoice is submitted (off)",
  );
  assert.equal(strip(j({ startRule: { event: "thing_happened", enabled: true } })).starts, "Thing happened");
  assert.deepEqual(
    strip(
      j({
        startRule: { event: "record.created", enabled: true },
        variables: [
          { key: "plan", title: "Plan" },
          { key: "owner", title: "Owner" },
        ],
      }),
    ),
    {
      starts: "A record is created",
      finishes: "Active",
      carried: "Plan, Owner",
    },
  );
  assert.equal(strip(j({ stages: [] })).finishes, "Nowhere yet");
});

const w = (o: Record<string, unknown>): any => ({
  journeyId: "jrn_1",
  recordId: "rec_1",
  stage: "prop",
  stageTitle: "Proposal",
  enteredAt: 0,
  hoursIn: 72,
  completed: false,
  path: [],
  ...o,
});
test("where: in the stage, with its limit, past it, or finished", () => {
  assert.equal(whereLine(w({})), "In Proposal for 3 days.");
  assert.equal(whereLine(w({ limitHours: 168 })), "In Proposal for 3 days of 7 days.");
  assert.equal(
    whereLine(w({ hoursIn: 200, limitHours: 168, overByHours: 32 })),
    "In Proposal for 8 days, 1 day past its limit.",
  );
  assert.equal(whereLine(w({ hoursIn: 5 })), "In Proposal for 5 hours.");
  assert.equal(
    whereLine(w({ hoursIn: 50, limitHours: 48, overByHours: 2 })),
    "In Proposal for 2 days, 2 hours past its limit.",
  );
  assert.equal(whereLine(w({ completed: true, stageTitle: "Active" })), "Finished in Active.");
});

const run = (s: PathTest, ...e: PathTestEvent[]): PathTest => e.reduce(pathTest, s);
test("the whole-path test: every transition, and no press leaves it stuck", () => {
  const idle: PathTest = { phase: "idle" };
  const runs = [
    { stage: "lead", automationId: "aut_a", runId: "run_a1" },
    { stage: "prop", automationId: "aut_b", error: "It needs a mailbox." },
  ];
  assert.deepEqual(run(idle, { type: "start", recordName: "Harbor Co" }), {
    phase: "starting",
    recordName: "Harbor Co",
  });
  const started = run(idle, { type: "start", recordName: "Harbor Co" }, { type: "started", runs });
  assert.deepEqual(started, { phase: "started", runs, recordName: "Harbor Co" });
  assert.equal(
    testLine(started),
    "Testing the whole path with Harbor Co: 1 Automation started, 1 could not start. Nothing is sent.",
  );
  assert.deepEqual(run(idle, { type: "start" }, { type: "failed", message: "Try again." }), {
    phase: "failed",
    message: "Try again.",
  });
  // a second press while starting changes nothing; a late answer after a reset is dropped
  const starting = run(idle, { type: "start" });
  assert.equal(pathTest(starting, { type: "start", recordName: "Other" }), starting);
  assert.deepEqual(run(starting, { type: "reset" }, { type: "started", runs }), { phase: "idle" });
  assert.deepEqual(run(started, { type: "failed", message: "late" }), started);
  // every state can start again or reset
  for (const s of [idle, starting, started, run(idle, { type: "start" }, { type: "failed", message: "x" })])
    assert.deepEqual(pathTest(s, { type: "reset" }), idle);
  assert.equal(
    pathTest(run(idle, { type: "start" }, { type: "failed", message: "x" }), { type: "start" }).phase,
    "starting",
  );
  assert.equal(
    testLine(run(idle, { type: "start" }, { type: "started", runs: [] })),
    "No stage has an Automation to try yet.",
  );
  assert.equal(runOf(started, "aut_b", "prop")?.error, "It needs a mailbox.");
  assert.equal(runOf(starting, "aut_b", "prop"), undefined);
});
