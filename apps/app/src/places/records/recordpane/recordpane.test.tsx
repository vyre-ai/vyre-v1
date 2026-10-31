// The record page's right pane: Activity from the log, Comments (threads, replies, edit, resolve, the Resolved filter, the @ picker, a person's request and an agent's reply), Chat and Files.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, textOf, typeInto } from "../../../onboarding/test-dom.ts";
import type { Node } from "../../../onboarding/test-dom.ts";
import { RecordPage, RecordPageDataProvider } from "../recordpage/index.ts";
import { CLIENT, createSamplePage } from "../recordpage/sample.ts";
import type { SamplePage } from "../recordpage/sample.ts";
import { saveField } from "../recordpage/index.ts";
import type { RecordRow } from "../recordpage/model.ts";
import { activityDetail, activityLine, candidates, insertMention, mentionPieces, mentionQuery, mentionsIn, replyingLine, threadsOf } from "./model.ts";
import type { Activity, Comment } from "./model.ts";

const open: Array<{ unmount(): void }> = [];
afterEach(async () => { for (const r of open.splice(0)) await act(async () => { r.unmount(); }); });
async function up(s: SamplePage, tab: "activity" | "comments" | "chat" | "files", id = "cl_0"): Promise<Node> {
  installDom();
  const r = createRoot();
  open.push(r);
  const el: ReactElement = <RecordPageDataProvider value={s.data}><RecordPage type="clients" recordId={id} start={{ pane: true, tab }} /></RecordPageDataProvider>;
  await act(async () => { r.render(el); });
  await flush();
  return r.container as unknown as Node;
}
const names = (id: string): string => ({ usr_maya: "Maya Chen", usr_omar: "Omar Haddad", usr_irfad: "Irfad Imtiaz", agt_intake: "Intake" } as Record<string, string>)[id] ?? id;
const inField = (root: Node, fieldId: string, what: string): Node => find(find(root, fieldId)!, what)!;
const write = async (root: Node, fieldId: string, text: string): Promise<void> => { await typeInto(inField(root, fieldId, "comment-reply-field"), text); await flush(); };
const send = async (root: Node, fieldId: string): Promise<void> => { await press(inField(root, fieldId, "comment-reply-send")); await flush(); };
const ids = (root: Node): string[] => {
  const out: string[] = [];
  const walk = (n: Node | string): void => { if (typeof n === "string") return; const t = n.props["data-testid"]; if (typeof t === "string") out.push(t); (n.children ?? []).forEach(walk); };
  walk(root);
  return out;
};
const calls = (s: SamplePage, cap: string): { cap: string; input: Record<string, unknown> }[] => s.calls.filter((c) => c.cap === cap) as never;

// ---------------------------------------------------------------- the pure part

test("an activity entry reads as one short line and its old and new value are the tooltip", () => {
  const e = (o: Partial<Activity>): Activity => ({ id: "e", kind: "edited", at: Date.UTC(2025, 9, 24, 9, 30), actor: "usr_maya", ...o } as Activity);
  assert.equal(activityLine(e({ kind: "created" }), CLIENT, names), "Maya created it");
  assert.equal(activityLine(e({ field: "status", to: "lead" }), CLIENT, names), "Maya set status to Lead");
  assert.equal(activityLine(e({ kind: "stage", field: "status", to: "active" }), CLIENT, names), "Maya moved status to Active");
  assert.equal(activityLine(e({ kind: "edited", field: "phone", to: null }), CLIENT, names), "Maya cleared phone");
  assert.equal(activityLine(e({ kind: "linked", field: "projects" }), CLIENT, names), "Maya linked projects");
  assert.equal(activityLine(e({ kind: "removed" }), CLIENT, names), "Maya moved it to Trash");
  assert.equal(activityLine(e({ kind: "synced", field: "email" }), CLIENT, names), "email updated by a sync");
  assert.equal(activityDetail(e({ field: "status", from: "lead", to: "active" }), CLIENT, names), "Status: Lead to Active\n2025-10-24 09:30 UTC");
  assert.equal(activityDetail(e({ field: "phone", from: null, to: "+1" }), CLIENT, names), "Phone: empty to +1\n2025-10-24 09:30 UTC");
});

test("comments fold into threads; a reply with no root is dropped", () => {
  const c = (commentId: string, parentId?: string): Comment => ({ commentId, type: "clients", recordId: "cl_0", ...(parentId ? { parentId } : {}), text: commentId, by: "usr_maya", at: 1, resolved: false, mentions: [], replying: [] });
  const t = threadsOf([c("a"), c("a1", "a"), c("b"), c("a2", "a"), c("x1", "gone")]);
  assert.deepEqual(t.map((x) => [x.root.commentId, x.replies.map((r) => r.commentId)]), [["a", ["a1", "a2"]], ["b", []]]);
});

test("the @ in a text: what is being typed, the people it offers, the name that replaces it, the mentions the text names", () => {
  const all = [{ id: "usr_maya", name: "Maya Chen", kind: "person" as const }, { id: "usr_omar", name: "Omar Haddad", kind: "person" as const }, { id: "agt_intake", name: "Intake", kind: "agent" as const }, { id: "usr_may", name: "May", kind: "person" as const }];
  assert.deepEqual(mentionQuery("hello @ma"), { at: 6, query: "ma" });
  assert.equal(mentionQuery("hello @Maya Chen"), null, "a finished mention has a space after it");
  assert.equal(mentionQuery("mail me@x.com"), null, "an @ inside a word is not a mention");
  assert.deepEqual(candidates(all, "ha").map((e) => e.id), ["usr_omar"], "any word of the name starts with it");
  assert.deepEqual(candidates(all, "ch").map((e) => e.id), ["usr_maya"], "any word of the name");
  assert.equal(candidates(all, "").length, 4);
  assert.equal(insertMention("hello @ma", "Maya Chen"), "hello @Maya Chen ");
  assert.deepEqual(mentionsIn("Hi @Maya Chen and @Intake, also @May.", all), [{ kind: "person", id: "usr_maya" }, { kind: "agent", id: "agt_intake" }, { kind: "person", id: "usr_may" }], "the longest name wins and each is named once");
  assert.deepEqual(mentionsIn("no mentions here, only me@x.com", all), []);
  assert.deepEqual(mentionPieces("Hi @Intake, thanks", ["Intake"]).map((p) => p.text + (p.mention ? "*" : "")), ["Hi ", "@Intake*", ", thanks"]);
  assert.equal(replyingLine(["agt_intake"], names), "Intake is replying");
  assert.equal(replyingLine(["agt_intake", "usr_maya"], names), "Intake and Maya are replying");
});

// ---------------------------------------------------------------- Activity

test("Activity lists the record's real history newest first, one row each with a face, and an edit shows at the top at once", async () => {
  const s = createSamplePage();
  const root = await up(s, "activity");
  const actRows = (): string[] => ids(root).filter((i) => i.startsWith("row-act:") && !/-(leading|trailing|suffix|marks)$/.test(i));
  const rows = actRows();
  assert.ok(rows.length >= 5, "the five seeded changes are there");
  const first = textOf(find(root, rows[0]!));
  assert.match(first, /Maya set next step due to|Docs set next step due to/, "the newest change is first");
  assert.ok(textOf(root).includes("Maya created it"), "the oldest says created");
  const before = rows.length;
  const r = (s.replica.rows("records:clients") as unknown as RecordRow[])[0]!;
  await act(async () => { await saveField(s.data, "clients", r, CLIENT.fields.find((f) => f.key === "phone")!, "+1 415 555 0100"); });
  await flush();
  const after = actRows();
  assert.equal(after.length, before + 1, "the edit is a new row");
  assert.ok(textOf(find(root, after[0]!)).includes("Irfad set phone to +1 415 555 0100"), "at the top");
});

test("a record nobody has touched shows an icon and one short line", async () => {
  const root = await up(createSamplePage(), "activity", "cl_1");
  assert.ok(find(root, "pane-activity-empty"));
  assert.equal(textOf(find(root, "pane-activity-empty")).trim(), "Nothing yet");
});

// ---------------------------------------------------------------- Comments

test("a first comment is written, shown, and the field empties; the Space is asked once with a key", async () => {
  const s = createSamplePage();
  const root = await up(s, "comments");
  assert.ok(find(root, "pane-comments-empty"), "no comments: an icon and a line");
  await write(root, "comment-field-new", "Call Elena about the retainer");
  await send(root, "comment-field-new");
  const made = calls(s, "records.comments.add");
  assert.equal(made.length, 1);
  assert.deepEqual([made[0]!.input.type, made[0]!.input.recordId, made[0]!.input.text], ["clients", "cl_0", "Call Elena about the retainer"]);
  assert.equal(typeof made[0]!.input.idempotencyKey, "string");
  assert.ok(textOf(root).includes("Call Elena about the retainer"));
  assert.ok(!find(root, "pane-comments-empty"));
});

test("a reply goes under the thread; your own comment can be edited and the edit is marked", async () => {
  const s = createSamplePage();
  const root = await up(s, "comments");
  await write(root, "comment-field-new", "First");
  await send(root, "comment-field-new");
  const rootId = (s.replica.rows("comments") as unknown as Comment[])[0]!.commentId;
  await write(root, `comment-field-${rootId}`, "Second");
  await send(root, `comment-field-${rootId}`);
  const reply = calls(s, "records.comments.add")[1]!.input;
  assert.equal(reply.parentId, rootId);
  assert.ok(find(root, `thread-${rootId}`) && textOf(find(root, `thread-${rootId}`)).includes("Second"));
  assert.ok(find(root, `more-${rootId}`), "your own comment has a More menu");
  await act(async () => { await s.data.call("records.comments.edit", { commentId: rootId, text: "First, edited" }); });
  await flush();
  assert.ok(textOf(root).includes("First, edited") && textOf(root).includes("(edited)"));
});

test("resolving a thread hides it from the default view, the Resolved filter shows it, and reopening brings it back", async () => {
  const s = createSamplePage();
  const root = await up(s, "comments");
  await write(root, "comment-field-new", "Question for legal");
  await send(root, "comment-field-new");
  await write(root, "comment-field-new", "Another thread");
  await send(root, "comment-field-new");
  const [a, b] = (s.replica.rows("comments") as unknown as Comment[]).map((c) => c.commentId);
  assert.ok(!find(root, "filter-resolved"), "nothing resolved: no filter");
  await press(find(root, `resolve-${a}`));
  await flush();
  assert.ok(!find(root, `thread-${a}`) && find(root, `thread-${b}`), "the resolved thread is gone from the default view");
  assert.match(textOf(find(root, "filter-resolved")), /Resolved\s+1/);
  await press(find(root, "filter-resolved"));
  await flush();
  assert.ok(find(root, `thread-${a}`) && find(root, `resolved-by-${a}`), "the filter shows it, marked resolved");
  assert.ok(textOf(find(root, `resolved-by-${a}`)).includes("Resolved by Irfad Imtiaz"));
  await press(find(root, `reopen-${a}`));
  await flush();
  assert.ok(find(root, `thread-${a}`) && !find(root, `resolved-by-${a}`), "reopened");
  assert.equal(calls(s, "records.comments.resolve").map((c) => c.input.resolved).join(), "true,false");
});

test("typing @ offers people and agents; a press takes one; the mention goes with the comment", async () => {
  const s = createSamplePage();
  const root = await up(s, "comments");
  await write(root, "comment-field-new", "Can you look, @Om");
  assert.ok(find(root, "mention-picker-new"), "the picker is open");
  assert.ok(find(root, "row-mention-new-usr_omar") && !find(root, "row-mention-new-usr_maya"), "narrowed to Omar");
  await press(find(root, "row-mention-new-usr_omar"));
  await flush();
  assert.ok(!find(root, "mention-picker-new"), "taking a name closes it");
  await send(root, "comment-field-new");
  const made = calls(s, "records.comments.add")[0]!.input;
  assert.equal(made.text, "Can you look, @Omar Haddad ".trim());
  assert.deepEqual(made.mentions, [{ kind: "person", id: "usr_omar" }]);
});

test("Enter with the picker open takes the first name and does not send", async () => {
  const s = createSamplePage();
  const root = await up(s, "comments");
  await write(root, "comment-field-new", "@Ma");
  await send(root, "comment-field-new");
  assert.equal(calls(s, "records.comments.add").length, 0, "nothing was sent");
  assert.ok(String((inField(root, "comment-field-new", "comment-reply-field").props as { value?: string }).value).startsWith("@Maya Chen"), "the first name was taken");
});

test("an @mentioned agent shows 'Intake is replying' until its answer lands under the comment, as a reply from the agent", async () => {
  const s = createSamplePage();
  const root = await up(s, "comments");
  await write(root, "comment-field-new", "What changed this week? @Int");
  await press(find(root, "row-mention-new-agt_intake"));
  await flush();
  await send(root, "comment-field-new");
  const made = calls(s, "records.comments.add")[0]!.input;
  assert.equal(made.text, "What changed this week? @Intake");
  assert.deepEqual(made.mentions, [{ kind: "agent", id: "agt_intake" }]);
  const rootId = (s.replica.rows("comments") as unknown as Comment[])[0]!.commentId;
  assert.equal(textOf(find(root, `replying-${rootId}`)), "Intake is replying");
  await act(async () => { s.agentReply(rootId, "agt_intake", "Two edits and a new file since Monday."); });
  await flush();
  assert.ok(!find(root, `replying-${rootId}`), "the quiet state clears");
  const thread = textOf(find(root, `thread-${rootId}`));
  assert.ok(thread.includes("Intake") && thread.includes("Two edits and a new file since Monday."), "the agent's reply sits under the comment, like a person's");
});

test("a comment you did not write has no Edit or Delete, and a thread with no resolved ones has no filter", async () => {
  const s = createSamplePage();
  const root = await up(s, "comments");
  await act(async () => { s.replica.put("comments", [{ id: "rcm_x", commentId: "rcm_x", type: "clients", recordId: "cl_0", text: "From Maya", by: "usr_maya", at: 5, resolved: false, mentions: [], replying: [] }] as never); });
  await flush();
  assert.ok(find(root, "comment-rcm_x") && !find(root, "more-rcm_x"), "no menu on someone else's comment");
  assert.ok(find(root, "resolve-rcm_x"), "anyone can resolve");
  assert.ok(!find(root, "filter-resolved"));
});

// ---------------------------------------------------------------- Chat and Files

test("the Chat tab is this record's own pane, drawn in place", async () => {
  const root = await up(createSamplePage(), "chat");
  assert.ok(find(root, "pane-chat") && textOf(find(root, "sample-chat")).includes("Ask pane for clients cl_0"));
  const none = createSamplePage();
  const bare = { ...none.data } as { renderChat?: unknown };
  delete bare.renderChat;
  const r2 = await up({ ...none, data: bare as never }, "chat");
  assert.ok(find(r2, "pane-chat-empty"));
});

test("Files: empty says so in one line; Attach stores files in the record's folder, they list, and a click opens the viewer", async () => {
  const s = createSamplePage();
  const root = await up(s, "files");
  assert.ok(find(root, "pane-files-empty"));
  assert.ok(!find(root, "open-files"), "no folder yet, nothing to open");
  const input = find(root, "attach-input")!;
  const file = { name: "Retainer.pdf", type: "application/pdf", arrayBuffer: async () => new ArrayBuffer(4) };
  await act(async () => { (input.props.onChange as (e: unknown) => void)({ target: { files: [file], value: "x" } }); });
  await flush();
  assert.deepEqual(s.attached.map((a) => a.name), ["Retainer.pdf"]);
  assert.ok(find(root, "row-file:fil_1") && textOf(root).includes("Retainer.pdf"), "the file lists");
  assert.ok(find(root, "open-files"), "and the folder can be opened");
  await press(find(root, "row-file:fil_1"));
  assert.deepEqual(s.opened.filter((o) => o.startsWith("file:")), ["file:fil_1"], "a click opens the file in the viewer");
});

test("dropping files on the Files tab attaches them", async () => {
  const s = createSamplePage();
  const root = await up(s, "files");
  const zone = find(root, "files-dropzone")!;
  const file = { name: "Notes.txt", type: "text/plain", arrayBuffer: async () => new ArrayBuffer(2) };
  let prevented = 0;
  await act(async () => { (zone.props.onDragOver as (e: unknown) => void)({ preventDefault: () => { prevented++; } }); });
  await act(async () => { (zone.props.onDrop as (e: unknown) => void)({ preventDefault: () => { prevented++; }, dataTransfer: { files: [file] } }); });
  await flush();
  assert.equal(prevented, 2);
  assert.deepEqual(s.attached.map((a) => a.name), ["Notes.txt"]);
});
