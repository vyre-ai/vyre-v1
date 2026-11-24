// An Automation a member makes on record changes runs for that member: its trigger shows the record as the member may see it (24 Nov 2026, the release audit of the hidden-field leak). With a grant that
// hides email and phone: the trigger payload (what automations.test_events shows, and what every step reads as {{ trigger.record.* }}) has the name and none of the hidden values, a filter on a hidden
// field cannot tell the member its value, and a record the member may not see starts nothing. Real server-role daemon, real access, records and automations modules.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";
import { hiddenMember } from "./support/hidden-member.ts";

let h: Hour;
before(async () => {
  h = await bootHour("hiddenauto");
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

test("a member's Automation sees a changed record as the member may see it, and starts nothing for a record they may not see", async () => {
  const f = await hiddenMember(h);
  const { member, owner } = f;
  // a record the member holds nothing on
  const unseen = (await owner.call("records.create", {
    type: "contact",
    fields: { name: "Unseen Bo", email: "unseen-bo@probe-mail.test" },
  })) as { record: { id: string } };
  await owner.call("access.audience_set", { resource: { type: "record", id: unseen.record.id }, audience: "added" });

  const made = await member.call("automations.create", {
    idempotencyKey: "ha-auto",
    name: "Contact changed",
    definition: {
      triggers: [{ key: "record_change", filter: { type: "contact" } }],
      nodes: [
        {
          id: "note",
          key: "records.create",
          input: {
            type: "note_board",
            fields: { title: "{{ trigger.record.name }} | {{ trigger.record.email }} | {{ trigger.record.phone }}" },
          },
        },
      ],
    },
  });
  const aid = String((made.automation ?? {}).id ?? made.automationId);
  await member.call("automations.set_enabled", { automationId: aid, enabled: true });
  const runs = async (): Promise<number> =>
    ((await member.call("runs.list", { scope: "subject", subject: { type: "automation", id: aid }, limit: 50 })).runs as unknown[])
      .length;

  // an edit of the record the member may not see comes first in the log; then an edit of the one they may see (name) and one of the hidden fields
  await owner.call("records.update", { type: "contact", recordId: unseen.record.id, patch: { name: "Unseen Bo 2" } });
  await owner.call("records.update", { type: "contact", recordId: f.rid, patch: { name: "Seen Hana C" } });
  await owner.call("records.update", { type: "contact", recordId: f.rid, patch: { email: "third-visible-test@probe-mail.test" } });
  type Te = { events: Array<{ payload: { recordId?: string; record?: Record<string, unknown>; changed?: Record<string, unknown>; fields?: string[] } }> };
  const testEvents = async (): Promise<Te> => (await member.call("automations.test_events", { automationId: aid })) as Te;
  // the runs for the edits of the seen record are in (the second one only touched a hidden field); the edit of the unseen one came before them in the log, so by now it would have run too
  await until("the Automation to run for both edits of the seen record", 15000, async () =>
    (await testEvents()).events.filter((e) => e.payload.recordId === f.rid && e.payload.changed?.["name"] === "Seen Hana C")
      .length >= 1 && (await runs()) >= 2
      ? true
      : undefined,
  );
  await new Promise((r) => setTimeout(r, 2500));
  assert.ok(
    (await testEvents()).events.every((e) => e.payload.recordId !== unseen.record.id),
    "a record the member may not see started nothing for them",
  );

  const te = await testEvents();
  const text = JSON.stringify(te);
  assert.deepEqual(f.leaks(text), [], "automations.test_events shows no hidden value");
  assert.ok(!text.includes("third-visible-test") && !text.includes("unseen-bo"), "nor the later email, nor the unseen record");
  const named = te.events.find((e) => e.payload.record?.["name"] === "Seen Hana C");
  assert.ok(named, "the visible name is in the trigger, so the probe is not an empty one");
  assert.deepEqual(Object.keys(named!.payload.record ?? {}), ["name"], "and it is the only field of the record");

  // what a step wrote: the note the Automation made names the record and carries no hidden value
  const notes = (await owner.call("records.query", { type: "note_board", limit: 50 })) as {
    rows: Array<{ fields: { title?: string } }>;
  };
  const titles = notes.rows.map((r) => String(r.fields.title ?? ""));
  assert.ok(titles.some((t) => t.includes("Seen Hana C")), `a step read the visible name: ${JSON.stringify(titles)}`);
  assert.deepEqual(f.leaks(titles.join("\n")), [], "no step wrote a hidden value");
  assert.ok(!titles.join("\n").includes("unseen-bo") && !titles.join("\n").includes("Unseen Bo"), "nor anything of the unseen record");
});
