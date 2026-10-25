// resend module entry (lane L5). The host loads these handlers once host/modules.json says `live` for resend.
// The host registers its half once at boot with setResendHost (the API key and signing secret from the Vault, Space file bytes, blob downloads): see projections.ts.
// parseWebhook and parseInbound turn a body the host has verified (Svix signature) into the input of resend.receive_webhook and resend.receive_inbound.
import type { Handler } from "../../host/src/invoke.ts";
import type { SeamSetters } from "../../host/src/seams/index.ts";
import * as h from "./handlers/index.ts";

import { setResendHost } from "./projections.ts";
export { setResendHost };
export type { ResendHost } from "./projections.ts";
export { parseInbound, parseWebhook } from "./handlers/index.ts";

export const handlers: Record<string, Handler> = {
  "resend.send_email": (ctx, i) => h.sendEmail(ctx, i),
  "resend.get_email": (ctx, i) => h.getEmail(ctx, i),
  "resend.domains.list": (ctx) => h.domainsList(ctx),
  "resend.domains.get": (ctx, i) => h.domainsGet(ctx, i),
  "resend.domains.create": (ctx, i) => h.domainsCreate(ctx, i),
  "resend.domains.verify": (ctx, i) => h.domainsVerify(ctx, i),
  "resend.domains.delete": (ctx, i) => h.domainsDelete(ctx, i),
  "resend.inbound.get_email": (ctx, i) => h.inboundGetEmail(ctx, i),
  "resend.health": (ctx) => h.health(ctx),
  "resend.receive_webhook": (ctx, i) => h.receiveWebhook(ctx, i),
  "resend.receive_inbound": (ctx, i) => h.receiveInbound(ctx, i),
};

export const projections = { inline: {}, consumers: {} };

/** Where the host registers its half at boot (ruling 31): the loader reads this export. */
export const hostSeams: SeamSetters = { setResendHost };
