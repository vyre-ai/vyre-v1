// The probe fixture itself (test/support/hidden-member.ts): the member reaches the contact through the grant, sees the name and not the email or phone, and the owner sees all of it.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";
import { hiddenMember } from "./support/hidden-member.ts";

let h: Hour;
before(async () => {
  h = await bootHour("hiddenfixture");
});
after(async () => {
  await h?.stop();
});

test("the hidden-member fixture: the member sees the name only, the owner sees the hidden values, and leaks() tells them apart", async () => {
  const f = await hiddenMember(h);
  const got = await f.member.call("records.get", { type: "contact", recordId: f.rid });
  assert.deepEqual(f.leaks(got), [], "the member's answer carries no hidden value");
  assert.match(String((got.record.fields as Record<string, unknown>)["name"]), /Probe Hana/);
  const own = await f.owner.call("records.get", { type: "contact", recordId: f.rid });
  assert.ok(f.leaks(own).length >= 2, "the owner's answer carries the hidden values (the fixture's literals are real)");
});
