// Imported sessions in Chats: the pure parts. Sorting and the group's default, the header line, the transcript items, Continue here, and the rows in the sidebar's flat list.
import test from "node:test";
import assert from "node:assert/strict";
import { IMPORTED_OPEN_MAX, dayLabel, headerLine, importedItems, importedRows, importedStartsOpen, providerMark, providerName, toolLabel } from "./model.ts";
import { continueImported } from "./continue.ts";
import { buildEntries } from "../sidebar/model.ts";
import { step, START } from "../mounts/route.ts";

const D = (s: string): number => Date.parse(s);
const NOW = D("2026-10-31T12:00:00Z");

test("rows are listed newest first, malformed ones dropped, an empty title gets a name", () => {
  const rows = importedRows([
    { conversationId: "isc_a", provider: "codex", title: "Older", startedAt: D("2026-10-01T00:00:00Z"), importedAt: 5 },
    { conversationId: "isc_b", provider: "claude_code", title: "  ", startedAt: D("2026-10-20T00:00:00Z"), importedAt: 6, continuedThreadId: "thr_1" },
    { provider: "claude_code", title: "no id" },
    { conversationId: "isc_c", provider: "claude_code", title: "Newest", startedAt: D("2026-10-27T00:00:00Z"), importedAt: 7 },
  ]);
  assert.deepEqual(rows.map((r) => r.conversationId), ["isc_c", "isc_b", "isc_a"]);
  assert.equal(rows[1]!.title, "Imported session");
  assert.equal(rows[1]!.continuedThreadId, "thr_1");
  assert.equal("continuedThreadId" in rows[0]!, false);
  assert.deepEqual(importedRows(undefined), []);
});

test("the group is open until it is long", () => {
  assert.equal(importedStartsOpen(0), true);
  assert.equal(importedStartsOpen(IMPORTED_OPEN_MAX), true);
  assert.equal(importedStartsOpen(IMPORTED_OPEN_MAX + 1), false);
});

test("provider names and marks", () => {
  assert.equal(providerName("claude_code"), "Claude Code");
  assert.equal(providerName("codex"), "Codex");
  assert.equal(providerMark("claude_code"), "claude");
  assert.equal(providerMark("codex"), "openai");
});

test("dates read as a short day, with the year only when it is not this year", () => {
  assert.equal(dayLabel(D("2026-10-27T10:00:00Z"), NOW, 0), "Oct 27");
  assert.equal(dayLabel(D("2025-03-02T10:00:00Z"), NOW, 0), "Mar 2, 2025");
  assert.equal(dayLabel(D("2026-10-27T23:30:00Z"), NOW, 120), "Oct 28", "the person's own day");
});

test("the header line names the source and the day, and the folder when it is known", () => {
  assert.equal(headerLine("claude_code", D("2026-10-27T10:00:00Z"), NOW, 0), "Imported from Claude Code, Oct 27");
  assert.equal(headerLine("codex", D("2026-10-27T10:00:00Z"), NOW, 0, "site"), "Imported from Codex, Oct 27, site");
});

test("the transcript becomes your turns and assistant turns with their tool calls folded", () => {
  const items = importedItems([
    { sourceMessageId: "m1", role: "user", text: "Fix the login", at: 1 },
    { sourceMessageId: "m2", role: "assistant", text: "Done.", at: 2, tools: [{ id: "t1", name: "Edit", summary: "Edit src/app.ts", ok: true }, { id: "t2", name: "Bash", summary: "Run npm test", ok: false }] },
    { role: "assistant", text: "No tools", at: 3 },
  ]);
  assert.equal(items[0]!.kind, "me");
  const a = items[1]!;
  assert.ok(a.kind === "other" && a.tools.length === 2 && a.toolLabel === "2 tool calls, 1 failed");
  const c = items[2]!;
  assert.ok(c.kind === "other" && c.tools.length === 0 && c.key === "m2");
  assert.equal(toolLabel([{ name: "x", summary: "" }]), "1 tool call");
});

test("Continue here asks the continue capability for the assistant in this Space and returns the chat", async () => {
  const seen: unknown[] = [];
  const data = { spaceId: "spc_me", assistantId: "agt_assist", call: async (cap: string, input: unknown) => { seen.push([cap, input]); return { threadId: "thr_9", linkedFrom: "isc_a" }; } };
  assert.equal(await continueImported(data, "isc_a"), "thr_9");
  assert.deepEqual(seen, [["sessions.continue", { conversationId: "isc_a", destinationSpaceId: "spc_me", destinationScope: "personal", agentId: "agt_assist" }]]);
  await assert.rejects(continueImported({ ...data, call: async () => ({}) }, "isc_a"), /did not start/);
  await assert.rejects(continueImported({ ...data, call: async () => { throw new Error("nope"); } }, "isc_a"), /nope/);
});

test("the sidebar lists the Imported group after Chats only when there are sessions, and folds it when asked", () => {
  const base = { needs: [], needsTotal: 0, faces: [], workingAgents: new Set<string>(), groups: [], channels: [], filter: "all" as const, closed: new Set<never>() };
  const none = buildEntries(base);
  assert.equal(none.some((e) => e.key === "h:imported"), false);
  const imported = importedRows([{ conversationId: "isc_a", provider: "codex", title: "A", startedAt: 1 }, { conversationId: "isc_b", provider: "claude_code", title: "B", startedAt: 2 }]);
  const keys = buildEntries({ ...base, imported }).map((e) => e.key);
  assert.deepEqual(keys.slice(keys.indexOf("h:recent")).filter((k) => k !== "e:recent"), ["h:recent", "h:imported", "i:isc_b", "i:isc_a"]);
  const folded = buildEntries({ ...base, imported, closed: new Set(["imported" as const]) }).map((e) => e.key);
  assert.ok(folded.includes("h:imported") && !folded.includes("i:isc_b"));
  const head = buildEntries({ ...base, imported }).find((e) => e.key === "h:imported");
  assert.ok(head?.type === "head" && head.count === 2 && head.label === "Imported");
});

test("opening an imported session is a place of its own", () => {
  const s = step(START, { t: "imported", conversationId: "isc_a" });
  assert.deepEqual(s.route, { view: "imported", conversationId: "isc_a" });
  assert.deepEqual(step(s, { t: "chat", threadId: "thr_9" }).route, { view: "chat", threadId: "thr_9" });
});
