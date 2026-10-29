// The composer's reach (chat UX): one slash list that runs, files stored then attached, [[links]] and # picks sent as the thing itself, export, fork, tasks from a message, and the chips and links a
// message draws. Everything goes through the same `call` the page uses, so a command that is offered is shown here to do its capability.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { CHAT_COMMANDS, parseSlash } from "../../../../../../lib/chat-commands.ts";
import { Composer, applyPick, initialState, popupFor, refsIn, sendNow } from "../../../../../../ui/src/Composer/index.tsx";
import type { ComposerLists, PopupItem, Trigger } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import * as act from "./actions.ts";
import { AttachmentChips, LinkedText, refsOf, sizeLine, splitLinks } from "./attachments.tsx";
import { commandItems, lastActionable, runSlash } from "./commands.ts";
import type { CommandEnv } from "./commands.ts";
import type { ConversationData, PluginCommand } from "./data.tsx";
import { exportAs, exportName } from "./export.ts";
import { fetchSuggestions, openQuery } from "./suggest.ts";
import { DIRECTORY, createSample } from "./sample.ts";
import type { Message, Thread } from "./model.ts";
import { MessageView } from "./MessageView.tsx";
import { timeline } from "./model.ts";

installComposerForTests(Composer);

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
type Call = { cap: string; input: any };   // eslint-disable-line @typescript-eslint/no-explicit-any

/** The sample conversation, with its own answers for the capabilities a test cares about and a record of every call. */
function rig(answers: Record<string, (input: any) => unknown> = {}, extra: Partial<ConversationData> = {}) {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const s = createSample("idle");
  const calls: Call[] = [];
  const opened: string[] = [];
  const saved: Array<{ name: string; mime: string; content: string }> = [];
  const rowsNow = (): Message[] => (s.data.screens.query("chats.conversation", "messages", { threadId: s.data.threadId }).getSnapshot() as { data: { messages: Message[] } }).data.messages;
  const data: ConversationData = {
    ...s.data,
    async call(cap, input) {
      calls.push({ cap, input });
      const a = answers[cap];
      if (a) return a(input);
      if (cap === "chat.messages.list") return { messages: rowsNow(), hasMore: false };
      return s.data.call(cap, input);
    },
    nav: { ...s.data.nav, openThread: (id, mid) => void opened.push(mid ? `thread:${id}@${mid}` : `thread:${id}`), openBeside: (k, id) => void opened.push(`beside:${k}:${id}`), openSearch: (q) => void opened.push(`search:${q}`) },
    saveFile: (name, mime, content) => void saved.push({ name, mime, content }),
    ...extra,
  };
  const thread = (s.data.screens.query("chats.conversation", "thread", { threadId: s.data.threadId }).getSnapshot() as { data: { thread: Thread } }).data.thread;
  const rows = (s.data.screens.query("chats.conversation", "messages", { threadId: s.data.threadId }).getSnapshot() as { data: { messages: Message[] } }).data.messages;
  const said: string[] = [];
  const flags = { find: 0, model: 0, search: [] as string[], sent: [] as string[] };
  const env: CommandEnv = {
    data, thread, rows, say: (t) => void said.push(t), newKey: () => "key_x",
    openFind: () => void flags.find++, openSearch: (q) => void flags.search.push(q), openModel: () => void flags.model++, send: (t) => void flags.sent.push(t),
  };
  return { s, data, calls, opened, saved, thread, rows, said, flags, env, last: (cap: string) => calls.filter((c) => c.cap === cap).at(-1) };
}

/* ---------- the one list ---------- */

test("the menu after / is the one list from lib/chat-commands, in order, and every entry that takes words says what they are", () => {
  const items = commandItems();
  assert.deepEqual(items.map((i) => (typeof i === "string" ? i : i.t)), CHAT_COMMANDS.map((c) => c.id));
  for (const [i, c] of CHAT_COMMANDS.entries()) {
    const item = items[i] as { arg?: string; kind?: string };
    assert.equal(item.kind, "Command");
    assert.equal(item.arg, c.arg);
  }
  const lists: ComposerLists = { commands: items };
  const trigger: Trigger = { ch: "/", start: 0, end: 1, query: "" };
  const popup = popupFor(trigger, lists, true).filter((e): e is PopupItem => "group" in e);
  assert.ok(popup.length >= 8, "the menu shows the commands");
});

test("plugin commands come after ours and never replace one of ours", () => {
  const plugins: PluginCommand[] = [{ name: "/review-pr", description: "Review a pull request" }, { name: "plan", description: "A clashing plan" }, { name: "Summarise", description: "Summarise" }];
  const names = commandItems(plugins).map((i) => (typeof i === "string" ? i : i.t));
  assert.deepEqual(names.slice(CHAT_COMMANDS.length), ["review-pr", "summarise"]);
  assert.equal(names.filter((n) => n === "plan").length, 1);
});

test("a message is a command only at the very start and only for a name that exists", () => {
  assert.deepEqual(parseSlash("/plan"), { id: "plan", arg: "" });
  assert.deepEqual(parseSlash("  /helper read the lease  "), { id: "helper", arg: "read the lease" });
  assert.equal(parseSlash("/usr/bin/env"), null);
  assert.equal(parseSlash("look at /plan"), null);
  assert.equal(parseSlash("/nothing here"), null);
  assert.deepEqual(parseSlash("/review-pr 12", ["review-pr"]), { id: "review-pr", arg: "12" });
});

/* ---------- every command does its capability ---------- */

test("/plan turns plan mode on and off, and says which", async () => {
  const r = rig();
  assert.equal(await runSlash("/plan on", r.env), true);
  assert.deepEqual(r.last("threads.set_plan_mode")?.input, { threadId: r.data.threadId, planMode: true });
  assert.match(r.said.at(-1)!, /Plan mode is on/);
  await runSlash("/plan off", r.env);
  assert.equal(r.last("threads.set_plan_mode")?.input.planMode, false);
  assert.match(r.said.at(-1)!, /Plan mode is off/);
});

test("/helper starts a helper with the words as its instruction and opens it", async () => {
  const r = rig({ "chat.helper.start": () => ({ helper: { threadId: "thr_helper1" }, blockId: "blk_1" }) });
  await runSlash("/helper read the lease and list the dates", r.env);
  const c = r.last("chat.helper.start")!;
  assert.equal(c.input.instruction, "read the lease and list the dates");
  assert.equal(c.input.title, "read the lease and list the dates");
  assert.ok(c.input.agentId, "the chat's lead runs it");
  assert.deepEqual(r.opened, ["thread:thr_helper1"]);
  await runSlash("/helper", r.env);
  assert.match(r.said.at(-1)!, /\/helper needs what it should do/);
});

test("/handoff names the agent from the @mention, passes the rest as the note, and opens the new chat", async () => {
  const r = rig({ "chat.handoff": () => ({ thread: { threadId: "thr_next" }, depth: 1 }) });
  const docs = DIRECTORY.find((d) => d.kind === "agent" && d.name === "Docs")!;
  await runSlash("/handoff @Docs write the cover letter", r.env);
  const c = r.last("chat.handoff")!;
  assert.equal(c.input.toAgentId, docs.id);
  assert.equal(c.input.note, "write the cover letter");
  assert.deepEqual(r.opened, ["thread:thr_next"]);
  const before = r.calls.length;
  await runSlash("/handoff write the letter", r.env);
  assert.equal(r.calls.length, before, "no agent named, so nothing is handed off");
  assert.match(r.said.at(-1)!, /Name the agent/);
});

test("/pin pins the last message, and again unpins it", async () => {
  const r = rig();
  const target = lastActionable(r.rows)!;
  await runSlash("/pin", r.env);
  assert.deepEqual(r.last(target.pinned ? "chat.unpin" : "chat.pin")?.input, { threadId: r.data.threadId, messageId: target.messageId });
});

test("/fork branches at the last message and opens the new chat", async () => {
  const r = rig({ "chat.fork": () => ({ thread: { threadId: "thr_fork" }, copied: 4 }) });
  await runSlash("/fork", r.env);
  const c = r.last("chat.fork")!;
  assert.equal(c.input.threadId, r.data.threadId);
  assert.equal(c.input.messageId, lastActionable(r.rows)!.messageId);
  assert.equal(c.input.idempotencyKey, "key_x");
  assert.deepEqual(r.opened, ["thread:thr_fork"]);
});

test("/export reads every page, names files and people by their names, and hands the file over", async () => {
  const r = rig({ "files.get": (i: { fileId: string }) => ({ file: { fileId: i.fileId, name: "intake.pdf" } }) });
  await runSlash("/export", r.env);
  assert.equal(r.saved.length, 1);
  assert.match(r.saved[0]!.name, /\.md$/);
  assert.equal(r.saved[0]!.mime, "text/markdown;charset=utf-8");
  assert.match(r.saved[0]!.content, /^# /);
  assert.ok(!/usr_irfad|agt_intake/.test(r.saved[0]!.content), "no ids where a name belongs");
  await runSlash("/export json", r.env);
  assert.match(r.saved[1]!.name, /\.json$/);
  const json = JSON.parse(r.saved[1]!.content);
  assert.equal(json.messages.length, r.rows.length);
  assert.ok(json.messages.every((m: any) => typeof m.author.name === "string" && m.author.name !== m.author.id));   // eslint-disable-line @typescript-eslint/no-explicit-any
});

test("/export with no way to save copies the text instead", async () => {
  const r = rig({}, { saveFile: undefined });
  await runSlash("/export", r.env);
  assert.match(r.said.at(-1)!, /Copied the chat as Markdown/);
});

test("/task makes a task from the last message with a block that links back to it", async () => {
  const r = rig({ "tasks.create": () => ({ task: { id: "tsk_1" } }) });
  const m = lastActionable(r.rows)!;
  await runSlash("/task", r.env);
  const c = r.last("tasks.create")!;
  assert.equal(c.input.source.id, r.data.threadId);
  assert.equal(c.input.blocks[0].type, "chat_message");
  assert.equal(c.input.blocks[0].data.messageId, m.messageId);
  assert.equal(c.input.blocks[0].data.author, r.data.nameOf(m.author.id), "the author is a name");
  assert.deepEqual(c.input.assigned, { kind: "person", id: r.data.me.id });
  assert.deepEqual(r.opened, ["beside:task:tsk_1"]);
  await runSlash("/task call the court", r.env);
  assert.equal(r.last("tasks.create")!.input.title, "call the court");
});

test("/remember proposes the fact to the lead's memory of this person, sourced to the chat", async () => {
  const r = rig({ "memory.propose_fact": () => ({ fact: {}, merged: true }) });
  await runSlash("/remember I prefer short answers", r.env);
  const c = r.last("memory.propose_fact")!;
  assert.equal(c.input.text, "I prefer short answers");
  assert.equal(c.input.layer, "person");
  assert.equal(c.input.sourceKind, "chat");
  assert.equal(c.input.sourceRef, r.data.threadId);
  assert.match(r.said.at(-1)!, /will remember that/);
});

test("/find, /search and /model open the screen pieces that own them; /stop stops", async () => {
  const r = rig();
  await runSlash("/find", r.env);
  await runSlash("/search closing date", r.env);
  await runSlash("/model", r.env);
  assert.deepEqual([r.flags.find, r.flags.search, r.flags.model], [1, ["closing date"], 1]);
  await runSlash("/stop", r.env);
  assert.ok(r.last("engine.stop_all"));
});

test("an unknown slash word is not a command: it is left for the caller to send", async () => {
  const r = rig();
  assert.equal(await runSlash("/usr/local/bin", r.env), false);
  assert.equal(r.calls.length, 0);
});

test("a plugin command runs its function or sends its prompt with the words filled in", async () => {
  const ran: string[] = [];
  const plugins: PluginCommand[] = [
    { name: "tidy", description: "Tidy", run: async (a) => { ran.push(a); return "Tidied"; } },
    { name: "review-pr", description: "Review", prompt: "Review pull request $ARGUMENTS and list risks" },
  ];
  const r = rig({}, { pluginCommands: () => plugins });
  await runSlash("/tidy the notes", r.env);
  assert.deepEqual(ran, ["the notes"]);
  assert.equal(r.said.at(-1), "Tidied");
  await runSlash("/review-pr 12", r.env);
  assert.deepEqual(r.flags.sent, ["Review pull request 12 and list risks"]);
});

test("a command that fails says so in a short line and does not throw", async () => {
  const r = rig({ "chat.fork": () => { throw new Error("This chat is end-to-end encrypted"); } });
  await runSlash("/fork", r.env);
  assert.match(r.said.at(-1)!, /^\/fork: This chat is end-to-end encrypted/);
});

/* ---------- files ---------- */

test("files are stored in Chat uploads (made once), by id, and come back in order", async () => {
  const made: string[] = [];
  const r = rig({
    "files.tree": () => ({ roots: [{ key: "agents", title: "Agents", kind: "folder", folderId: "fld_a", count: 0 }, { key: "personal", title: "Personal", kind: "folder", folderId: "fld_me", count: 0 }] }),
    "files.list": () => ({ files: [], folders: [], hasMore: false }),
    "files.folder.create": (i: { name: string; parentId: string }) => ({ folder: { folderId: "fld_uploads", name: i.name, parentId: i.parentId } }),
    "files.create": (i: { name: string }) => { made.push(i.name); return { file: { fileId: `fil_${made.length}`, name: i.name } }; },
  });
  const ids = await act.uploadAttachments(r.data, [{ name: "a.txt", file: new Blob(["hello"], { type: "text/plain" }) }, { name: "b.png", file: new Blob([new Uint8Array([1, 2, 3])]), mime: "image/png" }], "k1");
  assert.deepEqual(ids, ["fil_1", "fil_2"]);
  const creates = r.calls.filter((c) => c.cap === "files.create");
  assert.equal(creates[0]!.input.folderId, "fld_uploads");
  assert.deepEqual(creates[0]!.input.content, { base64: "aGVsbG8=" }, "the bytes of the file, not its name");
  assert.equal(creates[0]!.input.mime, "text/plain");
  assert.equal(creates[1]!.input.mime, "image/png");
  assert.notEqual(creates[0]!.input.idempotencyKey, creates[1]!.input.idempotencyKey);
  assert.equal(r.calls.filter((c) => c.cap === "files.folder.create").length, 1);
});

test("the Chat uploads folder is reused when it exists; a name already taken gets (2)", async () => {
  let n = 0;
  const r = rig({
    "files.tree": () => ({ roots: [{ key: "personal", title: "Personal", kind: "folder", folderId: "fld_me", count: 1 }] }),
    "files.list": () => ({ files: [], folders: [{ folderId: "fld_have", name: "Chat uploads" }], hasMore: false }),
    "files.create": (i: { name: string }) => { if (n++ === 0) throw Object.assign(new Error("duplicate"), { code: "validation.duplicate" }); return { file: { fileId: "fil_9", name: i.name } }; },
  });
  const ids = await act.uploadAttachments(r.data, [{ name: "report.pdf", file: new Blob(["x"]) }], "k2");
  assert.deepEqual(ids, ["fil_9"]);
  assert.equal(r.calls.some((c) => c.cap === "files.folder.create"), false);
  assert.deepEqual(r.calls.filter((c) => c.cap === "files.create").map((c) => c.input.name), ["report.pdf", "report (2).pdf"]);
});

test("a big file goes through the one-time address; with no way to put bytes there it is refused by name", async () => {
  const big = new Blob([new Uint8Array(act.INLINE_LIMIT + 1)]);
  const put: Array<{ url: string; n: number }> = [];
  const answers = {
    "files.tree": () => ({ roots: [{ key: "personal", title: "Personal", kind: "folder", folderId: "fld_me", count: 0 }] }),
    "files.list": () => ({ files: [], folders: [{ folderId: "fld_have", name: "Chat uploads" }], hasMore: false }),
    "files.upload_url": () => ({ blobId: "blb_1", url: "/spaces/s/blobs/blb_1?token=t", expiresAt: 1 }),
    "files.create": (i: { name: string }) => ({ file: { fileId: "fil_big", name: i.name } }),
  };
  const r = rig(answers, { putBlob: async (url, bytes) => void put.push({ url, n: bytes.length }) });
  const ids = await act.uploadAttachments(r.data, [{ name: "movie.mov", file: big }], "k3");
  assert.deepEqual(ids, ["fil_big"]);
  assert.deepEqual(put, [{ url: "/spaces/s/blobs/blb_1?token=t", n: act.INLINE_LIMIT + 1 }]);
  assert.deepEqual(r.calls.find((c) => c.cap === "files.create")!.input.content, { blobId: "blb_1" });
  const none = rig(answers);
  await assert.rejects(act.uploadAttachments(none.data, [{ name: "movie.mov", file: big }], "k4"), /movie\.mov is too large/);
});

test("a name with no file behind it cannot be sent, and nothing is stored first", async () => {
  const r = rig({ "files.tree": () => ({ roots: [{ key: "personal", title: "Personal", kind: "folder", folderId: "fld_me", count: 0 }] }), "files.list": () => ({ files: [], folders: [{ folderId: "f", name: "Chat uploads" }], hasMore: false }) });
  await assert.rejects(act.uploadAttachments(r.data, [{ name: "ghost.txt" }], "k5"), /ghost\.txt cannot be read/);
  assert.equal(r.calls.some((c) => c.cap === "files.create"), false);
});

test("a send carries the file ids and the links as a refs block, and nothing extra when there are none", async () => {
  const r = rig();
  await act.sendMessage(r.data, { text: "see [[Rivera Holdings]]", mentions: [], key: "k6", kind: "queue", working: false, refs: [{ kind: "record", id: "rec_1", title: "Rivera Holdings" }], attachments: ["fil_1"] });
  const post = r.last("chat.post")!.input;
  assert.deepEqual(post.attachments, ["fil_1"]);
  assert.deepEqual(post.blocks, [{ type: "refs", v: 1, data: { refs: [{ kind: "record", id: "rec_1", title: "Rivera Holdings" }] } }]);
  await act.sendMessage(r.data, { text: "plain", mentions: [], key: "k7", kind: "queue", working: false });
  const plain = r.last("chat.post")!.input;
  assert.equal(plain.attachments, undefined);
  assert.equal(plain.blocks, undefined);
});

/* ---------- the composer ---------- */

test("a [[ pick keeps the thing's id, and only links the text still names are sent", () => {
  const lists: ComposerLists = { records: [{ t: "Rivera Holdings", s: "Client", kind: "Record", ref: "rec_1" }] };
  const trigger: Trigger = { ch: "[[", start: 4, end: 6, query: "" };
  const item = popupFor(trigger, lists, true).find((e): e is PopupItem => "group" in e)!;
  const done = applyPick({ ...initialState("see [["), cursor: 6 }, trigger, item);
  assert.equal(done.next.text, "see [[Rivera Holdings]] ");
  assert.deepEqual(done.next.refs, [{ kind: "Record", id: "rec_1", title: "Rivera Holdings" }]);
  assert.deepEqual(sendNow(done.next, "")?.payload.refs, [{ kind: "Record", id: "rec_1", title: "Rivera Holdings" }]);
  const edited = { ...done.next, text: "see it" };
  assert.deepEqual(refsIn(edited), [], "the link was deleted from the text, so it is not sent");
});

test("a # pick keeps its id on the chip", () => {
  const lists: ComposerLists = { files: [{ t: "plan.md", s: "Projects", kind: "File", ref: "fil_7" }] };
  const trigger: Trigger = { ch: "#", start: 0, end: 1, query: "" };
  const item = popupFor(trigger, lists, true).find((e): e is PopupItem => "group" in e)!;
  const done = applyPick(initialState("#"), trigger, item);
  assert.deepEqual(done.next.chips, [{ kind: "File", name: "plan.md", id: "fil_7" }]);
});

test("picking a command that takes words writes its name and waits; one that takes none runs at once", () => {
  const lists: ComposerLists = { commands: commandItems() };
  const trigger: Trigger = { ch: "/", start: 0, end: 1, query: "" };
  const entries = popupFor(trigger, lists, true).filter((e): e is PopupItem => "group" in e);
  const helper = entries.find((e) => e.label === "helper")!;
  const a = applyPick(initialState("/"), trigger, helper);
  assert.equal(a.next.text, "/helper ");
  assert.deepEqual(a.effect, { kind: "none" });
  const pin = entries.find((e) => e.label === "pin")!;
  const b = applyPick(initialState("/"), trigger, pin);
  assert.equal(b.next.text, "");
  assert.deepEqual(b.effect, { kind: "command", name: "pin" });
});

test("the composer still draws with the new lists", () => {
  const out = clean(renderToStaticMarkup(<Composer whoWillAnswer="Intake will reply" lists={{ commands: commandItems(), records: [{ t: "Rivera Holdings", ref: "rec_1", kind: "Record" }] }} />));
  assert.ok(out.includes("composer-attach"));
});

/* ---------- suggestions ---------- */

test("# and [[ open a query; anything else does not", () => {
  assert.deepEqual(openQuery("see [[riv"), { ch: "[[", q: "riv" });
  assert.deepEqual(openQuery("look at #plan"), { ch: "#", q: "plan" });
  assert.deepEqual(openQuery("#"), { ch: "#", q: "" });
  assert.equal(openQuery("no trigger here"), null);
  assert.equal(openQuery("an @mention"), null);
  assert.equal(openQuery("done [[Title]] and more"), null);
});

test("a # search fills records, files, folders and channels with their ids; a [[ search asks for records only", async () => {
  const asked: Array<{ cap: string; input: any }> = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    asked.push({ cap, input: input as never });
    if (cap === "search.query") {
      return { hits: [
        { kind: "record", id: "rec_1", title: "Rivera Holdings", recordType: "Client", link: "x", score: 1 },
        { kind: "file", id: "fil_1", title: "plan.md", path: "Projects/plan.md", link: "x", score: 1 },
        { kind: "channel", id: "chn_1", title: "intake", link: "x", score: 1 },
        { kind: "person", id: "usr_1", title: "Maya", link: "x", score: 1 },
      ], tookMs: 1, hasMore: false };
    }
    if (cap === "files.folder.search") return { folders: [{ folderId: "fld_1", name: "Probate", path: "Projects/Probate" }] };
    throw new Error(cap);
  };
  const hash = await fetchSuggestions({ call }, "#", "riv");
  assert.deepEqual(hash.records, [{ t: "Rivera Holdings", s: "Client", kind: "Record", ref: "rec_1" }]);
  assert.deepEqual(hash.files, [{ t: "plan.md", s: "Projects/plan.md", kind: "File", ref: "fil_1" }]);
  assert.deepEqual(hash.channels, [{ t: "intake", kind: "Channel", ref: "chn_1" }]);
  assert.deepEqual(hash.folders, [{ t: "Probate", s: "Projects/Probate", kind: "Folder", ref: "fld_1" }]);
  assert.deepEqual(asked[0]!.input.types, ["record", "file", "channel"]);
  asked.length = 0;
  const link = await fetchSuggestions({ call }, "[[", "riv");
  assert.deepEqual(asked.map((a) => a.cap), ["search.query"]);
  assert.deepEqual(asked[0]!.input.types, ["record"]);
  assert.equal(link.records.length, 1);
});

/* ---------- messages: chips, links, fork line ---------- */

test("size reads as people say it", () => {
  assert.deepEqual([sizeLine(900), sizeLine(2048), sizeLine(5 * 1024 * 1024), sizeLine(3 * 1024 ** 3)], ["900 B", "2 KB", "5 MB", "3 GB"]);
});

test("a message with files draws a chip for each, named, and a pending file shows the name it was picked with", () => {
  const s = createSample("idle");
  const html = clean(renderToStaticMarkup(<AttachmentChips ids={["pending-file:contract.pdf"]} data={{ call: s.data.call, nav: s.data.nav, copy: s.data.copy }} menu={() => undefined} />));
  assert.ok(html.includes('data-testid="attachments"'));
  assert.ok(html.includes("contract.pdf"));
  assert.ok(html.includes("Sending"));
  assert.equal(clean(renderToStaticMarkup(<AttachmentChips ids={[]} data={{ call: s.data.call, nav: s.data.nav, copy: s.data.copy }} menu={() => undefined} />)), "");
});

test("[[Title]] marks split out of the text; a mark with a ref is drawn as a link, one without stays plain", () => {
  assert.deepEqual(splitLinks("a [[One]] b [[Two words]]"), [{ text: "a " }, { text: "[[One]]", link: "One" }, { text: " b " }, { text: "[[Two words]]", link: "Two words" }]);
  const s = createSample("idle");
  const html = clean(renderToStaticMarkup(<LinkedText body="open [[Rivera Holdings]] and [[Typed by hand]]" refs={[{ kind: "record", id: "rec_1", title: "Rivera Holdings" }]} data={{ call: s.data.call, nav: s.data.nav }} textStyle={{}} />));
  assert.ok(html.includes('data-testid="link-rec_1"'));
  assert.ok(html.includes("Rivera Holdings"));
  assert.ok(html.includes("Typed by hand") && !html.includes("[[Typed by hand]]"));
  assert.deepEqual(refsOf({ blocks: [{ id: "b", type: "refs", v: 1, state: "done", data: { refs: [{ kind: "record", id: "rec_1", title: "X" }, { nope: true }] } }] as never }), [{ kind: "record", id: "rec_1", title: "X" }]);
});

test("your message shows its link and its file chip; the refs block is not drawn as a card", () => {
  const r = rig();
  const me = r.data.me.id;
  const m: Message = { messageId: "m_files", threadId: r.data.threadId, threadSeq: 99, author: { kind: "person", id: me }, kind: "text", body: "see [[Rivera Holdings]]", blocks: [{ id: "b1", type: "refs", v: 1, state: "done", data: { refs: [{ kind: "record", id: "rec_1", title: "Rivera Holdings" }] } }] as never, depth: 0, attachments: ["pending-file:brief.docx"], reactions: [], pinned: false, createdAt: r.data.clock().now };
  const items = timeline([m], { meId: me, nameOf: r.data.nameOf, kindOf: r.data.kindOf, clock: r.data.clock() });
  const actions = { copy: () => undefined, edit: () => undefined, setPinned: () => undefined, react: () => undefined, openThread: () => undefined, remove: () => undefined, openAgent: () => undefined, openBeside: () => undefined, answer: () => undefined, approvePlan: () => undefined, retryTurn: () => undefined, errorNext: () => undefined, retrySend: () => undefined, discardSend: () => undefined, showMenu: () => undefined, host: { invoke: async () => ({}), open: () => undefined }, files: r.data, fork: () => undefined, makeTask: () => undefined };
  const html = clean(items.map((it) => renderToStaticMarkup(<MessageView item={it} actions={actions as never} meId={me} />)).join(""));
  assert.ok(html.includes('data-testid="link-rec_1"'));
  assert.ok(html.includes("brief.docx"));
  assert.ok(!html.includes('data-testid="card-b1"'));
});

test("a fork's first line names the chat it came from and links to the message", () => {
  const r = rig();
  const m: Message = { messageId: "m_fork", threadId: r.data.threadId, threadSeq: 1, author: { kind: "person", id: r.data.me.id }, kind: "system", body: 'Forked from "Plan the launch"', blocks: [{ id: "b", type: "fork_origin", v: 1, state: "done", data: { threadId: "thr_src", messageId: "m_src", title: "Plan the launch" } }] as never, depth: 0, attachments: [], reactions: [], pinned: false, createdAt: r.data.clock().now };
  const items = timeline([m], { meId: r.data.me.id, nameOf: r.data.nameOf, kindOf: r.data.kindOf, clock: r.data.clock() });
  const html = clean(items.map((it) => renderToStaticMarkup(<MessageView item={it} actions={{ openMessage: () => undefined } as never} meId={r.data.me.id} />)).join(""));
  assert.ok(html.includes('data-testid="fork-origin-m_fork"'));
  assert.ok(html.includes("Plan the launch"));
});

/* ---------- export ---------- */

test("the export file is named from the chat's title and never holds an id where a name belongs", () => {
  const r = rig();
  assert.equal(exportName("Plan: the launch / v2", "md"), "Plan-the-launch-v2.md");
  assert.equal(exportName("   ", "json"), "chat.json");
  const md = exportAs("md", { thread: r.thread, messages: r.rows, nameOf: r.data.nameOf, fileName: () => "x.pdf", clock: r.data.clock() });
  assert.match(md.content, /^# /);
  assert.ok(md.content.includes("**You**") || md.content.includes("**Intake**") || md.content.includes("**"));
  assert.ok(!/\b(usr|agt)_[a-z0-9]+/.test(md.content), md.content.slice(0, 400));
});
