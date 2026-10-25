// esign handlers: send and track envelopes over EsignProvider, the Documenso provider and the inbound webhook.

import { hookHandlers } from "./documenso.ts";
import { sendHandlers } from "./send.ts";

export const handlers = { ...sendHandlers, ...hookHandlers };

export { configureEsign } from "./send.ts";
export type { EsignConfig, EsignProvider, EnvelopeRequest, ProviderStatus, SignedFiles, WebhookEvent, ProviderKey, EnvelopeStatus } from "./send.ts";
export { documenso, parseLock } from "./documenso.ts";
export type { DocumensoLock, DocumensoOptions, HttpFn, HttpResponse } from "./documenso.ts";
