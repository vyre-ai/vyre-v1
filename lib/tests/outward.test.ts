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
