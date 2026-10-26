// zoom connector (lane L5). The host serves the generated stubs while host/modules.json says `status: 'stub'`; the flip to live is P-L5_LIVE's (ruling 25). The host registers its half once at boot with
// setZoomHost (Vault items, recording downloads into blobs), see projections.ts; signatureMatches is what its /hooks/zoom route checks first.
import type { Handler } from "../../host/src/invoke.ts";
import * as h from "./handlers/index.ts";
import { fail } from "../../host/src/routes/errors.ts";
import { hostOnly } from "../../host/src/ctx/host-only.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import type { WebhookAccept } from "../../host/src/routes/webhooks.ts";

import { setZoomHost } from "./projections.ts";
import type { SeamSetters } from "../../host/src/seams/index.ts";

export { setZoomHost };
export type { ZoomHost } from "./projections.ts";
export { signatureMatches, signatureOf, encryptedTokenOf, verifyWebhook, WEBHOOK_TOLERANCE_MS } from "./handlers/index.ts";

export const handlers: Record<string, Handler> = {
  "zoom.meetings.create": (ctx, i) => h.meetingsCreate(ctx, i),
  "zoom.meetings.list": (ctx, i) => h.meetingsList(ctx, i),
  "zoom.meetings.get": (ctx, i) => h.meetingsGet(ctx, i),
  "zoom.meetings.update": (ctx, i) => h.meetingsUpdate(ctx, i),
  "zoom.meetings.delete": (ctx, i) => h.meetingsDelete(ctx, i),
  "zoom.recordings.list": (ctx, i) => h.recordingsList(ctx, i),
  "zoom.recordings.get": (ctx, i) => h.recordingsGet(ctx, i),
  "zoom.recordings.download": (ctx, i) => h.recordingsDownload(ctx, i),
  "zoom.transcripts.get": (ctx, i) => h.transcriptsGet(ctx, i),
  "zoom.users.me": (ctx) => h.usersMe(ctx),
  "zoom.health": (ctx) => h.health(ctx),
  "zoom.receive_webhook": (ctx, i) => { hostOnly(ctx, "zoom.receive_webhook"); return h.receiveWebhook(ctx, i); },
};

export const projections = { inline: {}, consumers: {} };

/** Where the host registers its half at boot (ruling 31). */
export const hostSeams: SeamSetters = { setZoomHost };

/** /hooks/zoom (P-L5_17): x-zm-signature over `v0:<x-zm-request-timestamp>:<raw body>`, a timestamp within five minutes, and Zoom's URL check answered with the token pair. */
export const hostCalls = {
  "zoom.accept_webhook": async (ctx: Ctx, a: WebhookAccept): Promise<unknown> => {
    hostOnly(ctx, "zoom.accept_webhook");   // a host call: the webhook route is the only way in
    const secret = await h.webhookSecret(ctx);
    const v = await h.verifyWebhook(secret, a.headers, a.body, ctx.now());
    if (!v.ok) {
      if (v.reason === "bad_body") throw fail("validation.bad_input", ctx.trace.traceId, { message: "That is not a Zoom event." });
      throw fail("auth.bad_credentials", ctx.trace.traceId, { message: "That request was not signed by Zoom." });
    }
    if (!h.isEventType(v.input.type)) return { accepted: true };   // an event Vyre does not act on is acknowledged, so Zoom does not retry it
    return h.receiveWebhook(ctx, v.input);
  },
};
