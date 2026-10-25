// The host half of the Microsoft 365 connector (connectors/microsoft: Microsoft_App holds client id, client secret and tenant id; auth is client_credentials).
// Shaped like the Google seam so the Microsoft module (lane L5) registers it with setMsHost the same way. Token: POST the tenant's v2 endpoint with scope
// https://graph.microsoft.com/.default; app permissions are granted by the tenant admin, so there is no per-member sub.
import { fail } from "../routes/errors.ts";
import { HANDLE } from "./ports.ts";
import type { SeamCtx, SeamFetch, SpaceBlobs, SpaceFiles, SpaceMembers, VaultPort } from "./ports.ts";
import { downloadToBlob, statusError, uploadFile } from "./transfer.ts";

export const MS_DOMAINS = ["graph.microsoft.com", "login.microsoftonline.com", "sharepoint.com", "1drv.ms", "files.1drv.com"] as const;
export const MS_GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const TENANT = /^[A-Za-z0-9.-]{1,128}$/;

export interface MsHostSeam {
  mintToken(ctx: SeamCtx, a: { connectionId: string }): Promise<{ token: string; expiresAt: number }>;
  /** The non-secret identity of the app registration stored under a Vault handle. */
  appIdentity(ctx: SeamCtx, handle: string): Promise<{ clientId: string; tenantId: string }>;
  memberEmails(ctx: SeamCtx): Promise<{ userId: string; email: string }[]>;
  fileBytes(ctx: SeamCtx, fileId: string): Promise<{ name: string; mime: string; bytes: Uint8Array }>;
  putBlob(ctx: SeamCtx, bytes: Uint8Array, mime: string): Promise<string>;
  download(ctx: SeamCtx, a: { url: string; token: string; mime?: string }): Promise<{ blobId: string; size: number; mime: string }>;
  upload(ctx: SeamCtx, a: { url: string; token: string; fileId: string; metadata: Record<string, unknown> }): Promise<unknown>;
}

export interface MsSeamDeps {
  vault: VaultPort;
  fetch: SeamFetch;
  files: SpaceFiles;
  blobs: SpaceBlobs;
  members: SpaceMembers;
  /** Where the Microsoft module keeps the handle for a connection: read from its own table through ctx.db. Default: table microsoft_config, columns connectionId and vaultItem. */
  handleFor?: (ctx: SeamCtx, connectionId: string) => string | undefined;
}

interface App { clientId: string; clientSecret: string; tenantId: string }

function appOf(ctx: SeamCtx, json: string): App {
  let k: unknown;
  try { k = JSON.parse(json); } catch { k = null; }
  const o = (k && typeof k === "object" ? k : {}) as Record<string, unknown>;
  const clientId = o["clientId"] ?? o["client_id"], clientSecret = o["clientSecret"] ?? o["client_secret"], tenantId = o["tenantId"] ?? o["tenant_id"];
  if (typeof clientId !== "string" || typeof clientSecret !== "string" || typeof tenantId !== "string" || !clientId || !clientSecret || !TENANT.test(tenantId)) {
    throw fail("validation.bad_input", ctx.trace.traceId, { message: "That Vault item is not a Microsoft app registration (client id, client secret, tenant id)." });
  }
  return { clientId, clientSecret, tenantId };
}

export function createMsHost(d: MsSeamDeps): MsHostSeam {
  const handleFor = d.handleFor ?? ((ctx, connectionId): string | undefined => {
    const row = ctx.db.all('SELECT "vaultItem" AS h FROM microsoft_config WHERE "connectionId" = ? LIMIT 1', connectionId)[0] as { h?: unknown } | undefined;
    return typeof row?.h === "string" ? row.h : undefined;
  });
  return {
    async mintToken(ctx, a) {
      const handle = handleFor(ctx, a.connectionId);
      if (!handle || !HANDLE.test(handle)) throw fail("provider.auth_failed", ctx.trace.traceId, { message: "Microsoft 365 is not connected on this server." });
      const app = appOf(ctx, await d.vault.secret(handle, ctx.space));
      const r = await d.fetch(`https://login.microsoftonline.com/${encodeURIComponent(app.tenantId)}/oauth2/v2.0/token`, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: app.clientId, client_secret: app.clientSecret, scope: MS_GRAPH_SCOPE }).toString(),
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
    async appIdentity(ctx, handle) {
      if (!HANDLE.test(handle)) throw fail("validation.bad_input", ctx.trace.traceId, { message: "The Vault item is not a valid handle." });
      const app = appOf(ctx, await d.vault.secret(handle, ctx.space));
      return { clientId: app.clientId, tenantId: app.tenantId };
    },
    memberEmails: (ctx) => d.members.emails(ctx.space),
    fileBytes: (ctx, fileId) => d.files.read(ctx.space, fileId),
    putBlob: (ctx, bytes, mime) => d.blobs.put(ctx.space, bytes, mime),
    download: (ctx, a) => downloadToBlob(ctx, { fetch: d.fetch, blobs: d.blobs, domains: MS_DOMAINS }, a),
    upload: (ctx, a) => uploadFile(ctx, { fetch: d.fetch, files: d.files, domains: MS_DOMAINS }, a),
  };
}
