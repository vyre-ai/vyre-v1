import test from "node:test";
import assert from "node:assert/strict";
import { parseSession, parseSessionDocuments } from "./parse.ts";
test("Codex preview keeps visible canonical messages without payload ids, metadata and valid final lines", () => {
  const text = [
    { type: "session_meta", payload: { cwd: "/work/acme", git: { repository_url: "git@github.com:acme/app.git" } } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Fix this" }] } },
    { type: "event_msg", payload: { type: "agent_message", message: "duplicate" } },
    { type: "response_item", payload: { type: "reasoning", summary: [{ text: "private" }] } },
    { type: "response_item", payload: { type: "message", role: "assistant", channel: "analysis", content: [{ type: "output_text", text: "private analysis" }] } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done" }] } },
  ].map(JSON.stringify).join("\n");
  const out = parseSession({ provider: "codex", sessionId: "one", sessionKey: "codex:one" }, text);
  assert.deepEqual(out.messages.map((m) => m.text), ["Fix this", "Done"]);
  assert.equal(out.repo?.root, "/work/acme");
  assert.equal(new Set(out.messages.map((m) => m.sourceMessageId)).size, 2);
  assert.deepEqual(parseSession({ provider: "codex", sessionId: "one", sessionKey: "codex:one" }, text), out);
});

test("native repository decisions override stale transcript metadata", () => {
  const text = [
    { type: "session_meta", payload: { cwd: "/work/vyre/packages/app", git: { repository_url: "https://example.com/stale/fork.git" } } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Fix this" }] } },
  ].map(JSON.stringify).join("\n");
  const canonical = parseSession({
    provider: "codex", sessionId: "canonical", sessionKey: "codex:canonical",
    cwd: "/work/vyre", gitOriginUrl: "https://example.com/acme/vyre.git", repositoryMetadataAuthoritative: true,
  }, text);
  assert.deepEqual(canonical.repo, { root: "/work/vyre", remote: "https://example.com/acme/vyre.git" });

  const deleted = parseSession({
    provider: "codex", sessionId: "deleted", sessionKey: "codex:deleted",
    cwd: "/work/deleted-vyre", gitOriginUrl: null, repositoryMetadataAuthoritative: true,
  }, text);
  assert.deepEqual(deleted.repo, { root: "/work/deleted-vyre" }, "a stale transcript remote cannot turn a deleted checkout into a Project");
});
test("Claude preview excludes thinking and a tool call it cannot name, accepts final JSON, redacts remote credentials", () => {
  const out = parseSession({ provider: "claude", sessionId: "two", sessionKey: "claude:two", gitOriginUrl: "https://token:secret@example.com/a/b.git" }, JSON.stringify({ type: "assistant", uuid: "m1", message: { role: "assistant", content: [{ type: "thinking", thinking: "private" }, { type: "tool_use", input: "secret" }, { type: "text", text: "Visible" }] } }));
  assert.equal(out.messages[0].text, "Visible");
  assert.equal(out.repo?.remote, "https://example.com/a/b.git");
});

test("packaged preview strips instruction wrappers and credentials from visible text", () => {
  const secret = ["sk-", "proj-", "fixtureOnlySecret0123456789abcdef"].join("");
  const privateKey = ["-----BEGIN ", "PRIVATE KEY-----\nprivate-fixture-key\n-----END ", "PRIVATE KEY-----"].join("");
  const text = `<environment_context>DEPLOY_SECRET=private-fixture-value</environment_context>\n<INSTRUCTIONS>Private agent policy</INSTRUCTIONS>\nPlease fix the page.\nAPI_KEY=${secret}\n${privateKey}\nUse https://user:fixturepass@example.com/repo?token=fixture-token`;
  const out = parseSession({ provider: "claude", sessionId: "safe", sessionKey: "claude:safe" }, JSON.stringify({ type: "user", uuid: "m", message: { role: "user", content: text } }));
  const imported = JSON.stringify(out);
  for (const value of [secret, "private-fixture-value", "Private agent policy", "private-fixture-key", "fixturepass", "fixture-token"]) assert.ok(!imported.includes(value), value);
  assert.match(imported, /Please fix the page/);
  assert.match(imported, /REDACTED/);
});

test("Claude parent previews merge bounded subagent documents with stable namespaced ids", () => {
  const parent = JSON.stringify({ type: "user", uuid: "same", message: { role: "user", content: "Parent request" } });
  const subagent = JSON.stringify({ type: "assistant", uuid: "same", message: { role: "assistant", content: [{ type: "text", text: "Research result" }] } });
  const out = parseSessionDocuments(
    { provider: "claude", sessionId: "parent", sessionKey: "claude:parent" },
    [{ namespace: "main", text: parent }, { namespace: "subagent:child", text: subagent }],
  );
  assert.deepEqual(out.messages.map((message) => [message.sourceMessageId, message.text]), [
    ["same", "Parent request"],
    ["subagent:child:same", "Research result"],
  ]);
});

test("combined previews stop at five thousand visible messages across documents", () => {
  const text = (prefix: string, count: number): string => Array.from({ length: count }, (_, index) => JSON.stringify({ type: "user", uuid: `${prefix}-${index}`, message: { role: "user", content: `${prefix} ${index}` } })).join("\n");
  const out = parseSessionDocuments(
    { provider: "claude", sessionId: "parent", sessionKey: "claude:parent" },
    [{ namespace: "main", text: text("parent", 4_999) }, { namespace: "subagent:child", text: text("child", 2) }, { namespace: "subagent:later", text: text("later", 2) }],
  );
  assert.equal(out.messages.length, 5_000);
  assert.equal(out.messages.at(-1)?.sourceMessageId, "subagent:child:child-0");
});

test("Claude tool calls come with the message they ran in, a one-line summary, and the start of their result, credentials removed", () => {
  const secret = ["sk-", "proj-", "fixtureOnlySecret0123456789abcdef"].join("");
  const text = [
    { type: "user", uuid: "u1", message: { role: "user", content: "Fix the build" } },
    { type: "assistant", uuid: "a1", timestamp: "2026-10-30T10:00:00Z", message: { role: "assistant", content: [{ type: "text", text: "Looking." }, { type: "tool_use", id: "tu1", name: "Bash", input: { command: `npm test --token ${secret}` } }] } },
    { type: "user", uuid: "u2", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", is_error: true, content: [{ type: "text", text: `FAIL a.test.ts\nAPI_KEY=${secret}` }] }] } },
    { type: "assistant", uuid: "a2", message: { role: "assistant", content: [{ type: "tool_use", id: "tu2", name: "Edit", input: { file_path: "src/app.ts", old_string: "x", new_string: "y" } }] } },
    { type: "user", uuid: "u3", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu2", content: "ok" }] } },
    { type: "assistant", uuid: "a3", message: { role: "assistant", content: [{ type: "text", text: "Fixed." }] } },
  ].map(JSON.stringify).join("\n");
  const out = parseSession({ provider: "claude", sessionId: "t", sessionKey: "claude:t" }, text);
  assert.deepEqual(out.messages.map((m) => [m.sourceMessageId, m.role, m.text, m.tools?.length ?? 0]), [["u1", "user", "Fix the build", 0], ["a1", "assistant", "Looking.", 1], ["a2", "assistant", "", 1], ["a3", "assistant", "Fixed.", 0]]);
  const bash = out.messages[1]!.tools![0]!;
  assert.equal(bash.summary.startsWith("Run npm test"), true);
  assert.equal(bash.ok, false);
  assert.match(bash.output ?? "", /FAIL a\.test\.ts/);
  assert.ok(!JSON.stringify(out).includes(secret));
  assert.deepEqual(out.messages[2]!.tools![0], { id: "tu2", name: "Edit", summary: "Edit src/app.ts", ok: true, output: "ok" });
  assert.deepEqual(parseSession({ provider: "claude", sessionId: "t", sessionKey: "claude:t" }, text), out, "the same file gives the same preview");
});

test("Codex tool calls (function, custom and shell) pair with their outputs by call id, in either order", () => {
  const text = [
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "List the files" }] } },
    { type: "response_item", payload: { type: "function_call", name: "shell", call_id: "c1", arguments: JSON.stringify({ command: ["bash", "-lc", "ls -la"] }) } },
    { type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: JSON.stringify({ output: "a.txt\nb.txt", metadata: { exit_code: 0 } }) } },
    { type: "response_item", payload: { type: "function_call_output", call_id: "c2", output: "patched" } },
    { type: "response_item", payload: { type: "custom_tool_call", name: "apply_patch", call_id: "c2", input: "*** Begin Patch" } },
    { type: "response_item", payload: { type: "local_shell_call", call_id: "c3", action: { command: ["git", "status"] } } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done" }] } },
  ].map(JSON.stringify).join("\n");
  const out = parseSession({ provider: "codex", sessionId: "x", sessionKey: "codex:x" }, text);
  const tools = out.messages.flatMap((m) => m.tools ?? []);
  assert.deepEqual(tools.map((t) => [t.id, t.summary]), [["c1", "Run bash -lc ls -la"], ["c2", "Edit a file"], ["c3", "Run git status"]]);
  assert.equal(tools[0]!.output, "a.txt\nb.txt");
  assert.equal(tools[1]!.output, undefined, "an output that came before its call is not guessed at");
  assert.deepEqual(out.messages.map((m) => m.role), ["user", "assistant", "assistant", "assistant", "assistant"]);
  assert.equal(out.messages.at(-1)!.text, "Done");
});
