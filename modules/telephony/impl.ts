// telephony (lane L5). The host serves the generated stubs while host/modules.json says `status: 'stub'`; the flip to live is a one-line edit there (ruling 25).
// Twilio is reached through twilio.* capabilities, contacts and the conversation through contacts.* and inbox.*, recordings through files.* (ctx.call), never by importing another module.
import type { Handler } from "../../host/src/invoke.ts";
import * as h from "./handlers/index.ts";

export const handlers: Record<string, Handler> = {
  "telephony.number.list": (ctx, i) => h.numberList(ctx, i),
  "telephony.number.get": (ctx, i) => h.numberGet(ctx, i),
  "telephony.number.search": (ctx, i) => h.numberSearch(ctx, i),
  "telephony.number.buy": (ctx, i) => h.numberBuy(ctx, i),
  "telephony.number.import": (ctx, i) => h.numberImport(ctx, i),
  "telephony.number.release": (ctx, i) => h.numberRelease(ctx, i),
  "telephony.number.assign": (ctx, i) => h.numberAssign(ctx, i),
  "telephony.number.set_route": (ctx, i) => h.numberSetRoute(ctx, i),
  "telephony.number.set_hours": (ctx, i) => h.numberSetHours(ctx, i),
  "telephony.number.set_recording": (ctx, i) => h.numberSetRecording(ctx, i),
  "telephony.dial": (ctx, i) => h.dial(ctx, i),
  "telephony.answer": (ctx, i) => h.answer(ctx, i),
  "telephony.decline": (ctx, i) => h.decline(ctx, i),
  "telephony.hangup": (ctx, i) => h.hangup(ctx, i),
  "telephony.hold": (ctx, i) => h.hold(ctx, i),
  "telephony.transfer": (ctx, i) => h.transfer(ctx, i),
  "telephony.record": (ctx, i) => h.record(ctx, i),
  "telephony.call.list": (ctx, i) => h.callList(ctx, i),
  "telephony.call.get": (ctx, i) => h.callGet(ctx, i),
  "telephony.call.log_task": (ctx, i) => h.callLogTask(ctx, i),
  "telephony.call.attach_summary": (ctx, i) => h.callAttachSummary(ctx, i),
  "telephony.voice_token": (ctx, i) => h.voiceToken(ctx, i),
  "telephony.send_sms": (ctx, i) => h.sendSms(ctx, i),
  "telephony.sms.list": (ctx, i) => h.smsList(ctx, i),
  "telephony.ingest_voice": (ctx, i) => h.ingestVoice(ctx, i),
  "telephony.ingest_sms": (ctx, i) => h.ingestSms(ctx, i),
  "telephony.ingest_status": (ctx, i) => h.ingestStatus(ctx, i),
  "telephony.ingest_recording": (ctx, i) => h.ingestRecording(ctx, i),
  "telephony.registration.get": (ctx) => h.registrationGet(ctx),
  "telephony.registration.save": (ctx, i) => h.registrationSave(ctx, i),
  "telephony.registration.submit": (ctx, i) => h.registrationSubmit(ctx, i),
  "telephony.registration.refresh": (ctx, i) => h.registrationRefresh(ctx, i),
};

export const projections = { inline: {}, consumers: {} };
