// One row per helper, updated in place (owner, 4 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import { foldHelperRows, foundLine } from "./helper-rows.ts";

const start = { messageId: "m1", body: "Started a helper: Crew test: subagent 2", createdAt: 1000, blocks: [{ type: "helper", id: "b1", state: "live", data: { title: "Crew test: subagent 2", agentId: "agt_a", helperThreadId: "thr_h" } }] };
const report = { messageId: "m2", body: 'Helper "Crew test: subagent 2" found:\n\nThe pricing page lists three plans. The rest is detail nobody needs here.', createdAt: 14000, blocks: [{ type: "helper", v: 1, data: { threadId: "thr_h", parentThreadId: "thr_p", title: "Crew test: subagent 2", status: "done", agentId: "agt_a", path: [] } }] };
const text = { messageId: "m3", body: "Hello", createdAt: 15000, blocks: [] };

test("a running helper is one row with no body line; a finished one is the same row, done, with one line of what it found, and no second card", () => {
  const running = foldHelperRows([start, text]);
  assert.equal(running.length, 2);
  assert.equal(running[0]!.body, "", "no 'Started a helper' line above the card");
  assert.deepEqual([(running[0]!.blocks[0]!.data as { status: string }).status, (running[0]!.blocks[0]!.data as { startedAt: number }).startedAt], ["running", 1000]);
  const done = foldHelperRows([start, report, text]);
  assert.deepEqual(done.map((m) => m.messageId), ["m1", "m3"], "the report is not drawn as a second card");
  const d = done[0]!.blocks[0]!;
  assert.equal(d.state, "done");
  assert.deepEqual(d.data, { title: "Crew test: subagent 2", agentId: "agt_a", helperThreadId: "thr_h", threadId: "thr_h", status: "done", found: "The pricing page lists three plans.", finishedAt: 14000, startedAt: 1000 });
});

test("a report with no start line in view stays, and the found line is short and plain", () => {
  assert.deepEqual(foldHelperRows([report]).map((m) => m.messageId), ["m2"]);
  assert.equal(foundLine(report.body), "The pricing page lists three plans.");
  assert.equal(foundLine('Helper "X" could not finish.'), "");
  assert.ok(foundLine(`Helper "X" found:\n\n${"word ".repeat(80)}`).length <= 140);
});

import { helperRowOf } from "./helper-row.tsx";
test("the row reads its name, status and found line from the folded block", () => {
  const folded = foldHelperRows([start, report])[0]!.blocks[0]!;
  assert.deepEqual(helperRowOf(folded as never), { title: "Crew test: subagent 2", threadId: "thr_h", status: "done", found: "The pricing page lists three plans.", startedAt: 1000 });
  assert.equal(helperRowOf(foldHelperRows([start])[0]!.blocks[0]! as never).status, "running");
});
