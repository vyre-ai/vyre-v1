// Leak probe 2 (rc.44, 26 Nov 2026): what a member is told about a record. The owner comments on a contact and mentions the member, whose only access is a grant that hides its name, email and phone. The mention files
// an Answer request (tasks) and an item in her notifications. Neither the text she reads (titles, summaries, notification lines) nor the payloads the server stores for her may carry a hidden value. The same mention of
// the owner is the control (the owner reads the name, so it appears in theirs).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";
import { hiddenMember } from "./support/hidden-member.ts";

let h: Hour;
before(async () => {
  h = await bootHour("hiddennotify");
});
after(async () => {
  await h?.stop();
});

test("a mention on a record tells the member nothing her grant hides", async () => {
  const f = await hiddenMember(h, { hide: ["name", "email", "phone"] });
  const { owner, member } = f;
  const rec = (await owner.call("records.get", { type: "contact", recordId: f.rid })) as { record: { fields: { name: string } } };
  const name = rec.record.fields.name;
  assert.ok(name, "the record has a name");
  const secrets = [name, ...f.hidden];
  await owner.call("records.comments.add", {
    type: "contact",
    recordId: f.rid,
    text: "Please look at this one.",
    mentions: [{ kind: "person", id: member.personId }],
    idempotencyKey: "nt-mention",
  });
  await new Promise((r) => setTimeout(r, 2000));

  // control: a member whose grant hides only the email reads the name, so her request names the record and the probe is not empty
  const g = await hiddenMember(h, { hide: ["email"] });
  const gname = ((await owner.call("records.get", { type: "contact", recordId: g.rid })) as { record: { fields: { name: string } } }).record.fields.name;
  await owner.call("records.comments.add", {
    type: "contact",
    recordId: g.rid,
    text: "And this one.",
    mentions: [{ kind: "person", id: g.member.personId }],
    idempotencyKey: "nt-mention-control",
  });
  await new Promise((r) => setTimeout(r, 2000));
  const control = JSON.stringify(await g.member.call("tasks.list", { scope: "mine" }));
  assert.ok(control.includes(`Mentioned on ${gname}`), `control: a member who may read the name is told it: ${control.slice(0, 300)}`);
  assert.deepEqual([g.values.oldEmail, g.values.newEmail].filter((v) => control.includes(v)), [], "and not the email her grant hides");

  const tasks = JSON.stringify(await member.call("tasks.list", { scope: "mine" }));
  const notes = JSON.stringify(await member.call("notifications.list", {}));
  const stored = JSON.stringify([
    h.d.db!.all(`SELECT * FROM tasks_meta`),
    h.d.db!.all(`SELECT * FROM tasks_core`),
    h.d.db!.all(`SELECT * FROM notifications_items`),
  ]);
  assert.ok(tasks.includes("Mentioned on"), `the mention reached the member's requests: ${tasks.slice(0, 400)}`);
  const hits = (text: string) => secrets.filter((s) => text.includes(s));
  assert.deepEqual(hits(tasks), [], "no hidden value or name in the member's task list");
  assert.deepEqual(hits(notes), [], "no hidden value or name in the member's notifications");
  assert.deepEqual(hits(stored), [], "no hidden value or name in the rows the server stored for the mention");
});
