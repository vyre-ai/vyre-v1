// The host half of the Microsoft 365 connector (connectors/microsoft: Microsoft_App holds client id, client secret and tenant id; auth is client_credentials).
// Shaped like the Google seam so the Microsoft module (lane L5) registers it with setMsHost the same way. Token: POST the tenant's v2 endpoint with scope
// https://graph.microsoft.com/.default; app permissions are granted by the tenant admin, so there is no per-member sub.
import { fail } from "../routes/errors.ts";
import { HANDLE } from "./ports.ts";
import type { SeamCtx, SeamFetch, SpaceBlobs, SpaceFiles, SpaceMembers, VaultPort } from "./ports.ts";
import { downloadToBlob, putFile, statusError } from "./transfer.ts";
import { createUserOauth } from "./user-oauth.ts";
import type { UserOauthSeam } from "./user-oauth.ts";

export const MS_DOMAINS = ["graph.microsoft.com", "login.microsoftonline.com", "sharepoint.com", "1drv.ms", "files.1drv.com"] as const;
export const MS_GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const TENANT = /^[A-Za-z0-9.-]{1,128}$/;

/** What a person is asked to allow when they sign in to their own Microsoft mailbox. */
export const MS_USER_SCOPE = "offline_access User.Read Mail.ReadWrite Mail.Send";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface MsAppCheck { ok: boolean; clientId?: string; tenantId?: string; credential?: "certificate" | "secret"; problem?: string }

/** Microsoft's refusal of an app sign-in, in words that say what to do. Its AADSTS codes are the stable part of the answer. */
export function appProblem(error: string, description: string): string {
  const said = `${error} ${description}`;
  if (/AADSTS7000215|AADSTS7000222/.test(said)) return "Microsoft did not accept the client secret, or it has expired. Paste the secret's Value, not its ID, or make a new one under Certificates and secrets.";
  if (/AADSTS700016/.test(said)) return "That application is not in this tenant. Check the tenant ID, and that you copied the Application (client) ID from the app's Overview page.";
  if (/AADSTS90002|AADSTS900023/.test(said)) return "Microsoft has no such tenant. Copy the Directory (tenant) ID from the app's Overview page.";
  if (/AADSTS700027|AADSTS700023/.test(said)) return "Microsoft did not accept the certificate. Run the setup script again and paste what it prints.";
  return `Microsoft refused the app: ${said.trim().split("\r\n")[0]!.slice(0, 160)}`;
}

export interface MsHostSeam extends UserOauthSeam {
  mintToken(ctx: SeamCtx, a: { connectionId: string }): Promise<{ token: string; expiresAt: number }>;
  /** The non-secret identity of the app registration stored under a Vault handle. */
  appRegistration(ctx: SeamCtx, handle: string): Promise<{ clientId: string; tenantId: string }>;
  checkApp(ctx: SeamCtx, handle: string): Promise<MsAppCheck>;
  memberEmails(ctx: SeamCtx): Promise<{ userId: string; email: string }[]>;
  fileBytes(ctx: SeamCtx, fileId: string): Promise<{ name: string; mime: string; bytes: Uint8Array }>;
  putBlob(ctx: SeamCtx, bytes: Uint8Array, mime: string): Promise<string>;
  download(ctx: SeamCtx, a: { url: string; token: string; mime?: string }): Promise<{ blobId: string; size: number; mime: string }>;
  upload(ctx: SeamCtx, a: { url: string; token: string; fileId: string; ifMatch?: string }): Promise<unknown>;
}

export interface MsSeamDeps {
  vault: VaultPort;
  fetch: SeamFetch;
  files: SpaceFiles;
  blobs: SpaceBlobs;
  members: SpaceMembers;
  /** the address people reach this Space at, for a person's own sign-in to come back to */
  publicUrl?: ((space: string) => Promise<string>) | undefined;
  /** Where the Microsoft module keeps the handle for a connection: read from its own table through ctx.db. Default: table microsoft_config, columns connectionId and vaultItem. */
  handleFor?: (ctx: SeamCtx, connectionId: string) => string | undefined;
}

/** A secret, or a certificate: the private key stays in the Vault and signs the assertion there. */
interface App { clientId: string; clientSecret?: string; thumbprint?: string; tenantId: string }

const b64url = (b: Buffer | string): string => Buffer.from(b).toString("base64url");

function parseApp(json: string): App | null {
  let k: unknown;
  try { k = JSON.parse(json); } catch { k = null; }
  const o = (k && typeof k === "object" ? k : {}) as Record<string, unknown>;
  const clientId = o["clientId"] ?? o["client_id"], clientSecret = o["clientSecret"] ?? o["client_secret"], tenantId = o["tenantId"] ?? o["tenant_id"], thumbprint = o["thumbprint"], key = o["private_key"];
  if (typeof clientId !== "string" || typeof tenantId !== "string" || !clientId || !TENANT.test(tenantId)) return null;
  if (typeof clientSecret === "string" && clientSecret) return { clientId, clientSecret, tenantId };
  if (typeof thumbprint === "string" && /^[0-9a-f:]{40,}$/i.test(thumbprint) && typeof key === "string" && key.includes("PRIVATE KEY")) return { clientId, thumbprint: thumbprint.replaceAll(":", ""), tenantId };
  return null;
}

function appOf(ctx: SeamCtx, json: string): App {
  const app = parseApp(json);
  if (!app) throw fail("validation.bad_input", ctx.trace.traceId, { message: "That Vault item is not a Microsoft app registration (client id, tenant id, and a client secret or certificate)." });
  return app;
}

const tokenUrl = (tenant: string): string => `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;

export function createMsHost(d: MsSeamDeps): MsHostSeam {
  /** The token request's credential: the secret, or an assertion the Vault signs with the certificate's key. */
  const credential = async (ctx: SeamCtx, handle: string, app: App): Promise<Record<string, string>> => {
    if (app.clientSecret) return { client_secret: app.clientSecret };
    const now = Math.floor(ctx.now() / 1000);
    const claims = { aud: tokenUrl(app.tenantId), iss: app.clientId, sub: app.clientId, jti: globalThis.crypto.randomUUID(), nbf: now, exp: now + 300 };
    const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT", x5t: b64url(Buffer.from(app.thumbprint!, "hex")) }))}.${b64url(JSON.stringify(claims))}`;
    return { client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: `${unsigned}.${await d.vault.signRs256(handle, ctx.space, unsigned)}` };
  };
  const handleFor = d.handleFor ?? ((ctx, connectionId): string | undefined => {
    const row = ctx.db.all('SELECT "vaultItem" AS h FROM microsoft_config WHERE "connectionId" = ? LIMIT 1', connectionId)[0] as { h?: unknown } | undefined;
    return typeof row?.h === "string" ? row.h : undefined;
  });
  const user = createUserOauth({ vault: d.vault, fetch: d.fetch, publicUrl: d.publicUrl }, { name: "Microsoft", tokenUrl: (tenant) => `https://login.microsoftonline.com/${encodeURIComponent(tenant ?? "common")}/oauth2/v2.0/token`, domains: ["login.microsoftonline.com"], scope: MS_USER_SCOPE });
  return {
    ...user,
    async mintToken(ctx, a) {
      const handle = handleFor(ctx, a.connectionId);
      if (!handle || !HANDLE.test(handle)) throw fail("provider.auth_failed", ctx.trace.traceId, { message: "Microsoft 365 is not connected on this server." });
      const app = appOf(ctx, await d.vault.secret(handle, ctx.space));
      const r = await d.fetch(tokenUrl(app.tenantId), {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: app.clientId, ...(await credential(ctx, handle, app)), scope: MS_GRAPH_SCOPE }).toString(),
      });
      if (r.status === 400 || r.status === 401 || r.status === 403) {
        let why = "";
        try { const e = JSON.parse(await r.text()) as { error?: unknown; error_description?: unknown }; why = [e.error, typeof e.error_description === "string" ? e.error_description.split("\r\n")[0] : ""].filter((x) => typeof x === "string" && x).join(": "); } catch { /* no body */ }
        throw fail("provider.auth_failed", ctx.trace.traceId, { message: "Microsoft refused the app sign-in.", details: { status: r.status, why: why.slice(0, 200) } });
      }
      if (r.status < 200 || r.status >= 300) statusError(ctx, r.status, "token");
      let body: { access_token?: unknown; expires_in?: unknown };
      try { body = JSON.parse(await r.text()) as typeof body; } catch { body = {}; }
      if (typeof body.access_token !== "string" || !body.access_token) throw fail("provider.bad_response", ctx.trace.traceId, { details: { what: "token answer has no access_token" } });
      const secs = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;
      return { token: body.access_token, expiresAt: ctx.now() + secs * 1000 };
    },
    async appRegistration(ctx, handle) {
      if (!HANDLE.test(handle)) throw fail("validation.bad_input", ctx.trace.traceId, { message: "The Vault item is not a valid handle." });
      const app = appOf(ctx, await d.vault.secret(handle, ctx.space));
      return { clientId: app.clientId, tenantId: app.tenantId };
    },
    async checkApp(ctx, handle) {
      if (!HANDLE.test(handle)) return { ok: false, problem: "The Vault item is not a valid handle." };
      let text: string;
      try { text = await d.vault.secret(handle, ctx.space); } catch { return { ok: false, problem: "The app is not in the Vault yet. Paste its details first." }; }
      let app: App | null = null;
      try { app = parseApp(text); } catch { /* not JSON */ }
      if (!app) return { ok: false, problem: "That is not a Microsoft app. It needs the tenant ID, the application (client) ID, and a client secret or certificate." };
      if (!GUID.test(app.clientId)) return { ok: false, problem: "The application (client) ID is a code like 11111111-2222-3333-4444-555555555555. Copy it from the app's Overview page." };
      const known = { clientId: app.clientId, tenantId: app.tenantId, credential: app.clientSecret ? "secret" as const : "certificate" as const };
      let cred: Record<string, string>;
      try { cred = await credential(ctx, handle, app); } catch { return { ok: false, ...known, problem: "The certificate's private key is damaged. Run the setup script again and paste what it prints." }; }
      const r = await d.fetch(tokenUrl(app.tenantId), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: app.clientId, ...cred, scope: MS_GRAPH_SCOPE }).toString() });
      if (r.status >= 200 && r.status < 300) return { ok: true, ...known };
      if (r.status >= 500) return { ok: false, ...known, problem: "Microsoft is not answering right now. Try again in a minute." };
      let error = "", description = "";
      try { const e = JSON.parse(await r.text()) as { error?: unknown; error_description?: unknown }; error = String(e.error ?? ""); description = String(e.error_description ?? ""); } catch { /* no body */ }
      return { ok: false, ...known, problem: appProblem(error, description) };
    },
    memberEmails: (ctx) => d.members.emails(ctx.space),
    fileBytes: (ctx, fileId) => d.files.read(ctx.space, fileId),
    putBlob: (ctx, bytes, mime) => d.blobs.put(ctx.space, bytes, mime),
    download: (ctx, a) => downloadToBlob(ctx, { fetch: d.fetch, blobs: d.blobs, domains: MS_DOMAINS }, a),
    // Graph takes the bytes of a file as the body of a PUT; Drive's multipart upload is Google's
    upload: (ctx, a) => putFile(ctx, { fetch: d.fetch, files: d.files, domains: MS_DOMAINS }, a),
  };
}
