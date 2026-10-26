// Golden flow 4: an offline edit and a conflict (spec 2.12, 4.11; ARCH 5.4). Two devices edit the same field of one record from the same base; the second push meets the first, a conflict opens,
// a person resolves it, and undoes the resolution. Through the gateway, two real device sessions, sync push as each device.
import assert from "node:assert/strict";
import { bootTolerant, expectStatus, short, Trail } from "./02-space.ts";
import type { Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";

export const LIVE_FOR_CONFLICT = ["sync", "conflicts", "records", "schema", "devices", "access", "spaces"];
export const GAPS: Gap[] = [];

const NOTE = { op: "type.create", type: "note_item", def: { title: "Note", plural: "Notes", icon: "file", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }, { key: "status", type: "text", title: "Status", merge: "assistant" }] } };
const TRACE = "4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a";
const opFor = (n: number, device: string, recordId: string, value: string, base: number) => ({
  opId: `0192f3a0-7b1c-7000-8000-00000000000${n}`, traceId: TRACE, hlc: `00000000000${n}-0000-${device}`, cap: "records.update", v: 1, entity: "note_item", id: recordId,
  input: { type: "note_item", recordId, patch: { status: value }, fields: { status: value }, idempotencyKey: `golden-4-op-${n}` }, baseSeq: { status: base },
});

export async function runConflict(live: readonly string[]): Promise<{ events: Observed[]; trail: Trail }> {
  const trail = new Trail();
  const { s } = await bootTolerant(trail, live);
  if (!s) return { events: [], trail };
  try {
    const admin = s.d.token;
    await trail.step("the note type exists", async () => {
      const r = await s.call("schema.apply", admin, { idempotencyKey: "golden-4-type", ops: [NOTE] });
      if (r.status !== 422 || r.body?.error?.code !== "validation.duplicate") expectStatus(r, 200, "schema.apply");
    });
    const rec = await trail.step("a record exists", async () =>
      expectStatus(await s.call("records.create", admin, { idempotencyKey: "golden-4-rec", type: "note_item", fields: { name: "Shared note", status: "draft" } }), 200, "records.create").record.id as string,
    ["the note type exists"]);
    // the sequence the record has in the sync feed: the base both devices edit from
    const base = await trail.step("the record is in the sync feed", async () => {
      const out = expectStatus(await s.call("sync.pull", admin, { cursor: 0, epoch: 0 }), 200, "sync.pull");
      const seq = (out.changes as { id: string; seq: number }[]).find((c) => c.id === rec)?.seq;
      assert.ok(seq !== undefined, `the record is in the feed ${short(out)}`);
      return seq as number;
    }, ["a record exists"]);
    const a = s.signedIn("usr_noah", "dev_noaha1"), b = s.signedIn("usr_noah", "dev_noahb1");
    await trail.step("device A pushes its offline edit", async () => {
      const out = expectStatus(await s.call("sync.push", a, { deviceId: "dev_noaha1", epoch: 0, ops: [opFor(1, "noaha1", rec!, "sent", base!)] }), 200, "sync.push");
      assert.equal(out.applied.length, 1, `A applied ${short(out)}`);
      assert.equal(out.conflicts.length, 0, `A is the first edit from the base, so it meets no conflict ${short(out)}`);
      const now = expectStatus(await s.call("records.get", admin, { type: "note_item", recordId: rec! }), 200, "records.get");
      assert.equal(now.record.fields.status, "sent", `A's value is in the record ${short(now)}`);
      // the change has its event, under the flow's trace, before B pushes
      const log = await s.events(false);
      const updated = log.filter((e) => e.type === "record.updated");
      assert.equal(updated.length, 1, `A's edit has one record.updated; the log has ${log.map((e) => `${e.type}[${e.traceId?.slice(0, 4)}]`).join(", ")}`);
      assert.equal(updated[0]!.traceId, TRACE, "A's record.updated carries the op's trace id");
    }, ["the record is in the sync feed"]);
    const conflict = await trail.step("device B pushes a competing edit from the same base and a conflict opens", async () => {
      const out = expectStatus(await s.call("sync.push", b, { deviceId: "dev_noahb1", epoch: 0, ops: [opFor(2, "noahb1", rec!, "lost", base!)] }), 200, "sync.push");
      assert.ok(out.conflicts.length >= 1, `B conflicts ${short(out)}`);
      return out.conflicts[0].id as string;
    }, ["device A pushes its offline edit"]);
    const resolution = await trail.step("the person whose edit it was resolves it", async () =>
      expectStatus(await s.call("conflicts.resolve", b, { conflictId: conflict!, choice: "theirs", summary: "keep the first edit" }), 200, "conflicts.resolve").resolutionId as string,
    ["device B pushes a competing edit from the same base and a conflict opens"]);
    await trail.step("the resolution is undone", async () => {
      expectStatus(await s.call("conflicts.undo", b, { resolutionId: resolution! }), 200, "conflicts.undo");
    }, ["the person whose edit it was resolves it"]);
    await trail.step("refusal: a device that is not B's cannot push B's ops", async () => {
      const r = await s.call("sync.push", a, { deviceId: "dev_noahb1", epoch: 0, ops: [] });
      assert.ok(r.status >= 400 && r.status < 500, `A pushing as B: ${r.status}`);
    });
    return { events: await s.events(), trail };
  } finally { await s.stop(); }
}

export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runConflict([]);
  if (trail.failures.length) throw new Error(`flow 4 failed:\n${trail.report()}`);
  return events;
}
