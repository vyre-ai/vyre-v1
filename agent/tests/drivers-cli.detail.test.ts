import test from "node:test";
import assert from "node:assert/strict";
import { toolDetail } from "../src/drivers/cli/detail.ts";
import { createClaudeDecoder } from "../src/drivers/cli/claude.ts";

test("what a call touches is a file's name, a query or a page's host, and nothing else", () => {
  assert.equal(toolDetail("Read", { file_path: "/Users/dana/work/src/model.ts" }), "model.ts");
  assert.equal(toolDetail("Edit", { file_path: "C:\\proj\\app\\index.tsx" }), "index.tsx");
  assert.equal(toolDetail("WebSearch", { query: "stream pacing in chat" }), "stream pacing in chat");
  assert.equal(toolDetail("Grep", { pattern: "createStreamStore" }), "createStreamStore");
  assert.equal(toolDetail("WebFetch", { url: "https://docs.example.com/a/b?token=abc123" }), "docs.example.com", "the host only: never a path or a query");
});

test("a command, an unknown tool and anything secret-shaped show nothing", () => {
  assert.equal(toolDetail("Bash", { command: "curl -H 'Authorization: Bearer abc' https://x" }), "");
  assert.equal(toolDetail("mcp__vyre__records_search", { query: "dana" }), "");
  assert.equal(toolDetail("Read", { file_path: "/home/dana/.env" }), "");
  assert.equal(toolDetail("Read", { file_path: "/home/dana/id_rsa" }), "");
  assert.equal(toolDetail("Read", { file_path: "/home/dana/server.pem" }), "");
  assert.equal(toolDetail("WebSearch", { query: "sk-ant-api03-ABCDEFGHIJKLMNOP" }), "");
  assert.equal(toolDetail("WebSearch", { query: "password: hunter2 for the vault" }), "");
  assert.equal(toolDetail("Grep", { pattern: "A".repeat(40) }), "", "a long opaque string is a secret until shown otherwise");
  assert.equal(toolDetail("Read", {}), "");
});

test("the decoder passes the detail with the whole message, after the call, and a streamed call is not announced twice", () => {
  const d = createClaudeDecoder();
  const out = [
    ...d.push(JSON.stringify({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", id: "t1", name: "Read" } } })),
    ...d.push(JSON.stringify({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a/b/model.ts" } }] } })),
  ];
  assert.deepEqual(out, [{ type: "tool", phase: "call", id: "t1", name: "Read" }, { type: "tool", phase: "input", id: "t1", detail: "model.ts" }]);
});
