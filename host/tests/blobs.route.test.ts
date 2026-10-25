// The blob route (ARCH 4.1, 4.4): GET /spaces/<space>/blobs/<id> over a real node:http server, a real encrypted blob store, and a previews-shaped owner table. A thumbnail is fetched by a caller
// who may read its file and refused (403) for one who may not; the id alone grants nothing. The route is mounted the way the daemon mounts a request hook.
// @reads /host/src/routes/blobs.ts
// @reads /host/src/ctx/blobs.ts
// @reads /host/src/daemon/daemon.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import { createBlobStore } from "../src/ctx/blobs.ts";
import { blobPath, createBlobRoute } from "../src/routes/blobs.ts";
import type { BlobCaller } from "../src/routes/blobs.ts";

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
  const readers = new Map<string, Set<string>>();   // file id -> principals who may read it
  // previews stores a thumbnail with the file it is of; identity stores an avatar for the Space; a third blob names no resource
  const thumb = await store.forModule("previews").put(PNG, "image/png", { resource: { type: "file", id: "fil_contract" } });
  readers.set("fil_contract", new Set(["usr_maya"]));
  const orphan = await store.forModule("previews").put(PNG, "image/png");
  const avatar = await store.forModule("identity").put(PNG, "image/png", { resource: { type: "space", id: SPACE } });
  const asked: string[] = [];
  const route = createBlobRoute({
    space: SPACE, store,
    session: (h) => TOKENS[String(h["authorization"] ?? "").replace(/^Bearer /, "")] ?? null,
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

// ---- the store records owner and resource ---------------------------------------------------------------------------------------------

test("the store keeps the owning module and the resource beside each blob, gives them back through ownerOf, and keeps them out of what a module sees", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-blobs-owner-"));
  const key = new Uint8Array(32).fill(9);
  const store = createBlobStore({ dir, key });
  const a = await store.forModule("previews").put(PNG, "image/png", { resource: { type: "file", id: "fil_a" } });
  const b = await store.forModule("avatars").put(PNG, "image/png");
  assert.deepEqual(store.ownerOf(a.id), { module: "previews", resource: { type: "file", id: "fil_a" } });
  assert.deepEqual(store.ownerOf(b.id), { module: "avatars", resource: null });
  assert.equal(store.ownerOf(`blb_${"0".repeat(32)}`), null);
  assert.equal(store.ownerOf("nonsense"), null);
  assert.equal("resource" in (await store.forModule("previews").stat(a.id))!, false, "the module's own view has no resource field");
  assert.equal("module" in a, false);
  // it survives a restart: a new store over the same directory reads it back
  assert.deepEqual(createBlobStore({ dir, key }).ownerOf(a.id), { module: "previews", resource: { type: "file", id: "fil_a" } });
  for (const bad of [{ type: "File", id: "x" }, { type: "file", id: "" }, { type: "file", id: "x".repeat(201) }, { type: "", id: "x" }, null, "file/x"]) {
    await assert.rejects(store.forModule("previews").put(PNG, "image/png", { resource: bad as never }), (e: { error?: { code?: string } }) => e.error?.code === "validation.bad_input", JSON.stringify(bad));
  }
});

// ---- on a booted daemon ----------------------------------------------------------------------------------------------------------------

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const thumbCap = {
  name: "example.thumb", v: 1, permission: null, level: "edit", resource: { type: "space" }, idempotency: "natural", effects: "write", risk: "low", emits: [],
  examples: [], surfaces: {}, input: {}, output: {}, errors: [], summary: "Store a thumbnail for a folder",
} as unknown as CapabilityDef;
const thumbRoute = { method: "POST", path: "/v1/example/thumb", cap: "example.thumb", v: 1, effects: "write" as const };
type Put = (bytes: Uint8Array, type: string, opts?: { resource: { type: string; id: string } }) => Promise<{ id: string }>;
const thumbHandler = async (ctx: { blobs?: { put: Put } }, input: { folderId?: string }): Promise<{ blobId: string }> => {
  const m = await ctx.blobs!.put(PNG, "image/png", input.folderId ? { resource: { type: "folder", id: input.folderId } } : undefined);
  return { blobId: m.id };
};

test("booted daemon: a thumbnail stored for a folder is fetched through /spaces/<space>/blobs/<id> by someone who may read the folder; a caller without access gets 403; no token is 401", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-blobs-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const WHO: Record<string, string> = { "tok-olivia": "usr_olivia", "tok-noah": "usr_noah", "tok-tess": "usr_tess" };
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({ os: "linux", hostname: "blobs-live", free: 80e9, commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    } }),
    fetch: caddyFetch,
    session: (h) => {
      const who = WHO[/^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1] ?? ""];
      return who ? { space: "spc_core", principal: { kind: "person", id: who }, device: "blobs-live" } : null;
    },
    extra: { caps: [thumbCap], routes: [thumbRoute], handlers: { "example.thumb": thumbHandler as never } },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  try {
    const store = (token: string | null, p: string, body: unknown) => fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const made = async (folderId?: string): Promise<string> => {
      const r = await store("tok-olivia", "/v1/example/thumb", folderId ? { folderId } : {});
      assert.equal(r.status, 200, await r.clone().text());
      return ((await r.json()) as { data: { blobId: string } }).data.blobId;
    };
    const acme = await made("fld_acme");        // Tess may view Acme; Noah may view everything under the Space
    const clients = await made("fld_clients");  // Tess has no grant here
    const none = await made();                  // stored with no resource
    const fetchBlob = (token: string | null, id: string, init: RequestInit = {}) => fetch(`${d.url}${blobPath("spc_core", id)}`, { ...init, headers: token ? { authorization: `Bearer ${token}` } : {} });

    const ok = await fetchBlob("tok-tess", acme);
    assert.equal(ok.status, 200, await ok.clone().text());
    assert.equal(ok.headers.get("content-type"), "image/png");
    assert.deepEqual([...new Uint8Array(await ok.arrayBuffer())], [...PNG], "the thumbnail bytes come back through the host");
    assert.equal((await fetchBlob("tok-noah", clients)).status, 200, "a member who may read the folder gets it");
    assert.equal((await fetchBlob("tok-olivia", acme)).status, 200);

    const refused = await fetchBlob("tok-tess", clients);
    assert.equal(refused.status, 403, "Tess has no access to Clients");
    assert.equal(((await refused.json()) as { error: { code: string } }).error.code, "permission.no_grant");
    assert.equal((await fetchBlob("tok-noah", none)).status, 403, "a blob stored with no resource is served to nobody");
    assert.equal((await fetchBlob("tok-olivia", none)).status, 403);
    assert.equal((await fetchBlob(null, acme)).status, 401);
    assert.equal((await fetchBlob("tok-tess", `blb_${"0".repeat(32)}`)).status, 404);
    const other = await fetch(`${d.url}${blobPath("spc_other", acme)}`, { headers: { authorization: "Bearer tok-tess" } });
    assert.equal(other.status, 404, "another Space's path");
    // the rest of the API still answers through the gateway on the same server
    assert.equal((await store("tok-olivia", "/v1/example/thumb", {})).status, 200);
  } finally { await d.stop(); }
});
