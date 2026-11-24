// A hidden field's values are not in the member's view of the record's past either: the history, the activity, the versions, the record as it was at an earlier time and an export of the contact never carry the hidden
// email or phone, including the OLD values from before the owner changed them. Real server-role daemon, real access and records modules.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, join } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";

let h: Hour;
before(async () => {
  h = await bootHour("hiddenhistory");
});
after(async () => {
  await h?.stop();
});

test("the history, activity, versions, as-of and export of a contact never carry its hidden email and phone, old values included", async () => {
  const OLD_EMAIL = "old-qv7z@probe-mail.test";
  const NEW_EMAIL = "new-qv7z@probe-mail.test";
  const OLD_PHONE = "+1 555 0181";
  const NEW_PHONE = "+1 555 0182";
  const made = (await h.owner.call("records.create", {
    type: "contact",
    fields: { name: "History Hana", email: OLD_EMAIL, phone: OLD_PHONE },
  })) as { record: { id: string; version: number } };
  const rid = made.record.id;
  const ref = { type: "record", id: rid };
  const before = Date.now();
  await h.owner.call("access.audience_set", { resource: ref, audience: "added" });
  const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
  const inv = await h.owner.call("members.invites.create", {
    role: roles.find((r) => r.name === "Member")!.id,
    email: "hia@firm.test",
  });
  const n = h.person("Hia Hazel", "hia", "hia@firm.test", "hia horse battery staple 9");
  await join(h, n, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!), { device: "web" });
  await h.owner.call("access.share", {
    resource: ref,
    subject: { kind: "person", id: n.personId },
    level: "view",
    conditions: { hiddenFields: ["email", "phone"] },
    idempotencyKey: "hh-share",
  });
  // the owner changes the hidden values after the grant: the member's history holds both the old and the new
  await h.owner.call("records.update", {
    type: "contact",
    recordId: rid,
    patch: { email: NEW_EMAIL, phone: NEW_PHONE },
  });
  await h.owner.call("records.update", { type: "contact", recordId: rid, patch: { name: "History Hana B" } });

  const hidden = [OLD_EMAIL, NEW_EMAIL, OLD_PHONE, NEW_PHONE, "qv7z", "555 0181", "555 0182"];
  const probes: Array<[string, string]> = [];
  const probe = async (label: string, cap: string, input: Record<string, unknown>): Promise<void> => {
    const r = await n.attempt(cap, input);
    probes.push([label, r.ok ? JSON.stringify(r.data) : `refused ${(r.error as { code?: string }).code}`]);
  };
  await probe("history", "records.history", { type: "contact", recordId: rid });
  await probe("history of the email field", "records.history", { type: "contact", recordId: rid, field: "email" });
  await probe("activity", "records.activity", { type: "contact", recordId: rid });
  await probe("versions", "records.versions", { type: "contact", recordId: rid });
  await probe("as of before the change", "records.as_of", { type: "contact", recordId: rid, at: before });
  await probe("as of now", "records.as_of", { type: "contact", recordId: rid, at: Date.now() });
  await probe("export", "records.export", { type: "contact", format: "csv", recordIds: [rid] });
  const some = probes.filter(([, body]) => !body.startsWith("refused"));
  for (const [label, body] of probes)
    for (const v of hidden)
      assert.equal(
        body.includes(v),
        false,
        `${label}: the hidden text "${v}" is in the member's answer: ${body.slice(0, 300)}`,
      );
  // the probes are not all refusals: at least the history or the activity answered the member
  assert.ok(
    some.length >= 1,
    `at least one of the probes answered (${probes.map(([l, b]) => `${l}: ${b.slice(0, 40)}`).join(" | ")})`,
  );
});
