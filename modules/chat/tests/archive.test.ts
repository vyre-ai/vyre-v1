// Archive, delete and leave on a person's own chat list. Archive is per person (the others in a group chat keep theirs, a new message stays quiet, an @mention brings it back); delete is for a chat only
// the asker is in (hidden, undone by restore, removed for good by the retention purge); leave is for a chat with other people. A channel is none of these, and an agent only archives.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { registry } from "../../../generated/registry.ts";
import { DANA, DRAFTER, INTAKE, MAYA, codeOf, eventErrors, harness } from "../fixtures/harness.ts";

type Fn = (ctx: any, input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
let n = 0;
const key = (): string => `arc-${++n}`;

/** A direct message between Dana and Maya with one message in it, and a private chat of Dana's with an agent and one message in it. */
async function world() {
  const hn = harness({ calls: { "agents.get": () => ({ agent: {} }), "engine.stop_all": () => ({ stopped: 0 }), "files.resolve": () => ({ kind: "none" }) } });
  const dm = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() })).thread.threadId as string;
  await h["chat.post"]!(hn.ctx, { threadId: dm, body: "hi Maya", idempotencyKey: key() });
  const solo = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  await h["chat.post"]!(hn.ctx, { threadId: solo, body: "draft the note", mentions: [{ kind: "agent", id: INTAKE }], idempotencyKey: key() });
  return { hn, dm, solo };
}
const ids = (rows: Array<{ threadId: string }>): string[] => rows.map((r) => r.threadId);
const recent = async (ctx: unknown) => (await h["chat.recent"]!(ctx, {})) as Record<string, Array<{ threadId: string }>>;
const listed = (r: Record<string, Array<{ threadId: string }>>): string[] => [...r["starred"]!, ...r["today"]!, ...r["yesterday"]!, ...r["earlier"]!].map((x) => x.threadId);

test("archive leaves my list for the Archived section; the other person keeps the chat where it was", async () => {
  const { hn, dm } = await world();
  assert.ok(listed(await recent(hn.ctx)).includes(dm), "before: in my list");
  assert.deepEqual(await h["threads.archive"]!(hn.ctx, { threadId: dm }), { archived: true });
  const mine = await recent(hn.ctx);
  assert.ok(!listed(mine).includes(dm), "not in my groups");
  assert.deepEqual(ids(mine["archived"]!), [dm], "in my Archived section");
  assert.ok(listed(await recent(hn.person(MAYA))).includes(dm), "Maya still sees it, and has nothing archived");
  assert.deepEqual((await recent(hn.person(MAYA)))["archived"], []);
  assert.deepEqual(hn.named("thread.archived").map((e) => e.payload), [{ person: DANA, threadId: dm }]);
  await h["threads.archive"]!(hn.ctx, { threadId: dm });
  assert.equal(hn.named("thread.archived").length, 1, "archiving again changes nothing and says nothing");
  assert.deepEqual(eventErrors("thread.archived", hn.named("thread.archived")[0]!.payload), [], "the payload is the declared one");
});

test("a new message from someone else leaves it archived; an @mention of me brings it back; unarchive puts it back by hand", async () => {
  const { hn, dm } = await world();
  await h["threads.archive"]!(hn.ctx, { threadId: dm });
  await h["chat.post"]!(hn.person(MAYA), { threadId: dm, body: "you there?", idempotencyKey: key() });
  assert.deepEqual(ids((await recent(hn.ctx))["archived"]!), [dm], "a plain message is quiet");
  await h["chat.post"]!(hn.person(MAYA), { threadId: dm, body: "@Dana look", mentions: [{ kind: "person", id: DANA }], idempotencyKey: key() });
  const back = await recent(hn.ctx);
  assert.ok(listed(back).includes(dm) && back["archived"]!.length === 0, "the mention put it back in the list");
  assert.deepEqual(hn.named("thread.unarchived").map((e) => e.payload), [{ person: DANA, threadId: dm, reason: "mention" }]);
  await h["threads.archive"]!(hn.ctx, { threadId: dm });
  assert.deepEqual(await h["threads.unarchive"]!(hn.ctx, { threadId: dm }), { archived: false });
  assert.ok(listed(await recent(hn.ctx)).includes(dm));
  assert.equal(hn.named("thread.unarchived").at(-1)!.payload["reason"], "person");
  for (const e of hn.named("thread.unarchived")) assert.deepEqual(eventErrors("thread.unarchived", e.payload), [], "the payload is the declared one");
});

test("a mention of someone else does not unarchive mine; a channel is not archived this way; a stranger finds nothing", async () => {
  const { hn, dm } = await world();
  await h["threads.archive"]!(hn.ctx, { threadId: dm });
  await h["chat.post"]!(hn.person(MAYA), { threadId: dm, body: "note to self", mentions: [{ kind: "person", id: MAYA }], idempotencyKey: key() });
  assert.deepEqual(ids((await recent(hn.ctx))["archived"]!), [dm]);
  const channel = (await h["channels.create"]!(hn.ctx, { name: "general", visibility: "public", idempotencyKey: key() })).channel.mainThreadId as string;
  await assert.rejects(h["threads.archive"]!(hn.ctx, { threadId: channel }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(h["threads.archive"]!(hn.person("usr_stranger"), { threadId: dm }), (e) => codeOf(e) === "validation.not_found");
});

test("an agent acting for me may archive my chat", async () => {
  const { hn, solo } = await world();
  await h["threads.archive"]!(hn.agent(INTAKE, DANA), { threadId: solo });
  assert.deepEqual(ids((await recent(hn.ctx))["archived"]!), [solo]);
});

test("delete: a chat only I am in is hidden everywhere and restore brings it back; the running turns stop first", async () => {
  const { hn, solo } = await world();
  assert.deepEqual(await h["threads.delete"]!(hn.ctx, { threadId: solo }), { deleted: true });
  assert.equal(hn.callLog.filter((c) => c.cap === "engine.stop_all").length, 1, "stop first");
  const gone = await recent(hn.ctx);
  assert.ok(!listed(gone).includes(solo) && !ids(gone["archived"]!).includes(solo));
  await assert.rejects(h["threads.get"]!(hn.ctx, { threadId: solo }), (e) => codeOf(e) === "validation.not_found", "reads say not found");
  assert.equal(hn.rows(`SELECT COUNT(*) AS n FROM chat_message WHERE thread = ? AND deleted_at IS NULL`, solo)[0]!["n"], 0);
  assert.equal(hn.named("thread.deleted").length, 1);
  const back = await h["threads.restore"]!(hn.ctx, { threadId: solo });
  assert.equal(back.thread.threadId, solo);
  assert.ok(listed(await recent(hn.ctx)).includes(solo), "restored");
  assert.ok(Number(hn.rows(`SELECT COUNT(*) AS n FROM chat_message WHERE thread = ? AND deleted_at IS NULL`, solo)[0]!["n"]) > 0, "its messages came back");
  assert.equal(hn.named("thread.restored").length, 1);
  for (const e of ["thread.deleted", "thread.restored"]) assert.deepEqual(eventErrors(e, hn.named(e)[0]!.payload), [], e);
});

test("delete: a chat with another person is left, not deleted; a person other than the one who deleted cannot restore; an agent cannot delete", async () => {
  const { hn, dm, solo } = await world();
  await assert.rejects(h["threads.delete"]!(hn.ctx, { threadId: dm }), (e) => codeOf(e) === "validation.precondition_failed");
  await assert.rejects(h["threads.delete"]!(hn.agent(INTAKE, DANA), { threadId: solo }), (e) => codeOf(e) === "permission.no_grant");
  await h["threads.delete"]!(hn.ctx, { threadId: solo });
  await assert.rejects(h["threads.restore"]!(hn.person(MAYA), { threadId: solo }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(h["threads.restore"]!(hn.agent(INTAKE, DANA), { threadId: solo }), (e) => codeOf(e) === "permission.no_grant");
});

test("delete still deletes when the running turns cannot be stopped, and says so in the log", async () => {
  const warned: string[] = [];
  const hn = harness({ calls: { "agents.get": () => ({ agent: {} }) } });
  hn.ctx.log = { warn: (m: string) => { warned.push(m); } };
  const solo = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [DRAFTER], idempotencyKey: key() })).thread.threadId as string;
  await h["threads.delete"]!(hn.ctx, { threadId: solo });
  assert.equal(warned.length, 1);
  assert.match(warned[0]!, /could not be stopped/);
});

test("leave: I stop being a member of a chat with other people and they keep it; alone I delete instead", async () => {
  const { hn, dm, solo } = await world();
  assert.deepEqual(await h["threads.leave"]!(hn.ctx, { threadId: dm }), { ok: true });
  assert.ok(!listed(await recent(hn.ctx)).includes(dm), "gone from my list");
  assert.ok(listed(await recent(hn.person(MAYA))).includes(dm), "Maya keeps it");
  assert.equal(hn.named("channel.member_removed").length, 1);
  await assert.rejects(h["threads.leave"]!(hn.ctx, { threadId: solo }), (e) => codeOf(e) === "validation.bad_input", "alone: delete instead");
  await assert.rejects(h["threads.leave"]!(hn.agent(INTAKE, DANA), { threadId: dm }), (e) => codeOf(e) === "permission.no_grant");
});

test("the retention purge removes a deleted chat for good once it is older than the cutoff, and only then", async () => {
  const { hn, solo } = await world();
  await h["threads.delete"]!(hn.ctx, { threadId: solo });
  hn.advance(10_000);
  const early = await h["chat.transcript.purge"]!(hn.ctx, { before: hn.clock.t - 60_000, idempotencyKey: key() });
  assert.equal(hn.rows(`SELECT 1 AS x FROM chat_thread WHERE id = ?`, solo).length, 1, "a delete inside the cutoff is kept for Undo");
  assert.equal(early.removed >= 0, true);
  const held = await h["chat.transcript.purge"]!(hn.ctx, { before: hn.clock.t + 1, skipThreadIds: [solo], idempotencyKey: key() });
  assert.equal(hn.rows(`SELECT 1 AS x FROM chat_thread WHERE id = ?`, solo).length, 1, "a held chat is left whole");
  assert.ok(held.removed >= 0);
  const done = await h["chat.transcript.purge"]!(hn.ctx, { before: hn.clock.t + 1, idempotencyKey: key() });
  assert.ok(done.removed >= 1);
  assert.equal(hn.rows(`SELECT 1 AS x FROM chat_thread WHERE id = ?`, solo).length, 0, "gone for good");
  assert.equal(hn.rows(`SELECT 1 AS x FROM chat_message WHERE thread = ?`, solo).length, 0);
  assert.equal(hn.named("thread.erased").length >= 1, true);
  await assert.rejects(h["threads.restore"]!(hn.ctx, { threadId: solo }), (e) => codeOf(e) === "validation.not_found", "nothing to undo after the purge");
});

test("every event these handlers emit is declared by the capability that emits it (the pipeline refuses an undeclared one: chat.post answered 500 on a mention before it listed thread.unarchived)", () => {
  const emits = (cap: string): readonly string[] => registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0]!.emits ?? [];
  assert.ok(emits("threads.archive").includes("thread.archived"));
  assert.ok(emits("threads.unarchive").includes("thread.unarchived"));
  assert.ok(emits("threads.delete").includes("thread.deleted"));
  assert.ok(emits("threads.restore").includes("thread.restored"));
  assert.ok(emits("threads.leave").includes("channel.member_removed"));
  assert.ok(emits("chat.post").includes("thread.unarchived"), "a mention can unarchive");
  assert.ok(emits("chat.transcript.purge").includes("thread.erased"), "the purge erases deleted chats");
  for (const e of ["thread.archived", "thread.unarchived", "thread.deleted", "thread.restored"]) assert.ok(registry.events.some((x) => x.name === e), `${e} is declared`);
});
