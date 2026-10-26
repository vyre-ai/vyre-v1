// The host half of the Stripe, Twilio and GitHub connectors (ARCH 8; P-L5_LIVE). The modules call StripeHost, TwilioHost and GithubHost through setStripeHost, setTwilioHost and
// setGithubHost (they arrive as hostSeams, ruling 31); this file builds them from the Vault and the Space ports, so a secret or a byte never passes through a module.
//   stripe   the restricted key and the webhook signing secret, one call at a time, only the handles the manifest declares
//   twilio   the account Sid, auth token and API key Sid; a recording downloaded with the account's credentials; the Space's public address
//   portal   the mailer for portal invitations and sign-in links: mail.send through the Space's service mailbox
//   github   the webhook secret; the App JWT signed in the Vault (the key never leaves it); the manifest-flow secrets written to the Vault; the installation token held behind a filler handle
import type { Invoke } from "../invoke.ts";
import { fail } from "../routes/errors.ts";
import { checked, getToBlob, secretOf } from "./mail-providers.ts";
import type { FillerPort } from "./filler.ts";
import type { SeamCtx, SeamFetch, SpaceBlobs, VaultPort } from "./ports.ts";

export const STRIPE_HANDLES = ["#Stripe_Key", "#Stripe_Webhook_Secret"] as const;
export const TWILIO_HANDLES = ["#Twilio_Account", "#Twilio_Auth", "#Twilio_API_Key"] as const;
export const TWILIO_DOMAINS = ["api.twilio.com", "media.twilio.com"] as const;
export const GITHUB_SECRET_HANDLES = ["#GitHub_App_Webhook_Secret"] as const;

/** The shape of StripeHost (modules/stripe/projections.ts), kept here so the host never imports a module. */
export interface StripeHostSeam { secret(ctx: SeamCtx, handle: string): Promise<string> }

export interface TwilioHostSeam {
  secret(ctx: SeamCtx, handle: string): Promise<string>;
  optionalSecret(ctx: SeamCtx, handle: string): Promise<string | null>;
  download(ctx: SeamCtx, a: { url: string; mime?: string }): Promise<{ blobId: string; size: number; mime: string }>;
  publicUrl(ctx: SeamCtx): Promise<string>;
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

// ---- portal (P-L8_17): the mailer behind configurePortal

/** What the portal module hands the mailer (modules/portal/handlers/accounts.ts LinkMessage), kept structural so the host never imports a module. */
export interface PortalLinkMessage { siteId: string; accountId: string; email: string; purpose: "invite" | "sign_in" | "reset"; token: string; expiresAt: number }
/** The config configurePortal takes (the part the host owns). */
export interface PortalHostSeam { mailer: { sendLink(msg: PortalLinkMessage): Promise<void> } }

export interface PortalHostDeps {
  invoke: Invoke;
  space: string;
  /** The address people reach the Space at; the link in an email is built from it. */
  publicUrl?: ((space: string) => Promise<string>) | undefined;
  /** The Space owner: the person the portal email is sent as. The person who asks for a link is an outside client who is not signed in, and the host's service identity sees no mailbox. */
  owner(): string | null;
  /** Where a failed send is recorded (the portal module only says the email could not be sent): code and message, never the token. */
  warn?(msg: string, attrs: Record<string, unknown>): void;
}

const TRACE_ZERO = "0".repeat(32);

const SUBJECT: Record<PortalLinkMessage["purpose"], string> = { invite: "You are invited to sign in", sign_in: "Your sign-in link", reset: "Reset your password" };
const LEAD: Record<PortalLinkMessage["purpose"], string> = {
  invite: "You have been invited. Use this link to set up your account.",
  sign_in: "Use this link to sign in.",
  reset: "Use this link to choose a new password.",
};

/**
 * Portal links go out as email from the Space's service mailbox (a mailbox of kind `service`, created in Console, Comms) by mail.send through the same pipeline as every other send: caps,
 * suppression, windows and the audit row all apply. The host makes both calls as the Space owner, a normal authorized call (not a bypass): the outside person asking for a link is not signed in. With no service mailbox the send fails with
 * a message that says what to create, and the portal module removes the account it had just made.
 */
export function createPortalHost(d: PortalHostDeps): PortalHostSeam {
  async function send(msg: PortalLinkMessage): Promise<void> {
    const owner = d.owner();
    if (owner === null) throw fail("internal.unavailable", TRACE_ZERO, { message: "This Space has no owner to send portal email as." });
    const seed = { space: d.space, principal: { kind: "person", id: owner }, origin: "portal" } as const;
    if (!d.publicUrl) throw fail("internal.unavailable", TRACE_ZERO, { message: "This server has no public address yet, so a portal link cannot point at it." });
    const boxes = await d.invoke("mail.mailbox.list", { kind: "service", scope: "all" }, seed);
    const first = boxes.status === "ok" ? ((boxes.output as { mailboxes?: Array<{ id?: unknown }> } | null)?.mailboxes ?? [])[0] : undefined;
    if (typeof first?.id !== "string") throw fail("validation.precondition_failed", TRACE_ZERO, { message: "No service mailbox is set up to send portal emails from. Create one in Console, Comms." });
    const base = (await d.publicUrl(d.space)).replace(/\/+$/, "");
    const url = `${base}/portal/${encodeURIComponent(msg.siteId)}/link/${encodeURIComponent(msg.token)}?purpose=${msg.purpose}`;
    const sent = await d.invoke("mail.send", { mailboxId: first.id, route: "space_domain", to: [{ address: msg.email }], idempotencyKey: `portal:${msg.accountId}:${msg.purpose}:${msg.expiresAt}`, subject: SUBJECT[msg.purpose], text: `${LEAD[msg.purpose]}\n\n${url}\n\nThe link works once and expires.` }, seed);
    const status = sent.status === "ok" ? (sent.output as { status?: unknown } | null)?.status : "held";
    if (status !== "queued" && status !== "sent") throw fail("provider.unavailable", TRACE_ZERO, { message: `The portal email was not sent (${typeof status === "string" ? status : "unknown"}).` });
  }
  return {
    mailer: {
      async sendLink(msg) {
        try { await send(msg); } catch (e) {
          const err = (e as { error?: { code?: unknown; details?: unknown } } | null)?.error;
          d.warn?.("portal.mail_failed", { purpose: msg.purpose, code: typeof err?.code === "string" ? err.code : "unknown", why: `${e instanceof Error ? e.message : "failed"} ${JSON.stringify(err?.details ?? null)}`.slice(0, 400) });
          throw e;
        }
      },
    },
  };
}
