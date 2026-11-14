// @tsx
import test from "node:test";
import assert from "node:assert/strict";
import { activityLine, calmWord, elapsedWords, stepWords, thinkingExcerpt } from "./activity.ts";
import { workOf } from "./model.ts";
import type { Message } from "./model.ts";

const snap = (o: Partial<Parameters<typeof activityLine>[0]> = {}) => ({
  startedAt: 0,
  thinking: "",
  steps: [],
  version: 0,
  ...o,
});

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
  assert.equal(stepLabel("engine_setup", "Codex"), "Setting up Codex", "a turn waiting while Vyre installs its engine");
});

test("the line: a step in progress wins, then the thinking, else just Thinking; never a made-up word", () => {
  assert.deepEqual(activityLine(snap()), { label: "Thinking", detail: "" });
  assert.deepEqual(activityLine(snap({ thinking: "I should compare the two files" })), {
    label: "Thinking",
    detail: "I should compare the two files",
  });
  assert.equal(
    activityLine(
      snap({
        thinking: "x",
        steps: [
          { id: "a", name: "Read", state: "done" },
          { id: "b", name: "WebSearch", state: "live" },
        ],
      }),
    ).label,
    "Searching the web",
  );
  assert.equal(
    activityLine(snap({ thinking: "now", steps: [{ id: "a", name: "Read", state: "done" }] })).label,
    "Thinking",
    "when no step is in progress it is thinking again",
  );
  assert.equal(
    activityLine(snap({ steps: [{ id: "setup_codex", name: "engine_setup", detail: "Codex", state: "live" }] })).label,
    "Setting up Codex",
  );
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

test('a finished reply folds its steps into "Worked 14s" from the blocks the host recorded; they are not cards', () => {
  const b = (type: string, data: Record<string, unknown>, id: string) => ({ id, type, v: 1, state: "done", data });
  const m = {
    blocks: [
      b("tool_call", { id: "t1", name: "Read" }, "b1"),
      b("tool_result", { id: "t1", ok: true, secs: 2 }, "b2"),
      b("tool_call", { id: "t2", name: "WebSearch" }, "b3"),
      b("tool_result", { id: "t2", ok: true, secs: 3, turnSecs: 14 }, "b4"),
    ],
  } as unknown as Message;
  const w = workOf(m)!;
  assert.equal(w.summary, "Worked 14s · 2 steps");
  assert.deepEqual(
    w.steps.map((s) => s.title),
    ["Reading", "Searching the web"],
  );
});

test("tools running together read as one line that says how many, with the calls named", () => {
  const step = (id: string, name: string, state: "live" | "done" = "live") => ({ id, name, state, detail: "" });
  const reads = activityLine(
    snap({ steps: [step("a", "calendar_list_events"), step("b", "mail_message_search"), step("c", "tasks_list")] }),
  );
  assert.equal(reads.label, "Reading 3 things");
  assert.equal(reads.detail, "Using calendar list events · Searching mail message · Looking through tasks");
  const mixed = activityLine(snap({ steps: [step("a", "calendar_list_events"), step("b", "tasks_create")] }));
  assert.equal(mixed.label, "Working on 2 things");
  const one = activityLine(snap({ steps: [step("a", "calendar_list_events"), step("b", "tasks_list", "done")] }));
  assert.equal(one.label, "Using calendar list events", "one running step keeps its own words");
});

test("the API model's tools read as what they do, and no tool name leaks through the thinking line (lead, 12 Nov)", () => {
  assert.equal(stepWords("terminal_run"), "Running a command");
  assert.equal(stepWords("read_link"), "Reading a page");
  assert.equal(stepWords("web_search"), "Searching the web");
  const t = thinkingExcerpt("I will call terminal_run to start it, then mcp__vyre__records_search for the deal", 200);
  assert.ok(!/terminal_run|mcp__|records_search/.test(t), t);
  assert.match(t, /running a command/);
});

test("an ordinary underscored word in the thinking line is left as written; only a known tool's name is said as what it does (review)", () => {
  assert.equal(thinkingExcerpt("Checking the user_id on the record", 200), "Checking the user_id on the record");
  assert.match(thinkingExcerpt("Then terminal_run with the user_id", 200), /^Then running a command with the user_id$/);
});

test("a live reply shows one calm word, never a step's name or a count (G21)", () => {
  const step = (state: "live" | "done") => ({ id: "s1", name: "mcp__vyre__records_search", detail: "Harbor", state });
  assert.equal(calmWord(snap(), false), "Thinking");
  assert.equal(calmWord(snap({ thinking: "let me see" }), false), "Thinking");
  assert.equal(calmWord(snap({ steps: [step("live")] as never }), false), "Working");
  assert.equal(
    calmWord(snap({ steps: [step("done")] as never }), false),
    "Thinking",
    "a finished step is not live work",
  );
  assert.equal(calmWord(snap({ steps: [step("live")] as never }), true), "Writing", "words coming win");
});

test("a turn that sits a minute in one tool call keeps a true word, and one waiting on its computer says Waiting", () => {
  const long = snap({
    startedAt: Date.now() - 60_000,
    steps: [{ id: "s1", name: "Bash", state: "live" }] as never,
  });
  assert.equal(calmWord(long, false), "Working");
  const parked = snap({ steps: [{ id: "s2", name: "device_wait", state: "live" }] as never });
  assert.equal(calmWord(parked, false), "Waiting");
});

test("the word is true while a turn is held, setting up, or parked (review, 14 Nov)", () => {
  const live = (name: string, id = "s") => ({ id, name, state: "live" as const });
  assert.equal(calmWord(snap({ steps: [live("Bash")] as never }), false, true), "Waiting for you", "held for a person");
  assert.equal(calmWord(snap({ steps: [live("AskUserQuestion")] as never }), false), "Waiting for you");
  assert.equal(calmWord(snap({ steps: [live("engine_setup")] as never }), false), "Setting up");
  assert.equal(calmWord(snap({ steps: [live("device_wait")] as never }), false), "Waiting");
  assert.equal(
    calmWord(snap({ steps: [live("device_wait", "a"), live("Bash", "b")] as never }), false),
    "Working",
    "one parked step among running ones is still work",
  );
  assert.equal(
    calmWord(snap({ steps: [live("Bash")] as never }), true, true),
    "Waiting for you",
    "words streamed, then a question open: it waits",
  );
  assert.equal(
    calmWord(snap({ steps: [live("Bash")] as never }), true, false),
    "Writing",
    "words coming, nothing held",
  );
});
