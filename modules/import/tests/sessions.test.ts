import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/harness.ts";
import { sessionsContinue, sessionsImport } from "../handlers/sessions.ts";

const payload = {
  provider: "codex" as const,
  sourceKey: "codex:rollout-111",
  consent: { previewedAt: 1_760_000_000_000, confirmedAt: 1_760_000_000_001 },
  sessions: [{
    sourceSessionId: "rollout-111",
    title: "Release work",
    startedAt: 1_760_000_000_000,
    repo: { remote: "git@github.com:vyre-ai/vyre-v1.git", root: "/work/vyre-v1" },
    messages: [
      { sourceMessageId: "m1", role: "user" as const, text: "Ship the release", at: 1_760_000_000_000 },
      { sourceMessageId: "m2", role: "assistant" as const, text: "I will start with the gate.", at: 1_760_000_000_001 },
    ],
  }],
};

test("sessions.import requires previewed consent, persists provenance immutably, and is idempotent", async () => {
  const h = harness();
  const created = await sessionsImport(h.ctx, payload);
  assert.equal(created.imported, 1);
  assert.equal(created.updated, 0);
  assert.equal(created.sessions[0]?.provider, "codex");
  assert.equal(h.only("projects.create").length, 1);
  assert.deepEqual(h.rows("SELECT sourceKey, sourceSessionId, immutable FROM import_conversation"), [{ sourceKey: "codex:rollout-111", sourceSessionId: "rollout-111", immutable: 1 }]);
  assert.deepEqual(h.rows("SELECT role, provider, sourceMessageId FROM import_message ORDER BY sourceMessageId"), [
    { role: "user", provider: "codex", sourceMessageId: "m1" },
    { role: "assistant", provider: "codex", sourceMessageId: "m2" },
  ]);
  const again = await sessionsImport(h.ctx, payload);
  assert.deepEqual(again, { imported: 0, updated: 0, sessions: created.sessions });
  assert.equal(h.only("projects.create").length, 1);
});

test("sessions.import appends newly visible messages but records a conflict instead of overwriting copied history", async () => {
  const h = harness();
  await sessionsImport(h.ctx, payload);
  const next = await sessionsImport(h.ctx, { ...payload, sessions: [{ ...payload.sessions[0]!, messages: [
    ...payload.sessions[0]!.messages,
    { sourceMessageId: "m3", role: "assistant" as const, text: "Gate is green.", at: 1_760_000_000_002 },
  ] }] });
  assert.equal(next.updated, 1);
  await sessionsImport(h.ctx, { ...payload, sessions: [{ ...payload.sessions[0]!, messages: [{ ...payload.sessions[0]!.messages[0]!, text: "Changed outside Vyre" }] }] });
  assert.equal(h.rows("SELECT * FROM import_session_conflict").length, 1);
  assert.equal(h.rows("SELECT text FROM import_message WHERE sourceMessageId = ?", "m1")[0]?.text, "Ship the release");
});

test("sessions.import never turns loose paths into projects and continues in a linked live chat", async () => {
  const h = harness();
  const imported = await sessionsImport(h.ctx, {
    ...payload,
    sourceKey: "claude:loose-1",
    provider: "claude_code",
    sessions: [{ ...payload.sessions[0]!, sourceSessionId: "loose-1", repo: { root: "/tmp/scratch" } }],
  });
  assert.equal(imported.sessions[0]?.destination.kind, "imported_sessions");
  assert.equal(h.only("projects.create").length, 0);
  const live = await sessionsContinue(h.ctx, { conversationId: imported.sessions[0]!.conversationId, agentId: "agt_intake" });
  assert.equal(live.linkedFrom, imported.sessions[0]?.conversationId);
  assert.equal(h.only("chat.start").length, 1);
  assert.equal(h.rows("SELECT immutable FROM import_conversation")[0]?.immutable, 1);
});

test("sessions.import refuses unconsented or unsafe payloads before any write", async () => {
  const h = harness();
  await assert.rejects(sessionsImport(h.ctx, { ...payload, consent: { previewedAt: 1 } }), { code: "validation.precondition_failed" });
  await assert.rejects(sessionsImport(h.ctx, { ...payload, sessions: [{ ...payload.sessions[0]!, messages: [{ sourceMessageId: "x", role: "tool" as never, text: "secret", at: 1 }] }] }), { code: "validation.bad_input" });
  assert.equal(h.rows("SELECT * FROM import_conversation").length, 0);
});
