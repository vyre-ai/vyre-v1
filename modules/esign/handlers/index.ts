// esign handlers: send and track envelopes. Built-in signing (provider vyre, vyre.ts) is the default and needs nothing connected; hosted providers (Dropbox Sign, DocuSign, the Documenso hook) go through send.ts.

import { hookHandlers } from "./documenso.ts";
import { prime } from "./providers.ts";
import { defaultProvider, fail, one, providerOf, rec, reqStr, sendHandlers } from "./send.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import {
  cancelVyre,
  fetchVyre,
  isBuiltIn,
  isPlainCopy,
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
    const o = rec(ctx, input);
    // a copy set in the plain page look has no letterhead or pictures: it goes out only when the sender says so, and that choice is kept
    const plain = typeof o.fileId === "string" && (await isPlainCopy(ctx, o.fileId));
    if (plain && o.plainOk !== true)
      fail(
        ctx,
        "validation.precondition_failed",
        "Letterhead and pictures are missing in this copy. Wait for the exact copy, or send this one anyway.",
        { plain: true, field: "plainOk" },
      );
    const out = isBuiltIn(ctx, o.provider)
      ? await sendVyre(ctx, input)
      : (await prime(), await sendHandlers["esign.send"](ctx, input));
    const id = (out as { envelopeId?: unknown }).envelopeId;
    if (plain && typeof id === "string")
      ctx.db.run(
        "INSERT INTO esign_event (envelope_id, signer_idx, at, kind, ip, ua, detail) VALUES (?, NULL, ?, ?, NULL, NULL, ?)",
        id,
        ctx.now(),
        "plain_copy_sent",
        "sent as the plain copy by the sender's choice",
      );
    return out;
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
