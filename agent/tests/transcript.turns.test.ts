// Turns built from what an engine streams, and the Claude Code session file read back into the same shape (ARCH 6.9).
import test from "node:test";
import assert from "node:assert/strict";
import { SEED_OPEN, createTurnBuilder, importClaudeSession, outputText, OUTPUT_CAP } from "../src/transcript/index.ts";
import { FAKE_KEY, northwindSession } from "../src/transcript/fixtures/claude-session.ts";

const T = "thr_a";
const ANTHROPIC_KEY = ["sk", "ant", "api03", "A".repeat(24)].join("-");

test("text and thinking coalesce, each tool call keeps a summary, its links and a capped result, and no whole input", () => {
  const b = createTurnBuilder({ threadId: T, authorId: "agt_a", engine: "anthropic", model: "claude-sonnet-5-5", now: () => 5, cwd: "/w" });
  b.push({ type: "thinking", text: "hm" });
  b.push({ type: "thinking", text: " ok" });
  b.push({ type: "text", text: "Looking " });
  b.push({ type: "text", text: "now." });
  b.push({ type: "tool_call", id: "c1", name: "Write", input: { file_path: "/w/src/a.ts", content: `SECRET_BODY_${"x".repeat(5000)}` } });
  b.toolResult("c1", { ok: true, content: "written" });
  b.push({ type: "tool_call", id: "c2", name: "Bash", input: { command: "git commit -m 'x'" } });
  b.toolResult("c2", { ok: true, content: "[main 1a2b3c4] x\n 1 file changed" });
  b.push({ type: "tool_call", id: "c3", name: "Read", input: { file_path: "/w/src/a.ts" } });
  b.toolResult("c3", { ok: false, content: "x".repeat(5000) });
  b.push({ type: "block", kind: "plan", payload: { steps: [] } });
  b.push({ type: "usage", inputTokens: 5, outputTokens: 2 });
  b.push({ type: "usage", inputTokens: 3, outputTokens: 1 });
  b.push({ type: "done" });
  const turn = b.build();

  assert.deepEqual(turn.parts.map((p) => p.kind), ["thinking", "text", "tool_call", "tool_result", "tool_call", "tool_result", "tool_call", "tool_result", "block"]);
  assert.deepEqual(turn.parts[0], { kind: "thinking", text: "hm ok" });
  assert.deepEqual(turn.parts[1], { kind: "text", text: "Looking now." });
  const calls = turn.parts.flatMap((p) => (p.kind === "tool_call" ? [p] : []));
  assert.deepEqual(calls.map((c) => [c.name, c.tool, c.summary]), [["Write", "write", "Write /w/src/a.ts"], ["Bash", "run", "git commit -m 'x'"], ["Read", "read", "Read /w/src/a.ts"]]);
  assert.deepEqual(calls[0]?.args, { path: "/w/src/a.ts" });
  assert.deepEqual(calls[0]?.links, [{ kind: "file", ref: "src/a.ts" }], "relative to the folder");
  assert.deepEqual(calls[1]?.links, [{ kind: "commit", ref: "1a2b3c4" }], "found in the result, by the call's id");
  assert.ok(!JSON.stringify(turn).includes("SECRET_BODY_"), "a Write's content is not kept");
  const big = turn.parts.flatMap((p) => (p.kind === "tool_result" && p.id === "c3" ? [p] : []))[0];
  assert.deepEqual([big?.ok, big?.output.length, big?.cut], [false, OUTPUT_CAP, true]);
  assert.deepEqual(turn.parts[8], { kind: "block", type: "plan", data: { steps: [] } });
  assert.deepEqual(turn.tokens, { in: 8, out: 3 });
  assert.deepEqual(turn.links, [{ kind: "file", ref: "src/a.ts" }, { kind: "commit", ref: "1a2b3c4" }, { kind: "read", ref: "src/a.ts" }]);
  assert.deepEqual([turn.role, turn.authorId, turn.engine, turn.model, turn.at], ["agent", "agt_a", "anthropic", "claude-sonnet-5-5", 5]);
  assert.equal(b.build().parts.length, turn.parts.length, "build can be called again");
});

test("secrets are redacted in words, summaries, outputs and errors", () => {
  const b = createTurnBuilder({ threadId: T, authorId: "agt_a", engine: "anthropic", model: null, now: () => 1 });
  b.push({ type: "text", text: `use ${ANTHROPIC_KEY} for it` });
  b.push({ type: "tool_call", id: "c1", name: "Bash", input: { command: `curl -H 'x-api-key: ${ANTHROPIC_KEY}' https://api.test/v1` } });
  b.toolResult("c1", { ok: true, content: `echo ${ANTHROPIC_KEY}` });
  b.push({ type: "error", code: "provider.overloaded", message: `overloaded for ${ANTHROPIC_KEY}` });
  const turn = b.build();
  assert.ok(!JSON.stringify(turn).includes(ANTHROPIC_KEY));
  assert.match(JSON.stringify(turn), /Anthropic key redacted/);
  assert.equal(turn.error?.code, "provider.overloaded");
});

test("outputText reads a string, a CLI's content blocks, a tool's data and nothing", () => {
  assert.equal(outputText("plain"), "plain");
  assert.equal(outputText([{ type: "text", text: "a" }, { type: "image", source: {} }, { type: "text", text: "b" }]).replace(/\n+/g, "|"), "a|b");
  assert.equal(outputText({ data: { rows: 3 } }), '{"rows":3}');
  assert.equal(outputText(undefined), "");
});

test("a Claude Code session file becomes the conversation: requests, and everything the agent did in answer", () => {
  const imp = importClaudeSession(northwindSession(), { threadId: T, personId: "usr_alex", agentId: "agt_intake" });
  assert.deepEqual([imp.title, imp.cwd, imp.bad], ["Northwind order form", "/home/alex/Work/northwind-bakery", 1]);
  assert.deepEqual(imp.turns.map((t) => t.role), ["person", "agent", "person", "agent"]);
  assert.ok(imp.redacted >= 1);

  const [ask, work, ask2, note] = imp.turns;
  assert.equal(ask?.parts[0]?.kind === "text" ? ask.parts[0].text : "", "Fix the order form on the Northwind Bakery site. The Stripe key is [Stripe key redacted …ke12] if you need it.");
  assert.ok(!JSON.stringify(imp).includes(FAKE_KEY));
  assert.ok(!JSON.stringify(imp).includes("system-reminder"), "reminders are not what anyone said");
  assert.ok(!JSON.stringify(imp).includes("subagent chatter"), "a subagent's lines are not the conversation");
  assert.ok(!JSON.stringify(imp).includes("local-command"));

  assert.deepEqual(work?.parts.map((p) => p.kind), [
    "thinking", "text", "tool_call", "tool_result", "tool_call", "tool_result", "tool_call", "tool_result", "tool_call", "tool_result", "tool_call", "tool_result", "text",
  ]);
  assert.deepEqual(work?.parts.flatMap((p) => (p.kind === "tool_call" ? [p.name] : [])), ["Read", "Edit", "Bash", "Bash", "TodoWrite"]);
  const read = work?.parts.find((p) => p.kind === "tool_result");
  assert.ok(read?.kind === "tool_result" && read.output.startsWith("1\texport function OrderForm() {"));
  assert.deepEqual([work?.engine, work?.model, work?.authorId], ["claude_code", "claude-sonnet-4-5", "agt_intake"]);
  assert.deepEqual(work?.links, [{ kind: "read", ref: "src/OrderForm.js" }, { kind: "file", ref: "src/OrderForm.js" }, { kind: "commit", ref: "a1b2c3d" }]);
  assert.deepEqual(work?.tokens, { in: 6 * 1210, out: 6 * 40 }, "usage counted once per message, not once per block line");
  assert.equal(work?.at, Date.UTC(2026, 8, 2, 10, 1, 5));

  assert.equal(ask2?.parts[0]?.kind === "text" ? ask2.parts[0].text : "", "Thanks. Now draft a note to kit about it.");
  assert.deepEqual(note?.links, [{ kind: "url", ref: "https://example.test/northwind/pr/12" }]);
});

test("a rolled session's first message is the seed and then the person's words: only the words are the turn", () => {
  const line = JSON.stringify({ type: "user", timestamp: "2026-09-02T10:00:00.000Z", message: { role: "user", content: `${SEED_OPEN} earlier work was carried here.\n]\n\nContinue please` } });
  const only = JSON.stringify({ type: "user", message: { role: "user", content: `${SEED_OPEN} nothing else.\n]\n\n` } });
  const imp = importClaudeSession([line, only], { threadId: T, personId: "usr_alex", agentId: "agt_a" });
  assert.deepEqual(imp.turns.map((t) => t.parts[0]), [{ kind: "text", text: "Continue please" }]);
});

test("a session file of an unknown shape costs lines, never the import", () => {
  const imp = importClaudeSession(["", "{", "[]", JSON.stringify({ type: "mystery" }), JSON.stringify({ type: "assistant", message: { content: "not an array" } }), JSON.stringify({ type: "user" })], { threadId: T, personId: "p", agentId: "a" });
  assert.deepEqual([imp.turns.length, imp.bad], [0, 1]);
  assert.deepEqual(importClaudeSession("", { threadId: T, personId: "p", agentId: "a" }).turns, []);
});
