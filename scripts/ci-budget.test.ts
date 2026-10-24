import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { LIMIT_MIN, QUEUE_ALERT_SEC, budgetLines, checkBudget, split, wallSec } from "./ci-budget.ts";
import { queueVsExec, report, rows } from "./ci-report.ts";

test("limits are 5, 10 and 25 minutes", () => {
  assert.deepEqual(LIMIT_MIN, { push: 5, main: 10, tag: 25 });
});

test("a run fails when wall time exceeds 5, 10 and 25 minutes", () => {
  for (const [kind, min] of [["push", 5], ["main", 10], ["tag", 25]] as const) {
    assert.equal(checkBudget(kind, min * 60).ok, true, `${kind} at the limit passes`);
    assert.equal(checkBudget(kind, min * 60 + 1).ok, false, `${kind} one second over fails`);
    assert.match(checkBudget(kind, min * 60 + 1).line, /^FAIL/);
  }
});

test("a push that takes 6 minutes would pass the main budget but fail its own", () => {
  assert.equal(checkBudget("push", 360).ok, false);
  assert.equal(checkBudget("main", 360).ok, true);
});

test("wallSec reads ISO timestamps and rejects junk", () => {
  assert.equal(wallSec("2026-10-24T10:00:00Z", "2026-10-24T10:04:30Z"), 270);
  assert.equal(wallSec("2026-10-24T10:05:00Z", "2026-10-24T10:00:00Z"), 0);
  assert.throws(() => wallSec("", "2026-10-24T10:00:00Z"));
});

test("report lists jobs slowest first with the total", () => {
  const jobs = [
    { name: "a", conclusion: "success", started_at: "2026-10-24T10:00:00Z", completed_at: "2026-10-24T10:00:10Z" },
    { name: "b", conclusion: "failure", started_at: "2026-10-24T10:00:00Z", completed_at: "2026-10-24T10:01:00Z" },
    { name: "c", conclusion: "skipped", started_at: null, completed_at: null },
  ];
  assert.deepEqual(rows(jobs).map((r) => r.name), ["b", "a", "c"]);
  assert.match(report(jobs), /3 jobs, slowest b \(60 s\), 70 s of runner time/);
});

const fixture = [
  { name: "select", started_at: "2026-10-24T10:04:00Z", completed_at: "2026-10-24T10:04:30Z" },
  { name: "golden", started_at: "2026-10-24T10:04:05Z", completed_at: "2026-10-24T10:06:00Z" },
  { name: "shards", started_at: null, completed_at: null },
];

test("budget math: queue time is split from execution and only execution counts", () => {
  const s = split("2026-10-24T10:00:00Z", fixture, "2026-10-24T10:08:00Z");
  assert.equal(s.queueSec, 240);
  assert.equal(s.execSec, 240);
  const b = budgetLines("push", s.queueSec, s.execSec);
  assert.equal(b.ok, true, "8 minutes wall passes because 4 of them were queue");
  assert.match(b.lines.join("\n"), /queue wait: 4m00s/);
  assert.match(b.lines.join("\n"), /ALERT queue wait/);
});

test("execution over budget still fails and a short queue raises no alert", () => {
  const s = split("2026-10-24T10:00:00Z", fixture, "2026-10-24T10:10:30Z");
  const b = budgetLines("push", 30, s.execSec);
  assert.equal(b.ok, false);
  assert.doesNotMatch(b.lines.join("\n"), /ALERT/);
  assert.equal(QUEUE_ALERT_SEC, 120);
});

test("report shows queue versus execution", () => {
  assert.equal(queueVsExec("2026-10-24T10:00:00Z", fixture), "queue 240 s, execution 120 s (ALERT: queue over 2 min)");
});

test("check.yml: select, golden and contracts have no needs so they run in parallel", () => {
  const y = fs.readFileSync(new URL("../.github/workflows/check.yml", import.meta.url), "utf8");
  for (const j of ["select", "golden", "contracts"]) {
    const m = y.match(new RegExp(`\\n  ${j}:\\n([\\s\\S]*?)(?=\\n  [a-z]+:\\n|$)`));
    assert.ok(m, j);
    assert.doesNotMatch(m![1], /\n    needs:/, `${j} must not wait on another job`);
  }
});
