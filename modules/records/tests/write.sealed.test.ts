// @reads /modules/records/migrations/0001_init.sql
import test from "node:test";
import assert from "node:assert/strict";
import { mintUuid } from "../../../lib/ids.ts";
import { openRecords } from "../impl.ts";
import type { ProjectionHost } from "../../../kernel/src/store/projection.ts";
import { PERSON } from "../fixtures/seed.ts";

const SECRET = "123-45-6789";
const code = (c: string) => (e: unknown) => {
  assert.equal((e as { code?: string }).code, c);
  return true;
};
const vcode = (c: string) => (e: unknown) => {
  assert.equal((e as { error?: { code?: string } }).error?.code, c);
  return true;
};

function logText(host: ProjectionHost): string {
  return host.store.read({ limit: 5000 }).map((e) => new TextDecoder().decode(e.payload)).join("\n");
}

test("sealed plaintext is refused and never written to the log, events, history or the row", async () => {
  const rec = openRecords({ space: "sp_seal" });
  await rec.store.define({ add_types: [PERSON] });
  const emitted: unknown[] = [];
  const ctx = {
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    emit: (_n: string, _s: string, payload: Record<string, unknown>) => { emitted.push(payload); },
  };
  const id = mintUuid();
  await assert.rejects(() => rec.store.create("person", id, { name: "A", ssn: SECRET }), code("sealed_value_refused"));
  await assert.rejects(() => rec.handlers["records.create"](ctx, { type: "person", fields: { name: "A", ssn: SECRET }, idempotencyKey: "bad" }), vcode("validation.bad_input"));
  await assert.rejects(() => rec.store.create("person", mintUuid(), { name: "A", ssn: { sealed: "ssn", ref: SECRET, present: true } }), code("sealed_value_refused"));

  const ok = await rec.handlers["records.create"](ctx, {
    type: "person",
    fields: { name: "A", ssn: { sealed: "ssn", ref: "sv_1", present: true, raw: SECRET } },
    idempotencyKey: "ok",
  });
  assert.equal(ok.record.fields.ssn && (ok.record.fields.ssn as { raw?: string }).raw, undefined);
  assert.equal((ok.record.fields.ssn as { ref: string }).ref, "sv_1");
  await assert.rejects(() => rec.store.update("person", ok.record.id, { ssn: SECRET }, 1), code("sealed_value_refused"));
  await assert.rejects(() => rec.handlers["records.update"](ctx, { type: "person", recordId: ok.record.id, patch: { ssn: "987-65-4321" }, baseVersion: 1 }), vcode("validation.bad_input"));

  const changed = await rec.handlers["records.update"](ctx, {
    type: "person",
    recordId: ok.record.id,
    patch: { ssn: { sealed: "ssn", ref: "sv_2", present: true, valid_format: true, set_at: 1 } },
    baseVersion: 1,
  });
  assert.equal((changed.record.fields.ssn as { ref: string }).ref, "sv_2");

  const dump = [logText(rec.host), JSON.stringify(emitted), JSON.stringify(rec.history("person", ok.record.id))].join("\n");
  const rows = rec.host.tx.all<{ data: string }>("SELECT data FROM rt_person");
  const stored = dump + "\n" + rows.map((r) => r.data).join("\n");
  assert.equal(stored.includes(SECRET), false);
  assert.equal(stored.includes("987-65-4321"), false);
  for (const payload of emitted) {
    const text = JSON.stringify(payload);
    assert.equal(text.includes("sv_1"), false);
    assert.equal(text.includes("sv_2"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "value"), false);
  }
  assert.ok(emitted.length >= 2);
});
