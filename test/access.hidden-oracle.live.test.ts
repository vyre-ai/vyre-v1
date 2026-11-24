// A field a grant hides is not an oracle: the member cannot confirm or extract a hidden value without seeing it. As the member, a search for the hidden text and a query that filters on the hidden field (equals and contains)
// must not bring the record back, while the same search and filter on a field the member may see do (so the probe is not an empty one). Real server-role daemon, real access and records modules.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, join } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";

let h: Hour;
before(async () => {
  h = await bootHour("hiddenoracle");
});
after(async () => {
  await h?.stop();
});

test("a hidden field cannot be searched for or filtered on by the member it is hidden from", async () => {
  const EMAIL = "zq7xkv@probe-mail.test";
  const PHONE = "+1 555 0177";
  const made = (await h.owner.call("records.create", {
    type: "contact",
    fields: { name: "Oracle Hana", email: EMAIL, phone: PHONE },
  })) as { record: { id: string } };
  const rid = made.record.id;
  const ref = { type: "record", id: rid };
  await h.owner.call("access.audience_set", { resource: ref, audience: "added" });
  const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
  const inv = await h.owner.call("members.invites.create", {
    role: roles.find((r) => r.name === "Member")!.id,
    email: "ora@firm.test",
  });
  const n = h.person("Ora Oak", "ora", "ora@firm.test", "ora horse battery staple 9");
  await join(h, n, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!), { device: "web" });
  await h.owner.call("access.share", {
    resource: ref,
    subject: { kind: "person", id: n.personId },
    level: "view",
    conditions: { hiddenFields: ["email", "phone"] },
    idempotencyKey: "ho-share",
  });
  const hits = (out: { rows: Array<{ id: string }> }): boolean => out.rows.some((r) => r.id === rid);
  const search = async (q: string): Promise<boolean> => hits(await n.call("records.search", { type: "contact", q }));
  const filter = async (field: string, op: string, value: string): Promise<boolean> =>
    hits(await n.call("records.query", { type: "contact", filter: { field, op, value } }));

  // the probe is not empty: the visible field finds the record
  assert.equal(await search("Oracle Hana"), true, "a search for the visible name finds the contact");
  assert.equal(await filter("name", "eq", "Oracle Hana"), true, "a filter on the visible name finds the contact");

  // and the same probes work for the owner (the email and the phone are searchable and filterable at all)
  const ownerHits = async (call: Promise<{ rows: Array<{ id: string }> }>): Promise<boolean> =>
    (await call).rows.some((r) => r.id === rid);
  assert.equal(
    await ownerHits(h.owner.call("records.search", { type: "contact", q: EMAIL }) as never),
    true,
    "the owner finds the contact by its email",
  );
  assert.equal(
    await ownerHits(
      h.owner.call("records.query", { type: "contact", filter: { field: "phone", op: "eq", value: PHONE } }) as never,
    ),
    true,
    "the owner finds the contact by a filter on its phone",
  );

  // the hidden values are not an oracle
  assert.equal(await search(EMAIL), false, "a search for the hidden email does not find the contact");
  assert.equal(await search("zq7xkv"), false, "a search for part of the hidden email does not find the contact");
  assert.equal(await search(PHONE), false, "a search for the hidden phone does not find the contact");
  assert.equal(
    await filter("email", "eq", EMAIL),
    false,
    "a filter email equals the hidden value does not find the contact",
  );
  assert.equal(
    await filter("email", "contains", "zq7xkv"),
    false,
    "a filter email contains part of the hidden value does not find the contact",
  );
  assert.equal(
    await filter("phone", "eq", PHONE),
    false,
    "a filter phone equals the hidden value does not find the contact",
  );
  assert.equal(
    await filter("phone", "contains", "555 0177"),
    false,
    "a filter phone contains part of the hidden value does not find the contact",
  );
});
