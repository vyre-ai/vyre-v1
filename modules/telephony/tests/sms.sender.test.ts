// senderId on telephony.send_sms: an id from comms.senders.list (for a text, the number id). It must name the same number as numberId; the number is checked again at send time
// (active, able to text) and the refusal says so in plain words. Without a senderId nothing changes.
import test from "node:test";
import assert from "node:assert/strict";
import * as h from "../handlers/index.ts";
import { CALLER, MAYA, NUM_E164, codeOf, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const PAT = "rec_pat00001";
let seq = 0;

async function setup(t: Harness): Promise<string> {
  t.contacts.set(CALLER, PAT);
  t.prefs.set(PAT, { smsConsent: "granted" });
  const made = (await h.numberBuy(t.ctx, { e164: NUM_E164, title: "Main line", assigneeKind: "person", assigneeId: MAYA, idempotencyKey: "k-buy" })) as { number: { id: string } };
  return made.number.id;
}

const send = (t: Harness, numberId: string, o: Record<string, unknown> = {}) =>
  h.sendSms(t.ctx, { numberId, to: CALLER, body: "See you Friday.", idempotencyKey: `k-sender-${++seq}`, ...o } as Parameters<typeof h.sendSms>[1]);

async function refusal(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (e) {
    return { code: codeOf(e), message: (e as { error: { message: string } }).error.message };
  }
  return assert.fail("the text was not refused");
}

test("a text with the senderId of the number goes out from that number", async () => {
  const t = harness();
  const numberId = await setup(t);
  const out = await send(t, numberId, { senderId: numberId });
  assert.equal(out.status, "queued");
  assert.equal(t.calls("twilio.sms.send")[0]?.input.from, NUM_E164);
});

test("a senderId that is not a number, or names another number than numberId, is refused before anything is sent", async () => {
  const t = harness();
  const numberId = await setup(t);
  const mailbox = await refusal(send(t, numberId, { senderId: "mbx_maya" }));
  assert.deepEqual([mailbox.code, mailbox.message], ["validation.bad_input", "That sender is not a number. Pick one from the list of senders for text."]);
  const clash = await refusal(send(t, numberId, { senderId: "num_other" }));
  assert.deepEqual([clash.code, clash.message], ["validation.bad_input", "The sender and the number name different senders. Pass the same id for both."]);
  assert.equal(t.calls("twilio.sms.send").length, 0);
});

test("a chosen number that went inactive, was released, cannot text, or never existed is refused in plain words", async () => {
  const t = harness();
  const numberId = await setup(t);
  t.ctx.db.run(`UPDATE telephony_number SET state = ? WHERE id = ?`, "pending", numberId);
  const waiting = await refusal(send(t, numberId, { senderId: numberId }));
  assert.deepEqual([waiting.code, waiting.message], ["validation.precondition_failed", "That number is not active."]);
  t.ctx.db.run(`UPDATE telephony_number SET state = ?, capabilities = ? WHERE id = ?`, "active", JSON.stringify(["voice"]), numberId);
  assert.equal((await refusal(send(t, numberId, { senderId: numberId }))).message, "That number cannot send texts.");
  t.ctx.db.run(`UPDATE telephony_number SET state = ?, capabilities = ?, deleted_at = ? WHERE id = ?`, "active", JSON.stringify(["sms"]), 1, numberId);
  assert.equal((await refusal(send(t, numberId, { senderId: numberId }))).code, "validation.not_found");
  assert.equal((await refusal(send(t, "num_nobody", { senderId: "num_nobody" }))).code, "validation.not_found");
  assert.equal(t.calls("twilio.sms.send").length, 0);
});
