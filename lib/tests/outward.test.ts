// The held outward act read in a person's words: each channel, when it is not now, and the body put back after an edit. No internal field name is part of the answer.
import test from "node:test";
import assert from "node:assert/strict";
import { outwardOf, scheduleWords, verbOfChannel, withBody } from "../outward.ts";

test("a message to a person: who, the body as written, and timing only when it is not now", () => {
  assert.deepEqual(outwardOf("chat.message_person", { to: "usr_aliza", body: "**Hi** Aliza\n\n- one\n- two", timing: "online" }), { channel: "message", to: [{ kind: "person", id: "usr_aliza" }], body: "**Hi** Aliza\n\n- one\n- two", bodyField: "body", schedule: { kind: "online" } });
  assert.equal(outwardOf("chat.message_person", { to: "usr_a", body: "x", timing: "now" })!.schedule, undefined, "now is not shown");
  assert.deepEqual(outwardOf("chat.message_person", { to: "usr_a", body: "x", timing: "at", at: 1_700_000_000_000, urgent: true })!.schedule, { kind: "at", at: 1_700_000_000_000 });
  assert.equal(outwardOf("chat.message_person", { to: "usr_a", body: "x", urgent: true })!.urgent, true);
});

test("email, text and a post", () => {
  const mail = outwardOf("mail.send", { mailboxId: "mbx_1", to: [{ address: "aliza@example.com", name: "Aliza" }, { address: "b@example.com" }], subject: "Deed", text: "Hi", html: "<p>Hi</p>", sendAt: 5 })!;
  assert.deepEqual([mail.channel, mail.to.map((r) => r.address), mail.subject, mail.body, mail.bodyField, mail.schedule], ["email", ["aliza@example.com", "b@example.com"], "Deed", "Hi", "text", { kind: "at", at: 5 }]);
  const sms = outwardOf("telephony.send_sms", { numberId: "num_1", to: "+14155550123", body: "On my way" })!;
  assert.deepEqual([sms.channel, sms.to, sms.body], ["text", [{ kind: "phone", address: "+14155550123" }], "On my way"]);
  assert.equal(outwardOf("twilio.sms.send", { to: "+14155550123", body: "x" })!.channel, "text");
  const post = outwardOf("chat.post", { threadId: "thr_1", body: "Posted" })!;
  assert.deepEqual([post.channel, post.to], ["post", [{ kind: "thread", id: "thr_1" }]]);
  assert.equal(outwardOf("files.write", { body: "x" }), null, "not an outward act");
});

test("the header's words by channel, and when it sends", () => {
  const name = (r: { id?: string; address?: string }): string => r.id === "usr_aliza" ? "Aliza Rizvi" : r.address ?? r.id ?? "";
  assert.equal(verbOfChannel(outwardOf("chat.message_person", { to: "usr_aliza", body: "x" })!, name), "message Aliza Rizvi");
  assert.equal(verbOfChannel(outwardOf("mail.send", { to: [{ address: "aliza@example.com" }], subject: "s", text: "x" })!, name), "email aliza@example.com");
  assert.equal(verbOfChannel(outwardOf("telephony.send_sms", { to: "+14155550123", body: "x" })!, name), "text +14155550123");
  assert.equal(verbOfChannel(outwardOf("mail.send", { to: [{ address: "a@x.test" }, { address: "b@x.test" }, { address: "c@x.test" }], subject: "s", text: "x" })!, name), "email a@x.test, b@x.test and 1 more");
  assert.equal(scheduleWords({ kind: "online" }, () => ""), "Sends when they are next online");
  assert.equal(scheduleWords({ kind: "at", at: 1 }, () => "at 9:00 her time"), "Sends at 9:00 her time");
  assert.equal(scheduleWords(undefined, () => ""), null);
});

test("an edit puts the new body back in the right field and nothing else changes; an email's HTML goes", () => {
  assert.deepEqual(withBody("chat.message_person", { to: "usr_a", body: "old", timing: "online" }, "new"), { to: "usr_a", body: "new", timing: "online" });
  assert.deepEqual(withBody("mail.send", { to: [{ address: "a@x.test" }], subject: "s", text: "old", html: "<p>old</p>" }, "new"), { to: [{ address: "a@x.test" }], subject: "s", text: "new" });
  assert.equal(withBody("files.write", {}, "x"), null);
});

import { whenWords } from "../outward.ts";

test("a calendar entry reads as an event: title, invitees, where with its link, the agenda, and whether they are emailed", () => {
  const g = outwardOf("google.calendar.create_event", {
    summary: "Rivera closing prep", description: "Agenda\n- the deed\n- the fee", location: "https://us02web.zoom.us/j/123456", sendUpdates: "all",
    start: { dateTime: "2026-11-04T14:00:00-08:00", timeZone: "America/Los_Angeles" }, end: { dateTime: "2026-11-04T15:00:00-08:00", timeZone: "America/Los_Angeles" },
    attendees: [{ email: "dana@client.test" }, { email: "sam@firm.test" }],
  })!;
  assert.equal(g.channel, "event");
  assert.equal(g.event!.title, "Rivera closing prep");
  assert.equal(g.event!.link, "https://us02web.zoom.us/j/123456");
  assert.equal(g.event!.where, undefined, "the link is not also a place");
  assert.equal(g.event!.notify, true);
  assert.deepEqual(g.to.map((r) => r.address), ["dana@client.test", "sam@firm.test"]);
  assert.equal(g.body, "Agenda\n- the deed\n- the fee");
  assert.equal(g.bodyField, "description");
  assert.equal(g.titleField, "summary");
  assert.equal(outwardOf("google.calendar.create_event", { summary: "x", sendUpdates: "none", attendees: [{ email: "a@b.c" }] })!.event!.notify, false);
  const v = outwardOf("calendar.create_event", { title: "Standup", startsAt: Date.UTC(2026, 10, 4, 22, 0), endsAt: Date.UTC(2026, 10, 4, 22, 30), agenda: "Blockers", location: "Room 4", attendees: [{ email: "a@b.c", name: "Ana" }] })!;
  assert.equal(v.bodyField, "agenda");
  assert.equal(v.event!.where, "Room 4");
  assert.equal(v.to[0]!.name, "Ana");
  const m = outwardOf("ms.calendar.create_event", { subject: "Review", body: "Notes", start: { dateTime: "2026-11-04T14:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-11-04T15:00:00.0000000", timeZone: "UTC" }, teamsMeeting: true })!;
  assert.equal(m.event!.startMs, Date.UTC(2026, 10, 4, 14, 0));
  assert.equal(m.event!.join, "teams");
  assert.equal(m.titleField, "subject");
});

test("when: the event's own zone first, the viewer's after, and the viewer's alone when the event named none", () => {
  const e = { title: "x", startMs: Date.UTC(2026, 10, 4, 22, 0), endMs: Date.UTC(2026, 10, 4, 23, 0), tz: "America/Los_Angeles", notify: false };
  assert.equal(whenWords(e, "Asia/Karachi"), "Wed 4 Nov, 2:00 to 3:00 pm PST · Thu 5 Nov, 3:00 am yours");
  assert.equal(whenWords(e, "America/Los_Angeles"), "Wed 4 Nov, 2:00 to 3:00 pm PST");
  const { tz: _t, ...bare } = e;
  assert.equal(whenWords(bare, "UTC"), "Wed 4 Nov, 10:00 to 11:00 pm");
  assert.equal(whenWords({ title: "x", notify: false }), null);
});
