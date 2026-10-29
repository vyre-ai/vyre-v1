import assert from "node:assert/strict";
import test from "node:test";
import {
  fillTokens, fixtureValues, messageSummary, readMessage, renderMessage, savedFromList, smsCount, toApiBlock, writeEmail, writeList, writeSms,
} from "./compose.ts";

test("a text counts GSM-7 segments, and a character outside that set uses Unicode", () => {
  assert.deepEqual(smsCount("Hi"), { encoding: "GSM-7", characters: 2, segments: 1, limit: 160 });
  assert.equal(smsCount("a".repeat(161)).segments, 2);
  assert.equal(smsCount("a".repeat(161)).limit, 153);
  assert.equal(smsCount("Hi 👋").encoding, "Unicode");
  assert.equal(smsCount("").segments, 0);
});

test("email write pins a version and the canvas names the subject", () => {
  const first = writeEmail({ mailboxId: "mbx_1", to: ["ada@example.com"] }, {
    subject: "Hello {{first_name|there}}",
    previewText: "A note",
    body: "<p>Hello {{first_name|there}}</p>",
    mode: "html",
    blocks: [],
    html: "<p>Hello {{first_name|there}}</p>",
    plain: "Hello {{first_name|there}}",
    replyTo: "reply@example.com",
    fromName: "Ada",
  });
  assert.equal(readMessage(first).version, 1);
  assert.equal(first.mailboxId, "mbx_1");
  assert.equal(messageSummary("send_email", first), "Email ada@example.com: Hello {{first_name|there}}, template v1");
  const again = writeEmail(first, {
    subject: "Hello {{first_name|there}}",
    previewText: "A note",
    body: "<p>Hello {{first_name|there}}</p>",
    mode: "html",
    blocks: [],
    html: "<p>Hello {{first_name|there}}</p>",
    plain: "Hello {{first_name|there}}",
    replyTo: "reply@example.com",
    fromName: "Ada",
  });
  assert.equal(readMessage(again).version, 1);
  const next = writeEmail(again, {
    subject: "Hello {{first_name|there}}",
    previewText: "Updated",
    body: "<p>Hello {{first_name|there}}</p><a href=\"#unsubscribe\">Unsubscribe</a>",
    mode: "html",
    blocks: [{ id: "s", kind: "saved", savedId: "blk_1", text: "Sign-off" }],
    html: "<p>Hello</p>",
    plain: "Hello",
    replyTo: "reply@example.com",
    fromName: "Ada",
  });
  assert.equal(readMessage(next).version, 2);
  assert.equal(readMessage(next).consent, "unsubscribe");
  assert.match(messageSummary("send_email", next) ?? "", /1 saved, template v2/);
});

test("a fixture fills the rendered email and the text", () => {
  const values = fixtureValues({
    trigger: { definitionVersion: 3, output: { first_name: "Ada" } },
  });
  assert.equal(values.first_name, "Ada");
  const email = renderMessage("send_email", {
    subject: "Hello {{first_name|there}}",
    body: "Hi {{first_name|there}}",
    message: { version: 1, previewText: "For {{first_name|there}}", mode: "plain", blocks: [], html: "", plain: "Hi {{first_name|there}}", replyTo: "", fromName: "", consent: "none" },
  }, values);
  assert.equal(email, "Subject: Hello Ada\nPreview: For Ada\nHi Ada");
  assert.equal(fillTokens("Hi {{missing|friend}}", {}), "Hi friend");
  const text = renderMessage("send_sms", { to: "+15555550123", body: "Hi {{first_name|there}}" }, values);
  assert.match(text ?? "", /^Hi Ada\n1 GSM-7 segment/);
  assert.match(messageSummary("send_sms", { to: "+15555550123", body: "Hi", mediaFileIds: ["file_1"] }) ?? "", /1 segment, 1 file/);
});

test("text write keeps the number and drops an empty media list", () => {
  const next = writeSms({ numberId: "num_1", to: "+15555550123", mediaFileIds: ["file_old"] }, { body: "Hello", mediaFileIds: [" file_1 "] });
  assert.equal(next.numberId, "num_1");
  assert.deepEqual(next.mediaFileIds, ["file_1"]);
  const cleared = writeSms(next, { body: "Hello", mediaFileIds: [] });
  assert.equal("mediaFileIds" in cleared, false);
  assert.deepEqual(writeList({ to: ["a@b.c"] }, "cc", "c@d.e, f@g.h").cc, ["c@d.e", "f@g.h"]);
});

test("saved blocks from the catalog become builder blocks", () => {
  const saved = savedFromList([{
    blockId: "blk_1",
    name: "Sign-off",
    shared: true,
    block: { type: "footer", props: { text: "Thanks", unsub: true } },
  }]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.block.kind, "footer");
  assert.equal(saved[0]?.block.unsub, true);
  assert.equal(toApiBlock(saved[0]!.block).type, "footer");
  assert.equal(savedFromList([{ blockId: "blk_2", name: "Odd", block: { type: "not-a-block", props: {} } }]).length, 0);
});
