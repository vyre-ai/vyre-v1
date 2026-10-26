// Golden flow 4: an offline edit and a conflict (spec 2.12, 4.11; ARCH 5.4). Two devices edit the same field of one record from the same base; the second push meets the first, a conflict opens,
// a person resolves it, and undoes the resolution. Through the gateway, two real device sessions, sync push as each device.
import assert from "node:assert/strict";
import { bootTolerant, expectStatus, short, Trail } from "./02-space.ts";
import type { Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";

export const LIVE_FOR_CONFLICT = ["sync", "conflicts", "records", "schema", "devices", "access", "spaces"];
export const GAPS: Gap[] = [
  { packet: "PR 470 (P-L1_LIVE)", lane: "L1", what: "sync cannot boot live: sync.devices.lag, doc.close, doc.compact, doc.open, doc.update, endpoints, entities, health, hello, status have no handler" },
  { packet: "conflicts (L1)", lane: "L1", what: "modules/conflicts has no impl.ts, so the module cannot be loaded live" },
];

const NOTE = { op: "type.create", type: "note_item", def: { title: "Note", plural: "Notes", icon: "file", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }, { key: "status", type: "text", title: "Status" }] } };
const TRACE = "4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a";
const opFor = (n: number, device: string, recordId: string, value: string, base: number) => ({
  opId: `0192f3a0-7b1c-7000-8000-00000000000${n}`, traceId: TRACE, hlc: `00000000000${n}-0000-${device}`, cap: "records.update", v: 1, entity: "record", id: recordId,
  input: { type: "note_item", recordId, fields: { status: value }, idempotencyKey: `golden-4-op-${n}` }, baseSeq: { record: base },
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
    const a = s.signedIn("usr_noah", "dev_noaha1"), b = s.signedIn("usr_noah", "dev_noahb1");
    await trail.step("device A pushes its offline edit", async () => {
      const out = expectStatus(await s.call("sync.push", a, { deviceId: "dev_noaha1", epoch: 0, ops: [opFor(1, "noaha1", rec!, "sent", 0)] }), 200, "sync.push");
      assert.equal(out.applied.length, 1, `A applied ${short(out)}`);
    }, ["a record exists"]);
    const conflict = await trail.step("device B pushes a competing edit from the same base and a conflict opens", async () => {
      const out = expectStatus(await s.call("sync.push", b, { deviceId: "dev_noahb1", epoch: 0, ops: [opFor(2, "noahb1", rec!, "lost", 0)] }), 200, "sync.push");
      assert.ok(out.conflicts.length >= 1, `B conflicts ${short(out)}`);
      return out.conflicts[0].conflictId as string;
    }, ["device A pushes its offline edit"]);
    const resolution = await trail.step("a person resolves it", async () =>
      expectStatus(await s.call("conflicts.resolve", admin, { conflictId: conflict!, choice: "theirs", summary: "keep the first edit" }), 200, "conflicts.resolve").resolutionId as string,
    ["device B pushes a competing edit from the same base and a conflict opens"]);
    await trail.step("the resolution is undone", async () => {
      expectStatus(await s.call("conflicts.undo", admin, { resolutionId: resolution! }), 200, "conflicts.undo");
    }, ["a person resolves it"]);
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
