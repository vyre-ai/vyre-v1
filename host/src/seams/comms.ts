// The host half of the Stripe, Twilio and GitHub connectors (ARCH 8; P-L5_LIVE). The modules call StripeHost, TwilioHost and GithubHost through setStripeHost, setTwilioHost and
// setGithubHost (they arrive as hostSeams, ruling 31); this file builds them from the Vault and the Space ports, so a secret or a byte never passes through a module.
//   stripe   the restricted key and the webhook signing secret, one call at a time, only the handles the manifest declares
//   twilio   the account Sid, auth token and API key Sid; a recording downloaded with the account's credentials; the Space's public address
//   github   the webhook secret; the App JWT signed in the Vault (the key never leaves it); the manifest-flow secrets written to the Vault; the installation token held behind a filler handle
import { fail } from "../routes/errors.ts";
import { checked, getToBlob, secretOf } from "./mail-providers.ts";
import type { FillerPort } from "./filler.ts";
import type { SeamCtx, SeamFetch, SpaceBlobs, VaultPort } from "./ports.ts";

export const STRIPE_HANDLES = ["#Stripe_Key", "#Stripe_Webhook_Secret"] as const;
export const TWILIO_HANDLES = ["#Twilio_Account", "#Twilio_Auth", "#Twilio_API_Key"] as const;
export const TWILIO_DOMAINS = ["api.twilio.com", "media.twilio.com"] as const;
export const ZOOM_HANDLES = ["#Zoom_S2S.account_id", "#Zoom_S2S.client_id", "#Zoom_S2S.client_secret", "#Zoom_Webhook_Secret"] as const;
export const ZOOM_DOMAINS = ["zoom.us"] as const;
export const GITHUB_SECRET_HANDLES = ["#GitHub_App_Webhook_Secret"] as const;

/** The shape of StripeHost (modules/stripe/projections.ts), kept here so the host never imports a module. */
export interface StripeHostSeam { secret(ctx: SeamCtx, handle: string): Promise<string> }

export interface TwilioHostSeam {
  secret(ctx: SeamCtx, handle: string): Promise<string>;
  optionalSecret(ctx: SeamCtx, handle: string): Promise<string | null>;
  download(ctx: SeamCtx, a: { url: string; mime?: string }): Promise<{ blobId: string; size: number; mime: string }>;
  publicUrl(ctx: SeamCtx): Promise<string>;
}

/** The shape of ZoomHost (modules/zoom/projections.ts). */
export interface ZoomHostSeam {
  secret(ctx: SeamCtx, handle: string): Promise<string>;
  download(ctx: SeamCtx, a: { url: string; bearer: string; mime?: string }): Promise<{ blobId: string; size: number; mime: string }>;
}

export interface GithubHostSeam {
  secret(ctx: SeamCtx, handle: string): Promise<string>;
  appJwt(ctx: SeamCtx): Promise<string>;
  storeSecrets(ctx: SeamCtx, items: { name: string; value: string }[]): Promise<void>;
  fillerHandle(ctx: SeamCtx, a: { token: string; expiresAt: number; repo?: string }): Promise<string>;
  publicUrl(ctx: SeamCtx): Promise<string>;
}

export interface CommsDeps {
  vault: Pick<VaultPort, "secret"> & Partial<Pick<VaultPort, "signRs256">> & { store?(items: { name: string; value: string }[], space: string): Promise<void> };
  fetch: SeamFetch;
  blobs: SpaceBlobs;
  filler?: FillerPort | undefined;
  publicUrl?: ((space: string) => Promise<string>) | undefined;
}

const b64url = (s: string): string => Buffer.from(s, "utf8").toString("base64url");

function publicUrlOf(d: Pick<CommsDeps, "publicUrl">, ctx: SeamCtx, what: string): Promise<string> {
  if (!d.publicUrl) return Promise.reject(fail("internal.unavailable", ctx.trace.traceId, { message: `This server has no public address yet, so ${what} cannot reach it.` }));
  return d.publicUrl(ctx.space);
}

export function createStripeHost(d: Pick<CommsDeps, "vault">): StripeHostSeam {
  return { secret: (ctx, handle) => secretOf(d, ctx, handle, STRIPE_HANDLES, "Stripe") };
}

export function createZoomHost(d: CommsDeps): ZoomHostSeam {
  return {
    secret: (ctx, handle) => secretOf(d, ctx, handle, ZOOM_HANDLES, "Zoom"),
    // the address is checked first (https, a Zoom host): the account token goes nowhere else
    download: async (ctx, a) => { checked(ctx, a.url, ZOOM_DOMAINS); return getToBlob(ctx, { ...d, files: { read: () => Promise.reject(new Error("no files")) } }, ZOOM_DOMAINS, a, { authorization: `Bearer ${a.bearer}` }); },
  };
}

export function createTwilioHost(d: CommsDeps): TwilioHostSeam {
  const basic = async (ctx: SeamCtx): Promise<string> => {
    const account = await secretOf(d, ctx, "#Twilio_Account", TWILIO_HANDLES, "Twilio");
    const auth = await secretOf(d, ctx, "#Twilio_Auth", TWILIO_HANDLES, "Twilio");
    return `Basic ${Buffer.from(`${account}:${auth}`).toString("base64")}`;
  };
  return {
    secret: (ctx, handle) => secretOf(d, ctx, handle, TWILIO_HANDLES, "Twilio"),
    async optionalSecret(ctx, handle) {
      try { return await secretOf(d, ctx, handle, TWILIO_HANDLES, "Twilio"); } catch (e) {
        // a handle the host does not allow is a refusal; only an item the Vault does not have is "absent"
        if (!TWILIO_HANDLES.includes(handle as never)) throw e;
        return null;
      }
    },
    async download(ctx, a) {
      checked(ctx, a.url, TWILIO_DOMAINS);   // the address first: a refused address never reaches the Vault
      return getToBlob(ctx, { ...d, files: { read: () => Promise.reject(new Error("no files")) } }, TWILIO_DOMAINS, a, { authorization: await basic(ctx) });
    },
    publicUrl: (ctx) => publicUrlOf(d, ctx, "Twilio"),
  };
}

export function createGithubHost(d: CommsDeps): GithubHostSeam {
  return {
    secret: (ctx, handle) => secretOf(d, ctx, handle, GITHUB_SECRET_HANDLES, "GitHub"),
    async appJwt(ctx) {
      let appId = "";
      try { appId = await d.vault.secret("#GitHub_App_Id", ctx.space); } catch { /* the same answer below */ }
      if (!appId || !d.vault.signRs256) throw fail("provider.auth_failed", ctx.trace.traceId, { message: "The GitHub App is not set up. Connect GitHub in Console, Comms." });
      const iat = Math.floor(ctx.now() / 1000) - 60;   // GitHub allows a minute of clock drift
      const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iat, exp: iat + 9 * 60, iss: appId }))}`;
      let signature = "";
      try { signature = await d.vault.signRs256("#GitHub_App_Key", ctx.space, unsigned); } catch { /* the same answer below */ }
      if (!signature) throw fail("provider.auth_failed", ctx.trace.traceId, { message: "The GitHub App key is not in the Vault. Connect GitHub again." });
      return `${unsigned}.${signature}`;
    },
    async storeSecrets(ctx, items) {
      if (!d.vault.store) throw fail("internal.unavailable", ctx.trace.traceId, { message: "The Vault cannot take new items on this server yet, so the GitHub App cannot be saved." });
      await d.vault.store(items, ctx.space);
    },
    async fillerHandle(ctx, a) {
      if (!d.filler) throw fail("internal.unavailable", ctx.trace.traceId, { message: "This server has no way to hand a GitHub token to git yet." });
      return d.filler.hold(a.token, a.expiresAt);
    },
    publicUrl: (ctx) => publicUrlOf(d, ctx, "GitHub"),
  };
}
