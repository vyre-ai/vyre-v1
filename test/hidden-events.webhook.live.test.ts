// A webhook delivers a record's event as the person who made the webhook may read it (24 Nov 2026, the release audit of the hidden-field leak). A member whose role holds connectors.manage but whose only
// access to a contact is a record grant that hides email and phone: the body that goes to their webhook has the name and none of the hidden values; a filter on a hidden value matches nothing for them
// and leaves no row; an edit of a record they may not see sends nothing and leaves no row. Real server-role daemon, real access, events and records modules.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";
import { hiddenMember } from "./support/hidden-member.ts";

let h: Hour;
before(async () => {
  h = await bootHour("hiddenhook");
});
after(async () => {
  await h?.stop();
});

const until = async <T>(what: string, ms: number, look: () => Promise<T | undefined>): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await look();
    if (v !== undefined) return v;
    assert.ok(Date.now() < end, `gave up waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
};

test("a webhook of a member with a hidden-field grant delivers the record as that member may see it", async () => {
  const f = await hiddenMember(h);
  const { member, owner } = f;
  // the member's role holds connectors.manage (a webhook is made with it)
  const roles = (await owner.call("access.roles.list")).roles as Array<{ id: string; name: string; permissions?: string[] }>;
  const base = roles.find((r) => r.name === "Member")!;
  const role = (await owner.call("access.roles.create", { name: "Hook maker", cloneFrom: base.id, idempotencyKey: "hw-role" }))
    .role as { id: string; permissions: string[] };
  const permissions = [...role.permissions, "connectors.manage"];
  const preview = (await owner.call("access.roles.preview", { roleId: role.id, permissions })) as { previewHash: string };
  await owner.call("access.roles.apply", { roleId: role.id, permissions, previewHash: preview.previewHash });
  await owner.call("access.roles.assign", { subject: { kind: "person", id: member.personId }, roleId: role.id });

  const unseen = (await owner.call("records.create", {
    type: "contact",
    fields: { name: "Hook Unseen", email: "hook-unseen@probe-mail.test" },
  })) as { record: { id: string } };
  await owner.call("access.audience_set", { resource: { type: "record", id: unseen.record.id }, audience: "added" });

  const plain = (await member.call("webhooks.create", {
    name: "All contacts",
    url: "https://hooks.example.com/all",
    eventTypes: ["record.*"],
    idempotencyKey: "hw-plain",
  })) as { webhook: { id: string } };
  const byValue = (await member.call("webhooks.create", {
    name: "By a hidden value",
    url: "https://hooks.example.com/by-email",
    eventTypes: ["record.updated"],
    filter: { "/fields/email": "hook-probe-edit@probe-mail.test" },
    idempotencyKey: "hw-value",
  })) as { webhook: { id: string } };

  // the owner edits the unseen record, then the seen one: its name and its hidden email
  await owner.call("records.update", { type: "contact", recordId: unseen.record.id, patch: { name: "Hook Unseen 2" } });
  await owner.call("records.update", {
    type: "contact",
    recordId: f.rid,
    patch: { name: "Hook Seen", email: "hook-probe-edit@probe-mail.test" },
  });

  type Row = { event_id: string; state: string; body: string | null };
  const rows = (id: string): Row[] =>
    h.d.db!.all(`SELECT event_id, state, body FROM events_delivery WHERE webhook_id = ?`, id) as Row[];
  const delivered = await until("the webhook to carry the edit of the seen record", 20000, async () => {
    const r = rows(plain.webhook.id).filter((x) => x.body !== null && x.body.includes("Hook Seen"));
    return r.length ? r : undefined;
  });
  await new Promise((r) => setTimeout(r, 2500));
  const all = rows(plain.webhook.id);
  const text = all.map((r) => r.body ?? "").join("\n");
  assert.ok(delivered.length >= 1, "the visible edit is delivered, so the probe is not an empty one");
  assert.deepEqual(f.leaks(text), [], "no delivery body carries a hidden value");
  assert.ok(!text.includes("hook-probe-edit") && !text.includes("hook-unseen"), "nor the later email, nor the unseen record's");
  assert.ok(!text.includes("Hook Unseen"), "the edit of a record the member may not see sends nothing");
  const unseenEvents = (
    (await owner.call("events.list", { subject: { type: "record", id: unseen.record.id } })).events as Array<{ id: string }>
  ).map((e) => e.id);
  assert.ok(unseenEvents.length >= 1, "the owner's log holds the unseen record's edit");
  assert.ok(
    all.every((r) => !unseenEvents.includes(r.event_id)),
    "and leaves no row for it",
  );
  // the filter on the hidden value matched the whole event when it was queued; for the member it matches nothing and leaves no row
  assert.deepEqual(rows(byValue.webhook.id), [], "a filter on a hidden value leaves no delivery for the member");
});
