// The host half of the Google connector (ARCH 8, 8.1): everything that needs the service-account key or the Space's bytes. The module calls GoogleHost through setGoogleHost;
// this file builds it from the Vault. Domain-wide delegation: sign a JWT as the service account naming the member as `sub`, trade it for an access token.
// The key stays in the Vault (signRs256); this file sees only the account's public identity fields.
import { fail } from "../routes/errors.ts";
import { HANDLE } from "./ports.ts";
import type { SeamCtx, SeamFetch, SpaceBlobs, SpaceFiles, SpaceMembers, VaultPort } from "./ports.ts";
import { downloadToBlob, statusError, uploadFile } from "./transfer.ts";
import { createUserOauth } from "./user-oauth.ts";
import type { UserOauthSeam } from "./user-oauth.ts";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_DOMAINS = ["googleapis.com", "googleusercontent.com", "docs.google.com", "drive.google.com"] as const;
const GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";

/** The shape of GoogleHost (modules/google/projections.ts), kept here so the host never imports a module. The module's type accepts this object. */
export const GOOGLE_AUTH_DOMAINS = ["oauth2.googleapis.com"] as const;

export interface GoogleHostSeam extends UserOauthSeam {
  mintToken(ctx: SeamCtx, a: { connectionId: string; sub: string; scopes: string[] }): Promise<{ token: string; expiresAt: number }>;
  memberEmails(ctx: SeamCtx): Promise<{ userId: string; email: string }[]>;
  serviceAccount(ctx: SeamCtx, handle: string): Promise<{ clientId: string; clientEmail: string }>;
  checkKey(ctx: SeamCtx, handle: string): Promise<GoogleKeyCheck>;
  fileBytes(ctx: SeamCtx, fileId: string): Promise<{ name: string; mime: string; bytes: Uint8Array }>;
  putBlob(ctx: SeamCtx, bytes: Uint8Array, mime: string): Promise<string>;
  download(ctx: SeamCtx, a: { url: string; token: string; mime?: string }): Promise<{ blobId: string; size: number; mime: string }>;
  upload(ctx: SeamCtx, a: { url: string; token: string; fileId: string; metadata: Record<string, unknown>; method?: "POST" | "PATCH" }): Promise<unknown>;
}

export interface GoogleKeyCheck { ok: boolean; clientId?: string; clientEmail?: string; projectId?: string; problem?: string }

/** Google's refusal of a service-account sign-in, in words that say what to do. */
export function keyProblem(error: string, description: string): string {
  const said = `${error} ${description}`;
  if (/invalid_grant/.test(said) && /signature/i.test(said)) return "Google does not recognise this key: it was deleted or replaced. In Google Cloud open the service account, choose Keys, make a new JSON key and paste that.";
  if (/disabled/i.test(said)) return "This service account is turned off. In Google Cloud open it and choose Enable.";
  if (/invalid_client|not found|deleted/i.test(said)) return "Google has no such service account: it or its project was deleted. Make a new service account and paste its key.";
  return `Google refused the key: ${said.trim().slice(0, 160)}`;
}

export interface GoogleSeamDeps {
  vault: VaultPort;
  fetch: SeamFetch;
  files: SpaceFiles;
  blobs: SpaceBlobs;
  members: SpaceMembers;
  /** the address people reach this Space at, for a person's own sign-in to come back to */
  publicUrl?: ((space: string) => Promise<string>) | undefined;
}

const b64url = (s: string): string => Buffer.from(s, "utf8").toString("base64url");

interface KeyIdentity { clientId: string; clientEmail: string }

const KEY_WRONG = "That is not a Google service-account key. In Google Cloud open the service account, choose Keys, Add key, Create new key, JSON, and paste the whole file.";

function identityOf(ctx: SeamCtx, json: string): KeyIdentity {
  let k: unknown;
  try { k = JSON.parse(json); } catch { throw fail("validation.bad_input", ctx.trace.traceId, { message: "That Vault item is not a Google service-account key." }); }
  const o = (k && typeof k === "object" ? k : {}) as Record<string, unknown>;
  const clientId = o["client_id"], clientEmail = o["client_email"];
  if (o["type"] !== "service_account" || typeof clientId !== "string" || typeof clientEmail !== "string" || typeof o["private_key"] !== "string") {
    throw fail("validation.bad_input", ctx.trace.traceId, { message: "That Vault item is not a Google service-account key." });
  }
  return { clientId, clientEmail };
}

export function createGoogleHost(d: GoogleSeamDeps): GoogleHostSeam {
  const handleFor = (ctx: SeamCtx, connectionId: string): string => {
    const row = ctx.db.all('SELECT "vaultItem" AS h FROM google_config WHERE "connectionId" = ? LIMIT 1', connectionId)[0] as { h?: unknown } | undefined;
    if (typeof row?.h !== "string" || !HANDLE.test(row.h)) throw fail("provider.auth_failed", ctx.trace.traceId, { message: "Google is not connected on this server." });
    return row.h;
  };
  const user = createUserOauth({ vault: d.vault, fetch: d.fetch, publicUrl: d.publicUrl }, { name: "Google", tokenUrl: () => GOOGLE_TOKEN_URL, domains: GOOGLE_AUTH_DOMAINS });
  return {
    ...user,
    async mintToken(ctx, a) {
      const handle = handleFor(ctx, a.connectionId);
      const { clientEmail } = identityOf(ctx, await d.vault.secret(handle, ctx.space));
      const iat = Math.floor(ctx.now() / 1000);
      const claims = { iss: clientEmail, sub: a.sub, scope: a.scopes.join(" "), aud: GOOGLE_TOKEN_URL, iat, exp: iat + 3600 };
      const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
      const jwt = `${unsigned}.${await d.vault.signRs256(handle, ctx.space, unsigned)}`;
      const r = await d.fetch(GOOGLE_TOKEN_URL, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: GRANT, assertion: jwt }).toString(),
      });
      if (r.status === 400 || r.status === 401 || r.status === 403) {
        // Google says why in error / error_description (not a secret); the sender needs it to fix the delegation.
        let why = "";
        try { const e = JSON.parse(await r.text()) as { error?: unknown; error_description?: unknown }; why = [e.error, e.error_description].filter((x) => typeof x === "string").join(": "); } catch { /* no body */ }
        const notYet = /unauthorized_client/.test(why);
        const noSuchUser = /invalid_grant/.test(why) && /invalid email|user id/i.test(why);
        const message = notYet ? "Google has not allowed this client yet. Check you pasted the numeric client ID, not an email address, and the scopes. It can take up to 24 hours, usually minutes."
          : noSuchUser ? `Google has no Workspace user ${a.sub}. Type the address of a real user in your Workspace, not a group or an alias.`
          : "Google refused the delegated sign-in.";
        throw fail("provider.auth_failed", ctx.trace.traceId, { message, details: { status: r.status, why: why.slice(0, 200) } });
      }
      if (r.status < 200 || r.status >= 300) statusError(ctx, r.status, "token");
      let body: { access_token?: unknown; expires_in?: unknown };
      try { body = JSON.parse(await r.text()) as typeof body; } catch { body = {}; }
      if (typeof body.access_token !== "string" || !body.access_token) throw fail("provider.bad_response", ctx.trace.traceId, { details: { what: "token answer has no access_token" } });
      const secs = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;
      return { token: body.access_token, expiresAt: ctx.now() + secs * 1000 };
    },
    memberEmails: (ctx) => d.members.emails(ctx.space),
    async serviceAccount(ctx, handle) {
      if (!HANDLE.test(handle)) throw fail("validation.bad_input", ctx.trace.traceId, { message: "The Vault item is not a valid handle." });
      return identityOf(ctx, await d.vault.secret(handle, ctx.space));
    },
    async checkKey(ctx, handle) {
      if (!HANDLE.test(handle)) return { ok: false, problem: "The Vault item is not a valid handle." };
      let text: string;
      try { text = await d.vault.secret(handle, ctx.space); } catch { return { ok: false, problem: "The key is not in the Vault yet. Paste it first." }; }
      let o: Record<string, unknown>;
      try { o = JSON.parse(text) as Record<string, unknown>; } catch { return { ok: false, problem: "The key is not valid JSON. Paste the whole file, from the first { to the last }." }; }
      if (o === null || typeof o !== "object" || o["type"] !== "service_account" || typeof o["client_email"] !== "string" || typeof o["client_id"] !== "string" || typeof o["private_key"] !== "string") return { ok: false, problem: KEY_WRONG };
      const clientId = o["client_id"], clientEmail = o["client_email"];
      if (!/^\d{10,30}$/.test(clientId)) return { ok: false, problem: KEY_WRONG };
      const projectId = typeof o["project_id"] === "string" ? o["project_id"] : undefined;
      const known = { clientId, clientEmail, ...(projectId ? { projectId } : {}) };
      const iat = Math.floor(ctx.now() / 1000);
      const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: clientEmail, scope: "https://www.googleapis.com/auth/userinfo.email", aud: GOOGLE_TOKEN_URL, iat, exp: iat + 300 }))}`;
      let jwt: string;
      try { jwt = `${unsigned}.${await d.vault.signRs256(handle, ctx.space, unsigned)}`; } catch { return { ok: false, ...known, problem: "The private key in this file is damaged. Make a new JSON key and paste the whole file." }; }
      const r = await d.fetch(GOOGLE_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: GRANT, assertion: jwt }).toString() });
      if (r.status >= 200 && r.status < 300) return { ok: true, ...known };
      let error = "", description = "";
      try { const e = JSON.parse(await r.text()) as { error?: unknown; error_description?: unknown }; error = String(e.error ?? ""); description = String(e.error_description ?? ""); } catch { /* no body */ }
      if (r.status >= 500) return { ok: false, ...known, problem: "Google is not answering right now. Try again in a minute." };
      return { ok: false, ...known, problem: keyProblem(error, description) };
    },
    fileBytes: (ctx, fileId) => d.files.read(ctx.space, fileId),
    putBlob: (ctx, bytes, mime) => d.blobs.put(ctx.space, bytes, mime),
    download: (ctx, a) => downloadToBlob(ctx, { fetch: d.fetch, blobs: d.blobs, domains: GOOGLE_DOMAINS }, a),
    upload: (ctx, a) => uploadFile(ctx, { fetch: d.fetch, files: d.files, domains: GOOGLE_DOMAINS }, a),
  };
}
