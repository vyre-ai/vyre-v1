// records.update_many through a real server-role daemon with the real access and records modules: the owner updates a group of contacts in one call and each is updated and read back; a record that is gone is
// refused alone; a person whose role has records.create but not records.edit is refused the whole call (the permission is records.edit on the type) and nothing is changed.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, join } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

let h: Hour;
before(async () => {
  h = await bootHour("updatemany");
});
after(async () => {
  await h?.stop();
});

test("the owner updates a group of contacts in one call and a record that is gone is refused alone; a role without records.edit is refused the call", async () => {
  const ids: string[] = [];
  for (let i = 0; i < 3; i++)
    ids.push(
      (
        await h.owner.call("records.create", {
          type: "contact",
          fields: { name: `Contact ${i}`, email: `c${i}@example.test` },
        })
      ).record.id as string,
    );
  const out = await h.owner.call("records.update_many", {
    idempotencyKey: "um-1",
    type: "contact",
    items: [
      { recordId: ids[0], patch: { phone: "+1 555 0100" } },
      { recordId: ids[1], patch: { phone: "+1 555 0101" } },
      { recordId: "rec_" + "0".repeat(32), patch: { phone: "+1 555 0102" } },
      { recordId: ids[2], patch: { name: "Contact 2" } }, // changes nothing
    ],
  });
  const results = out.results as Array<{ recordId: string; record?: { version: number }; error?: { code: string } }>;
  assert.deepEqual(
    results.map((r) => (r.record ? `ok v${r.record.version}` : `refused ${r.error?.code}`)),
    ["ok v2", "ok v2", "refused validation.not_found", "ok v1"],
  );
  const read = await h.owner.call("records.get", { type: "contact", recordId: ids[1] });
  assert.equal((read.record.fields as Record<string, unknown>)["phone"], "+1 555 0101");

  // a role that can create records but not edit them
  const roles = (await h.owner.call("access.roles.list")).roles as Array<{
    id: string;
    name: string;
    permissions: string[];
  }>;
  const member = roles.find((r) => r.name === "Member")!;
  const made = (await h.owner.call("access.roles.create", { name: "Data entry", cloneFrom: member.id })).role as {
    id: string;
    permissions: string[];
  };
  const permissions = made.permissions.filter((p) => p !== "records.edit");
  const prev = await h.owner.call("access.roles.preview", { roleId: made.id, permissions });
  await h.owner.call("access.roles.apply", { roleId: made.id, permissions, previewHash: prev.previewHash });
  const inv = await h.owner.call("members.invites.create", { role: made.id, email: "maker@firm.test" });
  const maker: Person = h.person("Maker", "maker", "maker@firm.test", "maker horse battery staple 9");
  await join(h, maker, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!), { device: "web" });
  const refused = await maker.attempt("records.update_many", {
    idempotencyKey: "um-2",
    type: "contact",
    items: [{ recordId: ids[0], patch: { phone: "+1 555 0199" } }],
  });
  assert.equal(refused.ok, false, "a role without records.edit is refused the call");
  const still = await h.owner.call("records.get", { type: "contact", recordId: ids[0] });
  assert.equal((still.record.fields as Record<string, unknown>)["phone"], "+1 555 0100", "nothing was changed");
});
