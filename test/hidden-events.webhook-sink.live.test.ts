// Leak probe 1 (rc.44, 26 Nov 2026): the body a webhook SENDS, and the delivery row the server keeps, for a record with fields the owner of the webhook may not read. A member whose role holds connectors.manage and whose only
// access to a contact is a grant hiding email and phone makes a webhook on record.*; the owner makes the identical one as the control. The sink is the host's post port (postFetch), where the body leaves the server.
// The member's sink body and stored row carry the name and none of the hidden values; the owner's carry the new email, so the probe is not empty.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";
import { hiddenMember } from "./support/hidden-member.ts";

const sink: Array<{ url: string; body: string }> = [];
let h: Hour;
before(async () => {
  h = await bootHour("hooksink", {
    seams: {
      webhookAllow: () => ["hooks.example.com"],
      postFetch: async (url: string, init: { body: string }) => {
        sink.push({ url, body: init.body });
        return { status: 200, headers: { get: () => null }, text: async () => "ok" };
      },
    },
  });
});
after(async () => {
  await h?.stop();
});

const until = async <T>(what: string, ms: number, look: () => T | undefined): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = look();
    if (v !== undefined) return v;
    assert.ok(Date.now() < end, `gave up waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
};

test("what a member's webhook sends, and the row the server keeps of it, carry none of the fields her grant hides; the owner's carries them", async () => {
  const f = await hiddenMember(h);
  const { member, owner } = f;
  const roles = (await owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
  const base = roles.find((r) => r.name === "Member")!;
  const role = (
    await owner.call("access.roles.create", { name: "Sink hook maker", cloneFrom: base.id, idempotencyKey: "sk-role" })
  ).role as { id: string; permissions: string[] };
  const permissions = [...role.permissions, "connectors.manage"];
  const preview = (await owner.call("access.roles.preview", { roleId: role.id, permissions })) as {
    previewHash: string;
  };
  await owner.call("access.roles.apply", { roleId: role.id, permissions, previewHash: preview.previewHash });
  await owner.call("access.roles.assign", { subject: { kind: "person", id: member.personId }, roleId: role.id });

  const mine = (await member.call("webhooks.create", {
    name: "Member all",
    url: "https://hooks.example.com/member",
    eventTypes: ["record.*"],
    idempotencyKey: "sk-member",
  })) as { webhook: { id: string } };
  const theirs = (await owner.call("webhooks.create", {
    name: "Owner all",
    url: "https://hooks.example.com/owner",
    eventTypes: ["record.*"],
    idempotencyKey: "sk-owner",
  })) as { webhook: { id: string } };

  // the owner edits the contact after both webhooks exist: the hidden email and phone change, and the name too
  const newEmail = `edit-${Math.random().toString(36).slice(2, 8)}@probe-mail.test`;
  await owner.call("records.update", {
    type: "contact",
    recordId: f.rid,
    patch: { email: newEmail, phone: "+1 555 7777", name: "Sink Seen" },
  });
  const sent = (who: string) => sink.filter((s) => s.url.endsWith(who));
  await until("the owner's webhook to be sent", 20000, () =>
    sent("/owner").some((s) => s.body.includes("Sink Seen")) ? true : undefined,
  );
  await until("the member's webhook to be sent", 20000, () =>
    sent("/member").some((s) => s.body.includes("Sink Seen")) ? true : undefined,
  );
  await new Promise((r) => setTimeout(r, 2000));

  const ownerText = sent("/owner")
    .map((s) => s.body)
    .join("\n");
  assert.ok(
    ownerText.includes(newEmail),
    "control: the owner's webhook body carries the new email, so the probe is not empty",
  );
  const memberText = sent("/member")
    .map((s) => s.body)
    .join("\n");
  assert.ok(memberText.includes("Sink Seen"), "the member's webhook carries what she may see");
  assert.deepEqual(
    f.leaks(memberText),
    [],
    "no hidden value in the body that left the server for the member's webhook",
  );
  assert.ok(!memberText.includes(newEmail) && !memberText.includes("555 7777"), "nor the edit's email or phone");

  type Row = { body: string | null };
  const rows = (id: string): string =>
    (h.d.db!.all(`SELECT body FROM events_delivery WHERE webhook_id = ?`, id) as Row[])
      .map((r) => r.body ?? "")
      .join("\n");
  assert.ok(rows(theirs.webhook.id).includes(newEmail), "control: the owner's stored delivery row carries the email");
  assert.deepEqual(f.leaks(rows(mine.webhook.id)), [], "no hidden value in the member's stored delivery rows");
  assert.ok(!rows(mine.webhook.id).includes(newEmail), "nor the edit's email in the stored row");
});
