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
import type { GithubTickets } from "./github-tickets.ts";
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
  user?: GithubUserSeam;
}

/** A person's own GitHub (the shape of UserHost in modules/github/projections.ts). */
export interface GithubUserSeam {
  app(ctx: SeamCtx): Promise<{ clientId: string; source: "space" | "vyre" }>;
  exchange(ctx: SeamCtx, a: { code: string; verifier: string; redirectUri: string }): Promise<{ accessToken: string; refreshToken: string; expiresAt: number; linkTicket?: string }>;
  /** Tokens a sign-in with GitHub left for this GitHub id (consumed once), or null. */
  adopt(ctx: SeamCtx, a: { githubId: string }): Promise<{ login: string; accessToken: string; refreshToken: string; expiresAt: number } | null>;
  refresh(ctx: SeamCtx, a: { refreshToken: string }): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }>;
  revoke(ctx: SeamCtx, a: { accessToken: string }): Promise<void>;
  keep(ctx: SeamCtx, person: string, a: { refreshToken: string }): Promise<void>;
  recall(ctx: SeamCtx, person: string): Promise<string | null>;
  forget(ctx: SeamCtx, person: string): Promise<void>;
  redirectUri(ctx: SeamCtx): Promise<string>;
}

export interface CommsDeps {
  vault: Pick<VaultPort, "secret"> & Partial<Pick<VaultPort, "signRs256">> & {
    store?(items: { name: string; value: string }[], space: string): Promise<void>;
  };
  /** The host's own calls into modules (vault.mine_set and vault.mine_remove save a person's Mine item), as the host service. Absent: a personal GitHub cannot be kept. */
  hostCall?: ((name: string, input: unknown) => Promise<unknown>) | undefined;
  /** The default Vyre GitHub app, used when the Space did not set up its own: read when needed from the server's named settings (VYRE_GH_OAUTH_CLIENT_ID and VYRE_GH_OAUTH_CLIENT_SECRET). */
  defaultApp?: (() => { clientId: string; clientSecret: string } | null) | undefined;
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

/** The Vault's Twilio template saves one item, "Twilio", with the fields its .env names. A Space that added Twilio that way is read the same as one with the two named items. */
export const TWILIO_TEMPLATE_FIELDS: Readonly<Record<string, string>> = { "#Twilio_Account": "#Twilio.TWILIO_ACCOUNT_SID", "#Twilio_Auth": "#Twilio.TWILIO_AUTH_TOKEN" };

export function createTwilioHost(d: CommsDeps): TwilioHostSeam {
  // the named item first; when it is missing, the template's field of the same meaning
  const twilioSecret = async (ctx: SeamCtx, handle: string): Promise<string> => {
    try { return await secretOf(d, ctx, handle, TWILIO_HANDLES, "Twilio"); } catch (e) {
      const alt = TWILIO_TEMPLATE_FIELDS[handle];
      if (!alt) throw e;
      return secretOf(d, ctx, alt, [alt], "Twilio").catch(() => { throw e; });
    }
  };
  const basic = async (ctx: SeamCtx): Promise<string> => {
    const account = await twilioSecret(ctx, "#Twilio_Account");
    const auth = await twilioSecret(ctx, "#Twilio_Auth");
    return `Basic ${Buffer.from(`${account}:${auth}`).toString("base64")}`;
  };
  return {
    secret: (ctx, handle) => twilioSecret(ctx, handle),
    async optionalSecret(ctx, handle) {
      try { return await twilioSecret(ctx, handle); } catch (e) {
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
    user: createGithubUser(d),
  };
}

const MINE_ITEM = "GitHub";
/** The handle of a person's own GitHub item (the same rule as modules/vault/handlers/mine-host.ts mineHandle, which a test holds equal). */
export const githubItemHandle = (person: string): string => `#${MINE_ITEM}_${person.replace(/^usr_/, "").slice(0, 12)}`;
const GITHUB_WEB = ["github.com", "api.github.com"] as const;

/** The OAuth side of a person's own GitHub. The client secret is read from the Vault (or the default app) for one call; the refresh token lives in the person's own Vault item "GitHub", field refresh_token. */
function createGithubUser(d: CommsDeps): GithubUserSeam {
  const app = async (ctx: SeamCtx): Promise<{ clientId: string; clientSecret: string; source: "space" | "vyre" }> => {
    let id = "", secret = "";
    try { id = await d.vault.secret("#GitHub_App_Client_Id", ctx.space); secret = await d.vault.secret("#GitHub_App_Client_Secret", ctx.space); } catch { /* the Space has none: the default app */ }
    if (id && secret) return { clientId: id, clientSecret: secret, source: "space" };
    const dflt = d.defaultApp?.() ?? null;
    if (dflt?.clientId && dflt.clientSecret) return { ...dflt, source: "vyre" };
    throw fail("internal.unavailable", ctx.trace.traceId, { message: "No GitHub app is set up to connect to. An admin sets one up in Console, Comms, or this server needs VYRE_GH_OAUTH_CLIENT_ID and VYRE_GH_OAUTH_CLIENT_SECRET." });
  };
  const token = async (ctx: SeamCtx, form: URLSearchParams): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> => {
    const a = await app(ctx);
    form.set("client_id", a.clientId); form.set("client_secret", a.clientSecret);
    const r = await d.fetch(checked(ctx, "https://github.com/login/oauth/access_token", GITHUB_WEB), { method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
    let j: Record<string, unknown> = {};
    try { j = JSON.parse(await r.text()) as Record<string, unknown>; } catch { /* unreadable: refused below */ }
    const access = typeof j.access_token === "string" ? j.access_token : "", refresh = typeof j.refresh_token === "string" ? j.refresh_token : "";
    if (r.status >= 500) throw fail("provider.unavailable", ctx.trace.traceId, { message: "GitHub is not answering right now." });
    if (!access || !refresh) throw fail("provider.auth_failed", ctx.trace.traceId, { message: "GitHub did not accept the connection. Connect again." });
    return { accessToken: access, refreshToken: refresh, expiresAt: ctx.now() + (typeof j.expires_in === "number" ? j.expires_in : 28_800) * 1000 };
  };
  return {
    async app(ctx) { const a = await app(ctx); return { clientId: a.clientId, source: a.source }; },
    async exchange(ctx, a) {
      const got = await token(ctx, new URLSearchParams({ code: a.code, code_verifier: a.verifier, redirect_uri: a.redirectUri }));
      if (!d.tickets) return got;
      // who GitHub says this is, once, so the link to the sign-in needs no second code
      try {
        const r = await d.fetch(checked(ctx, "https://api.github.com/user", GITHUB_WEB), { method: "GET", headers: { accept: "application/vnd.github+json", authorization: `Bearer ${got.accessToken}`, "user-agent": "vyre-server" } });
        const u = JSON.parse(await r.text()) as { id?: unknown; login?: unknown };
        if ((typeof u.id === "number" || typeof u.id === "string") && typeof u.login === "string") return { ...got, linkTicket: d.tickets.mintLink({ id: String(u.id), login: u.login }) };
      } catch { /* connecting works without the link */ }
      return got;
    },
    async adopt(_ctx, a) {
      const p = d.tickets?.takePending(a.githubId);
      return p ? { login: p.login, ...p.tokens } : null;
    },
    refresh: (ctx, a) => token(ctx, new URLSearchParams({ grant_type: "refresh_token", refresh_token: a.refreshToken })),
    async revoke(ctx, a) {
      const c = await app(ctx);
      await d.fetch(checked(ctx, `https://api.github.com/applications/${encodeURIComponent(c.clientId)}/grant`, GITHUB_WEB), {
        method: "DELETE", headers: { accept: "application/vnd.github+json", authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`, "content-type": "application/json" }, body: JSON.stringify({ access_token: a.accessToken }),
      });
    },
    async keep(ctx, person, a) {
      if (!d.hostCall) throw fail("internal.unavailable", ctx.trace.traceId, { message: "This server's Vault cannot keep a personal item yet, so GitHub cannot be connected." });
      await d.hostCall("vault.mine_set", { owner: person, name: MINE_ITEM, fields: { refresh_token: a.refreshToken } });
    },
    async recall(ctx, person) {
      // the person's own Mine item, by the handle only they have (name plus a piece of their id); it opens with their key on this node
      try { return (await (d.vault.secret as (h: string, s: string, asker?: string) => Promise<string>)(`${githubItemHandle(person)}.refresh_token`, ctx.space, person)) || null; } catch { return null; }
    },
    async forget(ctx, person) { await d.hostCall?.("vault.mine_remove", { owner: person, name: MINE_ITEM }); },
    redirectUri: async (ctx) => `${await publicUrlOf(d, ctx, "GitHub")}/hooks/github/connect`,
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
