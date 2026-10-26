// zoom connector (lane L5). The host serves the generated stubs while host/modules.json says `status: 'stub'`; the flip to live is P-L5_LIVE's (ruling 25). The host registers its half once at boot with
// setZoomHost (Vault items, recording downloads into blobs), see projections.ts; signatureMatches is what its /hooks/zoom route checks first.
import type { Handler } from "../../host/src/invoke.ts";
import * as h from "./handlers/index.ts";

export { setZoomHost } from "./projections.ts";
export type { ZoomHost } from "./projections.ts";
export { signatureMatches, signatureOf, encryptedTokenOf } from "./handlers/index.ts";

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
  "zoom.receive_webhook": (ctx, i) => h.receiveWebhook(ctx, i),
};

export const projections = { inline: {}, consumers: {} };
