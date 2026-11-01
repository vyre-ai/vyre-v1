// The host half of a person's own sign-in to a mail provider (Google and Microsoft): the OAuth client the Space has (a Vault item such as #Google_Sign_In with fields client_id, client_secret
// and, for Microsoft, tenant), the sign-in code traded for tokens (PKCE: the verifier proves it is the same server), and access tokens made from a refresh token. The refresh token itself is
// sealed in the provider module's own table, never in the Vault; the module opens it for one call and hands it here. An access token is kept here by account until a minute before it ends.
import { fail } from "../routes/errors.ts";
import { HANDLE } from "./ports.ts";
import type { SeamCtx, SeamFetch, VaultPort } from "./ports.ts";
import { checked } from "./mail-providers.ts";
import { statusError } from "./transfer.ts";

const APP_ITEM = /^#[A-Za-z0-9_]+$/;
type Json = Record<string, unknown>;

/** The shape the provider modules' UserOauthHost takes (kept here so the host never imports a module). */
export interface UserOauthSeam {
  /** The OAuth client of the app item: its id, and whether it holds a secret. Throws provider.auth_failed when the item is not one. */
  userApp(ctx: SeamCtx, handle: string): Promise<{ clientId: string; hasSecret: boolean; tenant?: string }>;
  /** The address people reach this Space at (https://host), for the redirect the sign-in comes back to. */
  userPublicUrl(ctx: SeamCtx): Promise<string>;
  userExchange(ctx: SeamCtx, a: { appHandle: string; code: string; verifier: string; redirectUri: string }): Promise<{ refreshToken: string; accessToken: string; expiresAt: number }>;
  userRefresh(ctx: SeamCtx, a: { appHandle: string; refreshToken: string; cacheKey: string; fresh?: boolean }): Promise<{ token: string; expiresAt: number }>;
}

export interface UserOauthDeps {
  vault: Pick<VaultPort, "secret">;
  fetch: SeamFetch;
  publicUrl?: ((space: string) => Promise<string>) | undefined;
}

export interface UserOauthProvider {
  /** "Google" or "Microsoft": the word in the messages */
  name: string;
  /** the token address; Microsoft's depends on the tenant of the app item */
  tokenUrl(tenant: string | undefined): string;
  domains: readonly string[];
  /** Microsoft names the permissions again when a token is refreshed */
  scope?: string;
}

const parse = (text: string): Json => {
  try {
    const v = text ? (JSON.parse(text) as unknown) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
  } catch { return {}; }
};

export function createUserOauth(d: UserOauthDeps, p: UserOauthProvider): UserOauthSeam {
  const cache = new Map<string, { token: string; expiresAt: number }>();

  const field = async (ctx: SeamCtx, handle: string, name: "client_id" | "client_secret" | "tenant", required: boolean): Promise<string | undefined> => {
    if (!APP_ITEM.test(handle)) throw fail("validation.bad_input", ctx.trace.traceId, { message: "The Vault item is not a valid handle." });
    let value = "";
    try { value = await d.vault.secret(`${handle}.${name}`, ctx.space); } catch { /* the Vault refused or has no such field: the same answer below */ }
    if (!value && required) throw fail("provider.auth_failed", ctx.trace.traceId, { message: `${handle} has no ${name}. Add the ${p.name} OAuth client ${name === "client_id" ? "id" : name.replace("_", " ")} to that Vault item.` });
    return value || undefined;
  };

  /** POST a form to the token address and read the answer. Never throws a message with a code, token or secret in it. */
  async function tokenCall(ctx: SeamCtx, appHandle: string, form: URLSearchParams): Promise<Json> {
    form.set("client_id", (await field(ctx, appHandle, "client_id", true)) as string);
    const secret = await field(ctx, appHandle, "client_secret", false);
    if (secret) form.set("client_secret", secret);
    const tenant = await field(ctx, appHandle, "tenant", false);
    const url = checked(ctx, p.tokenUrl(tenant), p.domains);
    let r;
    try {
      r = await d.fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: form.toString() });
    } catch {
      throw fail("provider.network", ctx.trace.traceId, { message: `${p.name} could not be reached.` });
    }
    const body = parse(await r.text());
    if (r.status === 400 || r.status === 401 || r.status === 403) {
      const why = typeof body["error"] === "string" ? (body["error"] as string).slice(0, 60) : "";
      throw fail("provider.auth_failed", ctx.trace.traceId, { message: `${p.name} did not accept the sign-in. Sign in again.`, details: { status: r.status, why } });
    }
    if (r.status < 200 || r.status >= 300) statusError(ctx, r.status, "token");
    if (typeof body["access_token"] !== "string" || body["access_token"] === "") throw fail("provider.bad_response", ctx.trace.traceId, { details: { what: "token answer has no access_token" } });
    return body;
  }

  const lifeOf = (body: Json): number => (typeof body["expires_in"] === "number" && body["expires_in"] > 0 ? (body["expires_in"] as number) : 3600) * 1000;

  return {
    async userApp(ctx, handle) {
      const clientId = (await field(ctx, handle, "client_id", true)) as string;
      const tenant = await field(ctx, handle, "tenant", false);
      return { clientId, hasSecret: (await field(ctx, handle, "client_secret", false)) !== undefined, ...(tenant ? { tenant } : {}) };
    },
    userPublicUrl(ctx) {
      if (!d.publicUrl) return Promise.reject(fail("internal.unavailable", ctx.trace.traceId, { message: `This server has no public address yet, so ${p.name} cannot send people back to it.` }));
      return d.publicUrl(ctx.space);
    },
    async userExchange(ctx, a) {
      const body = await tokenCall(ctx, a.appHandle, new URLSearchParams({ grant_type: "authorization_code", code: a.code, redirect_uri: a.redirectUri, code_verifier: a.verifier }));
      const refresh = body["refresh_token"];
      if (typeof refresh !== "string" || refresh === "") throw fail("provider.bad_response", ctx.trace.traceId, { message: `${p.name} gave no way to stay signed in. The app must allow offline access.` });
      return { refreshToken: refresh, accessToken: body["access_token"] as string, expiresAt: ctx.now() + lifeOf(body) };
    },
    async userRefresh(ctx, a) {
      if (a.refreshToken === "") throw fail("provider.auth_failed", ctx.trace.traceId, { message: `The ${p.name} sign-in is gone. Sign in again.` });
      const key = `${ctx.space}|${a.cacheKey}`;
      const hit = cache.get(key);
      if (hit && !a.fresh && hit.expiresAt - ctx.now() > 60_000) return hit;
      const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: a.refreshToken });
      if (p.scope) form.set("scope", p.scope);
      const body = await tokenCall(ctx, a.appHandle, form);
      const fresh = { token: body["access_token"] as string, expiresAt: ctx.now() + lifeOf(body) };
      cache.set(key, fresh);
      return fresh;
    },
  };
}

export { HANDLE };
