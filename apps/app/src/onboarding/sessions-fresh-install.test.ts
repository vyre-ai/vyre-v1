// A fresh install's Claude Code and Codex folders, as a new Mac has them: the first real sessions sit beside ones that hold nothing a person can read (setup text only, tool calls only,
// file-history snapshots). Importing "all" must not fail on those: it reads each, leaves the empty ones out, imports the rest, and says so. Plain node: no component here.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSession } from "../../../../client/src/session-import/parse.ts";
import { confirmedSessionInput } from "../places/settings/session-import-model.ts";
import { failureLine, importedNote, whyWords } from "./sessions-model.ts";

const J = (...lines: unknown[]): string => lines.map((l) => JSON.stringify(l)).join("\n");
const claudeSrc = (id: string) => ({ provider: "claude" as const, sessionId: id, sessionKey: `claude:${id}`, cwd: "/Users/saqib/work/site" });
const codexSrc = (id: string) => ({ provider: "codex" as const, sessionId: id, sessionKey: `codex:${id}`, cwd: "/Users/saqib/work/api" });

// ~/.claude/projects/<dir>/<uuid>.jsonl on a new Mac
const CLAUDE_REAL = J(
  { type: "summary", summary: "Fix login", leafUuid: "x" },
  { type: "user", uuid: "u1", timestamp: "2026-11-04T10:00:00Z", cwd: "/Users/saqib/work/site", message: { role: "user", content: "Fix the login redirect" } },
  { type: "assistant", uuid: "a1", timestamp: "2026-11-04T10:00:05Z", message: { role: "assistant", content: [{ type: "text", text: "Done, the redirect uses the saved path." }] } },
);
const CLAUDE_SNAPSHOT_ONLY = J({ type: "file-history-snapshot", messageId: "m1", snapshot: {} }, { type: "summary", summary: "Empty", leafUuid: "y" });
const CLAUDE_TOOLS_ONLY = J(
  { type: "assistant", uuid: "a9", timestamp: "2026-11-04T11:00:00Z", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } },
);
// ~/.codex/sessions/2026/11/04/rollout-*.jsonl on a new Mac: the first user lines are setup text, which the importer strips as private
const CODEX_SETUP_ONLY = J(
  { type: "session_meta", payload: { id: "c1", cwd: "/Users/saqib/work/api" } },
  { type: "response_item", timestamp: "2026-11-04T09:00:00Z", payload: { type: "message", id: "m1", role: "user", content: [{ type: "input_text", text: "<environment_context>\n  <cwd>/Users/saqib/work/api</cwd>\n</environment_context>" }] } },
  { type: "response_item", timestamp: "2026-11-04T09:00:01Z", payload: { type: "message", id: "m2", role: "user", content: [{ type: "input_text", text: "<user_instructions>Be brief.</user_instructions>" }] } },
);
const CODEX_REAL = J(
  { type: "session_meta", payload: { id: "c2", cwd: "/Users/saqib/work/api" } },
  { type: "response_item", timestamp: "2026-11-04T09:30:00Z", payload: { type: "message", id: "m1", role: "user", content: [{ type: "input_text", text: "<environment_context><cwd>/x</cwd></environment_context>" }] } },
  { type: "response_item", timestamp: "2026-11-04T09:30:02Z", payload: { type: "message", id: "m2", role: "user", content: [{ type: "input_text", text: "Add a health endpoint" }] } },
  { type: "response_item", timestamp: "2026-11-04T09:30:09Z", payload: { type: "message", id: "m3", role: "assistant", content: [{ type: "output_text", text: "Added GET /health." }] } },
);

test("real sessions parse to messages and make a valid import payload", () => {
  for (const [src, text] of [[claudeSrc("a1"), CLAUDE_REAL], [codexSrc("c2"), CODEX_REAL]] as const) {
    const s = parseSession(src, text);
    assert.ok(s.messages.length >= 2, `${src.provider}: ${s.messages.length} messages`);
    const input = confirmedSessionInput({ source: src, session: s, at: 1 }, 2);
    assert.equal(input.sessions.length, 1);
    assert.equal(input.destination.kind, "personal");
  }
});

test("sessions with nothing readable parse to zero messages, and the payload builder refuses them: the card must skip these, not stop at them", () => {
  for (const [src, text] of [[claudeSrc("s1"), CLAUDE_SNAPSHOT_ONLY], [codexSrc("c1"), CODEX_SETUP_ONLY]] as const) {
    const s = parseSession(src, text);
    assert.equal(s.messages.length, 0, `${src.sessionKey} has no readable message`);
    assert.throws(() => confirmedSessionInput({ source: src, session: s, at: 1 }, 2), /visible messages/);
  }
  // a session of tool calls alone is a message with tools, so it is importable
  assert.equal(parseSession(claudeSrc("a9"), CLAUDE_TOOLS_ONLY).messages.length, 1);
});

test("the words: what was imported, what was empty, what failed and why", () => {
  assert.equal(importedNote(3), "Imported 3. They are in Chats.");
  assert.equal(importedNote(1, 2), "Imported 1. It is in Chats. 2 sessions had nothing to read and were left out.");
  assert.equal(importedNote(2, 1), "Imported 2. They are in Chats. 1 session had nothing to read and was left out.");
  assert.equal(failureLine({ imported: 0, empty: 0, failed: [] }), "");
  assert.equal(failureLine({ imported: 2, empty: 0, failed: [{ key: "k", name: "Fix login", why: "Open your Personal Space to import or read local history." }] }), "Imported 2. Fix login could not be imported: Open your Personal Space to import or read local history.");
  assert.match(failureLine({ imported: 0, empty: 0, failed: [{ key: "a", name: "A", why: "x" }, { key: "b", name: "B", why: "y" }] }), /^2 sessions could not be imported\. A: x$/);
  assert.equal(whyWords(new Error("The transcript is unavailable.")), "The transcript is unavailable.");
  assert.equal(whyWords(new TypeError("x is not a function")), "That did not work.");
  assert.equal(whyWords("boom"), "That did not work.");
});

test("the list leaves out sessions with nothing readable, checks only the newest few within its budget, and keeps ones it cannot read", async () => {
  const { dropEmpty } = await import("./sessions-filter.ts");
  const rows = ["a", "b", "c", "d", "e"].map((k) => ({ sessionKey: k }));
  const counts: Record<string, number> = { a: 3, b: 0, c: 2, d: 0, e: 0 };
  const seen: string[] = [];
  const got = await dropEmpty(rows, async (s) => { seen.push(s.sessionKey); if (s.sessionKey === "c") throw new Error("unreadable"); return counts[s.sessionKey]!; }, { limit: 4 });
  assert.deepEqual(got.map((s) => s.sessionKey), ["a", "c", "e"], "b and d are empty and gone; c could not be read so it stays; e was beyond the limit so it stays");
  assert.ok(!seen.includes("e"));
  let t = 0;
  const slow = await dropEmpty(rows, async () => 0, { budgetMs: 5, now: () => (t += 10), concurrency: 1 });
  assert.equal(slow.length, 5, "out of time before the first check: nothing is dropped");
});
