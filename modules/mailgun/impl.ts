// mailgun module entry (lane L5). The host loads these handlers once host/modules.json says `live` for mailgun.
// The host registers its half once at boot with setMailgunHost (the API key and signing key from the Vault, multipart uploads, Space file bytes, blob downloads, the
// Space's public address): see projections.ts. parseWebhook and parseInbound turn a body the host has verified into the input of mailgun.receive_webhook and
// mailgun.receive_inbound.
import type { Handler } from "../../host/src/invoke.ts";
import type { SeamSetters } from "../../host/src/seams/index.ts";
import * as h from "./handlers/index.ts";

import { setMailgunHost } from "./projections.ts";
export { setMailgunHost };
export type { MailgunHost } from "./projections.ts";
export { parseInbound, parseWebhook } from "./handlers/index.ts";

export const handlers: Record<string, Handler> = {
  "mailgun.send_email": (ctx, i) => h.sendEmail(ctx, i),
  "mailgun.events.list": (ctx, i) => h.eventsList(ctx, i),
  "mailgun.domains.list": (ctx) => h.domainsList(ctx),
  "mailgun.domains.get": (ctx, i) => h.domainsGet(ctx, i),
  "mailgun.domains.create": (ctx, i) => h.domainsCreate(ctx, i),
  "mailgun.domains.verify": (ctx, i) => h.domainsVerify(ctx, i),
  "mailgun.domains.delete": (ctx, i) => h.domainsDelete(ctx, i),
  "mailgun.routes.list": (ctx) => h.routesList(ctx),
  "mailgun.routes.create": (ctx, i) => h.routesCreate(ctx, i),
  "mailgun.routes.delete": (ctx, i) => h.routesDelete(ctx, i),
  "mailgun.health": (ctx, i) => h.health(ctx, i),
  "mailgun.receive_webhook": (ctx, i) => h.receiveWebhook(ctx, i),
  "mailgun.receive_inbound": (ctx, i) => h.receiveInbound(ctx, i),
};

export const projections = { inline: {}, consumers: {} };

/** Where the host registers its half at boot (ruling 31): the loader reads this export. */
export const hostSeams: SeamSetters = { setMailgunHost };
