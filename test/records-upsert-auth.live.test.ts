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

test("a source that syncs records in (create, then update the same records) runs as whoever it runs as: a role that may edit updates, a create-only role has its update deliveries kept as failed with the reason, and processing one again as someone who may edit writes it", async () => {
  const mapping = { dedupe: "/event", fields: [{ from: "/email", to: "email" }, { from: "/name", to: "name" }, { from: "/phone", to: "phone" }], match: ["email"] };
  const src = (await h.owner.call("sources.create", { connector: "webhook", title: "Sync feed", type: "contact", mapping, verify: "none" })).source as { key: string; sourceId: string };
  const deliver = (by: Person, event: string, email: string, name: string, phone: string) => by.call("sources.ingest", { source: src.key, receivedAt: Date.now(), headers: {}, body: JSON.stringify({ event, email, name, phone }) });
  const phoneOf = async (email: string): Promise<unknown> => {
    const rows = (await h.owner.call("records.query", { type: "contact", filter: { field: "email", op: "eq", value: email }, limit: 5 })).rows as Array<{ fields: Record<string, unknown> }>;
    return rows[0]?.fields["phone"];
  };
  // pass 1, as the create-only role: both contacts come in
  const c1 = await deliver(maker, "e1", "nia@sync.test", "Nia Nord", "100");
  const c2 = await deliver(maker, "e2", "omar@sync.test", "Omar Oak", "200");
  assert.deepEqual([c1.status, c2.status], ["accepted", "accepted"]);
  assert.equal(await phoneOf("nia@sync.test"), "100");
  // pass 2, the same two contacts with new phones, as the create-only role: nothing changes and neither delivery says accepted
  const u1 = await deliver(maker, "e3", "nia@sync.test", "Nia Nord", "101");
  const u2 = await deliver(maker, "e4", "omar@sync.test", "Omar Oak", "201");
  assert.deepEqual([u1.status, u2.status], ["failed", "failed"], "a refused update is not reported as accepted");
  assert.deepEqual([await phoneOf("nia@sync.test"), await phoneOf("omar@sync.test")], ["100", "200"]);
  const listed = (await h.owner.call("sources.deliveries.list", { sourceId: src.sourceId })).deliveries as Array<{ deliveryId: string; status: string; error?: string }>;
  const failed = listed.filter((d) => d.status === "failed");
  assert.equal(failed.length, 2);
  assert.ok(failed.every((d) => /may not edit/i.test(d.error ?? "")), `the reason is on the delivery: ${JSON.stringify(failed)}`);
  // the same source run as someone who may edit (the owner): the update goes in, twice over
  const o1 = await deliver(h.owner, "e5", "omar@sync.test", "Omar Oak", "202");
  assert.equal(o1.status, "accepted");
  assert.equal(await phoneOf("omar@sync.test"), "202");
  // a failed delivery processed again by the owner is a new try and is written
  const again = await h.owner.call("sources.replay", { deliveryId: u1.deliveryId });
  assert.equal(again.status, "accepted");
  assert.equal(await phoneOf("nia@sync.test"), "101");
});

test("an import with each onMatch choice: update (the preview says which rows will be refused, the commit lists them as failed), skip, and create (every row is made, nothing is matched)", async () => {
  const mapping = [{ column: "Name", field: "name" }, { column: "Email", field: "email" }, { column: "Phone", field: "phone" }];
  const stage = async (by: Person, csv: string, onMatch: "update" | "skip" | "create", tag: string) => {
    const staged = await by.call("import.parse_csv", { text: csv });
    const pv = await by.call("import.preview", { importId: staged.importId, type: "contact", mapping, match: ["email"], onMatch });
    return { staged, pv, commit: async () => { await by.call("import.commit", { importId: staged.importId, previewToken: pv.previewToken, idempotencyKey: `om-${tag}` }); return (await by.call("import.get", { importId: staged.importId })).import as Record<string, unknown> & { errors?: Array<{ row: number; message: string }> }; } };
  };
  const csv = (tag: string) => `Name,Email,Phone\nAnn Again,ann@example.test,+1 555 0${tag}\nPia ${tag},pia${tag}@example.test,\n`;
  // update, as the create-only role: the matching row is labelled refused in the preview, not promised as an update
  const u = await stage(maker, csv("11"), "update", "u");
  assert.deepEqual([u.pv.creates, u.pv.updates, u.pv.refused], [1, 0, 1], JSON.stringify(u.pv));
  const ug = await u.commit();
  assert.deepEqual([ug["state"], ug["created"], ug["updated"], ug["failed"]], ["done", 1, 0, 1]);
  assert.equal(ug.errors?.[0]?.row, 1, "the refused row is named by its place in the file");
  // update, as the owner: the same row is an update
  const o = await stage(h.owner, csv("12"), "update", "o");
  assert.deepEqual([o.pv.creates, o.pv.updates, o.pv.refused], [1, 1, undefined]);
  const og = await o.commit();
  assert.deepEqual([og["created"], og["updated"], og["failed"]], [1, 1, 0]);
  // skip: the matching row is skipped, the new one is made
  const s = await stage(maker, csv("13"), "skip", "s");
  assert.deepEqual([s.pv.creates, s.pv.skips], [1, 1]);
  const sg = await s.commit();
  assert.deepEqual([sg["state"], sg["created"], sg["skipped"], sg["failed"]], ["done", 1, 1, 0]);
  // create: both rows are made as new records, even the one that matches (this used to fail every such import)
  const c = await stage(maker, csv("14"), "create", "c");
  assert.deepEqual([c.pv.creates, c.pv.updates], [2, 0]);
  const cg = await c.commit();
  assert.deepEqual([cg["state"], cg["created"], cg["failed"]], ["done", 2, 0]);
  const anns = (await h.owner.call("records.query", { type: "contact", filter: { field: "email", op: "eq", value: "ann@example.test" }, limit: 10 })).rows as unknown[];
  assert.equal(anns.length, 2, "create made a second Ann");
});
