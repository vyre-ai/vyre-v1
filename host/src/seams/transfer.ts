// The two binary transfers ctx.http (text only) cannot carry, shared by the Google and Microsoft seams: GET bytes into a blob, and a multipart file upload.
// The host checks the address itself (https, listed domain) before a bearer token goes anywhere.
import { hostAllowed } from "../ctx/http.ts";
import { fail } from "../routes/errors.ts";
import type { SeamCtx, SeamFetch, SpaceBlobs, SpaceFiles } from "./ports.ts";

const enc = new TextEncoder();
export const MAX_DOWNLOAD = 100 * 1024 * 1024;

function target(ctx: SeamCtx, url: string, domains: readonly string[]): string {
  let u: URL;
  try { u = new URL(url); } catch { throw fail("validation.bad_input", ctx.trace.traceId, { message: "not a URL" }); }
  if (u.protocol !== "https:" || u.username || u.password || !hostAllowed(u.hostname, domains)) {
    throw fail("permission.no_grant", ctx.trace.traceId, { message: "This connector may not reach that address.", details: { host: u.hostname } });
  }
  return u.toString();
}

function statusError(ctx: SeamCtx, status: number, what: string): never {
  const traceId = ctx.trace.traceId;
  if (status === 401 || status === 403) throw fail("provider.auth_failed", traceId, { details: { status, what } });
  if (status === 429) throw fail("provider.rate_limited", traceId, { details: { status, what } });
  if (status >= 500) throw fail("provider.unavailable", traceId, { details: { status, what } });
  throw fail("provider.bad_response", traceId, { details: { status, what } });
}

export async function downloadToBlob(
  ctx: SeamCtx, d: { fetch: SeamFetch; blobs: SpaceBlobs; domains: readonly string[] },
  a: { url: string; token: string; mime?: string },
): Promise<{ blobId: string; size: number; mime: string }> {
  const r = await d.fetch(target(ctx, a.url, d.domains), { method: "GET", headers: { authorization: `Bearer ${a.token}` } });
  if (r.status < 200 || r.status >= 300) statusError(ctx, r.status, "download");
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.byteLength > MAX_DOWNLOAD) throw fail("validation.too_large", ctx.trace.traceId, { message: "That file is too large to bring in." });
  const mime = a.mime ?? "application/octet-stream";
  return { blobId: await d.blobs.put(ctx.space, bytes, mime), size: bytes.byteLength, mime };
}

/** multipart/related: part one is the JSON metadata, part two the file's bytes. */
export function multipartBody(boundary: string, metadata: Record<string, unknown>, mime: string, bytes: Uint8Array): Uint8Array {
  const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const out = new Uint8Array(head.byteLength + bytes.byteLength + tail.byteLength);
  out.set(head, 0); out.set(bytes, head.byteLength); out.set(tail, head.byteLength + bytes.byteLength);
  return out;
}

export async function uploadFile(
  ctx: SeamCtx, d: { fetch: SeamFetch; files: SpaceFiles; domains: readonly string[]; boundary?: () => string },
  a: { url: string; token: string; fileId: string; metadata: Record<string, unknown> },
): Promise<unknown> {
  const url = target(ctx, a.url, d.domains);
  const file = await d.files.read(ctx.space, a.fileId);
  const boundary = d.boundary?.() ?? `vyre-${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
  const r = await d.fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${a.token}`, "content-type": `multipart/related; boundary=${boundary}` },
    body: multipartBody(boundary, a.metadata, file.mime, file.bytes),
  });
  if (r.status < 200 || r.status >= 300) statusError(ctx, r.status, "upload");
  const text = await r.text();
  try { return text ? JSON.parse(text) : {}; } catch { throw fail("provider.bad_response", ctx.trace.traceId, { details: { what: "upload answer is not JSON" } }); }
}

export { statusError };
