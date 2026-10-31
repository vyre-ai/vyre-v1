// Comments on a record: threads, replies, edit own, resolve and reopen, the Resolved filter, and what a mention sets in motion (a person's Answer request, an agent's headless reply).
import test from "node:test";
import assert from "node:assert/strict";
import { openRecords } from "../impl.ts";
import { createCommentsHandlers, settleTurn } from "../handlers/comments.ts";
import type { CommentsCtx } from "../handlers/comments.ts";
import { ITEM } from "../fixtures/seed.ts";

const vcode = (c: string) => (e: unknown) => {
  assert.equal((e as { error?: { code?: string } }).error?.code, c);
  return true;
};

async function setup() {
  let t = 1000;
  const rec = openRecords({ space: `sp_cmt_${Math.random().toString(36).slice(2, 8)}`, clock: () => t });
  await rec.store.define({ add_types: [ITEM] as never });
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const events: { name: string; payload: Record<string, unknown> }[] = [];
  let failChat = false;
  const ctxFor = (principal: CommentsCtx["principal"], extra: Partial<CommentsCtx> = {}): CommentsCtx => ({
    trace: { traceId: "0123456789abcdef0123456789abcdef" }, principal,
    emit: (name, _subject, payload) => { events.push({ name, payload }); },
    call: (async (cap: string, input: Record<string, unknown>) => {
      calls.push({ cap, input });
      if (cap === "records.get") return rec.handlers["records.get"]({ trace: { traceId: "x" } } as never, input as never);
      if (cap === "chat.start") { if (failChat) throw new Error("no such agent"); return { thread: { threadId: `thr_${input["idempotencyKey"]}` } }; }
      return {};
    }) as never,
    now: () => t, ...extra,
  });
  const h = createCommentsHandlers({ tx: rec.host.tx, now: () => t });
  const id = (await rec.handlers["records.create"](ctxFor({ kind: "person", id: "usr_a" }) as never, { type: "item", fields: { name: "Rivera intake" } })).record.id;
  const ana = ctxFor({ kind: "person", id: "usr_ana" });
  const ben = ctxFor({ kind: "person", id: "usr_ben" });
  const bot = ctxFor({ kind: "agent", id: "agt_intake" });
  return { rec, h, id, ana, ben, bot, calls, events, at: (ms: number) => { t = ms; }, failChat: (v: boolean) => { failChat = v; } };
}

test("a comment, a reply and the thread's order; a reply joins the thread's root", async () => {
  const s = await setup();
  s.at(2000);
  const a = (await s.h["records.comments.add"](s.ana, { type: "item", recordId: s.id, text: "Call the client" })).comment;
  s.at(3000);
  const r1 = (await s.h["records.comments.add"](s.ben, { type: "item", recordId: s.id, text: "Done", parentId: a.commentId })).comment;
  s.at(4000);
  const r2 = (await s.h["records.comments.add"](s.ana, { type: "item", recordId: s.id, text: "Thanks", parentId: r1.commentId })).comment;
  assert.equal(r2.parentId, a.commentId, "a reply to a reply joins the root");
  const { comments } = await s.h["records.comments.list"](s.ana, { type: "item", recordId: s.id });
  assert.deepEqual(comments.map((c) => c.text), ["Call the client", "Done", "Thanks"]);
  assert.ok(s.events.some((e) => e.name === "record.comment_added" && e.payload["commentId"] === a.commentId));
  await assert.rejects(() => s.h["records.comments.add"](s.ana, { type: "item", recordId: s.id, text: "   " }), vcode("validation.bad_input"));
  await assert.rejects(() => s.h["records.comments.add"](s.ana, { type: "item", recordId: s.id, text: "x", parentId: "rcm_nope" }), vcode("validation.not_found"));
});

test("you edit only your own comment; the edit is marked", async () => {
  const s = await setup();
  s.at(2000);
  const c = (await s.h["records.comments.add"](s.ana, { type: "item", recordId: s.id, text: "First" })).comment;
  s.at(2500);
  const edited = (await s.h["records.comments.edit"](s.ana, { commentId: c.commentId, text: "First, fixed" })).comment;
  assert.equal(edited.text, "First, fixed");
  assert.equal(edited.editedAt, 2500);
  await assert.rejects(() => s.h["records.comments.edit"](s.ben, { commentId: c.commentId, text: "mine now" }), vcode("permission.no_grant"));
});

test("resolve hides the thread from the default list and reopen brings it back; the Resolved filter shows it", async () => {
  const s = await setup();
  const c = (await s.h["records.comments.add"](s.ana, { type: "item", recordId: s.id, text: "Question" })).comment;
  await s.h["records.comments.add"](s.ben, { type: "item", recordId: s.id, text: "Answer", parentId: c.commentId });
  const keep = (await s.h["records.comments.add"](s.ana, { type: "item", recordId: s.id, text: "Another" })).comment;
  const done = (await s.h["records.comments.resolve"](s.ben, { commentId: c.commentId, resolved: true })).comment;
  assert.equal(done.resolved, true);
  assert.equal(done.resolvedBy, "usr_ben");
  const open = await s.h["records.comments.list"](s.ana, { type: "item", recordId: s.id });
  assert.deepEqual(open.comments.map((x) => x.commentId), [keep.commentId], "the resolved thread and its reply are hidden");
  assert.equal(open.resolvedCount, 1);
  const all = await s.h["records.comments.list"](s.ana, { type: "item", recordId: s.id, includeResolved: true });
  assert.equal(all.comments.length, 3);
  await s.h["records.comments.resolve"](s.ana, { commentId: c.commentId, resolved: false });
  assert.equal((await s.h["records.comments.list"](s.ana, { type: "item", recordId: s.id })).comments.length, 3);
  assert.ok(s.events.some((e) => e.name === "record.comment_resolved" && e.payload["resolved"] === true));
});

test("mentioning a person raises an Answer request for them that names the record and the comment; you are not asked about your own mention", async () => {
  const s = await setup();
  const c = (await s.h["records.comments.add"](s.ana, { type: "item", recordId: s.id, text: "Can you check the dates?", mentions: [{ kind: "person", id: "usr_ben" }, { kind: "person", id: "usr_ana" }] })).comment;
  const made = s.calls.filter((x) => x.cap === "tasks.create");
  assert.equal(made.length, 1, "one request, for Ben");
  const t = made[0]!.input as Record<string, any>;
  assert.equal(t.kind, "answer");
  assert.deepEqual(t.assigned, { kind: "person", id: "usr_ben" });
  assert.equal(t.recordId, s.id);
  assert.deepEqual(t.source, { kind: "manual", id: c.commentId });
  assert.match(t.title, /Rivera intake/);
});

test("mentioning an agent starts it headless as a private Ask pane on the record and shows it replying until it answers", async () => {
  const s = await setup();
  const c = (await s.h["records.comments.add"](s.ana, { type: "item", recordId: s.id, text: "Summarise the history", mentions: [{ kind: "agent", id: "agt_intake" }] })).comment;
  const start = s.calls.find((x) => x.cap === "chat.start")!.input as Record<string, any>;
  assert.equal(start.kind, "ask");
  assert.deepEqual(start.agentIds, ["agt_intake"]);
  assert.equal(start.scopeType, "record");
  assert.equal(start.scopeId, s.id);
  assert.equal(start.title, "Comment replies", "the pane says what it is for");
  assert.equal(s.calls.find((x) => x.cap === "threads.set_mode")!.input["mode"], "auto", "headless: nobody is there to say yes to each step");
  const post = s.calls.find((x) => x.cap === "chat.post")!.input as Record<string, any>;
  assert.deepEqual(post.mentions, [{ kind: "agent", id: "agt_intake" }]);
  assert.match(post.body, /Summarise the history/);
  assert.match(post.body, new RegExp(`parentId "${c.commentId}"`), "the agent is told where to answer");
  // a second mention in the same thread reuses the same pane
  const again = (await s.h["records.comments.add"](s.ben, { type: "item", recordId: s.id, text: "and the dates?", parentId: c.commentId, mentions: [{ kind: "agent", id: "agt_intake" }] })).comment;
  assert.ok(again.replying.includes("agt_intake"));
  const starts = s.calls.filter((x) => x.cap === "chat.start").map((x) => x.input["idempotencyKey"]);
  assert.equal(new Set(starts).size, 1, "the same pane key for the whole thread");
  assert.equal(s.calls.filter((x) => x.cap === "chat.post").length, 2, "each mention is a message in that pane");
  assert.deepEqual(c.replying, ["agt_intake"]);
  assert.deepEqual((await s.h["records.comments.list"](s.ana, { type: "item", recordId: s.id })).comments[0]!.replying, ["agt_intake"]);
  const reply = (await s.h["records.comments.add"](s.bot, { type: "item", recordId: s.id, text: "Three edits since Monday.", parentId: c.commentId })).comment;
  assert.equal(reply.by, "agt_intake");
  const after = (await s.h["records.comments.list"](s.ana, { type: "item", recordId: s.id })).comments;
  assert.deepEqual(after.map((x) => x.replying), [[], [], []], "its answer clears the replying state");
});

test("a turn that ends without an answer stops the replying state; an agent that cannot start fails quietly; an agent's mention starts no agent", async () => {
  const s = await setup();
  const c = (await s.h["records.comments.add"](s.ana, { type: "item", recordId: s.id, text: "Look at this", mentions: [{ kind: "agent", id: "agt_intake" }] })).comment;
  assert.equal(settleTurn(s.rec.host.tx, "thr_unknown", "agt_intake", "done"), 0);
  const row = s.rec.host.tx.get<{ thread_id: string }>("SELECT thread_id FROM records_comment_agent WHERE comment_id = ?", c.commentId)!;
  assert.equal(settleTurn(s.rec.host.tx, row.thread_id, "agt_intake", "failed"), 1);
  assert.deepEqual((await s.h["records.comments.list"](s.ana, { type: "item", recordId: s.id })).comments[0]!.replying, []);
  s.failChat(true);
  const d = (await s.h["records.comments.add"](s.ana, { type: "item", recordId: s.id, text: "And you", mentions: [{ kind: "agent", id: "agt_gone" }] })).comment;
  assert.deepEqual(d.replying, [], "the comment is kept and nothing is left spinning");
  const before = s.calls.filter((x) => x.cap === "chat.start").length;
  await s.h["records.comments.add"](s.bot, { type: "item", recordId: s.id, text: "Over to you", mentions: [{ kind: "agent", id: "agt_other" }] });
  assert.equal(s.calls.filter((x) => x.cap === "chat.start").length, before, "agents do not keep each other going");
});

test("delete: the author, or someone who manages the record; a thread's replies go with it", async () => {
  const s = await setup();
  const c = (await s.h["records.comments.add"](s.ana, { type: "item", recordId: s.id, text: "Oops" })).comment;
  await s.h["records.comments.add"](s.ben, { type: "item", recordId: s.id, text: "Reply", parentId: c.commentId });
  await assert.rejects(() => s.h["records.comments.delete"](s.ben, { commentId: c.commentId }), vcode("permission.no_grant"));
  const mgr = { ...s.ben, authorize: () => ({ effect: "allow" as const, reason: "manage" }) };
  assert.deepEqual(await s.h["records.comments.delete"](mgr, { commentId: c.commentId }), { deleted: true });
  assert.equal((await s.h["records.comments.list"](s.ana, { type: "item", recordId: s.id })).comments.length, 0);
  assert.deepEqual(await s.h["records.comments.delete"](s.ana, { commentId: c.commentId }), { deleted: false });
});

test("a record you cannot read has no comments you can read", async () => {
  const s = await setup();
  const blind = { ...s.ana, call: (async () => { throw Object.assign(new Error("no"), { error: { code: "permission.no_grant" } }); }) as never };
  await assert.rejects(() => s.h["records.comments.list"](blind, { type: "item", recordId: s.id }));
  await assert.rejects(() => s.h["records.comments.add"](blind, { type: "item", recordId: s.id, text: "hi" }));
});
