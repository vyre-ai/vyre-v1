// A record and its record.created announcement are written to two files (space.db and events.db). A stop between them used to leave a record that search, sync and Run undo never heard of. Here the stop is
// made for real: a trigger on events.db refuses the announcement, so the call commits the records and fails at its end; the Space restarts, and the missing announcements are made from the records' own events,
// with the same actor, trace and quiet flag, the record searchable and undoable.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { world } from "./support/sync-live.ts";
import { boot, call, seededDir, stop } from "./support/eco-live.ts";
import { cap } from "./support/bigspace-kit.ts";
import { RULES } from "../modules/runs/handlers/undo.ts";
import { recordEventsFinding } from "../host/src/daemon/doctor.ts";

const announced = (file: string): { id: string; type: string; payload: Record<string, any>; actor: string; trace: string }[] => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare("SELECT event, payload FROM events WHERE json_extract(event, '$.type') = 'record.created' ORDER BY seq").all() as { event: string; payload: Uint8Array }[]).map((r) => {
      const e = JSON.parse(r.event) as { id: string; type: string; actor: string; trace_id: string };
      return { id: e.id, type: e.type, actor: e.actor, trace: e.trace_id, payload: JSON.parse(new TextDecoder().decode(r.payload)) };
    });
  } finally {
    db.close();
  }
};

test("a stop between the records and their announcement is repaired at the next start, exactly", { timeout: 180_000 }, async () => {
  const w = await world(true);
  let d = w.d;
  const dir = w.dir;
  try {
    // a control: a normal call, announced by the pipeline
    const control = await cap(d, "records.bulk_upsert", { type: "contact", match: ["email"], rows: [{ name: "Control Person", email: "c@x.test" }], createOnly: true });
    assert.equal(control.created, 1);
    // the stop: the log refuses record.created announcements from now on
    const block = new DatabaseSync(d.paths.events);
    block.exec("PRAGMA busy_timeout = 5000");
    block.exec(
      "CREATE TRIGGER stop_between BEFORE INSERT ON events WHEN json_extract(NEW.event, '$.type') = 'record.created' AND json_extract(NEW.event, '$.entity') = 'record' BEGIN SELECT RAISE(ABORT, 'stopped between the two writes'); END",
    );
    const rows = Array.from({ length: 5 }, (_, i) => ({ name: `Stopped Person ${i}`, email: `s${i}@x.test` }));
    const failed = await call(d, "records.bulk_upsert", { type: "contact", match: ["email"], rows, createOnly: true, idempotencyKey: "stop1" });
    assert.notEqual(failed.status, 200, "the call fails at its commit");
    block.exec("DROP TRIGGER stop_between");
    block.close();
    const before = await cap(d, "records.query", { type: "contact", limit: 50 });
    const sp = new DatabaseSync(`${dir}/space.db`, { readOnly: true });
    assert.equal(Number((sp.prepare("SELECT count(*) AS c FROM rt_contact").get() as { c: number }).c), 6, "the five records were written to the record store");
    sp.close();
    assert.equal(before.rows.length, 1, "and none of them can be seen: they were never registered as resources");
    const dirSpace = `${dir}/space.db`;
    const finding = recordEventsFinding(dirSpace, d.paths.events);
    assert.equal(finding.state, "degraded", "the doctor sees five records without their announcement");
    assert.match(finding.detail, /^5 of /);
    // restart on the same data: the announcements are made
    await stop(d);
    d = await boot(dir, (async function* () {})() as never, { vault: undefined });
    await d.startupWork();
    await d.hooks?.pump?.();
    const events = announced(d.paths.events);
    const stopped = events.filter((e) => /^evt_a/.test(e.id));
    assert.equal(stopped.length, 5, "five announcements made at the start");
    const ctl = events.find((e) => e.payload.fields?.email === "c@x.test")!;
    for (const e of stopped) {
      assert.equal(e.actor, ctl.actor, "the same actor as the call that made the records");
      assert.deepEqual(Object.keys(e.payload).sort(), Object.keys(ctl.payload).sort(), "the same payload keys the call itself gives");
      assert.equal(e.payload.quiet, true);
      assert.match(e.trace, /^[0-9a-f]{32}$/);
    }
    assert.equal(recordEventsFinding(`${dir}/space.db`, d.paths.events).state, "healthy", "the doctor is clean");
    const after = await cap(d, "records.query", { type: "contact", limit: 50 });
    assert.equal(after.rows.length, 6, "all six are visible after the restart: the resources were registered too");
    // undoable: the Run undo rule reads the announcement and names the delete
    const one = stopped[0]!;
    const undo = (RULES["record.created"] as (e: unknown) => any)({ seq: 1, id: one.id, type: "record.created", at: 1, subject: { type: "record", id: one.payload.recordId }, payload: one.payload });
    assert.equal(undo.cap, "records.delete");
    assert.equal(undo.input.recordId, one.payload.recordId);
    // searchable
    const found = await call(d, "search.query", { q: "Stopped Person 3" });
    assert.ok(JSON.stringify(found.data).includes("Stopped Person 3"), "search finds a record the stop had hidden: " + JSON.stringify(found.data).slice(0, 200));
    // a second start makes nothing more
    await stop(d);
    d = await boot(dir, (async function* () {})() as never, { vault: undefined });
    await d.startupWork();
    assert.equal(announced(d.paths.events).filter((e) => /^evt_a/.test(e.id)).length, 5, "a second start makes none");
  } finally {
    await stop(d);
    void seededDir;
  }
});
