// The host half of the Dropbox connector (live folders L3; ARCH 8). The dropbox module calls DropboxHost through setDropboxHost (it arrives as a hostSeams entry, ruling 31); this file builds it from the
// Vault and the Space ports, so an app secret, a refresh token or a file's bytes never pass through module code that does not need them.
//   app / appSecret   the Dropbox app's key and secret: fields app_key and app_secret of the Vault item the admin named (#Dropbox_App)
//   exchange          the sign-in code for tokens (PKCE: the verifier proves it is the same server; the secret is added when the app has one)
//   token             an access token made from an account's refresh token (which the dropbox module keeps sealed in its own table), kept here by connection until a minute before it ends and never stored
//   upload, download  the two transfers ctx.http (text only) cannot carry; the address is checked (https, a Dropbox host) before a token goes anywhere
import { fail } from "../routes/errors.ts";
import type { SeamCtx, SeamFetch, SpaceBlobs, SpaceFiles, VaultPort } from "./ports.ts";
import { MAX_DOWNLOAD, statusError } from "./transfer.ts";
import { checked } from "./mail-providers.ts";

export const DROPBOX_DOMAINS = ["api.dropboxapi.com", "content.dropboxapi.com", "notify.dropboxapi.com", "www.dropbox.com"] as const;
export const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
/** Dropbox's own limit for one upload call; larger files need upload sessions. */
export const MAX_UPLOAD = 150 * 1024 * 1024;
const APP_ITEM = /^#[A-Za-z0-9_]+$/;

type Json = Record<string, unknown>;

/** The shape of DropboxHost (modules/dropbox/projections.ts), kept here so the host never imports a module. The module's type accepts this object. */
export interface DropboxHostSeam {
  app(ctx: SeamCtx, handle: string): Promise<{ appKey: string; hasSecret: boolean }>;
  appSecret(ctx: SeamCtx, handle: string): Promise<string>;
  publicUrl(ctx: SeamCtx): Promise<string>;
  exchange(ctx: SeamCtx, a: { appHandle: string; code: string; verifier: string; redirectUri: string }): Promise<{ refreshToken: string; accessToken: string; expiresAt: number; accountId?: string }>;
  token(ctx: SeamCtx, a: { appHandle: string; refreshToken: string; cacheKey: string; fresh?: boolean }): Promise<{ token: string; expiresAt: number }>;
  upload(ctx: SeamCtx, a: { token: string; arg: Json; fileId: string }): Promise<{ status: number; json: Json }>;
  download(ctx: SeamCtx, a: { token: string; arg: Json; mime?: string }): Promise<{ status: number; json: Json; blob?: { blobId: string; size: number; mime: string } }>;
}

export interface DropboxSeamDeps {
  vault: Pick<VaultPort, "secret">;
  fetch: SeamFetch;
  files: SpaceFiles;
  blobs: SpaceBlobs;
  publicUrl?: ((space: string) => Promise<string>) | undefined;
}

/** Dropbox-API-Arg travels in a header: every character outside ASCII is written as a \u escape, which is still the same JSON. */
export function asciiJson(v: unknown): string {
  return JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

const parse = (text: string): Json => {
  try {
    const v = text ? (JSON.parse(text) as unknown) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
  } catch {
    return {};
  }
};

export function createDropboxHost(d: DropboxSeamDeps): DropboxHostSeam {
  const cache = new Map<string, { token: string; expiresAt: number }>();

  const field = async (ctx: SeamCtx, handle: string, name: "app_key" | "app_secret", required: boolean): Promise<string | undefined> => {
    if (!APP_ITEM.test(handle)) throw fail("validation.bad_input", ctx.trace.traceId, { message: "The Vault item is not a valid handle." });
    let value = "";
    try { value = await d.vault.secret(`${handle}.${name}`, ctx.space); } catch { /* the Vault refused or has no such field: the same answer below */ }
    if (!value && required) throw fail("provider.auth_failed", ctx.trace.traceId, { message: `${handle} has no ${name}. Add the Dropbox app key${name === "app_secret" ? " and secret" : ""} to that Vault item.` });
    return value || undefined;
  };

  /** POST a form to the token address and read the answer. Never throws a message with a code, token or secret in it. */
  async function tokenCall(ctx: SeamCtx, appHandle: string, form: URLSearchParams): Promise<Json> {
    form.set("client_id", (await field(ctx, appHandle, "app_key", true)) as string);
    const secret = await field(ctx, appHandle, "app_secret", false);
    if (secret) form.set("client_secret", secret);
    let r;
    try {
      r = await d.fetch(checked(ctx, DROPBOX_TOKEN_URL, DROPBOX_DOMAINS), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: form.toString() });
    } catch {
      throw fail("provider.network", ctx.trace.traceId, { message: "Dropbox could not be reached." });
    }
    const body = parse(await r.text());
    if (r.status === 400 || r.status === 401 || r.status === 403) {
      const why = typeof body["error"] === "string" ? (body["error"] as string).slice(0, 60) : "";
      throw fail("provider.auth_failed", ctx.trace.traceId, { message: "Dropbox did not accept the sign-in. Connect Dropbox again.", details: { status: r.status, why } });
    }
    if (r.status < 200 || r.status >= 300) statusError(ctx, r.status, "token");
    if (typeof body["access_token"] !== "string" || body["access_token"] === "") throw fail("provider.bad_response", ctx.trace.traceId, { details: { what: "token answer has no access_token" } });
    return body;
  }

  const lifeOf = (body: Json): number => (typeof body["expires_in"] === "number" && body["expires_in"] > 0 ? (body["expires_in"] as number) : 14400) * 1000;

  return {
    async app(ctx, handle) {
      const appKey = (await field(ctx, handle, "app_key", true)) as string;
      return { appKey, hasSecret: (await field(ctx, handle, "app_secret", false)) !== undefined };
    },
    async appSecret(ctx, handle) {
      return (await field(ctx, handle, "app_secret", true)) as string;
    },
    publicUrl(ctx) {
      if (!d.publicUrl) return Promise.reject(fail("internal.unavailable", ctx.trace.traceId, { message: "This server has no public address yet, so Dropbox cannot send people back to it." }));
      return d.publicUrl(ctx.space);
    },
    async exchange(ctx, a) {
      const body = await tokenCall(ctx, a.appHandle, new URLSearchParams({ grant_type: "authorization_code", code: a.code, redirect_uri: a.redirectUri, code_verifier: a.verifier }));
      const refresh = body["refresh_token"];
      if (typeof refresh !== "string" || refresh === "") throw fail("provider.bad_response", ctx.trace.traceId, { message: "Dropbox gave no way to stay connected. The app must allow offline access." });
      return {
        refreshToken: refresh, accessToken: body["access_token"] as string, expiresAt: ctx.now() + lifeOf(body),
        ...(typeof body["account_id"] === "string" ? { accountId: body["account_id"] as string } : {}),
      };
    },
    async token(ctx, a) {
      if (a.refreshToken === "") throw fail("provider.auth_failed", ctx.trace.traceId, { message: "The Dropbox sign-in is gone. Connect Dropbox again." });
      const key = `${ctx.space}|${a.cacheKey}`;
      const hit = cache.get(key);
      if (hit && !a.fresh && hit.expiresAt - ctx.now() > 60_000) return hit;
      const body = await tokenCall(ctx, a.appHandle, new URLSearchParams({ grant_type: "refresh_token", refresh_token: a.refreshToken }));
      const fresh = { token: body["access_token"] as string, expiresAt: ctx.now() + lifeOf(body) };
      cache.set(key, fresh);
      return fresh;
    },
    async upload(ctx, a) {
      const url = checked(ctx, "https://content.dropboxapi.com/2/files/upload", DROPBOX_DOMAINS);
      const file = await d.files.read(ctx.space, a.fileId);
      if (file.bytes.byteLength > MAX_UPLOAD) throw fail("validation.too_large", ctx.trace.traceId, { message: "Dropbox takes files up to 150 MB in one upload." });
      const r = await d.fetch(url, { method: "POST", headers: { authorization: `Bearer ${a.token}`, "dropbox-api-arg": asciiJson(a.arg), "content-type": "application/octet-stream" }, body: file.bytes });
      return { status: r.status, json: parse(await r.text()) };
    },
    async download(ctx, a) {
      const url = checked(ctx, "https://content.dropboxapi.com/2/files/download", DROPBOX_DOMAINS);
      const r = await d.fetch(url, { method: "POST", headers: { authorization: `Bearer ${a.token}`, "dropbox-api-arg": asciiJson(a.arg) } });
      if (r.status < 200 || r.status >= 300) return { status: r.status, json: parse(await r.text()) };
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.byteLength > MAX_DOWNLOAD) throw fail("validation.too_large", ctx.trace.traceId, { message: "That file is too large to bring in." });
      const mime = a.mime ?? "application/octet-stream";
      return { status: r.status, json: {}, blob: { blobId: await d.blobs.put(ctx.space, bytes, mime), size: bytes.byteLength, mime } };
    },
  };
}
