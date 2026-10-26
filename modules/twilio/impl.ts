// twilio module entry (lane L5). The host serves the generated stubs while manifests/twilio.ts says `status: 'stub'`; the flip to live is a one-line edit to host/modules.json
// (ruling 25) once P-CI_02 has landed. The host registers its half once at boot with setTwilioHost (Vault items, recording downloads, the Space's public address): see projections.ts.
// acceptHook is what the host's /hooks/twilio/* route calls first: it refuses a request Twilio did not sign and hands the rest to twilio.receive_webhook.
import type { Handler } from "../../host/src/invoke.ts";
import * as h from "./handlers/index.ts";
import { hostOnly } from "../../host/src/ctx/host-only.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import type { WebhookAccept } from "../../host/src/routes/webhooks.ts";
import { setTwilioHost } from "./projections.ts";
import type { SeamSetters } from "../../host/src/seams/index.ts";

export { setTwilioHost };
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
  "twilio.receive_webhook": async (ctx, i) => { hostOnly(ctx, "twilio.receive_webhook"); return h.receiveWebhook(ctx, i); },
};

export const projections = { inline: {}, consumers: {} };

/** Where the host registers its half at boot (ruling 31). */
export const hostSeams: SeamSetters = { setTwilioHost };

/** /hooks/twilio/<voice|sms|status|recording> (P-L5_17): Twilio signs the URL it called and the form fields, so the host passes both as they arrived. The answer carries the TwiML a call is owed. */
export const hostCalls = {
  "twilio.accept_webhook": async (ctx: Ctx, a: WebhookAccept): Promise<unknown> => {
    hostOnly(ctx, "twilio.accept_webhook");   // a host call: the webhook route is the only way in
    const params = Object.fromEntries(new URLSearchParams(a.body)) as Record<string, string>;
    const input = await h.acceptHook(ctx, { kind: a.kind ?? "", url: a.url, params, signature: a.headers["x-twilio-signature"] });
    return h.receiveWebhook(ctx, input);
  },
};
