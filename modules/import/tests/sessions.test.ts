import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness } from "../fixtures/harness.ts";
import { sessionsArchive, sessionsContinue, sessionsDelete, sessionsGet, sessionsImport, sessionsList, sessionsRename } from "../handlers/sessions.ts";

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

test("tool calls are stored with their message, cleaned and bounded, listed by sessions.get, and carried into a continued chat as lines", async () => {
  const h = harness();
  const secret = ["ghp_", "fixtureOnlyPrivateToken0123456789abcd"].join("");
  const withTools = { ...payload, sessions: [{ ...payload.sessions[0]!, messages: [
    { sourceMessageId: "u", role: "user" as const, text: "Fix it", at: 1 },
    { sourceMessageId: "a", role: "assistant" as const, text: "", at: 2, tools: [{ id: "t1", name: "Bash", summary: `Run npm test TOKEN=${secret}`, ok: false, output: `FAIL\nAPI_KEY=${secret}` }, { id: "t2", name: "Edit", summary: "Edit src/a.ts" }, { nope: true } as never] },
  ] }] };
  await sessionsImport(h.ctx, withTools);
  const stored = JSON.stringify(h.rows("SELECT * FROM import_message_tool"));
  assert.ok(!stored.includes(secret));
  assert.equal(h.rows("SELECT * FROM import_message_tool").length, 2, "the malformed entry is dropped");
  const list = await sessionsList(h.ctx, {}) as { sessions: Array<{ conversationId: string }> };
  const got = await sessionsGet(h.ctx, { conversationId: list.sessions[0]!.conversationId }) as { messages: Array<{ text: string; tools?: Array<{ name: string; ok?: boolean }> }> };
  assert.equal(got.messages[1]!.text, "");
  assert.deepEqual(got.messages[1]!.tools!.map((t) => [t.name, t.ok]), [["Bash", false], ["Edit", undefined]]);
  assert.equal(got.messages[0]!.tools, undefined);
  const cont = await sessionsContinue(h.ctx, { conversationId: list.sessions[0]!.conversationId, destinationSpaceId: h.ctx.space, destinationScope: "personal", agentId: "agt_x" }) as { threadId: string };
  const start = h.only("chat.start")[0]!.input as { first: string };
  assert.match(start.first, /\[tool Run npm test.*, failed\]/);
  assert.match(start.first, /\[tool Edit src\/a\.ts\]/);
  assert.ok(cont.threadId);
});

test("a later import fills in the tool calls of a message that was first imported as words only, and never rewrites ones it has", async () => {
  const h = harness();
  const base = { ...payload, sessions: [{ ...payload.sessions[0]!, messages: [{ sourceMessageId: "a", role: "assistant" as const, text: "Looking", at: 1 }] }] };
  await sessionsImport(h.ctx, base);
  assert.equal(h.rows("SELECT * FROM import_message_tool").length, 0);
  const withTool = { ...base, sessions: [{ ...base.sessions[0]!, messages: [{ ...base.sessions[0]!.messages[0]!, tools: [{ id: "t", name: "Read", summary: "Read a.ts" }] }] }] };
  await sessionsImport(h.ctx, withTool);
  assert.equal(h.rows("SELECT summary FROM import_message_tool")[0]?.summary, "Read a.ts");
  await sessionsImport(h.ctx, { ...withTool, sessions: [{ ...withTool.sessions[0]!, messages: [{ ...withTool.sessions[0]!.messages[0]!, tools: [{ id: "t", name: "Read", summary: "Changed" }] }] }] });
  assert.equal(h.rows("SELECT summary FROM import_message_tool")[0]?.summary, "Read a.ts");
});

test("only an assistant message carries tool calls", async () => {
  const h = harness();
  const bad = { ...payload, sessions: [{ ...payload.sessions[0]!, messages: [{ sourceMessageId: "u", role: "user" as const, text: "hi", at: 1, tools: [{ id: "t", name: "Bash", summary: "x" }] }] }] };
  await assert.rejects(sessionsImport(h.ctx, bad), (e: unknown) => /tool calls/.test(JSON.stringify(e)));
});

test("sessions.rename changes only the title shown: the transcript and the source title stay, the source title back clears it, and a later import keeps it", async () => {
  const h = harness();
  const conversationId = (await sessionsImport(h.ctx, payload)).sessions[0].conversationId;
  const before = JSON.stringify(h.rows("SELECT * FROM import_message ORDER BY sourceMessageId"));
  h.clear();
  const out = await sessionsRename(h.ctx, { conversationId, title: "  Release\n notes " }) as { session: { title: string } };
  assert.equal(out.session.title, "Release notes", "spaces and line breaks fold");
  assert.equal((await sessionsList(h.ctx, {})).sessions[0].title, "Release notes");
  assert.equal((await sessionsGet(h.ctx, { conversationId })).session.title, "Release notes");
  assert.deepEqual(h.rows("SELECT title, shownTitle, immutable FROM import_conversation"), [{ title: "Release work", shownTitle: "Release notes", immutable: 1 }], "the source title is kept");
  assert.equal(JSON.stringify(h.rows("SELECT * FROM import_message ORDER BY sourceMessageId")), before, "the transcript is untouched");
  assert.deepEqual(h.names(), ["sessions.renamed"]);
  assert.deepEqual(h.named("sessions.renamed")[0]!.payload, { conversationId }, "the event carries no title");
  await sessionsRename(h.ctx, { conversationId, title: "Release notes" });
  assert.equal(h.names().length, 1, "the same title again changes nothing");
  await sessionsImport(h.ctx, { ...payload, sessions: [{ ...payload.sessions[0]!, title: "Renamed at the source" }] });
  assert.equal((await sessionsList(h.ctx, {})).sessions[0].title, "Release notes", "a later import never overwrites the name the owner gave");
  await sessionsRename(h.ctx, { conversationId, title: "Release work" });
  assert.deepEqual(h.rows("SELECT shownTitle FROM import_conversation"), [{ shownTitle: null }], "the source title back clears the owner's own");
  await assert.rejects(sessionsRename(h.ctx, { conversationId, title: " " }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(sessionsRename(h.ctx, { conversationId, title: "x".repeat(201) }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(sessionsRename(h.as({ kind: "person", id: "usr_maya" }), { conversationId, title: "Mine" }), (e) => codeOf(e) === "validation.not_found", "owner-only");
});

test("sessions.archive moves a session to the Archived list and back; asking for the state it is in changes nothing", async () => {
  const h = harness();
  const conversationId = (await sessionsImport(h.ctx, payload)).sessions[0].conversationId;
  h.clear();
  assert.deepEqual(await sessionsArchive(h.ctx, { conversationId }), { archived: true });
  assert.equal((await sessionsList(h.ctx, {})).sessions[0].archived, true, "still listed, marked archived");
  assert.equal((await sessionsGet(h.ctx, { conversationId })).messages.length, 2, "the transcript still opens");
  assert.deepEqual(await sessionsArchive(h.ctx, { conversationId }), { archived: true });
  assert.deepEqual(h.names(), ["sessions.archived"], "archiving twice is one change");
  assert.deepEqual(await sessionsArchive(h.ctx, { conversationId, unarchive: true }), { archived: false });
  assert.equal("archived" in (await sessionsList(h.ctx, {})).sessions[0], false, "back in the list");
  assert.deepEqual(h.named("sessions.archived").map((e) => e.payload), [{ conversationId, archived: true }, { conversationId, archived: false }]);
  await assert.rejects(sessionsArchive(h.as({ kind: "person", id: "usr_maya" }), { conversationId }), (e) => codeOf(e) === "validation.not_found", "owner-only");
});

test("sessions.delete removes the imported copy, keeps the continued chat, never touches the computer, and a later import does not bring it back", async () => {
  const h = harness();
  const withTool = { ...payload, sessions: [{ ...payload.sessions[0]!, messages: [...payload.sessions[0]!.messages, { sourceMessageId: "m3", role: "assistant" as const, text: "Ran it", at: 1_760_000_000_003, tools: [{ id: "t1", name: "Bash", summary: "Run npm test" }] }] }] };
  const imported = await sessionsImport(h.ctx, withTool);
  const conversationId = imported.sessions[0].conversationId;
  await sessionsImport(h.ctx, { ...withTool, sessions: [{ ...withTool.sessions[0]!, messages: [{ ...withTool.sessions[0]!.messages[0]!, text: "Changed outside Vyre" }] }] });
  const continued = await sessionsContinue(h.ctx, { conversationId, destinationSpaceId: h.ctx.space, destinationScope: "personal", agentId: "agt_intake" });
  await sessionsRename(h.ctx, { conversationId, title: "Mine" });
  await sessionsArchive(h.ctx, { conversationId });
  await assert.rejects(sessionsDelete(h.as({ kind: "person", id: "usr_maya" }), { conversationId }), (e) => codeOf(e) === "validation.not_found", "owner-only");
  h.clear();
  assert.deepEqual(await sessionsDelete(h.ctx, { conversationId }), { deleted: true });
  assert.deepEqual(h.calls.map((c) => c.cap).filter((c) => c !== "spaces.matrix"), [], "no other module is asked to change anything: the continued chat is not deleted and nothing on the computer is touched");
  assert.equal(h.rows("SELECT * FROM import_message").length, 0, "the copied messages are gone");
  assert.equal(h.rows("SELECT * FROM import_message_tool").length, 0, "and their tool calls");
  assert.equal(h.rows("SELECT * FROM import_session_conflict").length, 0, "and the conflicts");
  assert.deepEqual(h.rows("SELECT title, shownTitle, continuedThreadId FROM import_conversation"), [{ title: null, shownTitle: null, continuedThreadId: continued.threadId }], "only a tombstone stays");
  assert.deepEqual(h.named("sessions.deleted").map((e) => e.payload), [{ conversationId }]);
  assert.equal((await sessionsList(h.ctx, {})).sessions.length, 0);
  await assert.rejects(sessionsGet(h.ctx, { conversationId }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(sessionsContinue(h.ctx, { conversationId, destinationSpaceId: h.ctx.space, destinationScope: "personal", agentId: "agt_intake" }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(sessionsRename(h.ctx, { conversationId, title: "Again" }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(sessionsArchive(h.ctx, { conversationId }), (e) => codeOf(e) === "validation.not_found");
  assert.deepEqual(await sessionsDelete(h.ctx, { conversationId }), { deleted: true }, "a second delete answers the same");
  assert.equal(h.named("sessions.deleted").length, 1, "and changes nothing");
  const again = await sessionsImport(h.ctx, withTool);
  assert.deepEqual(again, { imported: 0, updated: 0, sessions: [] }, "a later import of the same source session skips it");
  assert.equal(h.rows("SELECT * FROM import_message").length, 0);
  assert.equal((await sessionsList(h.ctx, {})).sessions.length, 0);
  const other = await sessionsImport(h.ctx, { ...payload, sessions: [{ ...payload.sessions[0]!, sourceSessionId: "rollout-222" }] });
  assert.equal(other.imported, 1, "other sessions of the same source still import");
});

