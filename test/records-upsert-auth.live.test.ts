// Issue 909: records.bulk_upsert (and with it a member's import or an agent's tool call) changes an existing record only when the caller may edit it, like records.update. A server-role daemon with the
// real access, records and import modules: the owner makes a role that can create records but not edit them, a person with that role calls bulk_upsert over a contact the owner made, and the contact is not changed.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, join } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

let h: Hour;
let maker: Person;

before(async () => { h = await bootHour("upsertauth"); });
after(async () => { await h?.stop(); });

test("a role with records.create and no records.edit adds new contacts through bulk_upsert but cannot change an existing one, whether called directly or as an import", async () => {
  const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string; permissions: string[] }>;
  const member = roles.find((r) => r.name === "Member")!;
  const made = (await h.owner.call("access.roles.create", { name: "Data entry", cloneFrom: member.id })).role as { id: string; permissions: string[] };
  const permissions = made.permissions.filter((p) => p !== "records.edit");
  assert.ok(made.permissions.includes("records.edit") && permissions.includes("records.create"), "the clone starts as a Member");
  const prev = await h.owner.call("access.roles.preview", { roleId: made.id, permissions });
  await h.owner.call("access.roles.apply", { roleId: made.id, permissions, previewHash: prev.previewHash });
  const inv = await h.owner.call("members.invites.create", { role: made.id, email: "maker@firm.test" });
  maker = h.person("Maker", "maker", "maker@firm.test", "maker horse battery staple 9");
  await join(h, maker, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!), { device: "web" });

  const ann = (await h.owner.call("records.create", { type: "contact", fields: { name: "Ann Alder", email: "ann@example.test" } })).record.id as string;
  const direct = await maker.call("records.bulk_upsert", { type: "contact", match: ["email"], rows: [{ email: "ann@example.test", phone: "+1 555 0100" }, { email: "new@example.test", name: "New Nia" }] });
  assert.deepEqual([direct.created, direct.updated], [1, 0], "the new contact is made, the existing one is not changed");
  assert.deepEqual((direct.refused as Array<{ row: number; reason: string }>).map((r) => [r.row, r.reason]), [[0, "not_allowed"]]);

  const staged = await maker.call("import.parse_csv", { text: "Name,Email,Phone\nHijacked,ann@example.test,+1 555 0199\nBo Birch,bo@example.test,\n" });
  const mapping = [{ column: "Name", field: "name" }, { column: "Email", field: "email" }, { column: "Phone", field: "phone" }];
  const pv = await maker.call("import.preview", { importId: staged.importId, type: "contact", mapping, match: ["email"] });
  await maker.call("import.commit", { importId: staged.importId, previewToken: pv.previewToken, idempotencyKey: "maker-import" });
  const row = (await h.owner.call("records.query", { type: "contact", filter: { field: "email", op: "eq", value: "ann@example.test" }, limit: 5 })).rows as Array<{ id: string; fields: Record<string, unknown> }>;
  assert.equal(row[0]?.id, ann);
  assert.deepEqual([row[0]?.fields["name"], row[0]?.fields["phone"]], ["Ann Alder", undefined], "Ann is exactly as the owner made her");
  const got = (await maker.call("import.get", { importId: staged.importId })).import as Record<string, number>;
  assert.deepEqual([got["created"], got["updated"], got["failed"]], [1, 0, 1], "the import says so: one row in, one row refused");
});
