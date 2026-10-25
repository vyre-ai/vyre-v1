// The blob route (ARCH 4.1, 4.4): GET /spaces/<space>/blobs/<id> over a real node:http server, a real encrypted blob store, and a previews-shaped owner table. A thumbnail is fetched by a caller
// who may read its file and refused (403) for one who may not; the id alone grants nothing. The route is mounted the way the daemon mounts a request hook.
// @reads /host/src/routes/blobs.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createBlobStore } from "../src/ctx/blobs.ts";
import { blobPath, createBlobRoute } from "../src/routes/blobs.ts";
import type { BlobCaller, BlobResource } from "../src/routes/blobs.ts";

const SPACE = "spc_core";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const TOKENS: Record<string, BlobCaller> = {
  maya: { space: SPACE, principal: { kind: "person", id: "usr_maya" } },
  noah: { space: SPACE, principal: { kind: "person", id: "usr_noah" } },
  elsewhere: { space: "spc_other", principal: { kind: "person", id: "usr_maya" } },
};

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-blobs-route-"));
  const store = createBlobStore({ dir, key: new Uint8Array(32).fill(7) });
  // what previews keeps: blob id -> the file the preview is of
  const previewOf = new Map<string, string>();
  const readers = new Map<string, Set<string>>();   // file id -> principals who may read it
  const thumb = await store.forModule("previews").put(PNG, "image/png");
  previewOf.set(thumb.id, "fil_contract");
  readers.set("fil_contract", new Set(["usr_maya"]));
  const orphan = await store.forModule("previews").put(PNG, "image/png");   // a blob the module records no file for
  const avatar = await store.forModule("identity").put(PNG, "image/png");
  const asked: string[] = [];
  const route = createBlobRoute({
    space: SPACE, store, modules: () => ["identity", "previews", "files"],
    session: (h) => TOKENS[String(h["authorization"] ?? "").replace(/^Bearer /, "")] ?? null,
    resourceOf: (module, id): BlobResource | null => (module === "previews" && previewOf.has(id) ? { type: "file", id: previewOf.get(id)! } : module === "identity" && id === avatar.id ? { type: "space", id: SPACE } : null),
    allow: (c, r) => { asked.push(`${c.principal.id}:${r.type}/${r.id}`); return r.type === "space" || (readers.get(r.id)?.has(c.principal.id) ?? false); },
  });
  const server = http.createServer((req, res) => { if (!route.handle(req, res)) { res.writeHead(404); res.end("not the blob route"); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = (p: string, who?: string, init: RequestInit = {}) => fetch(`${base}${p}`, { ...init, headers: { ...(who ? { authorization: `Bearer ${who}` } : {}), ...(init.headers as Record<string, string> | undefined) } });
  return { thumb, orphan, avatar, asked, get, readers, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

test("a caller who may read the preview's file gets the thumbnail bytes with their type, a validator and private caching; HEAD gives the headers; a matching ETag is 304", async (t) => {
  const w = await boot();
  t.after(w.close);
  const r = await w.get(blobPath(SPACE, w.thumb.id), "maya");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/png");
  assert.equal(r.headers.get("etag"), `"${w.thumb.sha256}"`);
  assert.match(String(r.headers.get("cache-control")), /^private/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.match(String(r.headers.get("content-security-policy")), /sandbox/);
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [...PNG], "the bytes are the ones the module stored");
  assert.deepEqual(w.asked, ["usr_maya:file/fil_contract"], "access was asked about the file, not the blob");

  const head = await w.get(blobPath(SPACE, w.thumb.id), "maya", { method: "HEAD" });
  assert.deepEqual([head.status, head.headers.get("content-length"), (await head.arrayBuffer()).byteLength], [200, String(PNG.length), 0]);
  const again = await w.get(blobPath(SPACE, w.thumb.id), "maya", { headers: { "if-none-match": `"${w.thumb.sha256}"` } });
  assert.equal(again.status, 304);
});

test("a caller without access to the file is 403 and gets no bytes; the blob id alone grants nothing; granting access opens it", async (t) => {
  const w = await boot();
  t.after(w.close);
  const r = await w.get(blobPath(SPACE, w.thumb.id), "noah");
  assert.equal(r.status, 403);
  const body = (await r.json()) as { error: { code: string } };
  assert.equal(body.error.code, "permission.no_grant");
  assert.equal(JSON.stringify(body).includes("PNG"), false);
  assert.equal(r.headers.get("etag"), null, "a refusal carries no validator of the content");
  assert.equal((await w.get(blobPath(SPACE, w.thumb.id), "noah", { method: "HEAD" })).status, 403, "HEAD is refused the same way");
  w.readers.get("fil_contract")!.add("usr_noah");
  assert.equal((await w.get(blobPath(SPACE, w.thumb.id), "noah")).status, 200);
});

test("no session is 401; a session of another Space and a path for another Space are 404; an id nobody holds is 404", async (t) => {
  const w = await boot();
  t.after(w.close);
  assert.equal((await w.get(blobPath(SPACE, w.thumb.id))).status, 401);
  assert.equal((await w.get(blobPath(SPACE, w.thumb.id), "not-a-token")).status, 401);
  assert.equal((await w.get(blobPath(SPACE, w.thumb.id), "elsewhere")).status, 404);
  assert.equal((await w.get(blobPath("spc_other", w.thumb.id), "maya")).status, 404);
  assert.equal((await w.get(blobPath(SPACE, `blb_${"0".repeat(32)}`), "maya")).status, 404);
  assert.deepEqual(w.asked, [], "access was never asked for any of those");
});

test("a blob its module records no resource for is served to no one; a module's own blobs (an avatar) follow the resource it names; the right module is found whichever stored it", async (t) => {
  const w = await boot();
  t.after(w.close);
  assert.equal((await w.get(blobPath(SPACE, w.orphan.id), "maya")).status, 403);
  assert.equal((await w.get(blobPath(SPACE, w.avatar.id), "noah")).status, 200);
});

test("other methods and malformed blob paths are refused; other paths are left to the daemon", async (t) => {
  const w = await boot();
  t.after(w.close);
  const post = await w.get(blobPath(SPACE, w.thumb.id), "maya", { method: "POST", body: "x" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");
  assert.equal((await w.get(`/spaces/${SPACE}/blobs/not-an-id`, "maya")).status, 404);
  assert.equal((await w.get(`/spaces/${SPACE}/blobs/`, "maya")).status, 404);
  assert.equal((await w.get(`/spaces/${SPACE}/blobs/${w.thumb.id}/extra`, "maya")).status, 404);
  const other = await w.get("/v1/anything", "maya");
  assert.equal(await other.text(), "not the blob route");
});
