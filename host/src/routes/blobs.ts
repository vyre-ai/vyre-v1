// The blob route (ARCH 4.1, 4.4): the host serves GET /spaces/<space>/blobs/<id> to callers who may read what the blob belongs to. A module stores a blob through ctx.blobs and hands out the
// reference `/spaces/<space>/blobs/<blobId>` (previews, thumbnails, page images; avatars and media the same way); this is the one place a reference turns into bytes for a person or app.
// Who may read a blob is decided by the resource it belongs to, never by the blob id: the id is not a secret that grants access.
//   1. the session: no signed-in caller is 401; a path for another Space is 404 (a Space never reveals what another holds)
//   2. the owner: ctx.blobs is scoped to the module that stored the blob; the store records that module and the resource the blob belongs to when the module puts it (ruling 50), and the
//      route reads on that module's behalf. The host never reads a module's tables to find out.
//   3. the resource: a blob a module stored with no resource is not served to anyone over HTTP, however it was stored
//   4. access: `allow` asks the access layer for read on that resource; a caller who may not is 403 (an id no module holds is 404, and only a signed-in caller is told either)
// Answers: 200 with the bytes, the content type the module stored, the stored sha256 as an ETag (a matching If-None-Match is 304), and private caching only (the bytes belong to the Space).
// HEAD answers the headers. Anything else is 405. Nothing about a blob is logged but its id.
import type http from "node:http";
import type { BlobResource, BlobStore } from "../ctx/blobs.ts";
import { makeError } from "./errors.ts";
import type { ErrorCode } from "../../../packages/contracts/src/types.ts";

export interface BlobCaller { space: string; principal: { kind: string; id: string }; actingFor?: string | undefined }
export type { BlobResource } from "../ctx/blobs.ts";

export interface BlobRouteDeps {
  space: string;
  /** the store records each blob's owning module and the resource it belongs to (ownerOf) */
  store: BlobStore;
  /** who is asking; null = not signed in */
  session(headers: Record<string, string | undefined>): BlobCaller | null | Promise<BlobCaller | null>;
  /** may this caller read this resource (level view or above) */
  allow(caller: BlobCaller, resource: BlobResource): boolean | Promise<boolean>;
  /** Store the bytes of an upload slot (files.upload_url): PUT /spaces/<space>/blobs/<id>?token=<token>. The slot's one-time token is the authority; the caller must be signed in. */
  put?(a: { blobId: string; token: string; bytes: Uint8Array; caller: BlobCaller }): Promise<{ hash: string; size: number }>;
}
const MAX_PUT = 25 * 1024 * 1024 + 1024;

const PATH = /^\/spaces\/([^/]+)\/blobs\/(blb_[a-f0-9]{32})$/;
const TRACE = "0".repeat(32);

export function blobPath(space: string, blobId: string): string {
  return `/spaces/${space}/blobs/${blobId}`;
}

function reply(res: http.ServerResponse, code: ErrorCode, status: number, message?: string, extra: Record<string, string> = {}): void {
  const body = JSON.stringify({ error: makeError(code, TRACE, message ? { message } : {}) });
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store", ...extra });
  res.end(body);
}

/** The route as a request hook, like the Chrome bridge's: true when the request was for a blob path and has been answered, false when the daemon should carry on. */
export function createBlobRoute(deps: BlobRouteDeps): { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean } {
  async function serve(req: http.IncomingMessage, res: http.ServerResponse, method: string, space: string, id: string): Promise<void> {
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(", ") : v;
    const caller = await deps.session(headers);
    if (!caller) return reply(res, "auth.unauthenticated", 401);
    if (space !== deps.space || caller.space !== deps.space) return reply(res, "validation.not_found", 404, "There is no such Space here.");

    const own = deps.store.ownerOf(id);
    // an id nobody stored is absent for everyone who is signed in; a stored one is 403 unless the caller may read the resource it belongs to
    if (!own) return reply(res, "validation.not_found", 404, "That file does not exist.");
    if (!own.resource || !(await deps.allow(caller, own.resource))) return reply(res, "permission.no_grant", 403, "You do not have access to this.");
    const blobs = deps.store.forModule(own.module);
    const meta = await blobs.stat(id);
    if (!meta) return reply(res, "validation.not_found", 404, "That file does not exist.");

    const etag = `"${meta.sha256}"`;
    const base = { "content-type": meta.contentType, etag, "cache-control": "private, max-age=0, must-revalidate", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" };
    if (req.headers["if-none-match"] === etag) { res.writeHead(304, { etag, "cache-control": base["cache-control"] }); res.end(); return; }
    if (method === "HEAD") { res.writeHead(200, { ...base, "content-length": meta.size }); res.end(); return; }
    const got = await blobs.get(id);
    if (!got) return reply(res, "validation.not_found", 404, "That file does not exist.");
    res.writeHead(200, { ...base, "content-length": got.bytes.byteLength });
    res.end(Buffer.from(got.bytes));
  }

  async function upload(req: http.IncomingMessage, res: http.ServerResponse, space: string, id: string, token: string): Promise<void> {
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(", ") : v;
    const caller = await deps.session(headers);
    if (!caller) return reply(res, "auth.unauthenticated", 401);
    if (space !== deps.space || caller.space !== deps.space) return reply(res, "validation.not_found", 404, "There is no such Space here.");
    if (!deps.put || token === "") return reply(res, "validation.bad_input", 405, "Blobs are read with GET.", { allow: "GET, HEAD" });
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_PUT) { reply(res, "validation.too_large", 413, "This file is over the size limit."); req.destroy(); return; }
      chunks.push(c as Buffer);
    }
    try {
      const out = await deps.put({ blobId: id, token, bytes: new Uint8Array(Buffer.concat(chunks)), caller });
      const body = JSON.stringify({ data: out });
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
      res.end(body);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "validation.not_found") return reply(res, "validation.not_found", 404, "That upload is not in this Space.");
      if (code === "validation.too_large") return reply(res, "validation.too_large", 413, "This file is over the size limit.");
      if (code === "validation.precondition_failed" || code === "validation.bad_input") return reply(res, "validation.bad_input", 400, "That upload was not accepted.");
      return reply(res, "internal.unexpected", 500);
    }
  }

  return {
    handle(req, res) {
      const url = new URL(req.url ?? "/", "http://vyred");
      const m = PATH.exec(url.pathname);
      if (!m) {
        // a path under /spaces/<space>/blobs/ that is not a blob id is still this route's to refuse
        if (/^\/spaces\/[^/]+\/blobs(\/|$)/.test(url.pathname)) { reply(res, "validation.not_found", 404); return true; }
        return false;
      }
      const method = (req.method ?? "GET").toUpperCase();
      if (method === "PUT" && deps.put) {
        void upload(req, res, decodeURIComponent(m[1] as string), m[2] as string, url.searchParams.get("token") ?? "").catch(() => { if (!res.headersSent) reply(res, "internal.unexpected", 500); else res.end(); });
        return true;
      }
      if (method !== "GET" && method !== "HEAD") { reply(res, "validation.bad_input", 405, "Blobs are read with GET.", { allow: "GET, HEAD" }); return true; }
      void serve(req, res, method, decodeURIComponent(m[1] as string), m[2] as string).catch(() => {
        if (!res.headersSent) reply(res, "internal.unexpected", 500);
        else res.end();
      });
      return true;
    },
  };
}
