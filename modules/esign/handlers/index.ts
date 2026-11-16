// esign handlers: send and track envelopes. Built-in signing (provider vyre, vyre.ts) is the default and needs nothing connected; hosted providers (Dropbox Sign, DocuSign, the Documenso hook) go through send.ts.

import { hookHandlers } from "./documenso.ts";
import { prime } from "./providers.ts";
import { defaultProvider, fail, one, providerOf, rec, reqStr, sendHandlers } from "./send.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import {
  cancelVyre,
  fetchVyre,
  isBuiltIn,
  listAll,
  providersVyre,
  remind,
  sendVyre,
  signerAct,
  signerDoc,
  signerView,
  statusVyre,
  verifyFile,
  titleOf,
} from "./vyre.ts";

/** Which provider an envelope was sent with; an unknown envelope falls through to the hosted code, which says so. */
const builtInEnvelope = (ctx: Ctx, input: unknown): boolean =>
  one(ctx, "SELECT provider FROM esign_envelope WHERE id = ?", reqStr(ctx, rec(ctx, input), "envelopeId"))?.provider ===
  "vyre";

export const handlers = {
  ...sendHandlers,
  ...hookHandlers,
  "esign.send": async (ctx: Ctx, input: unknown) => {
    if (isBuiltIn(ctx, rec(ctx, input).provider)) return sendVyre(ctx, input);
    await prime();
    return sendHandlers["esign.send"](ctx, input);
  },
  "esign.status": (ctx: Ctx, input: unknown) =>
    builtInEnvelope(ctx, input)
      ? statusVyre(ctx, reqStr(ctx, rec(ctx, input), "envelopeId"))
      : sendHandlers["esign.status"](ctx, input),
  "esign.cancel": async (ctx: Ctx, input: unknown) => {
    if (builtInEnvelope(ctx, input)) return cancelVyre(ctx, reqStr(ctx, rec(ctx, input), "envelopeId"));
    await prime();
    return sendHandlers["esign.cancel"](ctx, input);
  },
  "esign.fetch_signed": async (ctx: Ctx, input: unknown) => {
    if (builtInEnvelope(ctx, input)) return fetchVyre(ctx, reqStr(ctx, rec(ctx, input), "envelopeId"));
    await prime();
    return sendHandlers["esign.fetch_signed"](ctx, input);
  },
  "esign.hook": async (ctx: Ctx, input: unknown) => {
    await prime();
    return hookHandlers["esign.hook"](ctx, input);
  },
  "esign.list": (ctx: Ctx, input: unknown) => listAll(ctx, input),
  "esign.providers": async (ctx: Ctx) => {
    await prime();
    return providersVyre(ctx);
  },
  "esign.provider_set": async (ctx: Ctx, input: unknown) => {
    await prime();
    return sendHandlers["esign.provider_set"](ctx, input);
  },
  "esign.health": async (ctx: Ctx) => {
    await prime();
    const key = defaultProvider(ctx);
    if (key === "vyre") return { state: "healthy" as const, detail: "Built-in signing is ready." };
    if (!providerOf(key)) return { state: "down" as const, detail: `${titleOf(key)} is not connected.` };
    return sendHandlers["esign.health"](ctx);
  },
  "esign.remind": (ctx: Ctx, input: unknown) => remind(ctx, input),
  "esign.verify": (ctx: Ctx, input: unknown) => verifyFile(ctx, input),
  "esign.signer_view": (ctx: Ctx, input: unknown) => signerView(ctx, input),
  "esign.signer_doc": (ctx: Ctx, input: unknown) => signerDoc(ctx, input),
  "esign.signer_act": (ctx: Ctx, input: unknown) => signerAct(ctx, input),
};

export { configureEsign } from "./send.ts";
export { configureSigning } from "./vyre.ts";
export type {
  EsignConfig,
  EsignProvider,
  EnvelopeRequest,
  ProviderStatus,
  SignedFiles,
  WebhookEvent,
  ProviderKey,
  EnvelopeStatus,
} from "./send.ts";
export { documenso, parseLock } from "./documenso.ts";
export type { DocumensoLock, DocumensoOptions, HttpFn, HttpResponse } from "./documenso.ts";
