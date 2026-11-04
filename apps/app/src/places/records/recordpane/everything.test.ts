// @tsx
// The Everything feed: each source becomes lines, they merge newest first, and a source the person may not read adds nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { fromComments, fromConversation, fromFiles, fromMeetings, fromRuns, fromTasks, fromThreads, loadEverything, merge } from "./everything.ts";
import type { Item } from "./everything.ts";

const names = (id: string): string => ({ usr_maya: "Maya Cole", usr_dan: "Dan Ruiz" })[id] ?? id;

test("each source becomes lines with a kind, a time and, where it lives somewhere, a subject", () => {
  assert.deepEqual(fromTasks([{ id: "tsk_1", title: "Reply to Dana", state: "todo", updatedAt: 50 } as never]), [{ id: "task:tsk_1", kind: "task", at: 50, title: "Reply to Dana", note: "To do", subject: { type: "task", id: "tsk_1" } }]);
  assert.deepEqual(fromRuns([{ id: "run_1", name: "Lead sweep", status: "waiting_input", startedAt: 10, endedAt: 40 } as never])[0], { id: "run:run_1", kind: "run", at: 40, title: "Lead sweep", note: "waiting input", subject: { type: "run", id: "run_1" } });
  assert.equal(fromThreads([{ threadId: "thr_1", title: "Intake", createdAt: 5, lastMessageAt: 9, replyCount: 1 } as never])[0]!.note, "1 message");
  assert.deepEqual(fromFiles([{ fileId: "fil_1", name: "id.pdf", updatedAt: 7, updatedBy: "usr_maya" } as never, { fileId: "fil_2", name: "old.pdf", updatedAt: 3, updatedBy: "usr_dan", deletedAt: 4 } as never], names).map((x) => x.title), ["id.pdf"], "a file in Trash is not listed");
  const comment = fromComments([{ commentId: "rcm_1", text: "x".repeat(300), by: "usr_dan", at: 20 } as never], names)[0]!;
  assert.equal(comment.title.length, 120);
  assert.equal(comment.note, "Dan Ruiz commented");
  const mail = fromConversation([{ kind: "email", id: "eml_1", at: 30, direction: "in", title: "Engagement papers", preview: "Please find my ID" } as never, { kind: "record_chip", id: "x", at: 31 } as never, { kind: "sms", id: "sms_1", at: 32, direction: "out", preview: "On my way" } as never]);
  assert.deepEqual(mail.map((m) => [m.kind, m.title, m.note]), [["mail", "Engagement papers", "Received. Please find my ID"], ["text", "On my way", "Sent"]]);
});

test("the feed is newest first, one line per id, and capped", () => {
  const a: Item[] = [{ id: "a", kind: "task", at: 1, title: "a" }, { id: "b", kind: "task", at: 3, title: "b" }];
  const b: Item[] = [{ id: "b", kind: "task", at: 3, title: "b again" }, { id: "c", kind: "file", at: 2, title: "c" }];
  assert.deepEqual(merge([a, b]).map((x) => x.id), ["b", "c", "a"]);
  assert.equal(merge([a, b], 2).length, 2);
});

test("a source that answers no adds nothing, and nothing says it was refused", async () => {
  const seen: string[] = [];
  const call = async (cap: string): Promise<unknown> => {
    seen.push(cap);
    if (cap === "tasks.list") return { tasks: [{ id: "tsk_1", title: "Reply", state: "todo", updatedAt: 9 }] };
    if (cap === "records.activity") return { entries: [{ id: "e1", kind: "created", at: 5, actor: "usr_maya" }] };
    throw new Error("permission.not_found");
  };
  const out = await loadEverything({ call, type: "contact", recordId: "rec_1", names, folderOf: async () => "fld_1" });
  assert.deepEqual(out.map((x) => [x.kind, x.title]), [["task", "Reply"], ["edit", "Maya created it"]]);
  assert.deepEqual([...new Set(seen)].sort(), ["access.reach", "files.list", "inbox.thread", "meetings.closeout.list", "records.activity", "records.comments.list", "runs.list", "tasks.list", "threads.list"]);
});

test("no folder, no file read", async () => {
  const seen: string[] = [];
  await loadEverything({ call: async (cap) => { seen.push(cap); throw new Error("no"); }, type: "contact", recordId: "rec_1", names, folderOf: async () => null });
  assert.ok(!seen.includes("files.list"));
});

test("a record lists its meetings with where their close-out stands, and a tap opens the close-out", async () => {
  const items = fromMeetings([
    { meetingId: "rec_m1", title: "Renewal call", startsAt: 20, attendees: ["Pat Lee"], state: "ready", proposed: 4, done: 0 },
    { meetingId: "rec_m2", title: "Kickoff", startsAt: 10, attendees: [], state: "closed", proposed: 0, done: 5 },
  ]);
  assert.deepEqual(items.map((i) => [i.kind, i.title, i.note, i.subject?.type]), [["meeting", "Renewal call", "Ready to close · 4 to approve", "meeting"], ["meeting", "Kickoff", "Closed · 5 done", "meeting"]]);
  const out = await loadEverything({ call: async (cap, input) => { if (cap === "meetings.closeout.list") { assert.deepEqual(input, { recordId: "rec_1", limit: 50 }); return { meetings: [{ meetingId: "rec_m1", title: "Renewal call", startsAt: 20, attendees: [], state: "nothing", proposed: 0, done: 0 }], ready: 0 }; } throw new Error("no"); }, type: "contact", recordId: "rec_1", names, folderOf: async () => null });
  assert.deepEqual(out.map((x) => [x.kind, x.note]), [["meeting", "Nothing to do"]]);
});

test("the feed is drawn once, final: a row for a thing the person cannot open loses its name and its link before the first draw, from one access.reach call", async () => {
  const { withReach } = await import("./everything.ts");
  const calls: Array<{ cap: string; input: { items: Array<{ type: string; id: string }> } }> = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => { const i = input as { items: Array<{ type: string; id: string }> }; calls.push({ cap, input: i }); return { items: i.items.map((x) => ({ ...x, level: x.id === "tsk_private" ? "none" : "view" })) }; };
  const feed = [
    { id: "task:tsk_ok", kind: "task", at: 3, title: "Send the retainer", note: "To do", subject: { type: "task", id: "tsk_ok" } },
    { id: "task:tsk_private", kind: "task", at: 2, title: "Settlement offer", note: "To do", subject: { type: "task", id: "tsk_private" } },
    { id: "comment:c1", kind: "comment", at: 1, title: "A comment" },
  ] as never[];
  const out = await withReach(call as never, feed);
  assert.equal(calls.length, 1, "one call for the whole feed");
  assert.deepEqual(out.map((x: { title: string; subject?: unknown }) => [x.title, x.subject !== undefined]), [["Send the retainer", true], ["A task you do not have access to", false], ["A comment", false]]);
  const broken = await withReach((async () => { throw new Error("down"); }) as never, feed);
  assert.deepEqual(broken, feed, "a Space that does not answer leaves the rows as they are");
});
