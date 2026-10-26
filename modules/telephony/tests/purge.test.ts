// P-CC_39: telephony.sms.erase and telephony.call.erase remove one text or one call for good: the row, a call's meta, its recording from Files and from Twilio, and the conversation entry in the inbox.
// A second erase of the same item is `erased: false`, not an error. Other texts and calls stay.
// @reads /modules/telephony/migrations/0001_telephony.sql
// @reads /modules/telephony/handlers/purge.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as h from "../handlers/index.ts";
import { contractErrors, eventErrors, harness } from "../fixtures/harness.ts";
import { ensure } from "../projections.ts";
import type { Harness } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;

function seed(t: Harness): void {
  ensure(t.ctx);
  const sms = (id: string, to: string) => t.ctx.db.run(
    `INSERT INTO telephony_sms ("id", "numberId", "direction", "from", "to", "body", "status", "at", "version") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, "num_a1b2c3", "in", to, "+14155550100", "call me back about the trust", "delivered", 1, 0);
  sms("sms_pat00001", "+14155550177");
  sms("sms_other001", "+14155550188");
  const call = (id: string, file: string | null) => t.ctx.db.run(
    `INSERT INTO telephony_call ("id", "numberId", "direction", "from", "to", "state", "startedAt", "recordingFileId", "transcript", "summary", "version") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, "num_a1b2c3", "in", "+14155550177", "+14155550100", "ended", 1, file, "Pat: I want a trust", "Wants a trust", 0);
  call("cal_pat00001", "fil_rec00001");
  call("cal_other001", null);
  t.ctx.db.run(`INSERT INTO telephony_call_meta ("callId", "hold", "recording", "recordingSid") VALUES (?, ?, ?, ?)`, "cal_pat00001", 0, 0, "RE00000000000000000000000000000001");
  t.ctx.db.run(`INSERT INTO telephony_call_meta ("callId", "hold", "recording") VALUES (?, ?, ?)`, "cal_other001", 0, 0);
}

const rows = (t: Harness, table: string): string[] => t.rows(`SELECT id FROM ${table}`).map((r) => String(r["id"])).sort();

test("sms.erase removes the text and its conversation entry, leaves other texts, and answers erased false the second time", async () => {
  const t = harness();
  seed(t);
  t.script("inbox.item.erase", () => ({ erased: true }));
  const out = (await h.smsErase(t.ctx, { smsId: "sms_pat00001", idempotencyKey: "k1" })) as Json;
  assert.deepEqual(contractErrors("telephony.sms.erase", "out", out), []);
  assert.deepEqual(out, { erased: true });
  assert.deepEqual(rows(t, "telephony_sms"), ["sms_other001"]);
  assert.deepEqual(t.calls("inbox.item.erase").map((c) => c.input["refId"]), ["sms_pat00001"]);
  assert.deepEqual(t.named("sms.erased").map((e) => e.payload), [{ smsId: "sms_pat00001" }]);
  for (const e of t.named("sms.erased")) assert.deepEqual(eventErrors(e.name, e.payload), []);
  assert.deepEqual(await h.smsErase(t.ctx, { smsId: "sms_pat00001", idempotencyKey: "k2" }), { erased: false });
  assert.equal(t.named("sms.erased").length, 1);
  assert.ok(!JSON.stringify(t.emitted).includes("trust"), "the event carries ids, never the text");
});

test("call.erase removes the call, its meta, its recording from Twilio and Files, and its conversation entry", async () => {
  const t = harness();
  seed(t);
  t.script("inbox.item.erase", () => ({ erased: true }));
  t.script("twilio.recording.delete", () => ({ deleted: true }));
  t.script("files.delete", () => ({ ok: true }));
  t.script("files.purge", () => ({ purged: true }));
  const out = (await h.callErase(t.ctx, { callId: "cal_pat00001", idempotencyKey: "k1" })) as Json;
  assert.deepEqual(contractErrors("telephony.call.erase", "out", out), []);
  assert.deepEqual(rows(t, "telephony_call"), ["cal_other001"]);
  assert.deepEqual(t.rows(`SELECT "callId" FROM telephony_call_meta`).map((r) => r["callId"]), ["cal_other001"]);
  assert.deepEqual(t.calls("twilio.recording.delete").map((c) => c.input["recordingSid"]), ["RE00000000000000000000000000000001"]);
  assert.deepEqual([t.calls("files.delete")[0]?.input["fileId"], t.calls("files.purge")[0]?.input["fileId"]], ["fil_rec00001", "fil_rec00001"]);
  assert.deepEqual(t.named("call.erased").map((e) => e.payload), [{ callId: "cal_pat00001" }]);
  for (const e of t.named("call.erased")) assert.deepEqual(eventErrors(e.name, e.payload), []);
  assert.deepEqual(await h.callErase(t.ctx, { callId: "cal_pat00001", idempotencyKey: "k2" }), { erased: false });
});

test("a recording the provider or Files no longer has does not stop the erase; any other refusal does and leaves the call in place", async () => {
  const t = harness();
  seed(t);
  t.script("inbox.item.erase", () => ({ erased: true }));
  t.script("twilio.recording.delete", () => { throw t.err("validation.not_found", "gone"); });
  t.script("files.delete", () => { throw t.err("validation.not_found", "gone"); });
  t.script("files.purge", () => { throw t.err("validation.not_found", "gone"); });
  assert.deepEqual(await h.callErase(t.ctx, { callId: "cal_pat00001", idempotencyKey: "k1" }), { erased: true });

  const u = harness();
  seed(u);
  u.script("inbox.item.erase", () => ({ erased: true }));
  u.script("twilio.recording.delete", () => { throw u.err("provider.unavailable", "Twilio is down"); });
  await assert.rejects(h.callErase(u.ctx, { callId: "cal_pat00001", idempotencyKey: "k1" }), (e) => (e as { error?: { code?: string } }).error?.code === "provider.unavailable");
  assert.ok(rows(u, "telephony_call").includes("cal_pat00001"), "nothing local is removed before the provider copy is");
});
