// @tsx
import test from "node:test";
import assert from "node:assert/strict";
import { activityLine, elapsedWords, stepWords, thinkingExcerpt } from "./activity.ts";
import { workOf } from "./model.ts";
import type { Message } from "./model.ts";

const snap = (o: Partial<Parameters<typeof activityLine>[0]> = {}) => ({ startedAt: 0, thinking: "", steps: [], version: 0, ...o });

test("a tool's name is said the way a person would", () => {
  assert.equal(stepWords("Read"), "Reading");
  assert.equal(stepWords("WebSearch"), "Searching the web");
  assert.equal(stepWords("Bash"), "Running a command");
  assert.equal(stepWords("mcp__vyre__records_search"), "Searching records");
  assert.equal(stepWords("mcp__vyre__tasks_create"), "Creating tasks");
  assert.equal(stepWords("something_odd"), "Using something odd");
  assert.equal(stepWords("ToolSearch"), "Looking for tools");
  assert.equal(stepWords("SomeNewTool"), "Using some new tool");
  assert.equal(stepWords(""), "Working");
});

test("a step says what it touches when the host said so", async () => {
  const { stepLabel } = await import("./activity.ts");
  assert.equal(stepLabel("Read", "model.ts"), "Reading model.ts");
  assert.equal(stepLabel("WebSearch", "stream pacing"), "Searching the web: stream pacing");
  assert.equal(stepLabel("Bash"), "Running a command");
  assert.equal(stepLabel("Read"), "Reading");
});

test("the line: a step in progress wins, then the thinking, else just Thinking; never a made-up word", () => {
  assert.deepEqual(activityLine(snap()), { label: "Thinking", detail: "" });
  assert.deepEqual(activityLine(snap({ thinking: "I should compare the two files" })), { label: "Thinking", detail: "I should compare the two files" });
  assert.equal(activityLine(snap({ thinking: "x", steps: [{ id: "a", name: "Read", state: "done" }, { id: "b", name: "WebSearch", state: "live" }] })).label, "Searching the web");
  assert.equal(activityLine(snap({ thinking: "now", steps: [{ id: "a", name: "Read", state: "done" }] })).label, "Thinking", "when no step is in progress it is thinking again");
});

test("a long thought is shown as its last stretch on one line, and time shows only once it matters", () => {
  const long = `${"word ".repeat(60)}the end`;
  const e = thinkingExcerpt(long);
  assert.ok(e.startsWith("…") && e.endsWith("the end") && e.length <= 74 && !e.includes("\n"));
  assert.equal(thinkingExcerpt("  "), "");
  assert.equal(elapsedWords(2), "");
  assert.equal(elapsedWords(14), "14s");
  assert.equal(elapsedWords(75), "1m 15s");
});

test("a finished reply folds its steps into \"Worked for 14s\" from the blocks the host recorded; they are not cards", () => {
  const b = (type: string, data: Record<string, unknown>, id: string) => ({ id, type, v: 1, state: "done", data });
  const m = { blocks: [b("tool_call", { id: "t1", name: "Read" }, "b1"), b("tool_result", { id: "t1", ok: true, secs: 2 }, "b2"), b("tool_call", { id: "t2", name: "WebSearch" }, "b3"), b("tool_result", { id: "t2", ok: true, secs: 3, turnSecs: 14 }, "b4")] } as unknown as Message;
  const w = workOf(m)!;
  assert.equal(w.summary, "Worked for 14s, 2 steps");
  assert.deepEqual(w.steps.map((s) => s.title), ["Reading", "Searching the web"]);
});
