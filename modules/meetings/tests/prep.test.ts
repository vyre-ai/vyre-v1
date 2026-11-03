// Prepare (lane l-calevents): from an event in the Calendar, the person's own Assistant gets a brief with who is coming (their records) and the past meetings with them (what the
// close-out found), and hands back a few lines of notes that are the person's alone. Another agent cannot write them; another person never sees them.
// @reads /modules/meetings/handlers/prep.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as m from "../handlers/index.ts";
import { EVENT, HOUR, MAYA, NOW, START, contractErrors, harness, refusedWith } from "../fixtures/harness.ts";
import { ANSWER, ASSISTANT, SAM, TRANSCRIPT, closeoutWorld } from "../fixtures/closeout.ts";

type Json = Record<string, unknown>;
const NEXT = "cev_next0001";

async function world() {
  const h = harness();
  closeoutWorld(h, { [MAYA]: "Maya Ortiz", [SAM]: "Sam Reyes" });
  // last week's call with Pat, closed out
  const got = (await m.ingest(h.ctx, { source: "calendar", providerRef: EVENT, calendarEventId: EVENT, title: "Lee Holdings renewal", startsAt: START, endsAt: START + HOUR, attendees: [{ email: "maya@firm.example" }, { email: "pat@client.example" }] })) as Json;
  const past = String(got.meetingId);
  await m.attachRecording(h.ctx, { meetingId: past, source: "upload", transcriptText: TRANSCRIPT });
  await m.closeoutPrepare(h.ctx, { meetingId: past });
  h.actAs("agent", ASSISTANT);
  await m.closeoutPropose(h.ctx, { meetingId: past, ...ANSWER, email: undefined, next: undefined, records: [] } as never);
  h.actAs("person", MAYA);
  const items = (await m.closeoutGet(h.ctx, { meetingId: past })).items as Json[];
  await m.closeoutApprove(h.ctx, { meetingId: past, itemIds: [String(items[0]!.itemId)] });
  // the follow-up, three days later, with Pat again
  h.calendar.events.set(NEXT, {
    id: NEXT, calendarId: "cld_work0001", title: "Lee Holdings: legal review", startsAt: START + 72 * HOUR, endsAt: START + 73 * HOUR, allDay: false, joinProvider: "meet", recordIds: [], status: "confirmed",
    attendees: [{ email: "maya@firm.example", response: "accepted" }, { email: "pat@client.example", response: "needs_action" }], description: "Decide whether their legal team reviews the terms.",
  });
  return { h, past };
}

test("Prepare asks your own Assistant with who is coming and what the last meeting with them found", async () => {
  const { h } = await world();
  assert.deepEqual(await m.prepGet(h.ctx, { eventId: NEXT }), { state: "none", notes: [] });
  const started = await m.prepStart(h.ctx, { eventId: NEXT });
  assert.deepEqual(contractErrors("meetings.prep.start", "out", started), []);
  assert.equal(started.state, "working");
  const ask = h.calls("tasks.create").at(-1)!.input as Json;
  assert.deepEqual(ask.assigned, { kind: "agent", id: ASSISTANT });
  const brief = String((ask.notes as Json).brief);
  for (const said of ["Prepare Maya Ortiz", "Lee Holdings: legal review", "Pat Lee <pat@client.example>, record rec_pat00001, Operations lead", "Lee Holdings renewal on", "Tasks made: Send Pat the revised quote", "Still to approve: Set up the onboarding call", "Decide whether their legal team", "meetings.prep.save"]) {
    assert.ok(brief.includes(said), `the brief says ${said}`);
  }
  assert.deepEqual(await m.prepStart(h.ctx, { eventId: NEXT }), started, "pressing it again while it works asks nothing more");
  assert.equal(h.calls("tasks.create").filter((c) => String(c.input.title).startsWith("Prepare")).length, 1);
  assert.equal((await m.prepGet(h.ctx, { eventId: NEXT })).state, "working");
});

test("the Assistant's notes are Maya's alone; another agent cannot write them", async () => {
  const { h } = await world();
  await m.prepStart(h.ctx, { eventId: NEXT });
  h.actAs("agent", "agt_other0001");
  assert.equal(await refusedWith(m.prepSave(h.ctx, { eventId: NEXT, notes: ["Made up"] })), "validation.precondition_failed");
  h.actAs("agent", ASSISTANT);
  const saved = await m.prepSave(h.ctx, { eventId: NEXT, notes: ["Pat is now Head of Operations.", "Open: whether legal reviews the terms.", ""] });
  assert.deepEqual(contractErrors("meetings.prep.save", "out", saved), []);
  h.actAs("person", MAYA);
  const got = await m.prepGet(h.ctx, { eventId: NEXT });
  assert.deepEqual(contractErrors("meetings.prep.get", "out", got), []);
  assert.deepEqual([got.state, got.notes, got.preparedAt], ["ready", ["Pat is now Head of Operations.", "Open: whether legal reviews the terms."], NOW]);
  h.actAs("person", SAM);
  assert.deepEqual(await m.prepGet(h.ctx, { eventId: NEXT }), { state: "none", notes: [] }, "Sam sees none of it");
  assert.equal(await refusedWith(m.prepStart(h.ctx, { eventId: NEXT })), "validation.precondition_failed", "Sam has no Assistant yet");
  h.actAs("service", "svc_host");
  assert.equal(await refusedWith(m.prepStart(h.ctx, { eventId: NEXT })), "validation.precondition_failed", "prep notes are a person's");
});
