import test from "node:test";
import assert from "node:assert/strict";
import { parseSession } from "./parse.ts";
test("Codex preview keeps visible canonical messages without payload ids, metadata and valid final lines", () => {
  const text = [
    { type: "session_meta", payload: { cwd: "/work/acme", git: { repository_url: "git@github.com:acme/app.git" } } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Fix this" }] } },
    { type: "event_msg", payload: { type: "agent_message", message: "duplicate" } },
    { type: "response_item", payload: { type: "reasoning", summary: [{ text: "private" }] } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done" }] } },
  ].map(JSON.stringify).join("\n");
  const out = parseSession({ provider: "codex", sessionId: "one", sessionKey: "codex:one" }, text);
  assert.deepEqual(out.messages.map((m) => m.text), ["Fix this", "Done"]);
  assert.equal(out.repo?.root, "/work/acme");
  assert.equal(new Set(out.messages.map((m) => m.sourceMessageId)).size, 2);
  assert.deepEqual(parseSession({ provider: "codex", sessionId: "one", sessionKey: "codex:one" }, text), out);
});
test("Claude preview excludes tools and thinking, accepts final JSON, redacts remote credentials", () => {
  const out = parseSession({ provider: "claude", sessionId: "two", sessionKey: "claude:two", gitOriginUrl: "https://token:secret@example.com/a/b.git" }, JSON.stringify({ type: "assistant", uuid: "m1", message: { role: "assistant", content: [{ type: "thinking", thinking: "private" }, { type: "tool_use", input: "secret" }, { type: "text", text: "Visible" }] } }));
  assert.equal(out.messages[0].text, "Visible");
  assert.equal(out.repo?.remote, "https://example.com/a/b.git");
});
