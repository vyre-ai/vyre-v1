// Record comments on a booted daemon, with the model vendor stand-in. A comment that @mentions an agent is answered by that agent under the comment (headless: its turn runs in an unlisted Ask pane on the
// record, no chat shows up in Recent, and the agent replies by calling records_comments_add as itself), "is replying" clears when the answer lands; a comment that @mentions a person raises an Answer
// request for them that names the record; resolving a thread hides it from the default list and the Resolved list still has it.
// Needs the generated registry to carry records.comments.* and records.activity (a regen after the manifest change).
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, hostLog, makeAgent, scriptedModel, seededDir, waitFor } from "./support/live.ts";

type Comment = { commentId: string; parentId?: string; text: string; by: string; resolved: boolean; replying: string[]; mentions: Array<{ kind: string; id: string }> };

test("mention an agent and its reply lands under the comment; mention a person and they get an Answer request; resolve hides the thread", async () => {
  const model = scriptedModel(async function* (input, run) {
    const text = input.trigger?.body ?? "";
    const parentId = /parentId "(rcm_[^"]+)"/.exec(text)?.[1];
    const recordId = /recordId "(rec_[a-z0-9]+)"/.exec(text)?.[1];
    const type = /type "([a-z_]+)"/.exec(text)?.[1];
    if (!parentId || !recordId || !type) { yield { type: "text", text: "not a comment thread" }; return; }
    yield* run("tool_search", { query: "comment on a record" });
    const r = yield* run("records_comments_add", { type, recordId, parentId, text: "Three edits since Monday.", idempotencyKey: `sr-${parentId}` });
    yield { type: "text", text: r.ok ? "replied" : `FAILED ${JSON.stringify(r.content)}` };
  });
  const d = await boot(seededDir(), model);
  try {
    await connect(d);
    const agentId = await makeAgent(d, "Intake", "You answer intake questions.");
    const made = await call(d, "records.create", { type: "contact", fields: { name: "Rivera Holdings" }, idempotencyKey: "rc-rec" });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const recordId = made.data.record.id as string;
    const list = async (includeResolved = false): Promise<{ comments: Comment[]; resolvedCount: number }> => (await call(d, "records.comments.list", { type: "contact", recordId, includeResolved })).data;
    const before = (await call(d, "chat.recent", { filter: "all" })).data;

    // an agent is mentioned: it is shown replying, then its answer is a reply under the comment
    const asked = await call(d, "records.comments.add", { type: "contact", recordId, text: "@Intake what changed this week?", mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "cm-1" });
    assert.equal(asked.status, 200, JSON.stringify(asked.data));
    const root = asked.data.comment as Comment;
    assert.deepEqual(root.replying, [agentId], "the comment says who is replying");
    const answered = await waitFor(async () => {
      await d.hooks?.pump?.();
      const c = (await list()).comments;
      const reply = c.find((x) => x.parentId === root.commentId && x.by === agentId);
      return reply ? { reply, all: c } : null;
    }, 40_000, () => hostLog(d));
    assert.equal(answered.reply.text, "Three edits since Monday.");
    assert.deepEqual(answered.all.find((x) => x.commentId === root.commentId)!.replying, [], "the quiet state cleared when the answer landed");
    const after = (await call(d, "chat.recent", { filter: "all" })).data;
    assert.equal(JSON.stringify(after), JSON.stringify(before), "no chat shows up: the agent worked in an unlisted Ask pane");

    // a person is mentioned: an Answer request for them that names the record
    const person = "usr_tess";
    const pinged = await call(d, "records.comments.add", { type: "contact", recordId, text: "@Tess can you confirm the dates?", mentions: [{ kind: "person", id: person }], idempotencyKey: "cm-2" });
    assert.equal(pinged.status, 200, JSON.stringify(pinged.data));
    const tasks = (await call(d, "tasks.list", { scope: "all", kinds: ["answer"], recordId })).data.tasks as Array<{ kind: string; assigned: { id: string }; recordId?: string; source?: { id: string } }>;
    const request = tasks.find((t) => t.assigned.id === person);
    assert.ok(request, JSON.stringify(tasks) + hostLog(d).slice(-1200));
    assert.equal(request!.recordId, recordId);
    assert.equal(request!.source?.id, (pinged.data.comment as Comment).commentId, "the request points at the comment");

    // resolve hides the thread from the default view; the Resolved list still has it; reopening brings it back
    assert.equal((await call(d, "records.comments.resolve", { commentId: root.commentId, resolved: true })).status, 200);
    const open = await list();
    assert.ok(!open.comments.some((c) => c.commentId === root.commentId || c.parentId === root.commentId), "the resolved thread and its reply are hidden");
    assert.equal(open.resolvedCount, 1);
    assert.ok((await list(true)).comments.some((c) => c.commentId === root.commentId));
    assert.equal((await call(d, "records.comments.resolve", { commentId: root.commentId, resolved: false })).status, 200);
    assert.ok((await list()).comments.some((c) => c.commentId === root.commentId));

    // the record's Activity is the real history: what happened, newest first
    assert.equal((await call(d, "records.update", { type: "contact", recordId, patch: { name: "Rivera Holdings LLC" } })).status, 200);
    const activity = (await call(d, "records.activity", { type: "contact", recordId })).data.entries as Array<{ kind: string; field?: string; from?: unknown; to?: unknown }>;
    assert.equal(activity[0]!.kind, "edited");
    assert.deepEqual([activity[0]!.field, activity[0]!.from, activity[0]!.to], ["name", "Rivera Holdings", "Rivera Holdings LLC"]);
    assert.equal(activity[activity.length - 1]!.kind, "created");
  } finally { await d.stop(); }
});
