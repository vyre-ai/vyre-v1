// The doctor's records.created_events check on a booted Space: every way a record is made (records.create, records.bulk_upsert, a sync pull, an import through bulk upsert) leaves an announcement, so the check
// says nothing is wrong; a false alarm on a real Space would cost more than the check is worth. The records are made older than the grace by moving the clock the check reads.
import test from "node:test";
import assert from "node:assert/strict";
import { call, hostLog } from "./support/eco-live.ts";
import { pulled, rowsOf, spec, world } from "./support/sync-live.ts";
import { recordEventsFinding } from "../host/src/daemon/doctor.ts";

test("no false alarm after records.create, bulk upsert, a sync pull and an import", { timeout: 180_000 }, async () => {
  const w = await world(true);
  try {
    const dir = w.d.paths.events.replace(/\/[^/]*$/, "");
    const created = await call(w.d, "records.create", { type: "contact", fields: { name: "Solo", email: "solo@x.test" }, idempotencyKey: "solo" });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const bulk = await call(w.d, "records.bulk_upsert", { type: "contact", match: ["email"], rows: Array.from({ length: 50 }, (_, i) => ({ name: `Bulk ${i}`, email: `b${i}@x.test` })) });
    assert.equal(bulk.status, 200);
    const imported = await call(w.d, "records.bulk_upsert", { type: "contact", match: ["email"], rows: [{ name: "Import", email: "imp@x.test" }], runAutomations: true });
    assert.equal(imported.status, 200);
    const applied = await call(w.d, "sync_specs.apply", { spec: spec("people"), idempotencyKey: "apply-doc" });
    assert.equal(applied.status, 200, JSON.stringify(applied.data));
    await pulled(w.d, ["person"]);
    assert.ok((await rowsOf(w.d, "person")).length > 0, "the pull made records");
    const far = Date.now() + 60 * 60_000;
    const f = recordEventsFinding(`${dir}/space.db`, w.d.paths.events, far);
    assert.equal(f.state, "healthy", `${f.detail}\n${hostLog(w.d).slice(0, 400)}`);
    assert.match(f.detail, /^All \d+ records have their created event/);
  } finally {
    await w.close();
  }
});
