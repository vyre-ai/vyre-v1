import test from "node:test";
import assert from "node:assert/strict";
import { countRuns, dependenciesFrom, eventRows, exportChoices, packageRows } from "./read.ts";

test("run counts use the statuses on the list and add cost only when it is a number", () => {
  assert.equal(countRuns(null as never), null);
  const counted = countRuns([
    { status: "succeeded", costMicros: 10 },
    { status: "failed", costMicros: "nope" },
    { status: "waiting" },
  ]);
  assert.equal(counted?.text, "0 queued, 0 running, 1 waiting, 1 succeeded, 1 failed, 0 stopped. Cost 10.");
});

test("event rows show type, time, subject, and run, and a sealed row hides the payload", () => {
  const rows = eventRows({
    events: [
      { id: "evt_1", type: "record.updated", at: Date.UTC(2026, 0, 2), subject: { type: "record", id: "rec_1" }, runId: "run_1", payload: { secret: "no" } },
      { id: "evt_2", type: "dm.sent", at: Date.UTC(2026, 0, 2), payload: { sealed: true, body: "hidden" } },
    ],
  });
  assert.equal(rows?.[0]?.line.includes("secret"), false);
  assert.match(rows?.[0]?.line ?? "", /record\.updated/);
  assert.match(rows?.[0]?.line ?? "", /record rec_1/);
  assert.match(rows?.[0]?.line ?? "", /run run_1/);
  assert.match(rows?.[1]?.line ?? "", /dm\.sent/);
  assert.match(rows?.[1]?.line ?? "", /sealed/);
  assert.equal(rows?.[1]?.line.includes("hidden"), false);
});

test("package rows and export choices keep only named ids", () => {
  assert.deepEqual(packageRows({ packages: [{ id: "pkg_1", name: "Welcome" }, { id: 1, name: "skip" }] }), [{ id: "pkg_1", name: "Welcome" }]);
  assert.equal(packageRows({}), null);
  assert.deepEqual(exportChoices({ automations: [{ id: "aut_1", name: "Welcome" }] }), [{ id: "aut_1", name: "Welcome" }]);
});

test("dependencies come from named ids on the definition", () => {
  const rows = dependenciesFrom([{
    id: "aut_1",
    name: "Welcome",
    nodes: [
      { key: "send_email", input: { mailboxId: "mbx_main", to: "{{ trigger.email }}" } },
      { key: "call_automation", input: { automationId: "aut_next", journeyId: "jrn_1" } },
      { key: "send_sms", input: { numberId: "num_1" } },
      { key: "records.update", input: { connectionId: "con_1" } },
    ],
  }]);
  assert.deepEqual(rows.map((row) => row.line), [
    "Automation Welcome uses mailbox mbx_main",
    "Automation Welcome uses automation aut_next",
    "Automation Welcome uses journey jrn_1",
    "Automation Welcome uses number num_1",
    "Automation Welcome uses connection con_1",
  ]);
});
