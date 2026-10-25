// The host half of the two Space sending backends (ARCH 8, 8.2; P-L5_05): Resend and Mailgun. The modules call ResendHost and MailgunHost through setResendHost and setMailgunHost
// (they arrive as hostSeams, ruling 31); this file builds both from the Vault and the Space ports. Everything that needs a secret or a byte lives here, because ctx.http carries text only.
//   key         the API key and the webhook signing secret, one call at a time from the Vault, and only the handles the connector manifest declares
//   file        a Space file's bytes for an attachment
//   download    an inbound attachment fetched into a blob (Resend: a presigned address, no key; Mailgun: the stored message on the Mailgun host, with the key)
//   upload      Mailgun's multipart send (an email with attachments)
//   public url  where Mailgun posts inbound mail (/hooks/mail/mailgun)
// The Mailgun key goes only to a Mailgun host: every address is checked (https, listed domain, no credentials in the URL) before a header is built.
import { hostAllowed } from "../ctx/http.ts";
import { fail } from "../routes/errors.ts";
import type { SeamCtx, SeamFetch, SpaceBlobs, SpaceFiles, VaultPort } from "./ports.ts";
import { MAX_DOWNLOAD, statusError } from "./transfer.ts";

/** Vault handles each backend may read. A module cannot use its seam to read any other Vault item. */
export const RESEND_HANDLES = ["#Resend_Key", "#Resend_Webhook_Secret"] as const;
export const MAILGUN_HANDLES = ["#Mailgun_Key", "#Mailgun_Signing_Key"] as const;
export const MAILGUN_DOMAINS = ["api.mailgun.net", "api.eu.mailgun.net"] as const;
/** Resend hands out presigned addresses for inbound attachments; they carry no key from us. The exact hosts are a recorded-fixture assumption until an owner account exists (ruling 15). */
export const RESEND_DOWNLOAD_DOMAINS = ["resend.com", "resend.dev", "amazonaws.com"] as const;

/** The shape of ResendHost (modules/resend/projections.ts), kept here so the host never imports a module. The module's type accepts this object. */
export interface ResendHostSeam {
  secret(ctx: SeamCtx, handle: string): Promise<string>;
  fileBytes(ctx: SeamCtx, fileId: string): Promise<{ name: string; mime: string; bytes: Uint8Array }>;
  download(ctx: SeamCtx, a: { url: string; mime?: string }): Promise<{ blobId: string; size: number; mime: string }>;
}

/** The shape of MailgunHost (modules/mailgun/projections.ts). */
export interface MailgunHostSeam {
  secret(ctx: SeamCtx, handle: string): Promise<string>;
  fileBytes(ctx: SeamCtx, fileId: string): Promise<{ name: string; mime: string; bytes: Uint8Array }>;
  download(ctx: SeamCtx, a: { url: string; mime?: string; auth?: boolean }): Promise<{ blobId: string; size: number; mime: string }>;
  upload(ctx: SeamCtx, a: { url: string; fields: [string, string][]; files: { field: string; name: string; fileId: string }[] }): Promise<{ status: number; text: string }>;
  publicUrl(ctx: SeamCtx): Promise<string>;
}

export interface MailProviderDeps {
  vault: Pick<VaultPort, "secret">;
  fetch: SeamFetch;
  files: SpaceFiles;
  blobs: SpaceBlobs;
  /** the address people reach this Space at; omitted: Mailgun inbound routes refuse (unavailable) rather than point at nothing */
  publicUrl?: ((space: string) => Promise<string>) | undefined;
}

const enc = new TextEncoder();

function checked(ctx: SeamCtx, url: string, domains: readonly string[]): string {
  let u: URL;
  try { u = new URL(url); } catch { throw fail("validation.bad_input", ctx.trace.traceId, { message: "not a URL" }); }
  if (u.protocol !== "https:" || u.username || u.password || !hostAllowed(u.hostname, domains)) {
    throw fail("permission.no_grant", ctx.trace.traceId, { message: "This connector may not reach that address.", details: { host: u.hostname } });
  }
  return u.toString();
}

async function secretOf(d: Pick<MailProviderDeps, "vault">, ctx: SeamCtx, handle: string, allowed: readonly string[], what: string): Promise<string> {
  if (!allowed.includes(handle)) throw fail("permission.no_grant", ctx.trace.traceId, { message: `${what} may not read that Vault item.` });
  let value = "";
  try { value = await d.vault.secret(handle, ctx.space); } catch { /* the Vault refused or has no such item: the same answer below */ }
  if (!value) throw fail("provider.auth_failed", ctx.trace.traceId, { message: `${what} has no key in the Vault. Add ${handle.slice(1)} in Console, Comms.` });
  return value;
}

async function getToBlob(
  ctx: SeamCtx, d: MailProviderDeps, domains: readonly string[], a: { url: string; mime?: string }, headers: Record<string, string>,
): Promise<{ blobId: string; size: number; mime: string }> {
  const r = await d.fetch(checked(ctx, a.url, domains), { method: "GET", headers });
  if (r.status < 200 || r.status >= 300) statusError(ctx, r.status, "download");
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.byteLength > MAX_DOWNLOAD) throw fail("validation.too_large", ctx.trace.traceId, { message: "That file is too large to bring in." });
  const mime = a.mime ?? "application/octet-stream";
  return { blobId: await d.blobs.put(ctx.space, bytes, mime), size: bytes.byteLength, mime };
}

export function createResendHost(d: MailProviderDeps): ResendHostSeam {
  return {
    secret: (ctx, handle) => secretOf(d, ctx, handle, RESEND_HANDLES, "Resend"),
    fileBytes: (ctx, fileId) => d.files.read(ctx.space, fileId),
    download: (ctx, a) => getToBlob(ctx, d, RESEND_DOWNLOAD_DOMAINS, a, {}),
  };
}

const quoted = (s: string): string => s.replace(/[\r\n"]/g, " ");
const oneLine = (s: string): string => s.replace(/[\r\n]/g, " ");

/** multipart/form-data: the text fields in order (a field can repeat), then each file part. */
export function formData(boundary: string, fields: [string, string][], files: { field: string; name: string; mime: string; bytes: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [k, v] of fields) parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${quoted(k)}"\r\n\r\n${v}\r\n`));
  for (const f of files) {
    parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${quoted(f.field)}"; filename="${quoted(f.name)}"\r\nContent-Type: ${oneLine(f.mime) || "application/octet-stream"}\r\n\r\n`), f.bytes, enc.encode("\r\n"));
  }
  parts.push(enc.encode(`--${boundary}--\r\n`));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

export function createMailgunHost(d: MailProviderDeps): MailgunHostSeam {
  const basic = async (ctx: SeamCtx): Promise<string> => `Basic ${Buffer.from(`api:${await secretOf(d, ctx, "#Mailgun_Key", MAILGUN_HANDLES, "Mailgun")}`).toString("base64")}`;
  return {
    secret: (ctx, handle) => secretOf(d, ctx, handle, MAILGUN_HANDLES, "Mailgun"),
    fileBytes: (ctx, fileId) => d.files.read(ctx.space, fileId),
    async download(ctx, a) {
      checked(ctx, a.url, MAILGUN_DOMAINS);   // the address first: a refused address never reaches the Vault
      return getToBlob(ctx, d, MAILGUN_DOMAINS, a, a.auth ? { authorization: await basic(ctx) } : {});
    },
    async upload(ctx, a) {
      const url = checked(ctx, a.url, MAILGUN_DOMAINS);
      const authorization = await basic(ctx);
      const files: { field: string; name: string; mime: string; bytes: Uint8Array }[] = [];
      for (const f of a.files) {
        const file = await d.files.read(ctx.space, f.fileId);
        files.push({ field: f.field, name: f.name || file.name, mime: file.mime, bytes: file.bytes });
      }
      const boundary = `vyre-${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
      const r = await d.fetch(url, { method: "POST", headers: { authorization, accept: "application/json", "content-type": `multipart/form-data; boundary=${boundary}` }, body: formData(boundary, a.fields, files) });
      return { status: r.status, text: await r.text() };
    },
    async publicUrl(ctx) {
      if (!d.publicUrl) throw fail("internal.unavailable", ctx.trace.traceId, { message: "This server has no public address yet, so Mailgun cannot deliver inbound mail to it." });
      return d.publicUrl(ctx.space);
    },
  };
}
