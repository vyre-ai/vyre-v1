// A command-line engine's own subagents (finding F41): the lines a subagent works through carry parent_tool_use_id. They are not the main agent's words, usage or context; only its tool calls are told,
// tagged with the Agent call that started it, and the Agent call's own result carries what the subagent returned.
import test from "node:test";
import assert from "node:assert/strict";
import { createClaudeDecoder } from "../src/drivers/cli/index.ts";
import type { CliEvent } from "../src/drivers/cli/index.ts";

const feed = (lines: unknown[]): CliEvent[] => {
  const d = createClaudeDecoder();
  return lines.flatMap((l) => d.push(JSON.stringify(l)));
};
const asst = (parent: string | null, content: unknown[], usage = { input_tokens: 5, output_tokens: 2 }) => ({
  type: "assistant",
  parent_tool_use_id: parent,
  message: { id: `m${Math.random()}`, model: "claude-x", content, usage },
});

test("a subagent's words and usage are not the agent's; its tool calls are told with the call that started it", () => {
  const out = feed([
    asst(null, [{ type: "tool_use", id: "toolu_a", name: "Agent", input: { description: "Test the terminal" } }]),
    asst(
      "toolu_a",
      [
        { type: "text", text: "chatter nobody reads" },
        { type: "thinking", thinking: "private thoughts" },
        { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "echo hi" } },
      ],
      { input_tokens: 99_000, output_tokens: 1 },
    ),
    {
      type: "user",
      parent_tool_use_id: "toolu_a",
      isReplay: true,
      message: { content: [{ type: "tool_result", tool_use_id: "tu_1", content: "hi" }] },
    },
  ]);
  assert.deepEqual(out, [
    { type: "tool", phase: "call", id: "toolu_a", name: "Agent" },
    { type: "tool", phase: "input", id: "toolu_a", detail: "Test the terminal" },
    { type: "tool", phase: "call", id: "tu_1", name: "Bash", parent: "toolu_a" },
    { type: "tool", phase: "result", id: "tu_1", ok: true, parent: "toolu_a" },
  ]);
});

test("the Agent call's result carries what the subagent returned, redacted and cut; other results do not", () => {
  const out = feed([
    asst(null, [
      { type: "tool_use", id: "toolu_a", name: "Agent", input: { description: "d" } },
      { type: "tool_use", id: "r1", name: "Read", input: { file_path: "/x/a.md" } },
    ]),
    {
      type: "user",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_result", tool_use_id: "r1", content: "file text" }] },
    },
    {
      type: "user",
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_a",
            content: [{ type: "text", text: `It works. ${"x".repeat(3000)}` }],
          },
        ],
      },
    },
  ]);
  const results = out.filter(
    (e): e is Extract<CliEvent, { phase: "result" }> => e.type === "tool" && e.phase === "result",
  );
  assert.equal(results[0]!.id, "r1");
  assert.equal(results[0]!.result, undefined);
  assert.equal(results[1]!.id, "toolu_a");
  assert.match(results[1]!.result ?? "", /^It works\. x+…$/);
  assert.equal((results[1]!.result ?? "").length, 1500);
});

test("a subagent's streamed words are dropped too", () => {
  const out = feed([
    { type: "stream_event", parent_tool_use_id: "toolu_a", event: { type: "message_start", message: { id: "ms" } } },
    {
      type: "stream_event",
      parent_tool_use_id: "toolu_a",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "chatter" } },
    },
    {
      type: "stream_event",
      parent_tool_use_id: null,
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "the answer" } },
    },
  ]);
  assert.deepEqual(out, [{ type: "text", text: "the answer" }]);
});

// two parallel subagents whose lines interleave with the main agent's own stream (recorded shape of Claude Code stream-json)
const parallel = (withUsage: boolean): unknown[] => [
  { type: "stream_event", parent_tool_use_id: null, event: { type: "message_start", message: { id: "main1" } } },
  { type: "stream_event", parent_tool_use_id: "toolu_a", event: { type: "message_start", message: { id: "sub_a1" } } },
  { type: "stream_event", parent_tool_use_id: "toolu_b", event: { type: "message_start", message: { id: "sub_b1" } } },
  {
    type: "stream_event",
    parent_tool_use_id: null,
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
  },
  {
    type: "assistant",
    parent_tool_use_id: "toolu_a",
    message: {
      id: "sub_a1",
      model: "m",
      content: [{ type: "text", text: "A chatter" }],
      usage: { input_tokens: 90_000, output_tokens: 5 },
    },
  },
  {
    type: "assistant",
    parent_tool_use_id: "toolu_b",
    message: {
      id: "sub_b1",
      model: "m",
      content: [{ type: "text", text: "B chatter" }],
      usage: { input_tokens: 80_000, output_tokens: 5 },
    },
  },
  {
    type: "assistant",
    parent_tool_use_id: null,
    message: {
      id: "main1",
      model: "m",
      content: [{ type: "text", text: "Hello" }],
      usage: { input_tokens: 100, output_tokens: 2 },
    },
  },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Hello",
    session_id: "s",
    ...(withUsage ? { usage: { input_tokens: 100, output_tokens: 2 } } : {}),
  },
];

test("parallel subagents: the main text streams once, never doubled by a subagent's message_start", () => {
  const out = feed(parallel(true));
  assert.deepEqual(
    out.filter((e) => e.type === "text"),
    [{ type: "text", text: "Hello" }],
  );
});

test("parallel subagents: their usage never counts into the main reply, even when the result line gives none", () => {
  const out = feed(parallel(false));
  const u = out.find((e): e is Extract<CliEvent, { type: "usage" }> => e.type === "usage");
  assert.deepEqual([u?.inputTokens, u?.outputTokens, u?.contextTokens], [100, 2, 100]);
});

// A helper started in the background (owner's rc.28 report, 16 Nov): the launch call's result only says it started. It is not the helper's end, and its text is never an answer.
const launch = (
  callId: string,
  text = "Async agent launched successfully.\nagentId: ag_1 (internal ID - do not mention to user)",
) => ({
  type: "user",
  parent_tool_use_id: null,
  message: { content: [{ type: "tool_result", tool_use_id: callId, content: [{ type: "text", text }] }] },
  tool_use_result: { isAsync: true, status: "async_launched", agentId: "ag_1", description: "Research batch 1" },
});

test("a helper launched in the background is launched, not finished: its result carries no answer and says launched", () => {
  const out = feed([
    asst(null, [
      {
        type: "tool_use",
        id: "toolu_bg",
        name: "Agent",
        input: { description: "Research batch 1", run_in_background: true },
      },
    ]),
    launch("toolu_bg"),
  ]);
  const r = out.find((e) => e.type === "tool" && e.phase === "result");
  assert.deepEqual(r, {
    type: "tool",
    phase: "result",
    id: "toolu_bg",
    ok: true,
    launched: true,
    name: "Agent",
    detail: "Research batch 1",
  });
  assert.equal(JSON.stringify(out).includes("Async agent launched"), false);
});

test("a background shell job is launched, not finished, by its own words", () => {
  const out = feed([
    asst(null, [
      { type: "tool_use", id: "toolu_sh", name: "Bash", input: { command: "sleep 99", run_in_background: true } },
    ]),
    {
      type: "user",
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_sh",
            content: "Command running in background with ID: bg_7. Output is being written to: /tmp/x",
          },
        ],
      },
    },
  ]);
  const r = out.find((e): e is Extract<CliEvent, { phase: "result" }> => e.type === "tool" && e.phase === "result");
  assert.equal(r?.launched, true);
  assert.equal(r?.output, undefined);
});

test("a foreground helper still ends at its result with its answer", () => {
  const out = feed([
    asst(null, [{ type: "tool_use", id: "toolu_fg", name: "Agent", input: { description: "d" } }]),
    {
      type: "user",
      parent_tool_use_id: null,
      message: {
        content: [{ type: "tool_result", tool_use_id: "toolu_fg", content: [{ type: "text", text: "Found 3 rows." }] }],
      },
    },
  ]);
  const r = out.find((e): e is Extract<CliEvent, { phase: "result" }> => e.type === "tool" && e.phase === "result");
  assert.equal(r?.launched, undefined);
  assert.equal(r?.result, "Found 3 rows.");
});

test("a background task is told as it starts, as it works and when it ends, also after the turn that started it", () => {
  const out = feed([
    asst(null, [
      {
        type: "tool_use",
        id: "toolu_bg",
        name: "Agent",
        input: { description: "Research batch 1", run_in_background: true },
      },
    ]),
    launch("toolu_bg"),
    { type: "result", subtype: "success", is_error: false, result: "I am waiting.", session_id: "s" },
    {
      type: "system",
      subtype: "task_started",
      task_id: "ag_1",
      tool_use_id: "toolu_bg",
      description: "Research batch 1",
    },
    { type: "system", subtype: "task_progress", task_id: "ag_1", last_tool_name: "WebSearch", description: "" },
    {
      type: "system",
      subtype: "task_progress",
      task_id: "ag_1",
      description: "Reading the second profile",
      summary: "",
    },
    { type: "system", subtype: "task_notification", task_id: "ag_1", status: "completed", summary: "11 rows ranked" },
  ]);
  const tasks = out.filter((e): e is Extract<CliEvent, { type: "task" }> => e.type === "task");
  assert.deepEqual(
    tasks.map((t) => [t.state, t.id, t.text ?? "", t.ok]),
    [
      ["start", "toolu_bg", "Research batch 1", undefined],
      ["progress", "toolu_bg", "Searching the web", undefined],
      ["progress", "toolu_bg", "Reading the second profile", undefined],
      ["end", "toolu_bg", "11 rows ranked", true],
    ],
  );
});

test("a task that failed or was stopped says so; a task line that names only the task's own id is found by it", () => {
  const out = feed([
    asst(null, [
      { type: "tool_use", id: "toolu_bg", name: "Agent", input: { description: "d", run_in_background: true } },
    ]),
    launch("toolu_bg"),
    { type: "system", subtype: "task_notification", task_id: "ag_1", status: "failed", summary: "no network" },
    { type: "system", subtype: "task_notification", task_id: "zz", status: "stopped", summary: "" },
  ]);
  const tasks = out.filter((e): e is Extract<CliEvent, { type: "task" }> => e.type === "task");
  assert.deepEqual([tasks[0]!.id, tasks[0]!.ok, tasks[0]!.text], ["toolu_bg", false, "no network"]);
  assert.deepEqual([tasks[1]!.id, tasks[1]!.stopped], ["zz", true]);
});
