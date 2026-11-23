// What the rc.41 screens draw of the server's answers: which connect flow a Connect opens, the Last week line, what a test can be tried on, the summary of a trace, and the Why sheet's order and words.
import test from "node:test";
import assert from "node:assert/strict";
import {
  blockedById,
  connectNeedOf,
  firstOpen,
  traceSummary,
  tryOn,
  verdictTone,
  watchLine,
  weekHead,
} from "./model.ts";
import type { TraceStep, WeekStart, WhyRow, WouldRun } from "./model.ts";

test("Connect opens the flow for what is missing; a fix on a step opens no flow", () => {
  assert.deepEqual(connectNeedOf({ fix: { kind: "mailbox" } }), { kind: "mailbox" });
  assert.deepEqual(connectNeedOf({ fix: { kind: "ai_account" } }), { kind: "ai" });
  assert.deepEqual(connectNeedOf({ fix: { kind: "number" } }), { kind: "number" });
  assert.deepEqual(connectNeedOf({ fix: { kind: "connection", connector: "google" } }), {
    kind: "connector",
    service: "google",
  });
  assert.equal(connectNeedOf({ fix: { kind: "file" } }), null);
  assert.equal(connectNeedOf({ fix: { kind: "step" } }), null);
  const m = blockedById([
    { automationId: "aut_1", short: "No mailbox", line: "x", button: "Connect", fix: { kind: "mailbox" } },
    { short: "No AI account", line: "y", button: "Connect", fix: { kind: "ai_account" } },
  ]);
  assert.deepEqual([...m.keys()], ["aut_1"]);
});

const start = (over: Partial<WeekStart>): WeekStart => ({
  eventId: "evt_1",
  at: 1,
  starts: true,
  name: "Brightpath",
  change: "Stage became Signed",
  ...over,
});
const week = (over: Partial<WouldRun>): WouldRun => ({
  supported: true,
  days: 7,
  n: 6,
  of: 9,
  capped: false,
  what: "changes to Customers",
  starts: [],
  ...over,
});

test("the Last week line: the number, what it is out of, and a plus when the week was too busy to count to the end", () => {
  assert.deepEqual(weekHead(week({})), { n: "6", title: "would have started", sub: "of 9 changes to Customers" });
  assert.deepEqual(weekHead(week({ capped: true })).n, "6+");
  assert.equal(weekHead(week({ n: 0, of: 0 })).sub, "Nothing of its kind happened");
});

test("a test is offered the newest things that happened, one per record", () => {
  const w = week({
    starts: [
      start({ eventId: "evt_3", recordId: "rec_a", change: "Owner became Lena" }),
      start({ eventId: "evt_2", recordId: "rec_a" }),
      start({ eventId: "evt_1", recordId: "rec_b", name: "Harbor Co", starts: false }),
    ],
  });
  assert.deepEqual(
    tryOn(w).map((s) => s.eventId),
    ["evt_3", "evt_1"],
  );
  assert.deepEqual(tryOn(null), []);
});

const step = (n: number, over: Partial<TraceStep>): TraceStep => ({
  id: `s${n}`,
  number: n,
  text: `Step ${n}`,
  state: "pending",
  held: false,
  values: [],
  ...over,
});

test("a trace is summed up in a few words: where it is, that it reached the end, or where it stopped and why; and what was held", () => {
  const running = traceSummary(
    [step(1, { state: "done", held: true }), step(2, { state: "running" }), step(3, {})],
    false,
  );
  assert.deepEqual([running.state, running.head, running.quiet], ["running", "Step 2 of 3", "1 held"]);
  const ok = traceSummary([step(1, { state: "done", held: true }), step(2, { state: "done", held: true })], true);
  assert.deepEqual([ok.state, ok.head, ok.quiet, ok.held.length], ["ok", "Ran to the end", "2 held", 2]);
  const stopped = traceSummary(
    [
      step(1, { state: "done" }),
      step(2, { state: "stopped", error: "Send an email needs an address." }),
      step(3, { state: "skipped" }),
    ],
    true,
  );
  assert.deepEqual(
    [stopped.state, stopped.head, stopped.why],
    ["stopped", "Stopped at step 2", "Send an email needs an address."],
  );
});

test("the Why sheet opens the first Automation that did not do what was hoped, and says how many watch the record's kind", () => {
  const row = (id: string, verdict: WhyRow["verdict"]): WhyRow => ({
    automationId: id,
    name: id,
    status: "on",
    verdict,
    line: "",
    checks: [],
  });
  assert.equal(firstOpen([row("a", "ran"), row("b", "not_started"), row("c", "failed")]), "b");
  assert.equal(firstOpen([row("a", "ran"), row("b", "off")]), null);
  assert.deepEqual(
    ["not_started", "stopped", "failed", "waiting", "running", "ran", "off"].map((v) =>
      verdictTone(v as WhyRow["verdict"]),
    ),
    ["warn", "warn", "warn", "warn", "ok", "ok", "quiet"],
  );
  assert.equal(watchLine(3, "Customers"), "3 automations watch Customers");
  assert.equal(watchLine(1, "Companies"), "1 automation watches Companies");
  assert.equal(watchLine(0, "Customers"), "No automation watches Customers");
  assert.equal(watchLine(2), "2 automations watch this");
});
