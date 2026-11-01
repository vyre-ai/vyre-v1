// dropbox connector (live folders L3). Dropbox as a file source: the app and per-person (or Space) sign-in, the folder and file calls behind a Dropbox mount, and the /hooks/dropbox change notice.
// The host registers its half once at boot with setDropboxHost (app key and secret from the Vault, token exchange and refresh, binary transfers); see projections.ts.
// Not the same thing as modules/esign's Dropbox Sign, which sends documents for signature.
import type { Handler } from "../../host/src/invoke.ts";
import { fail } from "../../host/src/routes/errors.ts";
import { hostOnly } from "../../host/src/ctx/host-only.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import type { WebhookAccept } from "../../host/src/routes/webhooks.ts";
import type { SeamSetters } from "../../host/src/seams/index.ts";
import * as h from "./handlers/index.ts";
import { setDropboxHost } from "./projections.ts";

export { setDropboxHost };
export type { DropboxHost } from "./projections.ts";
export { signatureMatches, verifyWebhook } from "./handlers/index.ts";

export const handlers: Record<string, Handler> = {
  "dropbox.app.status": (ctx) => h.appStatus(ctx),
  "dropbox.app.set": (ctx, i) => h.appSet(ctx, i),
  "dropbox.connect.start": (ctx, i) => h.connectStart(ctx, i),
  "dropbox.connect.complete": (ctx, i) => h.connectComplete(ctx, i),
  "dropbox.account.list": (ctx) => h.accountList(ctx),
  "dropbox.account.remove": (ctx, i) => h.accountRemove(ctx, i),
  "dropbox.files.list_folder": (ctx, i) => h.listFolder(ctx, i),
  "dropbox.files.get_metadata": (ctx, i) => h.getMetadata(ctx, i),
  "dropbox.files.download": (ctx, i) => h.download(ctx, i),
  "dropbox.files.upload": (ctx, i) => h.upload(ctx, i),
  "dropbox.files.create_folder": (ctx, i) => h.createFolder(ctx, i),
  "dropbox.files.delete": (ctx, i) => h.deleteItem(ctx, i),
  "dropbox.files.list_revisions": (ctx, i) => h.listRevisions(ctx, i),
  "dropbox.files.restore": (ctx, i) => h.restore(ctx, i),
  "dropbox.files.latest_cursor": (ctx, i) => h.latestCursor(ctx, i),
  "dropbox.files.longpoll": (ctx, i) => h.longpoll(ctx, i),
  "dropbox.health": (ctx) => h.health(ctx),
  "dropbox.receive_webhook": async (ctx, i) => { hostOnly(ctx, "dropbox.receive_webhook"); return h.receiveWebhook(ctx, i); },
};

export const projections = { inline: {}, consumers: {} };

/** Where the host registers its half at boot (ruling 31). */
export const hostSeams: SeamSetters = { setDropboxHost };

/** /hooks/dropbox: x-dropbox-signature over the raw body with the app secret, checked before anything is recorded. */
export const hostCalls = {
  "dropbox.accept_webhook": async (ctx: Ctx, a: WebhookAccept): Promise<unknown> => {
    hostOnly(ctx, "dropbox.accept_webhook");   // a host call: the webhook route is the only way in
    const secret = await h.webhookSecret(ctx as never).catch(() => { throw fail("auth.bad_credentials", ctx.trace.traceId, { message: "That request was not signed by Dropbox." }); });
    const v = await h.verifyWebhook(secret, a.headers, a.body, ctx.now());
    if (!v.ok) {
      if (v.reason === "bad_body") throw fail("validation.bad_input", ctx.trace.traceId, { message: "That is not a Dropbox change notice." });
      throw h.refuseUnsigned(ctx.trace.traceId);
    }
    return h.receiveWebhook(ctx as never, v.input);
  },
};
