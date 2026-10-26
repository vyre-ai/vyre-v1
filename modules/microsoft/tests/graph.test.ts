// ms.mail.*, ms.calendar.*, ms.drive.*, ms.teams.recordings.* and the mailbox pull, replayed from recorded Graph responses (fixtures/graph):
// delta pages, drafts and removed items left out, attachments, an expired delta token, and the error mapping every Graph call shares.
// No socket is opened. The @reads lines put the recordings in the import graph, so a change to them selects this file:
// @reads /modules/microsoft/fixtures/graph/delta-inbox-1.json
// @reads /modules/microsoft/fixtures/graph/delta-inbox-2.json
// @reads /modules/microsoft/fixtures/graph/delta-sent.json
// @reads /modules/microsoft/fixtures/graph/delta-empty.json
// @reads /modules/microsoft/fixtures/graph/delta-resync.json
// @reads /modules/microsoft/fixtures/graph/message-g1.json
// @reads /modules/microsoft/fixtures/graph/message-g2.json
// @reads /modules/microsoft/fixtures/graph/message-g3.json
// @reads /modules/microsoft/fixtures/graph/message-g9.json
// @reads /modules/microsoft/fixtures/graph/message-nosender.json
// @reads /modules/microsoft/fixtures/graph/attachments-g1.json
// @reads /modules/microsoft/fixtures/graph/attachment-a1.json
import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarDelta, calendars, driveDelete, driveDelta, driveDownload, driveFolder, driveItem, driveItems, driveShare, driveUpload, eventCreate, eventDelete, eventGet,
  eventRespond, events, eventUpdate, mailAttachment, mailDelete, mailDelta, mailDraft, mailFolders, mailGet, mailMessages, mailMove, mailSend, mailUpdate, meetingTimes,
  pollInterval, pullMailbox, recordingGet, recordings, schedule, transcriptGet, transcripts,
} from "../handlers/graph.ts";
import { act, codeOf, CONN, contractErrors, fixture, harness, NOW, seedConsent, U } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const MAYA = "maya@vyre.test";
const check = (cap: string, out: unknown): void => assert.deepEqual(contractErrors(cap, "out", out), [], cap);
const q = (url: string, key: string): string | null => new URL(url).searchParams.get(key);

function ready(): Harness {
  const h = harness();
  seedConsent(h);
  return h;
}

/** The recorded first walk: Inbox in two pages, Sent Items in one, and the messages behind them. */
function mailbox(h: Harness): void {
  h.on("GET", `${U}/mailFolders/inbox/messages/delta?$select`, { body: fixture("graph/delta-inbox-1.json") });
  h.on("GET", /skiptoken=S2/, { body: fixture("graph/delta-inbox-2.json") });
  h.on("GET", `${U}/mailFolders/sentitems/messages/delta?$select`, { body: fixture("graph/delta-sent.json") });
  for (const id of ["g1", "g2", "g3", "g9"]) h.on("GET", `${U}/messages/${id}?`, { body: fixture(`graph/message-${id}.json`) });
  h.on("GET", `${U}/messages/g1/attachments?`, { body: fixture("graph/attachments-g1.json") });
  h.on("GET", `${U}/messages/g1/attachments/a1`, { body: fixture("graph/attachment-a1.json") });
}

// ---- the pull

test("delta pages: new mail lands once, in both folders, with its parts; drafts and removed items are left out; the delta links are kept", async () => {
  const h = ready();
  mailbox(h);
  const pull = await pullMailbox(h.ctx, { connectionId: CONN, mailbox: MAYA });
  assert.deepEqual([pull.ingested, pull.deduped, pull.skipped, pull.complete, pull.bootstrapped], [4, 0, 1, true, true]);
  assert.deepEqual(h.ingests.map((i) => i.providerId), ["g1", "g2", "g3", "g9"]);   // g1 changed twice in the walk and lands once

  const [g1, g2, , g9] = h.ingests;
  assert.deepEqual(g1, {
    source: "microsoft", envelopeTo: MAYA, providerId: "g1", rfcMessageId: "<AAA111@acme.test>", threadKey: "conv1", direction: "in",
    from: { address: "pat@acme.test", name: "Pat Lee" }, to: [{ address: MAYA, name: "Maya" }, { address: "sam@vyre.test" }], cc: [{ address: "kim@acme.test" }],
    subject: "Can we talk?", receivedAt: Date.parse("2026-10-25T08:00:00Z"),
    html: "<p>Hello&nbsp;Maya,</p><br>Thanks &amp; regards", text: "Hello Maya,\nThanks & regards",
    headers: { "in-reply-to": "<prev@vyre.test>", references: "<first@vyre.test> <prev@vyre.test>" },
    attachments: [{ name: "terms.pdf", mime: "application/pdf", size: 5, blobId: "blb_5b" }],   // inline, oversized and item attachments stay in Outlook
  });
  assert.deepEqual([g2!.rfcMessageId, g2!.text, g2!.html, g2!.cc], ["<graph-g2@outlook.office365.com>", "Yes.", undefined, []]);
  assert.deepEqual([g9!.direction, g9!.to, g9!.threadKey], ["out", [{ address: "pat@acme.test" }], "conv1"]);

  const first = h.hits(`${U}/mailFolders/inbox/messages/delta?$select`)[0]!.url;
  const since = new Date(NOW - 90 * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z");
  assert.equal(q(first, "$filter"), `receivedDateTime ge ${since}`);
  assert.equal(q(first, "$select"), "id,isDraft");
  const links = JSON.parse(String(h.rows(`SELECT "deltaLinks" FROM microsoft_mailbox`)[0]?.deltaLinks)) as Record<string, string>;
  assert.deepEqual(links, { inbox: `${U}/mailFolders/inbox/messages/delta?$deltatoken=D1`, sentitems: `${U}/mailFolders/sentitems/messages/delta?$deltatoken=SD1` });
  assert.deepEqual(h.rows(`SELECT "lastPolledAt", "lastActivityAt" FROM microsoft_mailbox`), [{ lastPolledAt: NOW, lastActivityAt: NOW }]);
  assert.equal(pull.nextPollMs, 2 * 60_000);
});

test("the next pull resumes from the saved delta links and reads only what changed", async () => {
  const h = ready();
  mailbox(h);
  await pullMailbox(h.ctx, { connectionId: CONN, mailbox: MAYA });
  h.on("GET", `${U}/mailFolders/inbox/messages/delta?$deltatoken=D1`, { body: fixture("graph/delta-empty.json") });
  h.on("GET", `${U}/mailFolders/sentitems/messages/delta?$deltatoken=SD1`, { body: { value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/users('mid')/mailFolders('sentitems')/messages/delta?$deltatoken=SD2" } });
  h.advance(5 * 60_000);
  const again = await pullMailbox(h.ctx, { connectionId: CONN, mailbox: MAYA });
  assert.deepEqual([again.ingested, again.bootstrapped, again.complete], [0, false, true]);
  assert.equal(h.ingests.length, 4);
  assert.deepEqual(JSON.parse(String(h.rows(`SELECT "deltaLinks" FROM microsoft_mailbox`)[0]?.deltaLinks)), { inbox: `${U}/mailFolders/inbox/messages/delta?$deltatoken=D2`, sentitems: `${U}/mailFolders/sentitems/messages/delta?$deltatoken=SD2` });
  assert.equal(again.nextPollMs, 2 * 60_000);   // active five minutes ago
});

test("when mail.ingest cannot take a message the folder's delta link stays, so nothing is lost", async () => {
  const h = ready();
  mailbox(h);
  h.ingestState.fail = true;
  const pull = await pullMailbox(h.ctx, { connectionId: CONN, mailbox: MAYA });
  assert.deepEqual([pull.ingested, pull.complete], [0, false]);
  assert.deepEqual(JSON.parse(String(h.rows(`SELECT "deltaLinks" FROM microsoft_mailbox`)[0]?.deltaLinks)), {});
  h.ingestState.fail = false;
  const again = await pullMailbox(h.ctx, { connectionId: CONN, mailbox: MAYA });
  assert.deepEqual([again.ingested, again.complete], [4, true]);
});

test("an expired delta token starts that folder over; a known message counts as deduped; a sender-less one and a vanished one are skipped", async () => {
  const h = ready();
  mailbox(h);
  h.ctx.db.run(`INSERT INTO microsoft_mailbox (email, "connectionId", "deltaLinks", "lastPolledAt", "lastActivityAt", "nextPollAt") VALUES (?, ?, ?, ?, ?, ?)`, MAYA, CONN,
    JSON.stringify({ inbox: `${U}/mailFolders/inbox/messages/delta?$deltatoken=OLD` }), null, null, null);
  h.on("GET", `${U}/mailFolders/inbox/messages/delta?$deltatoken=OLD`, { status: 410, body: fixture("graph/delta-resync.json") });
  h.on("GET", `${U}/messages/gn?`, { body: fixture("graph/message-nosender.json") });
  h.ingestState.deduped.add("g2");
  const pull = await pullMailbox(h.ctx, { connectionId: CONN, mailbox: MAYA });
  assert.equal(pull.bootstrapped, true);
  assert.deepEqual([pull.ingested, pull.deduped], [3, 1]);
  assert.equal(h.hits(`${U}/mailFolders/inbox/messages/delta?$select`).length, 1);

  const h2 = ready();
  h2.on("GET", `${U}/mailFolders/inbox/messages/delta?$select`, { body: { value: [{ id: "gn" }, { id: "vanished" }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/users('mid')/mailFolders('inbox')/messages/delta?$deltatoken=Z1" } });
  h2.on("GET", `${U}/mailFolders/sentitems/messages/delta?$select`, { body: { value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/users('mid')/mailFolders('sentitems')/messages/delta?$deltatoken=Z2" } });
  h2.on("GET", `${U}/messages/gn?`, { body: fixture("graph/message-nosender.json") });
  const quiet = await pullMailbox(h2.ctx, { connectionId: CONN, mailbox: MAYA });
  assert.deepEqual([quiet.ingested, quiet.skipped, quiet.complete], [0, 2, true]);
  assert.equal(h2.rows(`SELECT "lastActivityAt" FROM microsoft_mailbox`)[0]?.lastActivityAt, null);   // nothing new: not an active mailbox
});

test("a walk past the page cap hands back a position that continues it; a walk with no end is refused", async () => {
  const h = ready();
  let n = 0;
  h.on("GET", `${U}/mailFolders/inbox/messages/delta`, () => ({ body: { value: [{ id: `x${++n}` }], "@odata.nextLink": `https://graph.microsoft.com/v1.0/users('mid')/mailFolders('inbox')/messages/delta?$skiptoken=P${n}` } }));
  h.on("GET", /skiptoken=P/, () => ({ body: { value: [{ id: `x${++n}` }], "@odata.nextLink": `https://graph.microsoft.com/v1.0/users('mid')/mailFolders('inbox')/messages/delta?$skiptoken=P${n}` } }));
  const r = await mailDelta(h.ctx, { ...act, folderId: "inbox" });
  assert.equal(r.changed.length, 20);
  assert.equal(r.deltaLink, `${U}/mailFolders/inbox/messages/delta?$skiptoken=P20`);
  const h2 = ready();
  h2.on("GET", `${U}/mailFolders/inbox/messages/delta`, { body: { value: [] } });
  await assert.rejects(() => mailDelta(h2.ctx, { ...act, folderId: "inbox" }), (e) => codeOf(e) === "provider.bad_response");
  const h3 = ready();
  h3.on("GET", `${U}/mailFolders/inbox/messages/delta`, { body: { value: [], "@odata.nextLink": "https://evil.example/steal" } });
  await assert.rejects(() => mailDelta(h3.ctx, { ...act, folderId: "inbox" }), (e) => codeOf(e) === "provider.bad_response");
  assert.equal(h3.requests.length, 1);   // the foreign address was never called
});

test("polling slows as a mailbox quiets: 2 minutes active, 15 idle, an hour dormant or subscribed", () => {
  const H = 3_600_000;
  assert.equal(pollInterval(NOW, NOW - 5 * 60_000, false), 2 * 60_000);
  assert.equal(pollInterval(NOW, NOW - 2 * H, false), 15 * 60_000);
  assert.equal(pollInterval(NOW, NOW - 25 * H, false), H);
  assert.equal(pollInterval(NOW, null, false), 15 * 60_000);
  assert.equal(pollInterval(NOW, NOW, true), H);
});

// ---- delta capabilities and the delta link rule

test("a delta link is rebuilt from its position token for this member, never followed as given", async () => {
  const h = ready();
  h.on("GET", `${U}/mailFolders/inbox/messages/delta`, { body: { value: [{ id: "g1", subject: "S", receivedDateTime: "2026-10-25T08:00:00Z" }, { id: "gx", "@removed": { reason: "deleted" } }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/users('mid')/mailFolders('inbox')/messages/delta?$deltatoken=NEXT" } });
  const first = await mailDelta(h.ctx, { ...act, folderId: "inbox" });
  assert.deepEqual([first.changed.map((m) => m.id), first.removed, first.deltaLink], [["g1"], ["gx"], `${U}/mailFolders/inbox/messages/delta?$deltatoken=NEXT`]);
  check("ms.mail.delta", first);

  await mailDelta(h.ctx, { ...act, folderId: "inbox", deltaLink: "https://graph.microsoft.com/v1.0/users('SOMEONE-ELSE')/mailFolders('inbox')/messages/delta?$deltatoken=EVIL" });
  const used = h.hits(`${U}/mailFolders/inbox/messages/delta`).at(-1)!.url;
  assert.equal(used, `${U}/mailFolders/inbox/messages/delta?$deltatoken=EVIL`);   // the caller's path is dropped; only the token crosses
  assert.ok(h.requests.every((r) => !r.url.includes("SOMEONE-ELSE")));
  for (const link of ["https://evil.example/delta?$deltatoken=T", "not an address", "https://graph.microsoft.com/v1.0/users/x/messages/delta"]) {
    await assert.rejects(() => mailDelta(h.ctx, { ...act, folderId: "inbox", deltaLink: link }), (e) => codeOf(e) === "validation.bad_input", link);
  }
});

// ---- mail

const msg = { id: "m1", conversationId: "c1", subject: "Hello", bodyPreview: "Hi", receivedDateTime: "2026-10-25T08:00:00Z", isRead: false, from: { emailAddress: { address: "pat@acme.test" } }, toRecipients: [{ emailAddress: { address: MAYA } }], categories: ["Blue"], parentFolderId: "f1" };

test("folders and messages: listing, search, paging by skip token, one message with its body", async () => {
  const h = ready();
  h.on("GET", `${U}/mailFolders?`, { body: { value: [{ id: "f1", displayName: "Inbox", unreadItemCount: 3 }, { id: "f2", displayName: "Archive" }] } });
  h.on("GET", `${U}/mailFolders/f1/messages?`, { body: { value: [msg], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users('mid')/mailFolders('f1')/messages?$skiptoken=TK9" } });
  h.on("GET", `${U}/messages?`, { body: { value: [] } });
  h.on("GET", `${U}/messages/m1?`, { body: { ...msg, body: { contentType: "html", content: "<p>Hi</p>" } } });
  const folders = await mailFolders(h.ctx, act);
  assert.deepEqual(folders.folders, [{ id: "f1", displayName: "Inbox", unreadItemCount: 3 }, { id: "f2", displayName: "Archive" }]);
  const page = await mailMessages(h.ctx, { ...act, folderId: "f1", top: 25, skipToken: "TK1" });
  assert.deepEqual(page.messages[0], msg);
  assert.equal(page.nextSkipToken, "TK9");
  const u = h.hits(`${U}/mailFolders/f1/messages?`)[0]!.url;
  assert.deepEqual([q(u, "$top"), q(u, "$skiptoken"), q(u, "$orderby")], ["25", "TK1", "receivedDateTime desc"]);
  await mailMessages(h.ctx, { ...act, search: 'from:"pat" report' });
  const s = h.hits(`${U}/messages?`)[0]!.url;
  assert.deepEqual([q(s, "$search"), q(s, "$orderby")], ['"from:pat report"', null]);   // $search cannot be ordered, and its quotes are Microsoft's
  const one = await mailGet(h.ctx, { ...act, messageId: "m1" });
  assert.deepEqual([one.message.id, one.body], ["m1", "<p>Hi</p>"]);
  for (const [cap, out] of [["ms.mail.list_folders", folders], ["ms.mail.list_messages", page], ["ms.mail.get_message", one]] as const) check(cap, out);
});

test("mark read, categorise, move, delete and fetch an attachment", async () => {
  const h = ready();
  h.on("PATCH", `${U}/messages/m1`, { body: { ...msg, isRead: true } });
  h.on("POST", `${U}/messages/m1/move`, { body: { ...msg, parentFolderId: "f2" } });
  h.on("GET", `${U}/messages/m1/attachments/a1`, { body: fixture("graph/attachment-a1.json") });
  const upd = await mailUpdate(h.ctx, { ...act, messageId: "m1", isRead: true, categories: ["Red"] });
  assert.deepEqual(h.hits(`${U}/messages/m1`, "PATCH")[0]!.body, { isRead: true, categories: ["Red"] });
  assert.equal(upd.message.isRead, true);
  const moved = await mailMove(h.ctx, { ...act, messageId: "m1", folderId: "f2" });
  assert.deepEqual(h.hits(`${U}/messages/m1/move`)[0]!.body, { destinationId: "f2" });
  assert.equal(moved.message.parentFolderId, "f2");
  assert.deepEqual(await mailDelete(h.ctx, { ...act, messageId: "m1" }), { deleted: true });
  assert.deepEqual(h.hits(`${U}/messages/m1/move`)[1]!.body, { destinationId: "deleteditems" });   // a delete is a move to Deleted Items
  const blob = await mailAttachment(h.ctx, { ...act, messageId: "m1", attachmentId: "a1" });
  assert.deepEqual(blob, { blobId: "blb_5b", size: 5 });
  for (const [cap, out] of [["ms.mail.update_message", upd], ["ms.mail.move_message", moved], ["ms.mail.get_attachment", blob]] as const) check(cap, out);
});

test("a draft and a send carry the recipients and body as Graph wants them, with the addresses checked", async () => {
  const h = ready();
  h.on("POST", `${U}/messages`, { body: { id: "draft1" } });
  h.on("POST", `${U}/sendMail`, { status: 202 });
  const d = await mailDraft(h.ctx, { ...act, to: ["pat@acme.test"], cc: ["kim@acme.test"], subject: "Hello\r\nBcc: evil@x.test", html: "<b>Hi</b>" });
  assert.deepEqual(d, { draftId: "draft1" });
  assert.deepEqual(h.hits(`${U}/messages`, "POST")[0]!.body, {
    subject: "Hello Bcc: evil@x.test", body: { contentType: "HTML", content: "<b>Hi</b>" }, toRecipients: [{ emailAddress: { address: "pat@acme.test" } }], ccRecipients: [{ emailAddress: { address: "kim@acme.test" } }],
  });
  const sent = await mailSend(h.ctx, { ...act, to: ["pat@acme.test"], bcc: ["boss@vyre.test"], subject: "Menu", text: "plain", attachments: ["fil_menu"], conversationId: "conv1" });
  assert.deepEqual(sent, { sent: true });
  const body = h.hits(`${U}/sendMail`)[0]!.body as { message: Record<string, unknown>; saveToSentItems: boolean };
  assert.equal(body.saveToSentItems, true);
  assert.deepEqual(body.message.body, { contentType: "Text", content: "plain" });
  assert.deepEqual(body.message.bccRecipients, [{ emailAddress: { address: "boss@vyre.test" } }]);
  assert.deepEqual(body.message.attachments, [{ "@odata.type": "#microsoft.graph.fileAttachment", name: "fil_menu.txt", contentType: "text/plain", contentBytes: Buffer.from("file body").toString("base64") }]);
  check("ms.mail.create_draft", d);
  check("ms.mail.send_message", sent);
  for (const bad of [{ to: [] }, { to: ["not an address"] }, { to: ["a@b.test"], cc: ["x y@b.test"] }, { to: ["a@b.test"], text: undefined }]) {
    await assert.rejects(() => mailSend(h.ctx, { ...act, subject: "s", text: "t", ...(bad as object) } as Parameters<typeof mailSend>[1]), (e) => codeOf(e) === "validation.bad_input", JSON.stringify(bad));
  }
  assert.equal(h.hits(`${U}/sendMail`).length, 1);
});

// ---- calendar

const ev = { id: "e1", subject: "Intake", start: { dateTime: "2026-10-26T10:00:00", timeZone: "UTC" }, end: { dateTime: "2026-10-26T10:30:00", timeZone: "UTC" }, location: { displayName: "Room 1" },
  onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/abc" }, organizer: { emailAddress: { address: "pat@acme.test" } }, isCancelled: false,
  attendees: [{ emailAddress: { address: MAYA }, status: { response: "none" }, type: "required" }, { emailAddress: { address: "pat@acme.test" }, type: "optional" }] };

test("calendars and events map to the contract; a view is asked for its range and paged by skip token", async () => {
  const h = ready();
  h.on("GET", `${U}/calendars`, { body: { value: [{ id: "cal1", name: "Calendar", color: "auto", isDefaultCalendar: true, canEdit: true }, { id: "cal2", name: "Team" }] } });
  h.on("GET", `${U}/calendar/calendarView?`, { body: { value: [ev], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users('mid')/calendar/calendarView?$skiptoken=E2" } });
  h.on("GET", `${U}/calendars/cal2/calendarView?`, { body: { value: [] } });
  h.on("GET", `${U}/events/e1`, { body: ev });
  const cals = await calendars(h.ctx, act);
  assert.deepEqual(cals.calendars, [{ id: "cal1", name: "Calendar", color: "auto", isDefault: true, canEdit: true }, { id: "cal2", name: "Team" }]);
  const list = await events(h.ctx, { ...act, start: "2026-10-26T00:00:00Z", end: "2026-10-27T00:00:00Z" });
  const u = h.hits(`${U}/calendar/calendarView?`)[0]!.url;
  assert.deepEqual([q(u, "startDateTime"), q(u, "endDateTime")], ["2026-10-26T00:00:00Z", "2026-10-27T00:00:00Z"]);
  assert.equal(list.nextSkipToken, "E2");
  assert.deepEqual(list.events[0], { id: "e1", subject: "Intake", start: ev.start, end: ev.end, location: ev.location, onlineMeeting: ev.onlineMeeting, organizer: ev.organizer, isCancelled: false,
    attendees: [{ email: MAYA, response: "none", type: "required" }, { email: "pat@acme.test", type: "optional" }] });
  await events(h.ctx, { ...act, calendarId: "cal2", start: "a", end: "b" });
  assert.equal(h.hits(`${U}/calendars/cal2/calendarView?`).length, 1);
  const one = await eventGet(h.ctx, { ...act, eventId: "e1" });
  for (const [cap, out] of [["ms.calendar.list_calendars", cals], ["ms.calendar.list_events", list], ["ms.calendar.get_event", one]] as const) check(cap, out);
});

test("an event is created with a Teams meeting and invitees, changed, answered and deleted", async () => {
  const h = ready();
  h.on("POST", `${U}/events`, { body: ev });
  h.on("POST", `${U}/calendars/cal2/events`, { body: ev });
  h.on("PATCH", `${U}/events/e1`, { body: { ...ev, subject: "Moved" } });
  h.on("POST", /\/events\/e1\/(accept|decline|tentativelyAccept)$/, { status: 202 });
  h.on("DELETE", `${U}/events/e1`, { status: 204 });
  const made = await eventCreate(h.ctx, { ...act, subject: "Intake", body: "<p>Agenda</p>", location: "Room 1", start: ev.start, end: ev.end, teamsMeeting: true, attendees: [{ email: "Pat@Acme.test", optional: true }, { email: "kim@acme.test" }] });
  assert.deepEqual(h.hits(`${U}/events`, "POST")[0]!.body, {
    subject: "Intake", body: { contentType: "HTML", content: "<p>Agenda</p>" }, location: { displayName: "Room 1" }, start: ev.start, end: ev.end,
    attendees: [{ emailAddress: { address: "pat@acme.test" }, type: "optional" }, { emailAddress: { address: "kim@acme.test" }, type: "required" }], isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness",
  });
  await eventCreate(h.ctx, { ...act, calendarId: "cal2", subject: "In another calendar" });
  assert.equal(h.hits(`${U}/calendars/cal2/events`, "POST").length, 1);
  const moved = await eventUpdate(h.ctx, { ...act, eventId: "e1", subject: "Moved" });
  assert.deepEqual(h.hits(`${U}/events/e1`, "PATCH")[0]!.body, { subject: "Moved" });
  const answered = await eventRespond(h.ctx, { ...act, eventId: "e1", response: "tentativelyAccept", comment: "Maybe" });
  assert.deepEqual(h.hits(/\/events\/e1\/tentativelyAccept$/)[0]!.body, { sendResponse: true, comment: "Maybe" });
  assert.deepEqual(await eventDelete(h.ctx, { ...act, eventId: "e1" }), { deleted: true });
  await assert.rejects(() => eventCreate(h.ctx, { ...act, attendees: [{ email: "nope" }] }), (e) => codeOf(e) === "validation.bad_input");
  for (const [cap, out] of [["ms.calendar.create_event", made], ["ms.calendar.update_event", moved], ["ms.calendar.respond", answered]] as const) check(cap, out);
});

test("a calendar delta, free/busy and suggested times", async () => {
  const h = ready();
  h.on("GET", `${U}/calendar/calendarView/delta`, { body: { value: [ev, { id: "e2", "@removed": { reason: "deleted" } }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/users('mid')/calendar/calendarView/delta?$deltatoken=CD1" } });
  h.on("POST", `${U}/calendar/getSchedule`, { body: { value: [{ scheduleId: MAYA, scheduleItems: [{ status: "busy", start: { dateTime: "2026-10-26T10:00:00.0000000" }, end: { dateTime: "2026-10-26T10:30:00.0000000" } }, { status: "free", start: { dateTime: "2026-10-26T11:00:00" }, end: { dateTime: "2026-10-26T11:30:00" } }] }] } });
  h.on("POST", `${U}/findMeetingTimes`, { body: { meetingTimeSuggestions: [{ confidence: 100, meetingTimeSlot: { start: { dateTime: "2026-10-26T14:00:00" }, end: { dateTime: "2026-10-26T14:30:00" } } }] } });
  const delta = await calendarDelta(h.ctx, { ...act, start: "2026-10-26T00:00:00Z", end: "2026-10-27T00:00:00Z" });
  assert.deepEqual([delta.changed.map((e) => e.id), delta.removed], [["e1"], ["e2"]]);
  assert.equal(delta.deltaLink, `${U}/calendar/calendarView/delta?startDateTime=2026-10-26T00%3A00%3A00Z&endDateTime=2026-10-27T00%3A00%3A00Z&$deltatoken=CD1`);
  await calendarDelta(h.ctx, { ...act, start: "2026-10-26T00:00:00Z", end: "2026-10-27T00:00:00Z", deltaLink: delta.deltaLink });
  assert.ok(h.hits(`${U}/calendar/calendarView/delta`).at(-1)!.url.endsWith("$deltatoken=CD1"));
  const busy = await schedule(h.ctx, { ...act, emails: [MAYA], start: "2026-10-26T00:00:00", end: "2026-10-27T00:00:00" });
  assert.deepEqual(busy.busy, [{ email: MAYA, start: "2026-10-26T10:00:00.0000000Z", end: "2026-10-26T10:30:00.0000000Z" }]);   // free blocks are dropped, UTC is marked
  const times = await meetingTimes(h.ctx, { ...act, emails: [MAYA, "pat@acme.test"], durationMinutes: 30, start: "2026-10-26T00:00:00", end: "2026-10-27T00:00:00" });
  assert.deepEqual(times.slots, [{ start: "2026-10-26T14:00:00Z", end: "2026-10-26T14:30:00Z", confidence: 100 }]);
  assert.equal((h.hits(`${U}/findMeetingTimes`)[0]!.body as { meetingDuration: string }).meetingDuration, "PT30M");
  await assert.rejects(() => meetingTimes(h.ctx, { ...act, emails: [MAYA], durationMinutes: 1, start: "a", end: "b" }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(() => schedule(h.ctx, { ...act, emails: ["nope"], start: "a", end: "b" }), (e) => codeOf(e) === "validation.bad_input");
  for (const [cap, out] of [["ms.calendar.delta", delta], ["ms.calendar.get_schedule", busy], ["ms.calendar.find_meeting_times", times]] as const) check(cap, out);
});

// ---- OneDrive and SharePoint

const item = { id: "i1", name: "Intake.docx", size: 2048, lastModifiedDateTime: "2026-10-25T08:00:00Z", webUrl: "https://vyre.sharepoint.com/i1", parentReference: { id: "root1" } };

test("drive items: a folder listing, one item, a delta, with the folder flag and the parent", async () => {
  const h = ready();
  h.on("GET", `${U}/drive/root/children`, { body: { value: [item, { id: "i2", name: "Matters", folder: { childCount: 3 } }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users('mid')/drive/root/children?$skiptoken=D2" } });
  h.on("GET", "https://graph.microsoft.com/v1.0/drives/d1/items/f9/children", { body: { value: [] } });
  h.on("GET", `${U}/drive/items/i1`, { body: item });
  h.on("GET", `${U}/drive/root/delta`, { body: { value: [item, { id: "i3", "@removed": {} }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/users('mid')/drive/root/delta?token=T1" } });
  const listing = await driveItems(h.ctx, act);
  assert.deepEqual(listing.items, [{ id: "i1", name: "Intake.docx", size: 2048, lastModifiedDateTime: item.lastModifiedDateTime, webUrl: item.webUrl, parentId: "root1" }, { id: "i2", name: "Matters", folder: true }]);
  assert.equal(listing.nextSkipToken, "D2");
  await driveItems(h.ctx, { ...act, driveId: "d1", folderId: "f9" });
  assert.equal(h.hits("https://graph.microsoft.com/v1.0/drives/d1/items/f9/children").length, 1);
  const got = await driveItem(h.ctx, { ...act, itemId: "i1" });
  const delta = await driveDelta(h.ctx, act);
  assert.deepEqual([delta.changed.length, delta.removed, delta.deltaLink], [1, ["i3"], `${U}/drive/root/delta?token=T1`]);
  for (const [cap, out] of [["ms.drive.list_items", listing], ["ms.drive.get_item", got], ["ms.drive.delta", delta]] as const) check(cap, out);
});

test("downloads and uploads go through the host with the app token, names are checked, and shares invite or link", async () => {
  const h = ready();
  const dl = await driveDownload(h.ctx, { ...act, itemId: "i1" });
  h.on("POST", `${U}/drive/items/f1/children`, { body: { id: "fo1", name: "Matters", folder: {} } });
  h.on("POST", `${U}/drive/items/i1/invite`, { body: { value: [] } });
  h.on("POST", `${U}/drive/items/i1/createLink`, { body: { link: { webUrl: "https://vyre.sharepoint.com/s/abc" } } });
  h.on("DELETE", `${U}/drive/items/i1`, { status: 204 });
  const up = await driveUpload(h.ctx, { ...act, folderId: "f1", name: "Contract.pdf", fileId: "fil_contract" });
  assert.deepEqual(dl, { blobId: "blb_download", size: 42 });
  assert.equal(up.item.name, "Contract.pdf");
  assert.equal(h.requests.length, 0);   // ctx.http carries only JSON; the transfers belong to the host
  assert.equal(h.state.mints, 1);   // one application token serves both
  await assert.rejects(() => driveUpload(h.ctx, { ...act, name: "a/b.pdf", fileId: "fil_x" }), (e) => codeOf(e) === "validation.bad_input");
  const folder = await driveFolder(h.ctx, { ...act, parentId: "f1", name: "Matters" });
  assert.deepEqual(h.hits(`${U}/drive/items/f1/children`)[0]!.body, { name: "Matters", folder: {}, "@microsoft.graph.conflictBehavior": "rename" });
  await assert.rejects(() => driveFolder(h.ctx, { ...act, name: "bad:name" }), (e) => codeOf(e) === "validation.bad_input");
  assert.deepEqual(await driveShare(h.ctx, { ...act, itemId: "i1", emails: ["Pat@Acme.test"], role: "write" }), { shared: true });
  assert.deepEqual(h.hits(`${U}/drive/items/i1/invite`)[0]!.body, { recipients: [{ email: "pat@acme.test" }], roles: ["write"], requireSignIn: true, sendInvitation: true });
  const link = await driveShare(h.ctx, { ...act, itemId: "i1", role: "read" });
  assert.deepEqual(link, { shared: true, link: "https://vyre.sharepoint.com/s/abc" });
  assert.deepEqual(h.hits(`${U}/drive/items/i1/createLink`)[0]!.body, { type: "view", scope: "organization" });
  await assert.rejects(() => driveShare(h.ctx, { ...act, itemId: "i1", emails: ["nope"], role: "read" }), (e) => codeOf(e) === "validation.bad_input");
  assert.deepEqual(await driveDelete(h.ctx, { ...act, itemId: "i1" }), { deleted: true });
  for (const [cap, out] of [["ms.drive.download_item", dl], ["ms.drive.upload_item", up], ["ms.drive.create_folder", folder], ["ms.drive.share_item", link]] as const) check(cap, out);
});

// ---- Teams

test("Teams recordings and transcripts: listings, a recording as a blob, a transcript as text", async () => {
  const h = ready();
  const base = `${U}/onlineMeetings/MEET1`;
  h.on("GET", `${base}/recordings`, { body: { value: [{ id: "r1", createdDateTime: "2026-10-25T09:00:00Z", recordingContentUrl: "https://graph.microsoft.com/x" }, { id: "r2" }] } });
  h.on("GET", `${base}/transcripts`, { body: { value: [{ id: "t1", createdDateTime: "2026-10-25T09:30:00Z" }] } });
  h.on("GET", `${base}/transcripts/t1/content`, { body: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello" });
  const recs = await recordings(h.ctx, { ...act, onlineMeetingId: "MEET1" });
  assert.deepEqual(recs.recordings, [{ id: "r1", createdAt: "2026-10-25T09:00:00Z", contentUrl: "https://graph.microsoft.com/x" }, { id: "r2" }]);
  assert.deepEqual(await recordingGet(h.ctx, { ...act, onlineMeetingId: "MEET1", recordingId: "r1" }), { blobId: "blb_download", size: 42 });
  const trs = await transcripts(h.ctx, { ...act, onlineMeetingId: "MEET1" });
  assert.deepEqual(trs.transcripts, [{ id: "t1", createdAt: "2026-10-25T09:30:00Z" }]);
  const vtt = await transcriptGet(h.ctx, { ...act, onlineMeetingId: "MEET1", transcriptId: "t1" });
  assert.equal(vtt.vtt, "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello");
  const req = h.hits(`${base}/transcripts/t1/content`)[0]!;
  assert.deepEqual([q(req.url, "$format"), req.headers.accept], ["text/vtt", "text/plain, text/vtt, */*"]);
  h.on("GET", `${base}/transcripts/t2/content`, { status: 404, body: "" });
  await assert.rejects(() => transcriptGet(h.ctx, { ...act, onlineMeetingId: "MEET1", transcriptId: "t2" }), (e) => codeOf(e) === "validation.not_found");
  for (const [cap, out] of [["ms.teams.recordings.list_recordings", recs], ["ms.teams.recordings.list_transcripts", trs], ["ms.teams.recordings.get_transcript", vtt]] as const) check(cap, out);
});

// ---- tokens, who it acts as, and errors

test("a call acts as the member through /users/{address} with the application token, which is reused until close to expiry; every call is logged for that member", async () => {
  const h = ready();
  h.on("GET", `${U}/mailFolders?`, { body: { value: [] } });
  await mailFolders(h.ctx, act);
  await mailFolders(h.ctx, act);
  assert.equal(h.state.mints, 1);
  assert.match(h.requests[0]!.headers.authorization ?? "", /^Bearer .+\..+\..+$/);
  h.advance(3_600_000 - 30_000);
  await mailFolders(h.ctx, act);
  assert.equal(h.state.mints, 2);
  const log = h.rows(`SELECT subject, actor, cap, bulk FROM microsoft_read_log`);
  assert.deepEqual(log, [1, 2, 3].map(() => ({ subject: MAYA, actor: "usr_maya01", cap: "ms.mail.list_folders", bulk: 1 })));
});

test("another member needs an admin or a service; an excluded or unmapped one is never reached", async () => {
  const sam = "sam@vyre.test";
  const members = [{ email: MAYA, userId: "usr_maya01" }, { email: sam, userId: "usr_sam01" }, { email: "kim@vyre.test", userId: "usr_kim01", excluded: true }];
  const plain = harness();
  seedConsent(plain, { members });
  plain.on("GET", /mailFolders/, { body: { value: [] } });
  await assert.rejects(() => mailFolders(plain.ctx, { ...act, as: sam }), (e) => codeOf(e) === "permission.no_grant");
  const boss = harness({ admin: true });
  seedConsent(boss, { members });
  boss.on("GET", /mailFolders/, { body: { value: [] } });
  await mailFolders(boss.ctx, { ...act, as: "SAM@vyre.test" });
  assert.match(boss.requests.at(-1)!.url, /users\/sam%40vyre\.test\//);
  await assert.rejects(() => mailFolders(boss.ctx, { ...act, as: "kim@vyre.test" }), (e) => codeOf(e) === "permission.no_grant");
  await assert.rejects(() => mailFolders(boss.ctx, { ...act, as: "stranger@vyre.test" }), (e) => codeOf(e) === "validation.precondition_failed");
  const svc = harness({ principal: { kind: "service", id: "svc_ms" } });
  seedConsent(svc, { members });
  svc.on("GET", /mailFolders/, { body: { value: [] } });
  await mailFolders(svc.ctx, { ...act, as: MAYA });
  await assert.rejects(() => mailFolders(svc.ctx, act), (e) => codeOf(e) === "validation.precondition_failed");
  const off = harness();
  seedConsent(off, { configured: false });
  await assert.rejects(() => mailFolders(off.ctx, act), (e) => codeOf(e) === "validation.precondition_failed");
  const agent = harness({ principal: { kind: "agent", id: "agt_scout01" }, actingFor: "usr_maya01" });
  seedConsent(agent);
  agent.on("GET", /mailFolders/, { body: { value: [] } });
  await mailFolders(agent.ctx, act);
  assert.deepEqual(agent.rows(`SELECT subject, actor FROM microsoft_read_log`), [{ subject: MAYA, actor: "usr_maya01" }]);
});

test("a 401 mints a new token once; a second 401 is an answer", async () => {
  const h = ready();
  let n = 0;
  h.on("GET", `${U}/mailFolders?`, () => (++n === 1 ? { status: 401, body: { error: { code: "InvalidAuthenticationToken" } } } : { body: { value: [] } }));
  assert.deepEqual(await mailFolders(h.ctx, act), { folders: [] });
  assert.equal(h.state.mints, 2);
  h.on("GET", `${U}/messages/m1?`, { status: 401, body: { error: { code: "InvalidAuthenticationToken" } } });
  await assert.rejects(() => mailGet(h.ctx, { ...act, messageId: "m1" }), (e) => codeOf(e) === "provider.auth_failed");
  assert.equal(h.state.mints, 3);
});

test("Graph's refusals map to the error catalogue without passing Graph's text on", async () => {
  const h = ready();
  const cases: [number, string | undefined, string][] = [
    [429, "ApplicationThrottled", "provider.rate_limited"], [403, "Authorization_RequestDenied", "provider.auth_failed"], [403, "ErrorAccessDenied", "permission.no_grant"],
    [404, "ErrorItemNotFound", "validation.not_found"], [400, "BadRequest", "validation.bad_input"], [410, "syncStateNotFound", "validation.precondition_failed"],
    [412, undefined, "validation.precondition_failed"], [503, "ServiceNotAvailable", "provider.unavailable"], [418, undefined, "provider.bad_response"],
  ];
  for (const [status, code, want] of cases) {
    h.on("GET", `${U}/mailFolders?`, { status, body: { error: { ...(code ? { code } : {}), message: "private text from the request" } } });
    await assert.rejects(() => mailFolders(h.ctx, act), (e) => {
      assert.equal(codeOf(e), want, `${status} ${code}`);
      assert.ok(!JSON.stringify(e).includes("private text"));
      return true;
    });
  }
  h.on("GET", `${U}/mailFolders?`, { throws: true });
  await assert.rejects(() => mailFolders(h.ctx, act), (e) => codeOf(e) === "provider.network");
  h.on("GET", `${U}/mailFolders?`, { body: "<html>not json</html>" });
  await assert.rejects(() => mailFolders(h.ctx, act), (e) => codeOf(e) === "provider.bad_response");
});
