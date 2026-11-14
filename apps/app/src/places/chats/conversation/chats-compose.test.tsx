// The composer's reach (chat UX): one slash list that runs, files stored then attached, [[links]] and # picks sent as the thing itself, export, fork, tasks from a message, and the chips and links a
// message draws. Everything goes through the same `call` the page uses, so a command that is offered is shown here to do its capability.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { CHAT_COMMANDS, parseSlash } from "../../../../../../lib/chat-commands.ts";
import {
  Composer,
  applyPick,
  initialState,
  popupFor,
  refsIn,
  sendNow,
} from "../../../../../../ui/src/Composer/index.tsx";
import type { ComposerLists, PopupItem, Trigger } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import * as act from "./actions.ts";
import { AttachmentChips, LinkedText, refsOf, sizeLine, splitLinks } from "./attachments.tsx";
import { commandItems, lastActionable, runSlash } from "./commands.ts";
import type { CommandEnv } from "./commands.ts";
import { COMMAND_KINDS, accountName, cardLines, paidWords, unclassified } from "./command-result.ts";
import type { CommandResult } from "./command-result.ts";
import type { ConversationData, PluginCommand } from "./data.tsx";
import { exportAs, exportName } from "./export.ts";
import { fetchSuggestions, openQuery } from "./suggest.ts";
import { DIRECTORY, createSample } from "./sample.ts";
import type { Message, Thread } from "./model.ts";
import { HoverBar, MessageView, menuFor } from "./MessageView.tsx";
import { timeline } from "./model.ts";

installComposerForTests(Composer);

const clean = (s: string): string =>
  s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
type Call = { cap: string; input: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The sample conversation, with its own answers for the capabilities a test cares about and a record of every call. */
function rig(answers: Record<string, (input: any) => unknown> = {}, extra: Partial<ConversationData> = {}) {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  const s = createSample("idle");
  const calls: Call[] = [];
  const opened: string[] = [];
  const saved: Array<{ name: string; mime: string; content: string }> = [];
  const rowsNow = (): Message[] =>
    (
      s.data.screens.query("chats.conversation", "messages", { threadId: s.data.threadId }).getSnapshot() as {
        data: { messages: Message[] };
      }
    ).data.messages;
  const data: ConversationData = {
    ...s.data,
    async call(cap, input) {
      calls.push({ cap, input });
      const a = answers[cap];
      if (a) return a(input);
      if (cap === "chat.messages.list") return { messages: rowsNow(), hasMore: false };
      return s.data.call(cap, input);
    },
    nav: {
      ...s.data.nav,
      openThread: (id, mid) => void opened.push(mid ? `thread:${id}@${mid}` : `thread:${id}`),
      openBeside: (k, id) => void opened.push(`beside:${k}:${id}`),
      openSearch: (q) => void opened.push(`search:${q}`),
    },
    saveFile: (name, mime, content) => void saved.push({ name, mime, content }),
    ...extra,
  };
  const thread = (
    s.data.screens.query("chats.conversation", "thread", { threadId: s.data.threadId }).getSnapshot() as {
      data: { thread: Thread };
    }
  ).data.thread;
  const rows = (
    s.data.screens.query("chats.conversation", "messages", { threadId: s.data.threadId }).getSnapshot() as {
      data: { messages: Message[] };
    }
  ).data.messages;
  const said: string[] = [];
  const results: CommandResult[] = [];
  const flags = { find: 0, model: 0, search: [] as string[], sent: [] as string[] };
  const env: CommandEnv = {
    data,
    thread,
    rows,
    show: (r) => {
      results.push(r);
      if (r.kind === "notice") said.push(r.text);
      else if (r.kind === "menu") flags.model++;
    },
    newKey: () => "key_x",
    openFind: () => void flags.find++,
    openSearch: (q) => void flags.search.push(q),
    send: (t) => void flags.sent.push(t),
    openPane: (tab) => void opened.push(`pane:${tab}`),
  };
  return {
    s,
    data,
    calls,
    opened,
    saved,
    thread,
    rows,
    said,
    results,
    flags,
    env,
    last: (cap: string) => calls.filter((c) => c.cap === cap).at(-1),
  };
}

/* ---------- the one list ---------- */

test("the menu after / is the one list from lib/chat-commands, in order, and every entry that takes words says what they are", () => {
  const items = commandItems();
  assert.deepEqual(
    items.map((i) => (typeof i === "string" ? i : i.t)),
    CHAT_COMMANDS.map((c) => c.id),
  );
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
  const plugins: PluginCommand[] = [
    { name: "/review-pr", description: "Review a pull request" },
    { name: "plan", description: "A clashing plan" },
    { name: "Summarise", description: "Summarise" },
  ];
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
  assert.deepEqual(r.last(target.pinned ? "chat.unpin" : "chat.pin")?.input, {
    threadId: r.data.threadId,
    messageId: target.messageId,
  });
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
  assert.ok(json.messages.every((m: any) => typeof m.author.name === "string" && m.author.name !== m.author.id)); // eslint-disable-line @typescript-eslint/no-explicit-any
});

test("/export with no way to save copies the text instead", async () => {
  const r = rig({}, { saveFile: undefined });
  await runSlash("/export", r.env);
  assert.match(r.said.at(-1)!, /Copied the chat as Markdown/);
});

test("/task makes a task from the last message through chat.make_task: the server points it back at the message and leaves the card", async () => {
  const r = rig({ "chat.make_task": () => ({ taskId: "tsk_1", messageId: "m" }) });
  const m = lastActionable(r.rows)!;
  await runSlash("/task", r.env);
  const c = r.last("chat.make_task")!;
  assert.equal(c.input.threadId, r.data.threadId);
  assert.equal(c.input.messageId, m.messageId);
  assert.equal(c.input.assigneeId, undefined, "nobody is @named: the task is the asker's, which the server decides");
  assert.deepEqual(r.opened, ["beside:task:tsk_1"]);
  await runSlash("/task call the court", r.env);
  assert.equal(r.last("chat.make_task")!.input.title, "call the court");
});

test("a message that @names a person hands the task to them; a name that is not in the chat's directory does not", async () => {
  const r = rig({ "chat.make_task": () => ({ taskId: "tsk_2", messageId: "m" }) });
  const { makeTask } = await import("./actions.ts");
  const thread = (
    r.data.screens.query("chats.conversation", "thread", { threadId: r.data.threadId }).getSnapshot() as {
      data: { thread: never };
    }
  ).data.thread;
  const msg = {
    messageId: "msg_x",
    body: "@Maya please send the Rivera letter",
    author: { kind: "person" as const, id: "usr_omar" },
    createdAt: 1,
  };
  await makeTask(r.data, thread, msg, "k1");
  assert.equal(r.last("chat.make_task")!.input.assigneeId, "usr_maya");
  await makeTask(r.data, thread, { ...msg, body: "@Nobody please send it" }, "k2");
  assert.equal(r.last("chat.make_task")!.input.assigneeId, undefined);
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
    {
      name: "tidy",
      description: "Tidy",
      run: async (a) => {
        ran.push(a);
        return "Tidied";
      },
    },
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
  const r = rig({
    "chat.fork": () => {
      throw new Error("This chat is end-to-end encrypted");
    },
  });
  await runSlash("/fork", r.env);
  assert.match(r.said.at(-1)!, /^\/fork: This chat is end-to-end encrypted/);
});

/* ---------- files ---------- */

test("files are stored in Chat uploads (made once), by id, and come back in order", async () => {
  const made: string[] = [];
  const r = rig({
    "files.tree": () => ({
      roots: [
        { key: "agents", title: "Agents", kind: "folder", folderId: "fld_a", count: 0 },
        { key: "personal", title: "Personal", kind: "folder", folderId: "fld_me", count: 0 },
      ],
    }),
    "files.list": () => ({ files: [], folders: [], hasMore: false }),
    "files.folder.create": (i: { name: string; parentId: string }) => ({
      folder: { folderId: "fld_uploads", name: i.name, parentId: i.parentId },
    }),
    "files.create": (i: { name: string }) => {
      made.push(i.name);
      return { file: { fileId: `fil_${made.length}`, name: i.name } };
    },
  });
  const ids = await act.uploadAttachments(
    r.data,
    [
      { name: "a.txt", file: new Blob(["hello"], { type: "text/plain" }) },
      { name: "b.png", file: new Blob([new Uint8Array([1, 2, 3])]), mime: "image/png" },
    ],
    "k1",
  );
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
    "files.tree": () => ({
      roots: [{ key: "personal", title: "Personal", kind: "folder", folderId: "fld_me", count: 1 }],
    }),
    "files.list": () => ({ files: [], folders: [{ folderId: "fld_have", name: "Chat uploads" }], hasMore: false }),
    "files.create": (i: { name: string }) => {
      if (n++ === 0) throw Object.assign(new Error("duplicate"), { code: "validation.duplicate" });
      return { file: { fileId: "fil_9", name: i.name } };
    },
  });
  const ids = await act.uploadAttachments(r.data, [{ name: "report.pdf", file: new Blob(["x"]) }], "k2");
  assert.deepEqual(ids, ["fil_9"]);
  assert.equal(
    r.calls.some((c) => c.cap === "files.folder.create"),
    false,
  );
  assert.deepEqual(
    r.calls.filter((c) => c.cap === "files.create").map((c) => c.input.name),
    ["report.pdf", "report (2).pdf"],
  );
});

test("a big file goes through the one-time address; with no way to put bytes there it is refused by name", async () => {
  const big = new Blob([new Uint8Array(act.INLINE_LIMIT + 1)]);
  const put: Array<{ url: string; n: number }> = [];
  const answers = {
    "files.tree": () => ({
      roots: [{ key: "personal", title: "Personal", kind: "folder", folderId: "fld_me", count: 0 }],
    }),
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
  await assert.rejects(
    act.uploadAttachments(none.data, [{ name: "movie.mov", file: big }], "k4"),
    /movie\.mov is too large/,
  );
});

test("a name with no file behind it cannot be sent, and nothing is stored first", async () => {
  const r = rig({
    "files.tree": () => ({
      roots: [{ key: "personal", title: "Personal", kind: "folder", folderId: "fld_me", count: 0 }],
    }),
    "files.list": () => ({ files: [], folders: [{ folderId: "f", name: "Chat uploads" }], hasMore: false }),
  });
  await assert.rejects(act.uploadAttachments(r.data, [{ name: "ghost.txt" }], "k5"), /ghost\.txt cannot be read/);
  assert.equal(
    r.calls.some((c) => c.cap === "files.create"),
    false,
  );
});

test("a send carries the file ids and the links as a refs block, and nothing extra when there are none", async () => {
  const r = rig();
  await act.sendMessage(r.data, {
    text: "see [[Rivera Holdings]]",
    mentions: [],
    key: "k6",
    kind: "queue",
    working: false,
    refs: [{ kind: "record", id: "rec_1", title: "Rivera Holdings" }],
    attachments: ["fil_1"],
  });
  const post = r.last("chat.post")!.input;
  assert.deepEqual(post.attachments, ["fil_1"]);
  assert.deepEqual(post.blocks, [
    { type: "refs", v: 1, data: { refs: [{ kind: "record", id: "rec_1", title: "Rivera Holdings" }] } },
  ]);
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

test("a # pick keeps its id on the inline token it writes, and sends it while the text holds it", () => {
  const lists: ComposerLists = { files: [{ t: "plan.md", s: "Projects", kind: "File", ref: "fil_7" }] };
  const trigger: Trigger = { ch: "#", start: 0, end: 1, query: "" };
  const item = popupFor(trigger, lists, true).find((e): e is PopupItem => "group" in e)!;
  const done = applyPick(initialState("#"), trigger, item);
  assert.equal(done.next.text, "#plan.md ");
  assert.deepEqual(done.next.refs, [{ kind: "File", id: "fil_7", title: "plan.md", token: "#" }]);
  assert.deepEqual(sendNow(done.next, "")?.payload.refs, [{ kind: "File", id: "fil_7", title: "plan.md", token: "#" }]);
  assert.deepEqual(refsIn({ ...done.next, text: "never mind" }), [], "the token was deleted, so it is not sent");
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
  const out = clean(
    renderToStaticMarkup(
      <Composer
        whoWillAnswer="Intake will reply"
        lists={{ commands: commandItems(), records: [{ t: "Rivera Holdings", ref: "rec_1", kind: "Record" }] }}
      />,
    ),
  );
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

test("a # search fills records, files, folders, channels, chats, automations and projects with their ids; a [[ search asks for records only", async () => {
  const asked: Array<{ cap: string; input: any }> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    asked.push({ cap, input: input as never });
    if (cap === "search.query") {
      return {
        hits: [
          { kind: "record", id: "rec_1", title: "Rivera Holdings", recordType: "Client", link: "x", score: 1 },
          { kind: "file", id: "fil_1", title: "plan.md", path: "Projects/plan.md", link: "x", score: 1 },
          { kind: "channel", id: "chn_1", title: "intake", link: "x", score: 1 },
          { kind: "person", id: "usr_1", title: "Maya", link: "x", score: 1 },
          { kind: "chat", id: "thr_9", title: "Rivera kickoff", snippet: "2 days ago", link: "x", score: 1 },
          { kind: "automation", id: "aut_1", title: "Rivera reminders", link: "x", score: 1 },
        ],
        tookMs: 1,
        hasMore: false,
      };
    }
    if (cap === "files.folder.search")
      return { folders: [{ folderId: "fld_1", name: "Probate", path: "Projects/Probate" }] };
    if (cap === "projects.list")
      return {
        projects: [
          {
            projectId: "prj_1",
            recordId: "rec_p",
            type: "project",
            title: "Rivera filing",
            status: "active",
            channelId: "chn_p",
            folderId: "fld_p",
            memberCount: 2,
            openTasks: 3,
            lateTasks: 0,
          },
          {
            projectId: "prj_2",
            recordId: "rec_q",
            type: "project",
            title: "Other",
            status: "active",
            channelId: "c",
            folderId: "f",
            memberCount: 1,
            openTasks: 1,
            lateTasks: 0,
          },
        ],
        hasMore: false,
      };
    throw new Error(cap);
  };
  const hash = await fetchSuggestions({ call }, "#", "riv");
  assert.deepEqual(hash.records, [
    { t: "Rivera Holdings", s: "Client", data: { type: "Client" }, kind: "Record", ref: "rec_1" },
  ]);
  assert.deepEqual(hash.chats, [{ t: "Rivera kickoff", s: "2 days ago", kind: "Chat", ref: "thr_9" }]);
  assert.deepEqual(hash.automations, [{ t: "Rivera reminders", kind: "Automation", ref: "aut_1" }]);
  assert.deepEqual(hash.projects, [
    { t: "Rivera filing", s: "Project \u00b7 3 open tasks", kind: "Project", ref: "prj_1", data: { status: "active" } },
  ]);
  assert.deepEqual(hash.files, [{ t: "plan.md", s: "Projects/plan.md", kind: "File", ref: "fil_1" }]);
  assert.deepEqual(hash.channels, [{ t: "intake", kind: "Channel", ref: "chn_1" }]);
  assert.deepEqual(hash.folders, [{ t: "Probate", s: "Projects/Probate", kind: "Folder", ref: "fld_1" }]);
  assert.deepEqual(asked[0]!.input.types, ["record", "file", "channel", "chat", "automation"]);
  asked.length = 0;
  const link = await fetchSuggestions({ call }, "[[", "riv");
  assert.deepEqual(
    asked.map((a) => a.cap),
    ["search.query"],
  );
  assert.deepEqual(asked[0]!.input.types, ["record"]);
  assert.equal(link.records.length, 1);
});

/* ---------- messages: chips, links, fork line ---------- */

test("size reads as people say it", () => {
  assert.deepEqual(
    [sizeLine(900), sizeLine(2048), sizeLine(5 * 1024 * 1024), sizeLine(3 * 1024 ** 3)],
    ["900 B", "2 KB", "5 MB", "3 GB"],
  );
});

test("a message with files draws a chip for each, named, and a pending file shows the name it was picked with", () => {
  const s = createSample("idle");
  const html = clean(
    renderToStaticMarkup(
      <AttachmentChips
        ids={["pending-file:contract.pdf"]}
        data={{ call: s.data.call, nav: s.data.nav, copy: s.data.copy }}
        menu={() => undefined}
      />,
    ),
  );
  assert.ok(html.includes('data-testid="attachments"'));
  assert.ok(html.includes("contract.pdf"));
  assert.ok(html.includes("Sending"));
  assert.equal(
    clean(
      renderToStaticMarkup(
        <AttachmentChips
          ids={[]}
          data={{ call: s.data.call, nav: s.data.nav, copy: s.data.copy }}
          menu={() => undefined}
        />,
      ),
    ),
    "",
  );
});

test("[[Title]] marks split out of the text; a mark with a ref is drawn as a link, one without stays plain", () => {
  assert.deepEqual(splitLinks("a [[One]] b [[Two words]]"), [
    { text: "a " },
    { text: "[[One]]", link: "One" },
    { text: " b " },
    { text: "[[Two words]]", link: "Two words" },
  ]);
  const s = createSample("idle");
  const html = clean(
    renderToStaticMarkup(
      <LinkedText
        body="open [[Rivera Holdings]] and [[Typed by hand]]"
        refs={[{ kind: "record", id: "rec_1", title: "Rivera Holdings" }]}
        data={{ call: s.data.call, nav: s.data.nav }}
        textStyle={{}}
      />,
    ),
  );
  assert.ok(html.includes('data-testid="link-rec_1"'));
  assert.ok(html.includes("Rivera Holdings"));
  assert.ok(html.includes("Typed by hand") && !html.includes("[[Typed by hand]]"));
  assert.deepEqual(
    refsOf({
      blocks: [
        {
          id: "b",
          type: "refs",
          v: 1,
          state: "done",
          data: { refs: [{ kind: "record", id: "rec_1", title: "X" }, { nope: true }] },
        },
      ] as never,
    }),
    [{ kind: "record", id: "rec_1", title: "X" }],
  );
});

test("your message shows its link and its file chip; the refs block is not drawn as a card", () => {
  const r = rig();
  const me = r.data.me.id;
  const m: Message = {
    messageId: "m_files",
    threadId: r.data.threadId,
    threadSeq: 99,
    author: { kind: "person", id: me },
    kind: "text",
    body: "see [[Rivera Holdings]]",
    blocks: [
      {
        id: "b1",
        type: "refs",
        v: 1,
        state: "done",
        data: { refs: [{ kind: "record", id: "rec_1", title: "Rivera Holdings" }] },
      },
    ] as never,
    depth: 0,
    attachments: ["pending-file:brief.docx"],
    reactions: [],
    pinned: false,
    createdAt: r.data.clock().now,
  };
  const items = timeline([m], { meId: me, nameOf: r.data.nameOf, kindOf: r.data.kindOf, clock: r.data.clock() });
  const actions = {
    copy: () => undefined,
    edit: () => undefined,
    setPinned: () => undefined,
    react: () => undefined,
    openThread: () => undefined,
    remove: () => undefined,
    openAgent: () => undefined,
    openBeside: () => undefined,
    answer: () => undefined,
    approvePlan: () => undefined,
    retryTurn: () => undefined,
    errorNext: () => undefined,
    retrySend: () => undefined,
    discardSend: () => undefined,
    showMenu: () => undefined,
    host: { invoke: async () => ({}), open: () => undefined },
    files: r.data,
    fork: () => undefined,
    makeTask: () => undefined,
  };
  const html = clean(
    items.map((it) => renderToStaticMarkup(<MessageView item={it} actions={actions as never} meId={me} />)).join(""),
  );
  assert.ok(html.includes('data-testid="link-rec_1"'));
  assert.ok(html.includes("brief.docx"));
  assert.ok(!html.includes('data-testid="card-b1"'));
});

test("a fork's first line names the chat it came from and links to the message", () => {
  const r = rig();
  const m: Message = {
    messageId: "m_fork",
    threadId: r.data.threadId,
    threadSeq: 1,
    author: { kind: "person", id: r.data.me.id },
    kind: "system",
    body: 'Forked from "Plan the launch"',
    blocks: [
      {
        id: "b",
        type: "fork_origin",
        v: 1,
        state: "done",
        data: { threadId: "thr_src", messageId: "m_src", title: "Plan the launch" },
      },
    ] as never,
    depth: 0,
    attachments: [],
    reactions: [],
    pinned: false,
    createdAt: r.data.clock().now,
  };
  const items = timeline([m], {
    meId: r.data.me.id,
    nameOf: r.data.nameOf,
    kindOf: r.data.kindOf,
    clock: r.data.clock(),
  });
  const html = clean(
    items
      .map((it) =>
        renderToStaticMarkup(
          <MessageView item={it} actions={{ openMessage: () => undefined } as never} meId={r.data.me.id} />,
        ),
      )
      .join(""),
  );
  assert.ok(html.includes('data-testid="fork-origin-m_fork"'));
  assert.ok(html.includes("Plan the launch"));
});

test("a link card in a system line says where the work went, by name, and opens the task; an agent's card with buttons draws as a card", () => {
  const r = rig();
  const sys: Message = {
    messageId: "m_card",
    threadId: r.data.threadId,
    threadSeq: 1,
    author: { kind: "person", id: r.data.me.id },
    kind: "system",
    body: "Task created: Send the letter",
    blocks: [
      {
        id: "blk_c",
        type: "link_card",
        v: 1,
        state: "done",
        data: {
          icon: "task",
          lead: "Task created",
          title: "Send the letter",
          who: "usr_maya",
          target: { type: "task", id: "tsk_1" },
        },
      },
    ] as never,
    createdAt: 1,
    reactions: [],
    pinned: false,
    attachments: [],
  } as unknown as Message;
  const summary: Message = {
    ...sys,
    messageId: "m_sum",
    kind: "agent",
    author: { kind: "agent", id: "agt_billing" },
    body: "",
    blocks: [
      {
        id: "blk_s",
        type: "link_card",
        v: 1,
        state: "done",
        data: {
          icon: "summary",
          lead: "Summary",
          title: "Invoices",
          body: "Three paid, two open.",
          actions: [{ key: "task", label: "Make task" }],
        },
      },
    ] as never,
  } as Message;
  const items = timeline([sys, summary], {
    meId: r.data.me.id,
    nameOf: r.data.nameOf,
    kindOf: r.data.kindOf,
    clock: r.data.clock(),
  });
  const html = clean(
    items
      .map((it) =>
        renderToStaticMarkup(
          <MessageView
            item={it}
            actions={{ openBeside: () => undefined, nameOf: r.data.nameOf } as never}
            meId={r.data.me.id}
          />,
        ),
      )
      .join(""),
  );
  assert.ok(html.includes("Task created, assigned to Maya Chen"), "the name, not the id");
  assert.ok(html.includes('data-testid="link-card-blk_c-open"') && html.includes("Send the letter"));
  assert.ok(
    html.includes('data-testid="link-card-blk_s-task"') && html.includes("Three paid, two open."),
    "the agent's card has its words and its button",
  );
});

/* ---------- export ---------- */

test("the export file is named from the chat's title and never holds an id where a name belongs", () => {
  const r = rig();
  assert.equal(exportName("Plan: the launch / v2", "md"), "Plan-the-launch-v2.md");
  assert.equal(exportName("   ", "json"), "chat.json");
  const md = exportAs("md", {
    thread: r.thread,
    messages: r.rows,
    nameOf: r.data.nameOf,
    fileName: () => "x.pdf",
    clock: r.data.clock(),
  });
  assert.match(md.content, /^# /);
  assert.ok(md.content.includes("**You**") || md.content.includes("**Intake**") || md.content.includes("**"));
  assert.ok(!/\b(usr|agt)_[a-z0-9]+/.test(md.content), md.content.slice(0, 400));
});

/* ---------- continue in another Space ---------- */

test("a person who spoke in the chat and has since left still counts as someone else", async () => {
  const there: string[] = [];
  const r = rig(
    {
      "chat.messages.list": () => ({
        messages: [
          {
            messageId: "m1",
            threadId: "t",
            threadSeq: 1,
            author: { kind: "person", id: "usr_gone" },
            kind: "text",
            body: "hi",
            blocks: [],
            depth: 0,
            attachments: [],
            reactions: [],
            pinned: false,
            createdAt: 1,
          },
        ],
        hasMore: false,
      }),
    },
    {
      elsewhere: {
        spaces: [{ id: "spc_2", name: "Personal" }],
        call: async (_s, cap) => {
          there.push(cap);
          return {};
        },
      },
    },
  );
  const solo = { ...r.thread, members: [{ kind: "person" as const, id: r.data.me.id }] };
  await assert.rejects(
    act.continueElsewhere(r.data, solo, { id: "spc_2", name: "Personal" }, "Northwind", "k"),
    /other people/,
  );
  assert.deepEqual(there, []);
});

test("a plugin command with a colon in its name is a command, and its prompt is rendered by the plugin with what was typed", async () => {
  assert.deepEqual(parseSlash("/greeter:hello Dana", ["greeter:hello"]), { id: "greeter:hello", arg: "Dana" });
  const asked: string[] = [];
  const plugins: PluginCommand[] = [
    {
      name: "greeter:hello",
      description: "Greet",
      render: async (a) => {
        asked.push(a);
        return `Say hello to ${a}`;
      },
    },
  ];
  const r = rig({}, { pluginCommands: () => plugins });
  await runSlash("/greeter:hello Dana", r.env);
  assert.deepEqual(asked, ["Dana"]);
  assert.deepEqual(r.flags.sent, ["Say hello to Dana"]);
});

test("an agent's answer has five buttons in its hover bar (copy, thread, fork, pin, more), Make a task is in its menu, and nothing of it is drawn at rest (G12)", async () => {
  const r = rig();
  const reply: Message = {
    messageId: "m_ans",
    threadId: r.data.threadId,
    threadSeq: 2,
    author: { kind: "agent", id: "agt_billing" },
    kind: "agent",
    body: "Three invoices are paid, two are open.",
    blocks: [],
    createdAt: 2,
    reactions: [],
    pinned: false,
  } as unknown as Message;
  const bar = (visible: boolean, byAgent = true): string =>
    clean(
      renderToStaticMarkup(
        <HoverBar
          m={reply}
          mine={!byAgent}
          byAgent={byAgent}
          visible={visible}
          onEdit={() => undefined}
          a={
            {
              openBeside: () => undefined,
              nameOf: r.data.nameOf,
              makeTask: () => undefined,
              copy: () => undefined,
              openThread: () => undefined,
              setPinned: () => undefined,
              fork: () => undefined,
              showMenu: () => undefined,
            } as never
          }
        />,
      ),
    );
  const agentBar = bar(true);
  for (const id of ["copy", "reply", "fork", "pin", "more"])
    assert.ok(agentBar.includes(`data-testid="act-${id}-m_ans"`), `${id} is in the bar`);
  assert.equal((agentBar.match(/data-testid="act-/g) ?? []).length, 5, "five and no more");
  assert.ok(
    !agentBar.includes("act-make-m_ans") && !agentBar.includes("act-remember-m_ans"),
    "Make a task and Remember are in the menu",
  );
  assert.ok(!bar(true, false).includes('data-testid="act-make-m_ans"'), "never on a person's own message");
  assert.ok(!bar(false).includes("act-make-m_ans"), "at rest no action is drawn");
  // the message itself draws none of it at rest
  const items = timeline([reply], {
    meId: r.data.me.id,
    nameOf: r.data.nameOf,
    kindOf: r.data.kindOf,
    clock: r.data.clock(),
  });
  const html = clean(
    items
      .map((it) =>
        renderToStaticMarkup(
          <MessageView
            item={it}
            actions={
              {
                openBeside: () => undefined,
                nameOf: r.data.nameOf,
                makeTask: () => undefined,
                copy: () => undefined,
                openThread: () => undefined,
                setPinned: () => undefined,
                fork: () => undefined,
              } as never
            }
            meId={r.data.me.id}
          />,
        ),
      )
      .join(""),
  );
  const text = html.replace(/<[^>]+>/g, " ");
  for (const word of ["Copy", "Reply in thread", "Fork from here", "Pin", "Make a task", "Remember this"])
    assert.ok(!new RegExp(`\\b${word}\\b`).test(text), `${word} is not shown at rest`);
  // and the long-press sheet on a phone has it
  const sheet = menuFor(
    reply,
    false,
    {
      makeTask: () => undefined,
      openThread: () => undefined,
      copy: () => undefined,
      setPinned: () => undefined,
      react: () => undefined,
      remove: () => undefined,
    } as never,
    () => undefined,
  );
  assert.ok(sheet.some((e) => "label" in e && e.label === "Make a task"));
});

/* ---------- what a command hands back: data, classified (CMD-RESULTS-2026-11-13) ---------- */

test("every command in the one list has exactly one kind in the table, and the table has no command the list lacks", () => {
  assert.deepEqual(unclassified(), []);
  const ids = CHAT_COMMANDS.map((c) => c.id).sort();
  assert.deepEqual(Object.keys(COMMAND_KINDS).sort(), ids);
  assert.equal(ids.length, CHAT_COMMANDS.length);
  for (const id of ids)
    assert.ok(["notice", "card", "menu", "opens"].includes(COMMAND_KINDS[id as keyof typeof COMMAND_KINDS]), id);
});

const SAMPLE_MY_AI = {
  running: {
    model: "claude-sonnet-5-5",
    paid: "Claude Code, CF · your sign-in",
    account: { name: "Claude Code, CF" },
    context: { used: 31_000, window: 1_000_000 },
  },
  accounts: [
    {
      name: "Claude Code, CF",
      provider: "anthropic",
      kind: "subscription",
      usable: true,
      models: ["claude-sonnet-5-5", "claude-opus-5-5"],
      limits: { state: "read", session: { pct: 41.6, resetsAt: 1_700_000_000_000 }, week: { pct: 12 } },
    },
    {
      name: "dana@example.org",
      provider: "openai",
      kind: "subscription",
      usable: true,
      models: ["gpt-6.1"],
      limits: {
        state: "not_readable",
        note: "This sign-in's CLI reports its limits only with a turn, and none has been read here yet.",
      },
    },
    {
      name: "OpenCode Go",
      provider: "opencode_go",
      kind: "key",
      usable: true,
      models: ["glm-5.3"],
      limits: { state: "not_readable", note: "OpenCode Go does not report its quota." },
    },
    {
      name: "Codex",
      provider: "openai",
      kind: "subscription",
      usable: false,
      why: "Your Codex sign-in is locked on this server.",
      models: [],
      limits: { state: "not_readable", note: "x" },
    },
  ],
  use: {
    today: { turns: 1, input: 18_000, cachedInput: 13_000, output: 200, costMicros: 0 },
    month: { turns: 39, input: 1_500_000, cachedInput: 9_200_000, output: 176_000, costMicros: 2_500_000 },
  },
};

test("/usage hands back a usage card of data: names a person would say, no ids, no addresses, no codes, times as times", async () => {
  const r = rig({ "engine.my_ai": () => SAMPLE_MY_AI });
  await runSlash("/usage", r.env);
  const res = r.results.at(-1)!;
  assert.equal(res.kind, "card");
  const spec = (res as Extract<CommandResult, { kind: "card" }>).card;
  assert.equal(spec.kind, "usage");
  if (spec.kind !== "usage") return;
  assert.equal(
    r.calls.filter((c) => c.cap === "engine.my_ai").length,
    0,
    "the card opens first and reads its own data",
  );
  const card = await spec.read();
  assert.equal(card.chat.model, "Sonnet 5.5");
  assert.equal(card.chat.paidBy, "Your Claude sign-in");
  assert.deepEqual(card.chat.context, { used: 31_000, window: 1_000_000 });
  assert.deepEqual(
    card.accounts.map((a) => a.name),
    ["Claude sign-in", "ChatGPT sign-in", "OpenCode Go", "Codex"],
    "an address or initials is not a name",
  );
  assert.deepEqual(card.accounts[0]!.models, ["Sonnet 5.5", "Opus 5.5"]);
  assert.equal(card.accounts[0]!.current, "Sonnet 5.5");
  assert.deepEqual(card.accounts[0]!.limits, {
    state: "read",
    session: { pct: 42, resetsAt: 1_700_000_000_000 },
    week: { pct: 12 },
  });
  assert.deepEqual(card.accounts[1]!.limits, { state: "waiting" });
  assert.deepEqual(card.accounts[2]!.limits, { state: "silent" });
  assert.equal(card.accounts[3]!.usable, false);
  assert.equal(card.accounts[3]!.why, "Your Codex sign-in is locked on this server.");
  assert.deepEqual(card.today, { count: 1, fresh: 18_000, cached: 13_000, out: 200, costMicros: 0 });
  assert.equal(card.month.costMicros, 2_500_000);
  const text = cardLines(card, 1_700_000_000_000 - 3_600_000).join("\n");
  assert.ok(!/claude-sonnet|@|example\.org|\bCF\b|not_readable/.test(text), text);
  assert.match(text, /18k new, 13k cached, 200 out/);
  assert.match(text, /Shows after your next message/);
});

test("an account is named as the person gave it; only an address or initials is replaced", () => {
  assert.equal(accountName({ name: "Work Claude", provider: "anthropic", kind: "subscription" }), "Work Claude");
  assert.equal(
    accountName({ name: "dana@example.org", provider: "anthropic", kind: "subscription" }),
    "Claude sign-in",
  );
  assert.equal(accountName({ name: "CC, CF", provider: "openai", kind: "subscription" }), "ChatGPT sign-in");
  assert.equal(accountName({ name: "", provider: "xai", kind: "key" }), "Grok key");
  assert.equal(paidWords("Claude Code (Max) · your sign-in", "anthropic"), "Your Claude sign-in");
  assert.equal(paidWords("the Space's key", undefined), "The Space's key");
  assert.equal(paidWords("something odd", "anthropic"), null);
});

test("/permissions hands back the rules as data; the rule's id travels with it and is never in the words", async () => {
  const rules = [
    { id: "rul_1", kind: "always", act: "send", target: "Run tests in the project folder" },
    { id: "rul_2", kind: "standing", act: "approve", target: "*", automationId: "aut_1" },
  ];
  const r = rig({ "gate.allow.list": () => ({ rules }) });
  await runSlash("/permissions", r.env);
  const res = r.results.at(-1) as Extract<CommandResult, { kind: "card" }>;
  assert.equal(res.kind, "card");
  assert.equal(res.card.kind, "permissions");
  if (res.card.kind !== "permissions") return;
  const card = await res.card.read();
  assert.deepEqual(
    card.rules.map((x) => [x.id, x.text, x.restorable]),
    [
      ["rul_1", "Always allow Run tests in the project folder", false], // no expiry on record: it cannot be given back exactly,
      ["rul_2", "An automation may act to whoever its step reaches", false],
    ],
  );
  assert.ok(!card.rules.some((x) => /rul_|aut_/.test(x.text)));
});

test("taking a permission back says so with an Undo that gives it again through gate.allow.set; an automation's permission has no Undo", async () => {
  const NOW = rig().data.clock().now;
  const rules = [
    {
      id: "rul_1",
      kind: "always",
      act: "send",
      target: "Run tests",
      agentId: "agt_a",
      threadId: "thr_t",
      expiresAt: NOW + 5 * 86_400_000 + 1000,
    },
    { id: "rul_2", kind: "standing", act: "approve", target: "*", automationId: "aut_1" },
  ];
  const r = rig({
    "gate.allow.list": () => ({ rules }),
    "gate.allow.remove": () => ({ ok: true }),
    "gate.allow.set": () => ({}),
  });
  await runSlash("/permissions remove 1", r.env);
  const n = r.results.at(-1) as Extract<CommandResult, { kind: "notice" }>;
  assert.equal(n.kind, "notice");
  assert.equal(n.text, "Took back: Always allow Run tests");
  assert.deepEqual(r.last("gate.allow.remove")?.input, { id: "rul_1" });
  assert.ok(n.undo, "a person's Always allow can be given again");
  await n.undo!();
  const set = r.last("gate.allow.set")!.input;
  assert.deepEqual(
    { act: set.act, target: set.target, agentId: set.agentId, threadId: set.threadId },
    { act: "send", target: "Run tests", agentId: "agt_a", threadId: "thr_t" },
  );
  assert.ok(set.days >= 1 && set.days <= 90, `days ${set.days}`);
  await runSlash("/permissions remove 2", r.env);
  assert.equal(
    (r.results.at(-1) as Extract<CommandResult, { kind: "notice" }>).undo,
    undefined,
    "no call gives an automation's permission back",
  );
  await runSlash("/permissions remove 9", r.env);
  assert.match(r.said.at(-1)!, /There is no rule 9/);
});

test("/plan and /pin say what happened with an Undo that does the opposite; export and a plain failure have none", async () => {
  const r = rig();
  await runSlash("/plan on", r.env);
  const plan = r.results.at(-1) as Extract<CommandResult, { kind: "notice" }>;
  assert.equal(plan.text, "Plan mode is on");
  const before = r.calls.length;
  await plan.undo!();
  const undone = r.calls.slice(before).find((c) => /set_mode|set_plan_mode/.test(c.cap))!;
  assert.ok(undone.input.mode === "auto" || undone.input.planMode === false, JSON.stringify(undone.input));
  const target = lastActionable(r.rows)!;
  await runSlash("/pin", r.env);
  const pin = r.results.at(-1) as Extract<CommandResult, { kind: "notice" }>;
  assert.equal(pin.text, target.pinned ? "Unpinned the last message" : "Pinned the last message");
  await pin.undo!();
  assert.equal(r.last(target.pinned ? "chat.pin" : "chat.unpin")?.input.messageId, target.messageId);
  await runSlash("/export", r.env);
  assert.equal((r.results.at(-1) as Extract<CommandResult, { kind: "notice" }>).undo, undefined);
});

test("a command that throws becomes a failed notice in plain words with a Retry that runs the same command again", async () => {
  let fail = true;
  const r = rig({
    "chat.fork": () => {
      if (fail) throw new Error("chat.fork");
      return { thread: { threadId: "thr_fork" }, copied: 1 };
    },
  });
  await runSlash("/fork", r.env);
  const f = r.results.at(-1) as Extract<CommandResult, { kind: "notice" }>;
  assert.equal(f.kind, "notice");
  assert.equal(f.text, "/fork did not work.", "a code is never shown");
  assert.ok(f.failed, "it can be tried again");
  fail = false;
  await f.failed!.retry();
  assert.deepEqual(r.opened, ["thread:thr_fork"]);
  assert.equal(r.results.at(-1)!.kind, "opens");
});

test("each of the commands ends in the kind the table says (a hint or an error is a notice)", async () => {
  const docs = DIRECTORY.find((d) => d.kind === "agent" && d.name === "Docs")!;
  assert.ok(docs);
  const there = {
    spaces: [{ id: "spc_2", name: "Personal" }],
    call: async () => ({
      agents: [{ agentId: "agt_assist", name: "Assistant", role: "assistant" }],
      thread: { threadId: "thr_there" },
    }),
  };
  const answers = {
    "engine.my_ai": () => SAMPLE_MY_AI,
    "gate.allow.list": () => ({ rules: [] }),
    "chat.helper.start": () => ({ helper: { threadId: "thr_helper1" }, blockId: "blk_1" }),
    "chat.handoff": () => ({ thread: { threadId: "thr_next" }, depth: 1 }),
    "chat.fork": () => ({ thread: { threadId: "thr_fork" }, copied: 4 }),
    "chat.make_task": () => ({ taskId: "tsk_1", messageId: "m" }),
    "memory.propose_fact": () => ({ fact: {}, merged: true }),
    "engine.compact": () => ({ line: "Freed 40k of context" }),
    "chat.start": () => ({ thread: { threadId: "thr_fresh" } }),
  };
  const lines: Record<string, string> = {
    btw: "/btw what is the deadline again?",
    stop: "/stop",
    find: "/find",
    helper: "/helper read the lease",
    handoff: "/handoff @Docs write the cover letter",
    review: "/review the lease",
    "security-review": "/security-review",
    agents: "/agents",
    model: "/model",
    effort: "/effort",
    plan: "/plan on",
    permissions: "/permissions",
    new: "/new",
    usage: "/usage",
    context: "/context",
    compact: "/compact",
    fork: "/fork",
    export: "/export",
    search: "/search closing date",
    task: "/task call the court",
    remember: "/remember I prefer short answers",
    memory: "/memory",
    pin: "/pin",
    copy: "/copy",
    skills: "/skills",
    hooks: "/hooks",
    init: "/init",
  };

  for (const c of CHAT_COMMANDS) {
    const r = rig(answers, { elsewhere: there as never, spaceName: "Northwind" });
    await runSlash(lines[c.id]!, r.env);
    const got = r.results.at(-1);
    // compact: the server's own line is posted in the chat, so the screen has nothing to add
    assert.ok(got, `/${c.id} gave a result`);
    assert.equal(
      got.kind,
      c.id === "compact" ? "opens" : COMMAND_KINDS[c.id as keyof typeof COMMAND_KINDS],
      `/${c.id}: ${JSON.stringify(got).slice(0, 160)}`,
    );
  }
});

test("an Undo of a take-back never leaves the agent with more than it had: whole days rounded down, nothing wider", async () => {
  const NOW = rig().data.clock().now;
  const H = 3_600_000;
  const base = { id: "rul_1", kind: "always", act: "send", target: "Run tests", agentId: "agt_a", threadId: "thr_t" };
  const take = async (rule: Record<string, unknown>) => {
    const r = rig({
      "gate.allow.list": () => ({ rules: [rule] }),
      "gate.allow.remove": () => ({ ok: true }),
      "gate.allow.set": () => ({}),
    });
    await runSlash("/permissions remove 1", r.env);
    return { r, n: r.results.at(-1) as Extract<CommandResult, { kind: "notice" }> };
  };
  // 36 hours left: one whole day goes back, not two
  const a = await take({ ...base, expiresAt: NOW + 36 * H });
  assert.ok(a.n.undo);
  await a.n.undo!();
  const set = a.r.last("gate.allow.set")!.input;
  assert.deepEqual(set, { act: "send", target: "Run tests", agentId: "agt_a", threadId: "thr_t", days: 1 });
  // 5 hours left: no whole day, so no Undo; the line only says it was taken back
  const b = await take({ ...base, expiresAt: NOW + 5 * H });
  assert.equal(b.n.text, "Took back: Always allow Run tests");
  assert.equal(b.n.undo, undefined);
  // no expiry on record: the call cannot say that exactly, so no Undo
  const c = await take({ ...base });
  assert.equal(c.n.undo, undefined);
  // a rule with no agent or chat is given back with none: never wider
  const d = await take({
    id: "rul_1",
    kind: "always",
    act: "send",
    target: "Run tests",
    expiresAt: NOW + 3 * 86_400_000 + H,
  });
  await d.n.undo!();
  assert.deepEqual(d.r.last("gate.allow.set")!.input, { act: "send", target: "Run tests", days: 3 });
});

/* ---------- the whole command set (G49) ---------- */

test("the / list offers the design's command set under its headings, and Continue in another Space is not in it (DESIGN-chat-system, line 164)", () => {
  const ids = CHAT_COMMANDS.map((c) => c.id);
  for (const id of [
    "effort",
    "context",
    "review",
    "security-review",
    "agents",
    "new",
    "copy",
    "memory",
    "skills",
    "hooks",
    "init",
  ])
    assert.ok(ids.includes(id), `/${id} is offered`);
  assert.ok(!ids.includes("continue"));
  assert.equal(parseSlash("/continue Personal"), null);
  assert.deepEqual(
    [...new Set(CHAT_COMMANDS.map((c) => c.group))],
    ["While it works", "Bring in help", "How it runs", "This session", "Keep it", "Set it up"],
  );
  const lists: ComposerLists = { commands: commandItems() };
  const trigger: Trigger = { ch: "/", start: 0, end: 1, query: "" };
  const popup = popupFor(trigger, lists, true);
  assert.equal(
    popup.filter((e): e is PopupItem => "group" in e).length,
    CHAT_COMMANDS.length,
    "nothing is cut at eight",
  );
  assert.deepEqual(
    popup.filter((e) => "head" in e && e.head !== undefined).map((e) => (e as { head: string }).head),
    ["While it works", "Bring in help", "How it runs", "This session", "Keep it", "Set it up"],
  );
});

test("names people know from other tools run the command they stand for", () => {
  for (const [said, id] of [
    ["status", "usage"],
    ["cost", "usage"],
    ["clear", "new"],
    ["quit", "stop"],
    ["code-review", "review"],
  ] as const)
    assert.equal(parseSlash(`/${said}`)?.id, id, said);
});

test("/review starts a helper that reviews; /agents, /memory, /skills open the pane on their tab; /copy copies the last reply; /new starts a chat with the same agent", async () => {
  const r = rig({
    "chat.helper.start": () => ({ helper: { threadId: "thr_rev" }, blockId: "b" }),
    "chat.start": () => ({ thread: { threadId: "thr_fresh" } }),
  });
  await runSlash("/review the lease", r.env);
  const helper = r.calls.find((c) => c.cap === "chat.helper.start");
  assert.ok(helper, "a helper started");
  assert.match(JSON.stringify(helper.input), /Review the work done in this chat, looking at: the lease/);
  assert.ok(r.opened.includes("thread:thr_rev"));
  await runSlash("/agents", r.env);
  await runSlash("/memory", r.env);
  await runSlash("/skills", r.env);
  assert.deepEqual(
    r.opened.filter((o) => o.startsWith("pane:")),
    ["pane:crew", "pane:memory", "pane:skills"],
  );
  await runSlash("/new", r.env);
  assert.ok(r.opened.includes("thread:thr_fresh"));
  assert.ok(r.calls.some((c) => c.cap === "chat.start"));
});

test("/usage and /context are two commands: usage opens the usage card, context opens the context card with the meters and Compact (G44)", async () => {
  const r = rig({
    "engine.my_ai": () => SAMPLE_MY_AI,
    "engine.usage.get": () => ({
      context: { used: 420_000, window: 1_000_000 },
      session: { pct: 34 },
      week: { pct: 61 },
      keepEvery: "",
    }),
    "engine.compact": () => ({ line: "Freed 40k of context" }),
  });
  await runSlash("/usage", r.env);
  assert.equal((r.results.at(-1) as { card: { kind: string } }).card.kind, "usage");
  await runSlash("/context", r.env);
  const spec = (
    r.results.at(-1) as {
      card: {
        kind: string;
        read(): Promise<{ meters: { key: string; pct: number }[] }>;
        compact(k: string, a: boolean): Promise<void>;
      };
    }
  ).card;
  assert.equal(spec.kind, "context");
  const d = await spec.read();
  assert.deepEqual(
    d.meters.map((m) => [m.key, m.pct]),
    [
      ["context", 42],
      ["session", 34],
      ["week", 61],
    ],
  );
  await spec.compact("the decisions", true);
  assert.ok(r.calls.some((c) => c.cap === "engine.compact" && JSON.stringify(c.input).includes("the decisions")));
});
