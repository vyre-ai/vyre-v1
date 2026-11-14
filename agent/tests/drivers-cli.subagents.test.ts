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
