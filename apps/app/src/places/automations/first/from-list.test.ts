import test from "node:test";
import assert from "node:assert/strict";
import { needsFromAutomations, pausedWhy, todayFromAutomations, summaryLine } from "./from-list.ts";

const row = (o: object) => ({
  id: "aut_1",
  name: "Weekly report",
  status: "on",
  kind: "space",
  updatedAt: 0,
  failedRuns: 0,
  ...o,
});
const DAY = 86_400_000;
const now = 10 * DAY + 3_600_000;

test("an Automation that is paused or whose last run failed needs him, with the one fix that fits and no field key", () => {
  const rows = [
    row({
      id: "a",
      name: "New lead follow-up",
      failedRuns: 1,
      lastRun: { runId: "run_4", status: "failed", at: now - 1000 },
    }),
    row({ id: "b", name: "Invoice reminders", status: "paused" }),
    row({ id: "c", name: "Daily brief", lastRun: { runId: "run_1", status: "succeeded", at: now - 500 } }),
  ];
  const n = needsFromAutomations(rows as never);
  assert.deepEqual(
    n.map((x) => [x.id, x.automation, x.runId ?? null, x.fix.label]),
    [
      ["a", "New lead follow-up", "run_4", "Open it"],
      ["b", "Invoice reminders", null, "Open it"],
    ],
  );
  assert.ok(!/\b(aut|run)_/.test(JSON.stringify(n.map((x) => x.why))));
});

test("today counts the runs that started today and names the failed ones", () => {
  const rows = [
    row({ id: "a", lastRun: { runId: "r1", status: "succeeded", at: now - 1000 } }),
    row({ id: "b", lastRun: { runId: "r2", status: "failed", at: now - 2000 } }),
    row({ id: "c", lastRun: { runId: "r3", status: "succeeded", at: now - 3 * DAY } }),
  ];
  assert.deepEqual(todayFromAutomations(rows as never, now), { ran: 2, failed: [{ runId: "r2" }] });
});

test("the line under the title says how many are on and how many need him", () => {
  const rows = [
    row({ status: "on" }),
    row({ status: "on", failedRuns: 1, lastRun: { runId: "r", status: "failed", at: 1 } }),
    row({ status: "off" }),
  ];
  assert.equal(summaryLine(rows as never), "2 on, 1 needs you");
  assert.equal(summaryLine([row({ status: "off" })] as never), "None on");
  assert.equal(summaryLine([] as never), "");
});

test("a paused Automation says the reason the builder head says, and offers no run to read; a failed one still offers its run", () => {
  const paused = row({
    id: "p",
    name: "New lead follow-up",
    status: "paused",
    pausedReason: "Needs the Twilio key",
    failedRuns: 1,
    lastRun: { runId: "run_4", status: "failed", at: now - 1000 },
  });
  const failed = row({ id: "f", failedRuns: 1, lastRun: { runId: "run_9", status: "failed", at: now - 1000 } });
  const [a, b] = needsFromAutomations([paused, failed] as never, { p: "Needs the Twilio key" });
  assert.equal(a!.why, "Needs the Twilio key");
  assert.equal(a!.runId, undefined, "See the run only where a failed run is the reason");
  assert.equal(pausedWhy(paused as never), "Needs the Twilio key", "one source for the card and the head");
  assert.equal(b!.runId, "run_9");
});
