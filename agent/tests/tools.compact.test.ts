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
    assert.equal((limited(cap, {}) as { limit: number }).limit, l.dflt, cap);
    assert.equal((limited(cap, { limit: 500 }) as { limit: number }).limit, l.max, cap);
    assert.equal((limited(cap, { limit: 3, q: "x" }) as { limit: number; q: string }).limit, 3);
  }
  const input = { a: 1 };
  assert.equal(limited("tasks.list", input), input);
  assert.equal(limited("tasks.list", undefined), undefined);
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
  const other = await session.call(ctx(), "tasks_list", {});
  assert.deepEqual(other.kind === "result" ? (other.result.content as { data: unknown }).data : null, { cap: "tasks.list" }, "everything else comes back as it was");
});
