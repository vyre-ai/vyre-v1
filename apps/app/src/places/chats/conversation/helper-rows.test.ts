// @tsx
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

import { mergeCrewAnswer } from "./helper-rows.ts";

test("the agent's intro, the strip and its answer read as one message once the helpers have ended; the answer waits while one still works; a person's line ends the run", () => {
  const agent = { kind: "agent", id: "agt_1" }, person = { kind: "person", id: "usr_1" };
  const strip = (id: string, status: string) => ({ messageId: `s_${id}`, body: "", author: agent, blocks: [{ type: "crew_strip", id: `strip-${id}`, data: { blocks: [{ type: "helper", id: "b1", data: { helperThreadId: "thr_1", status } }] } }] });
  const text = (id: string, body: string, who = agent) => ({ messageId: id, body, author: who, blocks: [] });
  // start lines first, then the agent's words, then the answer
  const done = mergeCrewAnswer([strip("1", "done"), text("i", "Two helpers are on it."), text("a", "Thursday works [1]."), text("b", "Say the word.")]);
  assert.equal(done.length, 1);
  assert.equal(done[0]!.messageId, "i"); assert.equal(done[0]!.body, "Two helpers are on it.");
  assert.equal(((done[0]!.blocks[0]!.data as { after?: string }).after), "Thursday works [1].\n\nSay the word.");
  // still working: the intro joins the strip and the answer stays where it is
  const working = mergeCrewAnswer([strip("1", "running"), text("i", "Two helpers are on it."), text("a", "Not yet.")]);
  assert.equal(working.length, 2); assert.equal(((working[0]!.blocks[0]!.data as { after?: string }).after), undefined);
  // the agent spoke first
  assert.equal(mergeCrewAnswer([text("i", "Let me get helpers."), strip("1", "done")]).length, 1);
  // a person's line, another author or a card ends the run
  const cut = mergeCrewAnswer([strip("1", "done"), text("p", "Thanks", person as never), text("a", "Later.")]);
  assert.equal(cut.length, 3);
  assert.equal(mergeCrewAnswer([strip("1", "done"), text("o", "Someone else", { kind: "agent", id: "agt_2" })]).length, 2);
});


import { hideCrewPosts } from "./helper-rows.ts";

test("nothing is posted per coder: the start line and the result card go once the strip holds the coder; words and other cards stay", () => {
  const start = { messageId: "s", body: "", blocks: [{ type: "helper", id: "b1", data: { crew: true, helperThreadId: "thr_c" } }] };
  const result = { messageId: "r", body: "Ember finished Fix it: 1 commit.", blocks: [{ type: "crew_result", id: "b2", data: { jobId: "crw_1", threadId: "thr_c" } }] };
  const words = { messageId: "w", body: "Three helpers are on it.", blocks: [{ type: "helper", id: "b3", data: { crew: true, helperThreadId: "thr_c" } }] };
  const other = { messageId: "o", body: "", blocks: [{ type: "crew_result", id: "b4", data: { jobId: "crw_9", threadId: "thr_x" } }] };
  const out = hideCrewPosts([start, result, words, other], new Set(["thr_c"]), new Set(["crw_1"]));
  assert.deepEqual(out.map((m) => m.messageId), ["w", "o"]);
  assert.equal(out[0]!.blocks.length, 0, "the words stay, without the star line");
  assert.deepEqual(hideCrewPosts([start], new Set(), new Set()).map((m) => m.messageId), ["s"], "no coder in the strip, nothing is hidden");
});

import { stripFromCoders } from "./helper-rows.ts";

test("a crew of coders only gets a strip made of the first coder's start line: the lead's words stay above it, other start lines go, and the answer that follows joins it once they are done", () => {
  const agent = { kind: "agent", id: "agt_1" };
  const lead = { messageId: "m1", body: "Two coders are on it.", author: agent, blocks: [{ type: "helper", id: "b1", data: { crew: true, helperThreadId: "thr_a" } }, { type: "helper", id: "b2", data: { crew: true, helperThreadId: "thr_b" } }] };
  const second = { messageId: "m2", body: "", author: agent, blocks: [{ type: "helper", id: "b3", data: { crew: true, helperThreadId: "thr_b" } }] };
  const answer = { messageId: "m3", body: "Both are in.", author: agent, blocks: [] };
  const out = stripFromCoders([lead, second, answer], new Set(["thr_a", "thr_b"]));
  assert.deepEqual(out.map((m) => m.messageId), ["m1", "m3"]);
  assert.deepEqual(out[0]!.blocks.map((b) => b.type), ["crew_strip"]);
  assert.equal(out[0]!.body, "Two coders are on it.");
  const startOnly = { messageId: "m0", body: "Started a helper: Dark mode", author: agent, blocks: [{ type: "helper", id: "b0", data: { crew: true, helperThreadId: "thr_a" } }] };
  assert.equal(stripFromCoders([startOnly], new Set(["thr_a"]))[0]!.body, "", "a line that held only the start keeps no words");
  assert.equal(stripFromCoders([lead], new Set()).length, 1);
  // done: the answer joins the strip under the lead's own words
  const done = mergeCrewAnswer(out.map((m, i) => (i === 0 ? { ...m, blocks: [{ ...m.blocks[0]!, data: { blocks: [{ type: "helper", id: "x", data: { helperThreadId: "thr_a", status: "done" } }] } }] } : m)));
  assert.equal(done.length, 1);
  assert.equal((done[0]!.blocks[0]!.data as { after?: string }).after, "Both are in.");
});
