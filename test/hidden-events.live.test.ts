// What a record's events show a member (24 Nov 2026, the release audit of the hidden-field leak: records.as_of returned fields a grant hides). The event log keeps the whole payload of record.created and
// record.updated (`fields`, `prev`); a reader gets only the fields they may see, where the event is shown. As the member with a grant that hides email and phone: events.list, events.get and events.since show
// the name and none of the four values (the first email and phone, and what the owner changed them to), while the owner reads the same events whole (so the probe is not an empty one).
// Real server-role daemon, real access, events and records modules.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, join } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";

let h: Hour;
before(async () => {
  h = await bootHour("hiddenevents");
});
after(async () => {
  await h?.stop();
});

const EMAIL = "zq7xkv@probe-mail.test";
const PHONE = "+1 555 0177";
const EMAIL2 = "newmail9wq@probe-mail.test";
const PHONE2 = "+1 555 0188";
const SECRETS = [EMAIL, PHONE, EMAIL2, PHONE2, "zq7xkv", "newmail9wq", "555 0177", "555 0188"];

test("the events of a record show a member only the fields their grant lets them see", async () => {
  const made = (await h.owner.call("records.create", {
    type: "contact",
    fields: { name: "Event Hana", email: EMAIL, phone: PHONE },
  })) as { record: { id: string } };
  const rid = made.record.id;
  const ref = { type: "record", id: rid };
  await h.owner.call("access.audience_set", { resource: ref, audience: "added" });
  const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
  const inv = await h.owner.call("members.invites.create", {
    role: roles.find((r) => r.name === "Member")!.id,
    email: "eva@firm.test",
  });
  const n = h.person("Eva Elm", "eva", "eva@firm.test", "eva horse battery staple 9");
  await join(h, n, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!), { device: "web" });
  await h.owner.call("access.share", {
    resource: ref,
    subject: { kind: "person", id: n.personId },
    level: "view",
    conditions: { hiddenFields: ["email", "phone"] },
    idempotencyKey: "he-share",
  });
  await h.owner.call("records.update", {
    type: "contact",
    recordId: rid,
    patch: { email: EMAIL2, phone: PHONE2, name: "Event Hana B" },
  });

  type Ev = { id: string; type: string; subject?: { id: string }; payload: { fields?: Record<string, unknown>; prev?: Record<string, unknown> } };
  const about = (events: Ev[]): Ev[] => events.filter((e) => e.type.startsWith("record.") && e.subject?.id === rid);

  // the owner reads the events whole: the probe is not an empty one
  const ownerList = about((await h.owner.call("events.list", { types: ["record.*"] })).events as Ev[]);
  const ownerText = JSON.stringify(ownerList);
  assert.ok(ownerList.some((e) => e.type === "record.created"), "the owner sees the creation");
  assert.ok(ownerList.some((e) => e.type === "record.updated"), "the owner sees the update");
  for (const s of [EMAIL, PHONE, EMAIL2, PHONE2]) assert.ok(ownerText.includes(s), `the owner's events carry ${s}`);

  // the member sees the same events, with the fields the grant lets them see and nothing of the others
  const memberList = about((await n.call("events.list", { types: ["record.*"] })).events as Ev[]);
  assert.ok(memberList.some((e) => e.type === "record.updated"), "the member sees the update");
  const text = JSON.stringify(memberList);
  for (const s of SECRETS) assert.ok(!text.includes(s), `events.list shows the member no ${s}`);
  const updated = memberList.find((e) => e.type === "record.updated")!;
  assert.equal(updated.payload.fields?.["name"], "Event Hana B", "the visible field is still there");
  assert.deepEqual(Object.keys(updated.payload.fields ?? {}), ["name"], "and it is the only one");
  assert.deepEqual(Object.keys(updated.payload.prev ?? {}), ["name"], "the previous values are cut the same way");

  // one event by its id, and the catch-up read
  for (const e of memberList) {
    const got = (await n.call("events.get", { eventId: e.id })) as { event: Ev };
    const t = JSON.stringify(got.event);
    for (const s of SECRETS) assert.ok(!t.includes(s), `events.get shows the member no ${s}`);
  }
  const since = (await n.call("events.since", { after: 0, types: ["record.*"], limit: 1000 })) as { events: Ev[] };
  const sinceText = JSON.stringify(about(since.events));
  for (const s of SECRETS) assert.ok(!sinceText.includes(s), `events.since shows the member no ${s}`);
});
