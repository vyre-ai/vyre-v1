// records.get_many: up to 200 records of one type in one call, each cut exactly as records.get cuts it (hidden fields, label ceiling, provider ceiling); a record the caller may not see, or that is gone, is not in the answer,
// and nothing in the answer or in an error names it. Real server-role daemon.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";
import { hiddenMember } from "./support/hidden-member.ts";

let h: Hour;
before(async () => {
  h = await bootHour("getmany");
});
after(async () => {
  await h?.stop();
});

type Row = { id: string; type: string; version: number; fields: Record<string, unknown> };
const make = async (name: string, extra: Record<string, unknown> = {}): Promise<string> =>
  (
    (await h.owner.call("records.create", { type: "contact", fields: { name, ...extra } })) as {
      record: { id: string };
    }
  ).record.id;

test("get_many answers the records that exist, in the order asked, each as records.get gives it, and skips an id that is missing or repeated", async () => {
  const a = await make("Gm One", { email: "one@gm.test" });
  const b = await make("Gm Two", { email: "two@gm.test" });
  const out = (await h.owner.call("records.get_many", {
    type: "contact",
    ids: [b, a, "rec_" + "0".repeat(32), b],
  })) as { rows: Row[] };
  assert.deepEqual(
    out.rows.map((r) => r.id),
    [b, a],
  );
  for (const row of out.rows) {
    const one = (await h.owner.call("records.get", { type: "contact", recordId: row.id })) as { record: Row };
    assert.deepEqual(row, one.record, "the same row records.get gives");
  }
  const none = await h.owner.attempt("records.get_many", { type: "no_such_type", ids: [a] });
  assert.equal(none.ok, false, "a type that does not exist is refused, as records.get refuses it");
});

test("get_many takes at most 200 ids", async () => {
  const ids = Array.from({ length: 201 }, (_, i) => `rec_${String(i).padStart(32, "0")}`);
  const r = await h.owner.attempt("records.get_many", { type: "contact", ids });
  assert.equal(r.ok, false);
});

test("get_many cuts what records.get cuts: a member whose grant hides email and phone gets neither, and the same fields records.get gives them", async () => {
  const f = await hiddenMember(h);
  const one = await f.member.call("records.get", { type: "contact", recordId: f.rid });
  const many = (await f.member.call("records.get_many", { type: "contact", ids: [f.rid] })) as { rows: Row[] };
  assert.equal(many.rows.length, 1);
  assert.deepEqual(many.rows[0], one.record, "the same row, field for field, as records.get");
  assert.ok(Object.hasOwn(many.rows[0]!.fields, "name"), "the visible field is there");
  assert.equal(Object.hasOwn(many.rows[0]!.fields, "email"), false);
  assert.equal(Object.hasOwn(many.rows[0]!.fields, "phone"), false);
  assert.deepEqual(f.leaks(many), [], "no hidden value, nor a fragment of one");
  const owner = (await f.owner.call("records.get_many", { type: "contact", ids: [f.rid] })) as { rows: Row[] };
  assert.ok(f.leaks(owner).length >= 2, "the owner gets the hidden fields (the probe is not empty)");
});

test("a record the member may not see is absent, never an error, and the answer does not name it", async () => {
  const f = await hiddenMember(h);
  const secret = await make("Gm Secret Owner Only", { email: "secret@gm.test" });
  await h.owner.call("access.audience_set", { resource: { type: "record", id: secret }, audience: "me" });
  const gone = await make("Gm Deleted");
  await h.owner.call("records.delete", { type: "contact", recordId: gone });
  const r = await f.member.attempt("records.get_many", { type: "contact", ids: [secret, f.rid, gone] });
  assert.equal(r.ok, true, "no error");
  const rows = (r.data as { rows: Row[] }).rows;
  assert.deepEqual(
    rows.map((x) => x.id),
    [f.rid],
  );
  const text = JSON.stringify(r.data);
  assert.equal(text.includes(secret) || text.includes("Secret"), false, "the hidden record is not named");
  const onlyHidden = await f.member.attempt("records.get_many", { type: "contact", ids: [secret] });
  assert.equal(onlyHidden.ok, true);
  assert.deepEqual((onlyHidden.data as { rows: Row[] }).rows, []);
});

import { join } from "./support/member-hour.ts";
import type { Person } from "./support/member-hour.ts";

let guests = 0;
async function holder(role: string): Promise<Person> {
  const n = ++guests;
  const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
  const username = `gm${role.toLowerCase()}${n}`;
  const inv = await h.owner.call("members.invites.create", {
    role: roles.find((r) => r.name === role)!.id,
    email: `${username}@firm.test`,
  });
  const p = h.person(`Gm ${role} ${n}`, username, `${username}@firm.test`, `${username} horse battery staple 9`);
  await join(h, p, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!), { device: "web" });
  return p;
}
const shareRecord = (id: string, p: Person, key: string) =>
  h.owner.call("access.share", {
    resource: { type: "record", id },
    subject: { kind: "person", id: p.personId },
    level: "view",
    idempotencyKey: key,
  });

test("a Guest who holds only one record's share reads that record through get_many exactly as records.get gives it, and the others are absent", async () => {
  const mine = await make("Gm Shared To Guest", { email: "g@gm.test" });
  const other = await make("Gm Not Shared", { email: "o@gm.test" });
  const g = await holder("Guest");
  await shareRecord(mine, g, `gm-guest-${mine}`);
  const one = await g.attempt("records.get", { type: "contact", recordId: mine });
  assert.equal(one.ok, true, "records.get serves this person");
  const many = await g.attempt("records.get_many", { type: "contact", ids: [other, mine] });
  assert.equal(many.ok, true, `get_many serves them too: ${JSON.stringify(many)}`);
  const rows = (many.data as { rows: Row[] }).rows;
  assert.deepEqual(
    rows.map((r) => r.id),
    [mine],
  );
  assert.deepEqual(rows[0], (one.data as { record: Row }).record, "the same row records.get gives");
  assert.equal(JSON.stringify(many.data).includes(other), false, "the other record is not named");
  assert.equal((await g.attempt("records.get", { type: "contact", recordId: other })).ok, false);
});

test("a record whose own label is above the member's clearance is absent from the answer: no error, no id named", async () => {
  const open = await make("Gm Open Label");
  const high = await make("Gm Restricted Label");
  await h.owner.call("access.labels.set", { resource: { type: "record", id: high }, label: "restricted" });
  const m = await holder("Member");
  await shareRecord(open, m, `gm-label-a-${open}`);
  await shareRecord(high, m, `gm-label-b-${high}`);
  const direct = await m.attempt("records.get", { type: "contact", recordId: high });
  assert.equal(direct.ok, false, "records.get refuses the restricted record for this member");
  const many = await m.attempt("records.get_many", { type: "contact", ids: [high, open] });
  assert.equal(many.ok, true, "no error");
  assert.deepEqual(
    (many.data as { rows: Row[] }).rows.map((r) => r.id),
    [open],
  );
  assert.equal(JSON.stringify(many.data).includes(high) || JSON.stringify(many.data).includes("Restricted"), false);
});
