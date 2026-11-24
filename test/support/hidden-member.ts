// The probe fixture for field-level privacy (lane r42-scroll, 24 Nov): a contact whose email and phone are hidden by a record grant from a member who holds nothing else on it. The member reaches the record only through
// that grant (the record is open to people added), the owner changes both hidden values after the grant so the log holds OLD and NEW values, and `leaks(body)` says which hidden literals a member's answer carries.
//
//   const f = await hiddenMember(h);                // h: await bootHour("name") from ./member-hour.ts
//   const r = await f.member.attempt("records.get", { type: "contact", recordId: f.rid });
//   assert.deepEqual(f.leaks(r.data), []);          // no hidden value, nor a fragment of one, in the answer
//
// `f.rid` the contact's id, `f.member` the Person (call / attempt as the member), `f.owner` h.owner, `f.hidden` the literals (old and new email and phone, and short unique fragments of each), `f.visible` the fields the
// member may see ("name"), `f.at` a time before the owner changed the values (for as_of).
import { join } from "./member-hour.ts";
import type { Hour, Person } from "./member-hour.ts";

export interface HiddenFixture {
  h: Hour;
  owner: Hour["owner"];
  member: Person;
  rid: string;
  at: number;
  hidden: string[];
  values: { oldEmail: string; newEmail: string; oldPhone: string; newPhone: string };
  /** The hidden literals that appear in this answer (a string, or anything JSON-shaped); empty when the answer is clean. */
  leaks(body: unknown): string[];
}

let seq = 0;

export async function hiddenMember(h: Hour, o: { hide?: string[] } = {}): Promise<HiddenFixture> {
  const n = ++seq;
  const tag = `zq${n}x${Math.random().toString(36).slice(2, 6)}`;
  const values = {
    oldEmail: `old-${tag}@probe-mail.test`,
    newEmail: `new-${tag}@probe-mail.test`,
    oldPhone: `+1 555 ${String(5000 + n)}1`,
    newPhone: `+1 555 ${String(5000 + n)}2`,
  };
  const made = (await h.owner.call("records.create", {
    type: "contact",
    fields: { name: `Probe Hana ${n}`, email: values.oldEmail, phone: values.oldPhone },
  })) as { record: { id: string } };
  const rid = made.record.id;
  const ref = { type: "record", id: rid };
  await h.owner.call("access.audience_set", { resource: ref, audience: "added" });
  const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
  const username = `probe${n}`;
  const inv = await h.owner.call("members.invites.create", {
    role: roles.find((r) => r.name === "Member")!.id,
    email: `${username}@firm.test`,
  });
  const member = h.person(`Probe Member ${n}`, username, `${username}@firm.test`, `${username} horse battery staple 9`);
  await join(h, member, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!), { device: "web" });
  await h.owner.call("access.share", {
    resource: ref,
    subject: { kind: "person", id: member.personId },
    level: "view",
    conditions: { hiddenFields: o.hide ?? ["email", "phone"] },
    idempotencyKey: `hm-share-${n}`,
  });
  const at = Date.now();
  await h.owner.call("records.update", {
    type: "contact",
    recordId: rid,
    patch: { email: values.newEmail, phone: values.newPhone },
  });
  await h.owner.call("records.update", { type: "contact", recordId: rid, patch: { name: `Probe Hana ${n} B` } });
  const hidden = [
    values.oldEmail,
    values.newEmail,
    values.oldPhone,
    values.newPhone,
    tag,
    `555 ${5000 + n}1`,
    `555 ${5000 + n}2`,
  ];
  return {
    h,
    owner: h.owner,
    member,
    rid,
    at,
    hidden,
    values,
    leaks: (body) => {
      const text = typeof body === "string" ? body : JSON.stringify(body ?? null);
      return hidden.filter((v) => text.includes(v));
    },
  };
}
