// Erase one text or one call for good (governance erase; P-CC_39). The row, what hangs off it and the conversation entry go; a call's recording goes from Files and from Twilio.
// DECISION: a text or call that is already gone answers `erased: false`, not an error, so a replay after a restore is one more call. Holds are the caller's check (governance), made before this runs.
// DECISION: the provider copy of a recording is deleted with the file: an erased call must not leave its audio at Twilio. A recording Twilio no longer has (not_found) is fine; any other refusal stops the erase.
import { codeOf, ensure, first, str, strOrNull } from "../projections.ts";
import type { TelCtx } from "../projections.ts";

async function tolerant(run: () => Promise<unknown>): Promise<void> {
  try { await run(); } catch (e) { if (codeOf(e) !== "validation.not_found" && codeOf(e) !== "permission.not_found") throw e; }
}

/** The conversation entry of this item, in the inbox module. */
async function dropEntry(ctx: TelCtx, refId: string): Promise<void> {
  await tolerant(() => ctx.call("inbox.item.erase", { refId, idempotencyKey: `tel-erase:${refId}` }));
}

export async function smsErase(ctx: TelCtx, input: { smsId: string; idempotencyKey: string }) {
  ensure(ctx);
  const row = first(ctx.db.all(`SELECT * FROM telephony_sms WHERE id = ?`, input.smsId));
  if (!row) return { erased: false };
  const id = str(row, "id");
  await dropEntry(ctx, id);
  ctx.db.run(`DELETE FROM telephony_sms WHERE id = ?`, id);
  ctx.emit("sms.erased", `entity/${id}`, { smsId: id });
  return { erased: true };
}

export async function callErase(ctx: TelCtx, input: { callId: string; idempotencyKey: string }) {
  ensure(ctx);
  const row = first(ctx.db.all(`SELECT * FROM telephony_call WHERE id = ?`, input.callId));
  if (!row) return { erased: false };
  const id = str(row, "id");
  const meta = first(ctx.db.all(`SELECT * FROM telephony_call_meta WHERE "callId" = ?`, id));
  const sid = meta ? strOrNull(meta, "recordingSid") : null;
  if (sid) await tolerant(() => ctx.call("twilio.recording.delete", { recordingSid: sid, idempotencyKey: `tel-erase:${id}:twilio` }));
  const file = strOrNull(row, "recordingFileId");
  if (file) {
    await tolerant(() => ctx.call("files.delete", { fileId: file }));
    await tolerant(() => ctx.call("files.purge", { fileId: file }));
  }
  await dropEntry(ctx, id);
  ctx.db.run(`DELETE FROM telephony_call_meta WHERE "callId" = ?`, id);
  ctx.db.run(`DELETE FROM telephony_call WHERE id = ?`, id);
  ctx.emit("call.erased", `entity/${id}`, { callId: id });
  return { erased: true };
}
