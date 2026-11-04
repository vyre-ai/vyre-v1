// What a model reads back from the calendar and mail tools (Andrey's rc.20 report: one "what is on my calendar and what needs a reply" cost minutes and ~560k tokens). Fixtures have the shapes of the real
// capability outputs (generated/types.ts) at the sizes real mail and calendars have: HTML bodies with quoted history, long descriptions, attendee blobs, dial-ins. Each list result must stay under RESULT_BUDGET.
import test from "node:test";
import assert from "node:assert/strict";
import { createToolSession } from "../src/tools/index.ts";
import { LIMITS, RESULT_BUDGET, limited, shapeOutput } from "../src/tools/compact.ts";
import { ctx, fakeInvoke, loadGenerated } from "../src/tools/harness.ts";
import type { CallDeps } from "../src/tools/call.ts";

const size = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v)).length;
const lorem = (n: number): string => "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. ".repeat(Math.ceil(n / 80)).slice(0, n);
const DAY0 = Date.UTC(2026, 10, 2);
const people = ["maya", "omar", "lena", "sam", "irfad", "priya", "elena", "marcus", "hannah", "wei", "jonas", "sofia"];

/** A crowded week: 60 events with a long HTML description, an agenda, twelve attendees and a conference with dial-ins. */
const eventsOut = (n: number): { events: unknown[]; next?: string; total: number } => ({
  total: n + 40, next: "cur_next",
  events: Array.from({ length: n }, (_, i) => ({
    id: `cev_${i}`, calendarId: "cld_work", title: `Meeting ${i}: ${lorem(60)}`, startsAt: DAY0 + Math.floor(i / 8) * 864e5 + (9 + (i % 8)) * 36e5, endsAt: DAY0 + Math.floor(i / 8) * 864e5 + (9.5 + (i % 8)) * 36e5,
    allDay: false, location: "Northwind office, 410 Valencia St, San Francisco, Room 4", joinUrl: `https://meet.google.com/abc-${i}`, joinProvider: "meet",
    description: `<div><p>${lorem(1800)}</p><p><a href="https://example.test/x">link</a></p></div>`, agenda: lorem(500),
    attendees: people.map((p) => ({ email: `${p}@northwind.example`, name: `${p[0]!.toUpperCase()}${p.slice(1)} Surname`, contactId: `rec_${p}`, response: "accepted" })),
    organizer: "maya@northwind.example", recordIds: ["rec_1", "rec_2"], meetingId: `mtg_${i}`, status: "confirmed", seriesId: "ser_1",
    conference: { provider: "meet", url: `https://meet.google.com/abc-${i}`, meetingId: `abc-${i}`, passcode: "551203", dialIns: [{ number: "+1 669 444 9171", pin: "84512345678#", label: "US" }, { number: "+44 20 3000 1111", pin: "1234#", label: "UK" }] },
  })),
});

const addr = (n: string): { address: string; name: string } => ({ address: `${n}@clientco.example`, name: `${n[0]!.toUpperCase()}${n.slice(1)} Client` });
const msg = (t: number, k: number): Record<string, unknown> => ({
  id: `eml_${t}_${k}`, at: DAY0 + (t * 10 + k) * 6e5, direction: k % 2 === 0 ? "in" : "out", mailboxId: "mbx_1", mailboxIds: ["mbx_1"], from: addr(people[k % people.length]!), to: [addr("irfad")], cc: [addr("maya"), addr("omar")],
  subject: `Re: Contract review ${t}`, body: lorem(2500), quoted: lorem(5000), signature: lorem(400), html: `<html><body>${"<p>" + lorem(3000) + "</p>"}</body></html>`, reactions: [],
  attachments: [{ attachmentId: `att_${t}`, name: "contract.pdf", mime: "application/pdf", size: 120000 }], isPrivate: false, rfcMessageId: `<${t}.${k}@mail.example>`, inReplyTo: `<${t}.${k - 1}@mail.example>`,
});
const convo = { id: "cnv_1", contactId: "rec_1", address: "elena@clientco.example", displayName: "Elena Rivera", lastMessageAt: DAY0, lastChannel: "email", lastPreview: lorem(300), unreadCount: 2, needsMatch: false, mailboxIds: ["mbx_1"], followed: true, alertOnReplies: false };
/** 50 inbox threads of five whole messages each (what inbox.threads returns today). */
const threadsOut = (n: number): unknown => ({
  conversation: convo, next: "cur_t", total: n + 20,
  threads: Array.from({ length: n }, (_, t) => ({
    threadId: `thr_${t}`, subject: `Contract review ${t}`, role: "to", participants: people.slice(0, 6).map(addr), lastAt: DAY0 + t * 6e5, messageCount: 5, unread: 1,
    messages: Array.from({ length: 5 }, (_, k) => ({ unread: k === 4, message: msg(t, k) })),
  })),
});
const mailRowsOut = (n: number): unknown => ({
  total: n + 100, next: "cur_m",
  messages: Array.from({ length: n }, (_, i) => ({
    id: `eml_${i}`, mailboxId: "mbx_1", inboxIds: ["inb_1"], threadId: `thr_${i % 30}`, direction: i % 3 === 0 ? "out" : "in", status: i % 3 === 0 ? "sent" : "received", from: { ...addr(people[i % 12]!), contactId: `rec_${i}` },
    to: [addr("irfad")], cc: [addr("maya")], subject: `Question about invoice ${i} and the schedule for next week`, snippet: lorem(400), sentAt: DAY0 + i * 36e5, contactId: `rec_${i}`, isPrivate: false,
  })),
});
const byThreadOut = (n: number): unknown => ({ showing: "all", next: "c", total: n + 10, threads: Array.from({ length: n }, (_, i) => ({ threadId: `thr_${i}`, channel: "email", subject: `Subject number ${i} ${lorem(80)}`, mailboxId: "mbx_1", lastAt: DAY0 + i * 6e5, participants: people.map((p) => `${p}@clientco.example`), unread: 1, contactId: `rec_${i}`, conversationId: `cnv_${i}` })) });
const byContactOut = (n: number): unknown => ({ showing: "all", next: "c", total: n + 10, rows: Array.from({ length: n }, (_, i) => ({ ...convo, id: `cnv_${i}`, displayName: `Person ${i}`, address: `p${i}@clientco.example`, lastPreview: lorem(400) })) });

test("the report's own questions: a crowded week and 50 inbox threads each stay under the budget, and the sizes are the point", () => {
  const rows: Array<[string, unknown]> = [
    ["calendar.list_events (60 events)", eventsOut(60)],
    ["inbox.threads (50 threads x 5 messages)", threadsOut(50)],
    ["mail.message.list (50 rows)", mailRowsOut(50)],
    ["mail.message.search (50 rows)", mailRowsOut(50)],
    ["inbox.list_by_thread (50 rows)", byThreadOut(50)],
    ["inbox.list_by_contact (50 rows)", byContactOut(50)],
  ];
  for (const [label, out] of rows) {
    const cap = label.split(" ")[0]!;
    const before = size(out), s = shapeOutput(cap, out)!;
    assert.ok(s, cap);
    const after = size(s.data);
    assert.equal(s.meta.bytes, after, "meta.bytes is the size of data");
    assert.ok(after <= RESULT_BUDGET, `${label}: ${after} bytes after, over ${RESULT_BUDGET}`);
    assert.ok(before > (cap === "calendar.list_events" || cap === "inbox.threads" ? 10 : 3) * after, `${label}: ${before} before, ${after} after`);
    console.log(`  size ${label}: ${before} -> ${after} bytes (${s.meta.count} rows${s.meta.omitted ? `, ${s.meta.omitted} left out` : ""})`);
  }
});

test("events: title, start, end, who, location and a link; no description, HTML, agenda, conference or attendee blob; the rest is counted with where to resume", () => {
  const out = eventsOut(60);
  const s = shapeOutput("calendar.list_events", out)!;
  const data = s.data as { events: Array<Record<string, unknown>> };
  const e = data.events[0]!;
  assert.deepEqual(Object.keys(e).sort(), ["end", "id", "link", "location", "start", "title", "who"]);
  assert.equal(Date.parse(e["start"] as string), DAY0 + 9 * 36e5, "an ISO time");
  assert.ok((e["who"] as string[]).includes("+8"), "twelve people: four names and +8");
  assert.ok(!JSON.stringify(s.data).match(/ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor\. Lorem|<div>|dialIns|passcode|attendees|agenda/), "nothing raw leaks");
  assert.equal(s.meta.count + (s.meta.omitted ?? 0), 60);
  assert.ok((s.meta.omitted ?? 0) > 0 && typeof s.meta.resume?.["from"] === "number", "rows over the budget are counted, and `from` says where to resume");
  assert.equal(s.meta.next, undefined, "the server cursor skips what was left out, so it is not offered then");
  const small = shapeOutput("calendar.list_events", eventsOut(10))!;
  assert.equal(small.meta.omitted, undefined);
  assert.equal(small.meta.next, "cur_next");
  assert.equal(small.meta.total, 50);
  assert.equal(small.meta.read, "calendar_get_event");
});

test("mail rows: subject, from, date, a one-line snippet and needs-reply (newest of its thread, and it came in)", () => {
  const s = shapeOutput("mail.message.list", mailRowsOut(20))!;
  const rows = (s.data as { messages: Array<Record<string, unknown>> }).messages;
  assert.ok(rows.every((r) => String(r["snippet"]).length <= 160));
  assert.deepEqual(Object.keys(rows[1]!).sort(), ["at", "from", "id", "needsReply", "snippet", "subject", "thread"]);
  const raw = (mailRowsOut(20) as { messages: Array<{ direction: string; threadId: string; sentAt: number; id: string }> }).messages;
  for (const r of rows) {
    const m = raw.find((x) => x.id === r["id"])!;
    const newest = raw.filter((x) => x.threadId === m.threadId).sort((a, b) => b.sentAt - a.sentAt)[0]!;
    assert.equal(r["needsReply"] === true, m.direction === "in" && newest.id === m.id, `${m.id}`);
  }
  const t = shapeOutput("inbox.threads", threadsOut(3))!;
  const th = (t.data as { threads: Array<Record<string, unknown>> }).threads[0]!;
  assert.equal(th["needsReply"], true, "its newest message came in");
  assert.ok(!JSON.stringify(t.data).match(/<html>|quoted|signature/), "no HTML, quoted history or signature in a list");
  assert.ok(String((th["last"] as { snippet: string }).snippet).length <= 160, "the last message is a one-line snippet");
  assert.equal(t.meta.read, "mail_thread_get");
});

test("one message and one thread are read whole by their own tools: text kept, raw HTML and quoted history left out, long text cut and said so", () => {
  const m = shapeOutput("mail.message.get", { message: { ...(mailRowsOut(1) as { messages: object[] }).messages[0] }, text: lorem(50_000), html: "<p>x</p>", attachments: [{ attachmentId: "a1", name: "c.pdf", mime: "application/pdf", size: 5, fileId: "fil_1" }], provider: { traceId: "t", providerId: "p" } })!;
  const d = m.data as { text: string; textCut: number; attachments: unknown[] };
  assert.equal(d.text.length, 20_000);
  assert.equal(d.textCut, 30_000);
  assert.ok(!JSON.stringify(m.data).includes("<p>"));
  const htmlOnly = shapeOutput("mail.message.get", { message: {}, html: "<html><style>p{}</style><body><p>Hello <b>there</b></p></body></html>", attachments: [], provider: { traceId: "t" } })!;
  assert.match((htmlOnly.data as { text: string }).text, /^Hello there$/);
  const thread = shapeOutput("mail.thread.get", { threadId: "thr_1", subject: "S", role: "to", participants: [addr("a")], messages: Array.from({ length: 5 }, (_, k) => msg(1, k)) })!;
  const td = thread.data as { messages: Array<{ text: string; textCut?: number; quotedLeftOut?: boolean }>; needsReply: boolean };
  assert.ok(td.messages.every((x) => x.text.length <= 4000), "each message is cut at 4000 characters, whole when shorter");
  assert.ok(td.messages.every((x) => x.quotedLeftOut === true));
  assert.ok(!JSON.stringify(thread.data).includes("<html>"));
  assert.equal(td.needsReply, true);
  const ev = shapeOutput("calendar.get_event", { event: { ...(eventsOut(1).events[0] as object), description: lorem(9000) }, mine: { email: "i@x", response: "accepted" }, repeats: "week" })!;
  const ed = ev.data as { event: { description: string; descriptionCut?: number; attendees: unknown[] } };
  assert.ok(ed.event.description.length <= 4000 && ed.event.descriptionCut !== undefined, "a long description is cut at 4000 and says by how much");
  assert.equal(ed.event.attendees.length, 12, "who is on it is read whole");
});

test("limits: a default limit when none is given, a ceiling when too much is asked, other tools untouched", () => {
  for (const [cap, l] of Object.entries(LIMITS)) {
    const k = l.key ?? "limit";
    assert.equal((limited(cap, {}) as Record<string, number>)[k], l.dflt, cap);
    assert.equal((limited(cap, { [k]: 5_000_000 }) as Record<string, number>)[k], l.max, cap);
    assert.equal((limited(cap, { [k]: 3, q: "x" }) as Record<string, number>)[k], 3);
  }
  const input = { a: 1 };
  assert.equal(limited("tasks.get", input), input);
  assert.equal(limited("tasks.get", undefined), undefined);
});

test("through a tool call: the invoke gets a default limit, the model gets compact rows with meta, and a tool outside the list is unchanged", async () => {
  const loaded = loadGenerated();
  const seen: unknown[] = [];
  const base = fakeInvoke(loaded.caps).invoke;
  const invoke: CallDeps["invoke"] = async (cap, input, seed) => {
    if (cap === "calendar.list_events") { seen.push(input); return { status: "ok", output: eventsOut(60), traceId: "t" }; }
    if (cap === "mail.message.search") { seen.push(input); return { status: "ok", output: mailRowsOut(50), traceId: "t" }; }
    return base(cap, input, seed);
  };
  const session = createToolSession({ catalog: loaded.catalog, defaults: loaded.defaults, invoke, levelFor: () => null, canEngineer: () => false, traceId: () => "t" });
  session.preload("T1", ["calendar_list_events", "mail_message_search"]);
  const a = await session.call(ctx(), "calendar_list_events", { from: DAY0, to: DAY0 + 7 * 864e5 });
  assert.equal(a.kind, "result");
  assert.equal((seen[0] as { limit: number }).limit, LIMITS["calendar.list_events"]!.dflt, "no limit given: the default");
  const c = (a.kind === "result" ? a.result.content : {}) as { data: { events: unknown[] }; meta: { count: number; bytes: number; omitted?: number } };
  assert.ok(size(c.data) <= RESULT_BUDGET);
  assert.equal(c.meta.count, c.data.events.length);
  assert.equal(c.meta.bytes, size(c.data));
  assert.ok(size(a.kind === "result" ? a.result.content : null) <= RESULT_BUDGET + 1024, "the whole tool result, meta included, stays small");
  const b = await session.call(ctx(), "mail_message_search", { q: "invoice", limit: 500 });
  assert.equal((seen[1] as { limit: number }).limit, 100, "the ceiling");
  assert.ok(size(b.kind === "result" ? b.result.content : null) <= RESULT_BUDGET + 1024);
  session.preload("T1", ["notes_get"]);
  const other = await session.call(ctx(), "notes_get", {});
  assert.deepEqual(other.kind === "result" ? (other.result.content as { data: unknown }).data : null, { cap: "notes.get" }, "everything else comes back as it was");
});

// ---------------------------------------------------------------- records, files, tasks, memory and chat

const recordRows = (n: number): unknown => ({ total: n + 400, next: "c", rows: Array.from({ length: n }, (_, i) => ({ id: `rec_${i}`, type: "contact", version: 3, label: 1, createdAt: DAY0, updatedAt: DAY0 + i * 6e5, holds: 0, fields: { name: `Person ${i}`, email: `p${i}@clientco.example`, phone: "+1 415 555 0100", notes: lorem(3000), history: Array.from({ length: 40 }, (_, k) => ({ at: k, text: lorem(120) })), tags: ["a", "b", "c", "d", "e"], company: `Company ${i}`, title: "Partner", address: lorem(200), source: "import", stage: "lead", owner: "usr_1", extra: lorem(900) } })) });
const fileMeta = (i: number): unknown => ({ fileId: `fil_${i}`, folderId: "fld_1", name: `Contract draft number ${i}.docx`, kind: "document", mime: "application/vnd.openxmlformats", size: 120000, version: 4, label: 1, ownerId: "usr_1", createdAt: DAY0, updatedAt: DAY0 + i, updatedBy: "usr_1", thumb: true, holds: 0, source: { mountId: "mnt_1", provider: "google" } });
const filesOut = (n: number): unknown => ({ total: n + 300, next: "c", files: Array.from({ length: n }, (_, i) => fileMeta(i)), folders: Array.from({ length: 40 }, (_, i) => ({ folderId: `fld_${i}`, name: `Folder ${i}`, path: `/Clients/Folder ${i}`, fileCount: 12, folderCount: 2, scope: "space", label: 1, git: false, reviewChanges: false })) });
const tasksOut = (n: number): unknown => ({ total: n + 100, next: "c", tasks: Array.from({ length: n }, (_, i) => ({ id: `tsk_${i}`, kind: "work", title: `Review the lease and send notes ${i}`, summary: lorem(400), why: lorem(300), state: "todo", blocked: false, blocks: [{ type: "text", data: lorem(1500) }], actions: [{ key: "done", label: "Done" }, { key: "block", label: "Block" }], assigned: { kind: "person", id: "usr_1" }, fileIds: ["fil_1", "fil_2"], dependsOn: [], followers: ["usr_2", "usr_3"], workingNotes: { a: lorem(600) }, reviewLoops: 0, createdBy: "usr_1", createdAt: DAY0, updatedAt: DAY0, due: DAY0 + 864e5, priority: "high", fields: { x: lorem(500) } })) });
const memoryOut = (n: number): unknown => ({ tookMs: 12, meaning: { state: "on", model: "m", hint: lorem(200) }, hits: Array.from({ length: n }, (_, i) => ({ kind: "fact", factId: `fct_${i}`, title: `Fact ${i}`, text: lorem(1500), layer: "person", score: 0.8123456, lesson: { used: 2, scope: "you" }, subject: { pageId: "pg_1", title: "Elena", kind: "person" }, sourceLink: "https://x.example/a", by: "usr_1", byKind: "person", versions: 2 })) });
const chatOut = (n: number): unknown => ({ hasMore: true, messages: Array.from({ length: n }, (_, i) => ({ messageId: `msg_${i}`, threadId: "thr_1", threadSeq: 100 + i, author: { kind: i % 2 ? "agent" : "person", id: i % 2 ? "agt_1" : "usr_1" }, kind: "text", body: lorem(2500), blocks: [{ type: "table", v: 1, id: `b${i}`, data: { rows: lorem(2500) }, traceId: "t" }], depth: 0, attachments: ["fil_1"], reactions: [{ emoji: "ok", by: ["usr_1"] }], pinned: false, createdAt: DAY0 + i * 6e4 })) });
const recentOut = (n: number): unknown => ({ starred: [], today: Array.from({ length: n }, (_, i) => ({ threadId: `thr_${i}`, kind: "chat", title: `Chat about the lease ${i} ${lorem(100)}`, agents: ["agt_1", "agt_2"], unread: 1, working: false, starred: false, lastAt: DAY0 + i, preview: lorem(300), people: ["usr_1", "usr_2"] })), yesterday: [], earlier: [], archived: [] });

test("records, files, tasks, memory and chat: every list stays under the budget and far below its raw size", () => {
  const rows: Array<[string, unknown]> = [
    ["records.search", recordRows(100)], ["records.query", recordRows(100)], ["files.list", filesOut(100)], ["files.recent", { files: Array.from({ length: 50 }, (_, i) => fileMeta(i)) }],
    ["tasks.list", tasksOut(80)], ["memory.search", memoryOut(30)], ["chat.messages.list", chatOut(60)], ["chat.recent", recentOut(60)],
    ["memory.facts.list", { total: 500, next: "c", facts: Array.from({ length: 100 }, (_, i) => ({ factId: `f${i}`, layer: "person", ownerRef: "o", text: lorem(900), validFrom: DAY0, learnedAt: DAY0, sourceKind: "chat", sourceRef: "thr_1", status: "current", subject: { pageId: "p", title: "t", kind: "k" } })) }],
    ["notes.search", { notes: Array.from({ length: 30 }, (_, i) => ({ noteId: `n${i}`, title: `Note ${i}`, snippet: lorem(600), labels: ["a"], owner: "usr_1", updatedAt: DAY0 })) }],
    ["chat.search", { meaning: true, sealedChats: 0, tookMs: 3, hits: Array.from({ length: 30 }, (_, i) => ({ messageId: `m${i}`, threadId: "thr_1", threadSeq: i, author: { kind: "person", id: "usr_1" }, snippet: lorem(500), at: DAY0, score: 1, found: "both", thread: { kind: "chat", title: "T", agentIds: ["agt_1"], memberIds: ["usr_1", "usr_2", "usr_3"] } })) }],
    ["chat.transcript.search", { hits: Array.from({ length: 30 }, (_, i) => ({ turnId: `t${i}`, threadId: "thr_1", idx: i, role: "user", snippet: lorem(500), at: DAY0, link: "vyre://x" })) }],
  ];
  for (const [cap, out] of rows) {
    const before = size(out), s = shapeOutput(cap, out)!;
    assert.ok(s, cap);
    const after = size(s.data);
    assert.equal(s.meta.bytes, after, cap);
    assert.ok(after <= RESULT_BUDGET + 600, `${cap}: ${after} bytes after`);
    assert.ok(before > (["files.recent", "notes.search", "chat.search", "chat.transcript.search"].includes(cap) ? 2 : 4) * after, `${cap}: ${before} before, ${after} after`);
    console.log(`  size ${cap}: ${before} -> ${after} bytes (${s.meta.count} rows${s.meta.omitted ? `, ${s.meta.omitted} left out` : ""})`);
  }
});

test("reading: a file's text is cut at 20000 and says so, base64 is left out, a record's long fields are cut, a transcript is cut", () => {
  const f = shapeOutput("files.read", { text: lorem(120_000), mime: "text/plain", size: 120_000, version: 2, truncated: false })!;
  const fd = f.data as { text: string; textCut: number; truncated: boolean };
  assert.equal(fd.text.length, 20_000);
  assert.equal(fd.textCut, 100_000);
  assert.equal(fd.truncated, true);
  const b = shapeOutput("files.read", { base64: "A".repeat(60_000), mime: "image/png", size: 45_000, version: 1, truncated: false })!;
  assert.equal((b.data as { base64Omitted: number }).base64Omitted, 60_000);
  assert.ok(!JSON.stringify(b.data).includes("AAAA"));
  const r = shapeOutput("records.get", { record: { id: "rec_1", type: "contact", version: 1, label: 1, createdAt: 0, updatedAt: 0, holds: 0, fields: { notes: lorem(5000), name: "Elena", big: { x: lorem(3000) } } } })!;
  const rd = r.data as { record: { fields: { notes: string; name: string; big: string }; fieldsCut: number } };
  assert.equal(rd.record.fields.notes.length, 1000);
  assert.equal(rd.record.fields.name, "Elena");
  assert.match(rd.record.fields.big, /^\[too long/);
  assert.equal(rd.record.fieldsCut, 2);
  const t = shapeOutput("chat.transcript.read", { markdown: lorem(70_000), next: 21 })!;
  assert.equal((t.data as { markdown: string; markdownCut: number; next: number }).markdown.length, 20_000);
  assert.equal((t.data as { markdownCut: number }).markdownCut, 50_000);
  assert.equal((t.data as { next: number }).next, 21);
});

test("rows keep what names them: a record's first fields, a task's state and due, a chat message's seq and resume point", () => {
  const rec = (shapeOutput("records.search", recordRows(2))!.data as { rows: Array<{ id: string; fields: Record<string, unknown> }> }).rows[0]!;
  assert.equal(rec.id, "rec_0");
  assert.equal(Object.keys(rec.fields).length, 8, "at most eight fields");
  assert.equal(rec.fields["name"], "Person 0");
  assert.ok(!JSON.stringify(rec).includes("ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. Lorem ipsum"), "a long note is cut to a line");
  const task = (shapeOutput("tasks.list", tasksOut(2))!.data as { tasks: Array<Record<string, unknown>> }).tasks[0]!;
  assert.deepEqual(Object.keys(task).sort(), ["assignee", "due", "id", "kind", "priority", "state", "summary", "title"]);
  const chat = shapeOutput("chat.messages.list", chatOut(60))!;
  assert.ok((chat.meta.omitted ?? 0) > 0 && typeof chat.meta.resume?.["before"] === "number", "rows left out: resume before the first one left out");
  const few = shapeOutput("chat.messages.list", chatOut(3))!;
  assert.equal(few.meta.resume?.["before"], 100, "hasMore with nothing left out: resume before the oldest row");
  assert.ok(!JSON.stringify(chat.data).includes("traceId"), "no block data in a list of messages");
});

test("limits for the new tools, and a file is read a slice at a time", () => {
  for (const cap of ["records.search", "records.query", "files.list", "files.recent", "tasks.list", "memory.search", "memory.facts.list", "notes.search", "chat.messages.list", "chat.search", "chat.transcript.read", "chat.transcript.search"]) {
    const l = LIMITS[cap]!;
    assert.equal((limited(cap, {}) as { limit: number }).limit, l.dflt, cap);
    assert.equal((limited(cap, { limit: 9999 }) as { limit: number }).limit, l.max, cap);
  }
  assert.equal((limited("files.read", { fileId: "fil_1" }) as { length: number }).length, 20_000, "no length given: the first 20000");
  assert.equal((limited("files.read", { fileId: "fil_1", length: 5_000_000 }) as { length: number }).length, 100_000);
  assert.equal((limited("files.read", { fileId: "fil_1", offset: 20_000, length: 100 }) as { offset: number }).offset, 20_000, "the rest of the input is kept");
});

test("an answer without the contract's shape (an error body, a stand-in, a later contract) passes through as it is", () => {
  for (const cap of Object.keys(LIMITS)) assert.equal(shapeOutput(cap, { cap }), null, cap);
  assert.equal(shapeOutput("calendar.list_events", null), null);
  assert.equal(shapeOutput("tasks.get", { task: {} }), null, "a tool that is not in the table");
});
