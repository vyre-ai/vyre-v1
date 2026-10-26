import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness } from "../fixtures/harness.ts";
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
  const live = await sessionsContinue(h.ctx, { conversationId: imported.sessions[0]!.conversationId, destinationSpaceId: imported.sessions[0]!.destination.spaceId, destinationScope: imported.sessions[0]!.destination.scope, agentId: "agt_intake" });
  assert.equal(live.linkedFrom, imported.sessions[0]?.conversationId);
  assert.equal(h.only("chat.start").length, 1);
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

test("sessions.import resolves Personal and confirmed Team destinations before writes, even from a Team ambient Space", async () => {
  const seed = harness();
  const personal = harness({ raw: seed.raw, world: seed.world, clock: seed.clock, space: "spc_personal", personalSpace: "spc_personal" });
  const selectedTeam = harness({ raw: seed.raw, world: seed.world, clock: seed.clock, space: "spc_team_target", personalSpace: "spc_personal" });
  const ambientTeam = harness({ raw: seed.raw, world: seed.world, clock: seed.clock, space: "spc_team_ambient", personalSpace: "spc_personal" });
  const route = {
    async resolve(_owner: string, request: { kind: "personal" } | { kind: "team"; spaceId: string }) {
      if (request.kind === "personal") return { kind: "personal" as const, spaceId: "spc_personal" };
      if (request.spaceId === "spc_team_target") return { kind: "team" as const, spaceId: request.spaceId };
      throw Object.assign(new Error("not a member of that Team"), { error: { code: "permission.no_grant" } });
    },
    async invoke(spaceId: string, _cap: "sessions.import" | "sessions.continue", input: unknown) {
      const isContinuation = typeof input === "object" && input !== null && "conversationId" in input;
      if (spaceId === "spc_personal") return isContinuation ? sessionsContinue(personal.ctx, input as { conversationId: string; destinationSpaceId: string; destinationScope: "personal" | "team"; agentId: string }) : sessionsImport(personal.ctx, input as typeof payload);
      if (spaceId === "spc_team_target") return isContinuation ? sessionsContinue(selectedTeam.ctx, input as { conversationId: string; destinationSpaceId: string; destinationScope: "personal" | "team"; agentId: string }) : sessionsImport(selectedTeam.ctx, input as typeof payload);
      throw new Error("unexpected destination");
    },
  };
  personal.ctx.sessionDestination = route;
  selectedTeam.ctx.sessionDestination = route;
  ambientTeam.ctx.sessionDestination = route;

  const defaulted = await sessionsImport(ambientTeam.ctx, { ...payload, sourceKey: "codex:personal-from-team" });
  assert.equal(defaulted.sessions[0]?.destination.spaceId, "spc_personal");
  assert.deepEqual(ambientTeam.rows("SELECT sourceKey FROM import_conversation WHERE spaceId = ?", "spc_team_ambient"), []);
  assert.deepEqual(personal.rows("SELECT spaceId, destinationScope FROM import_conversation WHERE sourceKey = ?", "codex:personal-from-team"), [{ spaceId: "spc_personal", destinationScope: "personal" }]);

  const selected = await sessionsImport(ambientTeam.ctx, { ...payload, sourceKey: "codex:team-target", destination: { kind: "team", spaceId: "spc_team_target", confirmedAt: 1_760_000_000_002 } });
  assert.equal(selected.sessions[0]?.destination.spaceId, "spc_team_target");
  assert.deepEqual(selectedTeam.rows("SELECT spaceId, destinationScope FROM import_conversation WHERE sourceKey = ?", "codex:team-target"), [{ spaceId: "spc_team_target", destinationScope: "team" }], "the selected Team is concrete and owns its archive projection");
  await sessionsContinue(ambientTeam.ctx, { conversationId: selected.sessions[0]!.conversationId, destinationSpaceId: "spc_team_target", destinationScope: "team", agentId: "agt_intake" });
  assert.equal(selectedTeam.only("chat.start").length, 1, "continuation runs in the selected destination Space");
  await assert.rejects(sessionsImport(ambientTeam.ctx, { ...payload, sourceKey: "codex:unauthorized-team", destination: { kind: "team", spaceId: "spc_not_a_member", confirmedAt: 1_760_000_000_002 } }), (e) => codeOf(e) === "permission.no_grant");
});
