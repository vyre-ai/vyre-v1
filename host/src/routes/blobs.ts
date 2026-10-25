// The blob route (ARCH 4.1, 4.4): the host serves GET /spaces/<space>/blobs/<id> to callers who may read what the blob belongs to. A module stores a blob through ctx.blobs and hands out the
// reference `/spaces/<space>/blobs/<blobId>` (previews, thumbnails, page images; avatars and media the same way); this is the one place a reference turns into bytes for a person or app.
// Who may read a blob is decided by the resource it belongs to, never by the blob id: the id is not a secret that grants access.
//   1. the session: no signed-in caller is 401; a path for another Space is 404 (a Space never reveals what another holds)
//   2. the owner: ctx.blobs is scoped to the module that stored the blob, so the route finds the owning module by asking each loaded module's own handle whether it holds the id
//      (a module's handle refuses another module's id, which is how the owner shows itself) and reads on that module's behalf
//   3. the resource: the owning module says which resource the blob belongs to (a preview's file), through `resourceOf`; a blob with no resource is not served to anyone, however it was stored
//   4. access: `allow` asks the access layer for read on that resource; a caller who may not is 403 (an id no module holds is 404, and only a signed-in caller is told either)
// Answers: 200 with the bytes, the content type the module stored, the stored sha256 as an ETag (a matching If-None-Match is 304), and private caching only (the bytes belong to the Space).
// HEAD answers the headers. Anything else is 405. Nothing about a blob is logged but its id.
import type http from "node:http";
import type { BlobMeta, Blobs } from "../../../packages/contracts/src/ctx.ts";
import type { BlobStore } from "../ctx/blobs.ts";
import { makeError } from "./errors.ts";
import type { ErrorCode } from "../../../packages/contracts/src/types.ts";

export interface BlobCaller { space: string; principal: { kind: string; id: string }; actingFor?: string | undefined }
export interface BlobResource { type: string; id: string }

export interface BlobRouteDeps {
  space: string;
  store: BlobStore;
  /** every module id that may own a blob (the loaded modules) */
  modules(): string[];
  /** who is asking; null = not signed in */
  session(headers: Record<string, string | undefined>): BlobCaller | null | Promise<BlobCaller | null>;
  /** the resource a blob belongs to, as its owning module records it; null when it belongs to none */
  resourceOf(module: string, blobId: string): BlobResource | null | Promise<BlobResource | null>;
  /** may this caller read this resource (level view or above) */
  allow(caller: BlobCaller, resource: BlobResource): boolean | Promise<boolean>;
}

const PATH = /^\/spaces\/([^/]+)\/blobs\/(blb_[a-f0-9]{32})$/;
const TRACE = "0".repeat(32);

export function blobPath(space: string, blobId: string): string {
  return `/spaces/${space}/blobs/${blobId}`;
}

/** Finds the handle of the module that holds the id, or null when no module does. */
async function owner(deps: BlobRouteDeps, id: string): Promise<{ module: string; blobs: Blobs; meta: BlobMeta } | null> {
  for (const module of deps.modules()) {
    try {
      const blobs = deps.store.forModule(module);
      const meta = await blobs.stat(id);
      if (meta) return { module, blobs, meta };
    } catch {
      // another module's blob: the handle refuses it, which means this is not the owner
    }
  }
  return null;
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

    const own = await owner(deps, id);
    // an id no module holds is absent for everyone who is signed in; an id some module holds is 403 unless the caller may read its resource
    if (!own) return reply(res, "validation.not_found", 404, "That file does not exist.");
    const resource = await deps.resourceOf(own.module, id);
    if (!resource || !(await deps.allow(caller, resource))) return reply(res, "permission.no_grant", 403, "You do not have access to this.");

    const etag = `"${own.meta.sha256}"`;
    const base = { "content-type": own.meta.contentType, etag, "cache-control": "private, max-age=0, must-revalidate", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" };
    if (req.headers["if-none-match"] === etag) { res.writeHead(304, { etag, "cache-control": base["cache-control"] }); res.end(); return; }
    if (method === "HEAD") { res.writeHead(200, { ...base, "content-length": own.meta.size }); res.end(); return; }
    const got = await own.blobs.get(id);
    if (!got) return reply(res, "validation.not_found", 404, "That file does not exist.");
    res.writeHead(200, { ...base, "content-length": got.bytes.byteLength });
    res.end(Buffer.from(got.bytes));
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
      if (method !== "GET" && method !== "HEAD") { reply(res, "validation.bad_input", 405, "Blobs are read with GET.", { allow: "GET, HEAD" }); return true; }
      void serve(req, res, method, decodeURIComponent(m[1] as string), m[2] as string).catch(() => {
        if (!res.headersSent) reply(res, "internal.unexpected", 500);
        else res.end();
      });
      return true;
    },
  };
}
