import test from "node:test";
import assert from "node:assert/strict";
import { needsFromAutomations, todayFromAutomations, summaryLine } from "./from-list.ts";

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
