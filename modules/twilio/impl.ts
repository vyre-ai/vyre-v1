// twilio module entry (lane L5). The host serves the generated stubs while manifests/twilio.ts says `status: 'stub'`; the flip to live is a one-line edit to host/modules.json
// (ruling 25) once P-CI_02 has landed. The host registers its half once at boot with setTwilioHost (Vault items, recording downloads, the Space's public address): see projections.ts.
// acceptHook is what the host's /hooks/twilio/* route calls first: it refuses a request Twilio did not sign and hands the rest to twilio.receive_webhook.
import type { Handler } from "../../host/src/invoke.ts";
import * as h from "./handlers/index.ts";

export { setTwilioHost } from "./projections.ts";
export type { TwilioHost } from "./projections.ts";
export { acceptHook, hookInput, signatureMatches, signatureOf, voiceTwiml } from "./handlers/index.ts";

export const handlers: Record<string, Handler> = {
  "twilio.number.list_owned": (ctx) => h.numberListOwned(ctx),
  "twilio.number.search": (ctx, i) => h.numberSearch(ctx, i),
  "twilio.number.buy": (ctx, i) => h.numberBuy(ctx, i),
  "twilio.number.release": (ctx, i) => h.numberRelease(ctx, i),
  "twilio.number.configure": (ctx, i) => h.numberConfigure(ctx, i),
  "twilio.twiml_app.ensure": (ctx, i) => h.twimlAppEnsure(ctx, i),
  "twilio.access_token": (ctx, i) => h.accessToken(ctx, i),
  "twilio.call.create": (ctx, i) => h.callCreate(ctx, i),
  "twilio.call.get": (ctx, i) => h.callGet(ctx, i),
  "twilio.call.update": (ctx, i) => h.callUpdate(ctx, i),
  "twilio.recording.start": (ctx, i) => h.recordingStart(ctx, i),
  "twilio.recording.stop": (ctx, i) => h.recordingStop(ctx, i),
  "twilio.recording.download": (ctx, i) => h.recordingDownload(ctx, i),
  "twilio.recording.delete": (ctx, i) => h.recordingDelete(ctx, i),
  "twilio.sms.send": (ctx, i) => h.smsSend(ctx, i),
  "twilio.a2p.create_brand": (ctx, i) => h.a2pCreateBrand(ctx, i),
  "twilio.a2p.create_campaign": (ctx, i) => h.a2pCreateCampaign(ctx, i),
  "twilio.a2p.status": (ctx, i) => h.a2pStatus(ctx, i),
  "twilio.a2p.attach_number": (ctx, i) => h.a2pAttachNumber(ctx, i),
  "twilio.health": (ctx) => h.health(ctx),
  "twilio.receive_webhook": (ctx, i) => h.receiveWebhook(ctx, i),
};

export const projections = { inline: {}, consumers: {} };
