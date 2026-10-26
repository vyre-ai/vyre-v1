// @tsx
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverSessions, providerRoots } from "../src/session-import/discover.ts";
import { readCodexSession } from "../src/session-import/codex.ts";
import { readClaudeSession } from "../src/session-import/claude.ts";
import { makeBridge } from "../src/bridge.ts";

const TESTS = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(TESTS, "fixtures", "session-import");
const codex = path.join(FIXTURES, "codex");
const claude = path.join(FIXTURES, "claude");

test("the shell exposes a metadata-only Codex discovery command with a configured home", async () => {
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  const source = { provider: "codex", sessionId: "11111111-1111-4111-8111-111111111111", sessionKey: "codex:11111111-1111-4111-8111-111111111111", projectKey: "codex:/workspace/vyre", transcriptPath: "/safe/sessions/rollout-11111111-1111-4111-8111-111111111111.jsonl" };
  const bridge = makeBridge(async (command, args) => { calls.push({ command, args }); return [source]; });
  assert.deepEqual(await bridge.discoverCodexSessions({ codexHome: "/safe" }), [source]);
  assert.deepEqual(calls, [{ command: "discover_codex_sessions", args: { options: { codexHome: "/safe" } } }]);
});

test("the shell discovers both providers natively and keeps the Claude Desktop metadata root separate", async () => {
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  const bridge = makeBridge(async (command, args) => { calls.push({ command, args }); return []; });
  assert.deepEqual(await bridge.discoverSessionSources({ codexHome: "/safe/codex", claudeHome: "/safe/claude", claudeDesktopHome: "/safe/Library/Application Support/Claude" }), []);
  assert.deepEqual(calls, [{ command: "discover_session_sources", args: { options: { codexHome: "/safe/codex", claudeHome: "/safe/claude", claudeDesktopHome: "/safe/Library/Application Support/Claude" } } }]);
});

test("configured homes win over defaults and discovery returns metadata without opening transcript bodies", async () => {
  assert.deepEqual(providerRoots("codex", { codexHome: codex, home: "/ignored" }), [codex]);
  assert.deepEqual(providerRoots("claude", { claudeHome: claude, home: "/ignored" }), [claude]);
  const sources = await discoverSessions({ codexHome: codex, claudeHome: claude });
  assert.deepEqual(sources.map((source) => [source.provider, source.sessionKey, source.transcriptPath.endsWith(".jsonl")]).sort(), [
    ["claude", "claude:22222222-2222-4222-8222-222222222222", true],
    ["claude", "claude:33333333-3333-4333-8333-333333333333", true],
    ["claude", "claude:44444444-4444-4444-8444-444444444444", true],
    ["codex", "codex:11111111-1111-4111-8111-111111111111", true],
  ]);
  assert.ok(sources.every((source) => source.messageCount === undefined), "discovery does not parse transcript records");
});

test("Codex reads only canonical response items and rejects corrupt and partial records", async () => {
  const source = (await discoverSessions({ codexHome: codex })).find((item) => item.provider === "codex");
  assert.ok(source);
  const session = await readCodexSession(source);
  assert.equal(session.sessionKey, "codex:11111111-1111-4111-8111-111111111111");
  assert.deepEqual(session.messages.map((message) => [message.id, message.role, message.text]), [
    ["user-1", "user", "Plan the release"],
    ["assistant-1", "assistant", "I will prepare the release."],
    ["assistant-2", "assistant", "Final visible answer."],
  ]);
  assert.ok(session.warnings.some((warning) => /partial/i.test(warning)));
  assert.ok(session.warnings.some((warning) => /canonical response_item/i.test(warning)));
});

test("Claude keeps parent links and subagents, ignores hidden blocks, and tolerates a partial tail", async () => {
  const source = (await discoverSessions({ claudeHome: claude })).find((item) => item.sessionKey === "claude:22222222-2222-4222-8222-222222222222");
  assert.ok(source);
  const session = await readClaudeSession(source);
  assert.equal(session.projectKey, "claude:-workspace-vyre");
  assert.deepEqual(session.messages.map((message) => [message.id, message.parentId, message.role, message.text]), [
    ["u-1", undefined, "user", "Draft the note"],
    ["a-1", "u-1", "assistant", "Draft one."],
    ["sub-u", "a-1", "user", "Research it"],
    ["sub-a", "sub-u", "assistant", "Research result."],
    ["u-2", "a-1", "user", "Make it shorter"],
    ["a-2", "u-2", "assistant", "Short note."],
  ]);
  assert.ok(session.warnings.some((warning) => /partial/i.test(warning)));
});

test("Claude archive gzip transcripts are supported and desktop metadata only enriches its matching source", async () => {
  const archive = path.join(claude, "projects-archive", "-workspace-vyre", "44444444-4444-4444-8444-444444444444.jsonl");
  const compressed = `${archive}.gz`;
  fs.writeFileSync(compressed, await gzip(fs.readFileSync(archive)));
  fs.unlinkSync(archive);
  try {
    const source = (await discoverSessions({ claudeHome: claude })).find((item) => item.sessionKey === "claude:44444444-4444-4444-8444-444444444444");
    assert.ok(source);
    assert.equal(source.transcriptPath.endsWith(".jsonl.gz"), true);
    const session = await readClaudeSession(source);
    assert.deepEqual(session.messages.map((message) => message.text), ["Archived request", "Archived answer"]);
    const primary = (await discoverSessions({ claudeHome: claude })).find((item) => item.sessionKey === "claude:22222222-2222-4222-8222-222222222222");
    assert.equal(primary?.cwd, "/workspace/vyre");
  } finally {
    if (fs.existsSync(compressed)) fs.unlinkSync(compressed);
    fs.writeFileSync(archive, '{"type":"user","uuid":"archive-u","sessionId":"44444444-4444-4444-8444-444444444444","timestamp":"2026-10-01T08:00:00.000Z","message":{"role":"user","content":"Archived request"}}\n{"type":"assistant","uuid":"archive-a","parentUuid":"archive-u","sessionId":"44444444-4444-4444-8444-444444444444","timestamp":"2026-10-01T08:00:01.000Z","message":{"role":"assistant","content":"Archived answer"}}\n');
  }
});

test("discovery normalizes contained paths and rejects symlink escapes and excluded local data", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-session-import-"));
  const inside = path.join(root, "projects", "-ok");
  fs.mkdirSync(inside, { recursive: true });
  fs.writeFileSync(path.join(inside, "55555555-5555-4555-8555-555555555555.jsonl"), "");
  fs.mkdirSync(path.join(root, "session-env"));
  fs.writeFileSync(path.join(root, "session-env", "ignored.jsonl"), "");
  fs.symlinkSync("/tmp", path.join(root, "projects", "escape"));
  try {
    const sources = await discoverSessions({ claudeHome: root });
    assert.deepEqual(sources.map((source) => source.sessionKey), ["claude:55555555-5555-4555-8555-555555555555"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function gzip(input: Buffer): Promise<Buffer> {
  const zlib = await import("node:zlib");
  return zlib.gzipSync(input);
}
