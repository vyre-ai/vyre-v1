import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness } from "../fixtures/harness.ts";
import { sessionsContinue, sessionsImport, sessionsList, sessionsGet } from "../handlers/sessions.ts";

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

test("direct import sanitizes messages and titles before immutable storage or conflicts", async () => {
  const h = harness();
  const secret = ["ghp_", "fixtureOnlyPrivateToken0123456789abcd"].join("");
  const unsafe = { ...payload, sessions: [{ ...payload.sessions[0]!, title: `API_KEY=${secret}`, messages: [{ sourceMessageId: "secret", role: "user" as const, text: `<system-reminder>Internal agent policy</system-reminder>\nShip it.\nTOKEN=${secret}`, at: 1 }] }] };
  await sessionsImport(h.ctx, unsafe);
  await sessionsImport(h.ctx, { ...unsafe, sessions: [{ ...unsafe.sessions[0]!, messages: [{ ...unsafe.sessions[0]!.messages[0]!, text: `New visible text\nTOKEN=${secret}` }] }] });
  const persisted = JSON.stringify({ rows: h.rows("SELECT title FROM import_conversation"), messages: h.rows("SELECT text FROM import_message"), conflicts: h.rows("SELECT incomingText FROM import_session_conflict") });
  assert.ok(!persisted.includes(secret));
  assert.ok(!persisted.includes("Internal agent policy"));
  assert.match(persisted, /Ship it/);
  assert.match(persisted, /REDACTED/);
});

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
  const live = await sessionsContinue(h.ctx, { conversationId: imported.sessions[0]!.conversationId, destinationSpaceId: imported.sessions[0]!.destination.spaceId, destinationScope: imported.sessions[0]!.destination.scope, agentId: "agt_intake" });
  assert.equal(live.linkedFrom, imported.sessions[0]?.conversationId);
  assert.equal(h.only("chat.start").length, 1);
  assert.equal(h.only("projects.file_chat").length, 0, "loose sessions stay in the Personal imported archive without an empty Project");
  assert.equal(h.rows("SELECT immutable FROM import_conversation")[0]?.immutable, 1);
});

test("sessions.import refuses unconsented or unsafe payloads before any write", async () => {
  const h = harness();
  await assert.rejects(sessionsImport(h.ctx, { ...payload, consent: { previewedAt: 1 } }), (e) => codeOf(e) === "validation.precondition_failed");
  await assert.rejects(sessionsImport(h.ctx, { ...payload, sessions: [{ ...payload.sessions[0]!, messages: [{ sourceMessageId: "x", role: "tool" as never, text: "secret", at: 1 }] }] }), (e) => codeOf(e) === "validation.bad_input");
  assert.equal(h.rows("SELECT * FROM import_conversation").length, 0);
});

test("sessions.import scopes identical provider source keys to the personal owner and never lets another person continue them", async () => {
  const h = harness();
  const dana = await sessionsImport(h.ctx, payload);
  const maya = h.as({ kind: "person", id: "usr_maya" });
  const copied = await sessionsImport(maya, payload);
  assert.equal(copied.imported, 1, "a matching source key belongs to Maya's own import, not Dana's");
  assert.equal(h.only("projects.create").length, 2, "repository bindings are per owner");
  await assert.rejects(sessionsContinue(maya, { conversationId: dana.sessions[0]!.conversationId, destinationSpaceId: dana.sessions[0]!.destination.spaceId, destinationScope: dana.sessions[0]!.destination.scope, agentId: "agt_intake" }), (e) => codeOf(e) === "validation.not_found");
  assert.deepEqual(h.rows("SELECT owner, sourceKey, sourceSessionId FROM import_conversation ORDER BY owner"), [
    { owner: "usr_dana", sourceKey: payload.sourceKey, sourceSessionId: "rollout-111" },
    { owner: "usr_maya", sourceKey: payload.sourceKey, sourceSessionId: "rollout-111" },
  ]);
});

test("sessions.import is Personal-only in v1 and defers Team routing", async () => {
  const h = harness();
  await sessionsImport(h.ctx, payload);
  assert.equal(h.rows("SELECT destinationScope FROM import_conversation")[0]?.destinationScope, "personal");
  await assert.rejects(sessionsImport(h.ctx, { ...payload, sourceKey: "codex:team-refused", destination: { kind: "team" } }), (e) => codeOf(e) === "validation.precondition_failed");
  await assert.rejects(sessionsImport(h.ctx, { ...payload, sourceKey: "codex:team-confirmed", destination: { kind: "team", spaceId: "spc_importtest", confirmedAt: 1_760_000_000_002 } }), (e) => codeOf(e) === "validation.precondition_failed");
});

test("concurrent confirmed imports of one source produce one archive and one copy of each message", async () => {
  const h = harness();
  const results = await Promise.all([sessionsImport(h.ctx, payload), sessionsImport(h.ctx, payload)]);
  assert.equal(h.rows("SELECT * FROM import_conversation").length, 1);
  assert.equal(h.rows("SELECT * FROM import_message").length, payload.sessions[0]!.messages.length);
  assert.equal(results[0].sessions[0].conversationId, results[1].sessions[0].conversationId);
  assert.equal(results[0].imported + results[1].imported, 1);
});


test("session archive list and transcript are scoped to the owner and Space", async () => {
  const h = harness();
  const imported = await sessionsImport(h.ctx, payload);
  const conversationId = imported.sessions[0].conversationId;
  const listed = await sessionsList(h.ctx, {});
  assert.equal(listed.sessions.length, 1);
  const archive = await sessionsGet(h.ctx, { conversationId });
  assert.equal(archive.session.conversationId, conversationId);
  assert.deepEqual(archive.messages.map((m) => m.text), payload.sessions[0].messages.map((m) => m.text));
  const other = h.as({ kind: "person", id: "usr_other" });
  assert.equal((await sessionsList(other, {})).sessions.length, 0);
  await assert.rejects(sessionsGet(other, { conversationId }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(sessionsGet({ ...h.ctx, space: "spc_other" }, { conversationId }), (e) => codeOf(e) === "validation.not_found");
});

test("session import rejects a Team node before persisting personal history", async () => {
  const h = harness();
  h.world.handlers["spaces.matrix"] = () => ({ kind: "team", features: [] });
  await assert.rejects(sessionsImport(h.ctx, payload), (e) => codeOf(e) === "validation.precondition_failed");
  assert.equal(h.rows("SELECT * FROM import_conversation").length, 0);
});


test("session project calls carry the required idempotency key in input and continuation receives history", async () => {
  const h = harness();
  const create = h.world.handlers["projects.create"]!;
  h.world.handlers["projects.create"] = (input, opts) => {
    assert.equal(typeof input.idempotencyKey, "string", "the gateway validates input, not CallOpts");
    return create(input, opts);
  };
  const imported = await sessionsImport(h.ctx, payload);
  const continued = await sessionsContinue(h.ctx, { conversationId: imported.sessions[0].conversationId, destinationSpaceId: h.ctx.space, destinationScope: "personal", agentId: "agt_intake" });
  assert.match(h.only("chat.start")[0].input.first, /Ship the release/);
  assert.deepEqual(h.only("projects.file_chat").map((call) => call.input), [{ projectId: imported.sessions[0].destination.projectId, threadId: continued.threadId }], "the continued chat is visible inside its imported repository Project");
  const reopened = await sessionsContinue(h.ctx, { conversationId: imported.sessions[0].conversationId, destinationSpaceId: h.ctx.space, destinationScope: "personal", agentId: "agt_intake" });
  assert.equal(reopened.threadId, continued.threadId);
  assert.equal(h.only("chat.start").length, 1, "continuation remains idempotent");
  assert.equal(h.only("projects.file_chat").length, 2, "reopening repairs Project filing if an earlier attempt was interrupted");
});
