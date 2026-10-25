// @reads /modules/previews/handlers/store.ts
// @reads /modules/previews/handlers/render.ts
// @reads /modules/previews/projections.ts
// @reads /modules/previews/migrations/0001_previews_core.sql
// @reads /modules/previews/migrations/0002_blob_images.sql
// Image store of previews (P-L4_07b): images are blobs, rows keep the blob id, content type and size, responses carry blob references and never a data address, and no blob is left behind.
import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { versionConsumer } from "../projections.ts";
import { decodePng, encodePng } from "../handlers/render.ts";
import { dropImages, findImage, putImage, sweepGc } from "../handlers/store.ts";
import { MemoryDb, readMigration } from "../fixtures/db.ts";
import { gradient, pdf, png } from "../fixtures/make.ts";
import { blobOf, dimsOf, harness } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

type Row = Record<string, unknown>;

const call = (w: World, cap: keyof typeof handlers, input: Row, ctx?: Ctx): Promise<Row> => (handlers[cap] as (c: Ctx, i: unknown) => Promise<Row>)(ctx ?? w.ctx, input);
const REF = /^\/spaces\/spc_test\/blobs\/blb_[0-9a-f]{32}$/;

async function with_(run: (w: World) => Promise<void>): Promise<void> {
  const w = harness();
  try {
    await run(w);
  } finally {
    w.cleanup();
  }
}

async function expectCode(code: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    assert.ok(e instanceof VyreErr, e instanceof Error ? e.stack : "throw");
    assert.equal(e.error.code, code, e.error.message);
    return;
  }
  assert.fail(`expected ${code}`);
}

/** Every image row points at a stored blob and every stored blob has a row: nothing is missing and nothing is left behind. */
function assertNoLeaks(w: World): void {
  const rowIds = w.rows("previews_image").map((r) => String(r["blob_id"])).sort();
  const stored = [...w.blobs.items.keys()].sort();
  assert.deepEqual(stored, rowIds, "stored blobs and image rows are the same set");
}

test("migration 0002: previews_image keeps blob id, content type and size, with no data column; previews_gc exists", () => {
  const schema = new MemoryDb(readMigration()).schema;
  const image = schema.get("previews_image");
  assert.ok(image);
  assert.deepEqual(image.columns, ["file_id", "version", "kind", "size", "page", "blob_id", "content_type", "bytes", "width", "height", "created_at"]);
  assert.ok(!image.columns.includes("data"), "the old data-address column is gone");
  assert.ok(image.required.has("blob_id") && image.required.has("content_type") && image.required.has("bytes"));
  assert.deepEqual(schema.get("previews_gc")?.columns, ["blob_id", "queued_at"]);
});

test("a png preview is saved as blobs with content type and size, and previews.get returns a blob reference", () => with_(async (w) => {
  const f = w.files.add("photo.png", "image/png", encodePng(gradient(1000, 500)));
  const got = await call(w, "previews.get", { fileId: f.fileId });
  assert.match(String(got["url"]), REF);
  assert.deepEqual([got["ready"], got["width"], got["height"]], [true, 256, 128]);

  const rows = w.rows("previews_image");
  assert.equal(rows.length, 4, "one thumbnail per size");
  for (const r of rows) {
    const blob = w.blobs.items.get(String(r["blob_id"]));
    assert.ok(blob, "the row names a stored blob");
    assert.equal(r["content_type"], "image/png");
    assert.equal(blob.meta.contentType, "image/png");
    assert.equal(r["bytes"], blob.bytes.byteLength);
    assert.equal(r["bytes"], blob.meta.size);
    assert.ok(blob.bytes.byteLength > 8 && decodePng(blob.bytes), "the blob holds a readable png");
  }
  assert.deepEqual(dimsOf(w, String(got["url"])), { width: 256, height: 128 });
  assertNoLeaks(w);
}));

test("no response and no table carries a data address any more", () => with_(async (w) => {
  const img = w.files.add("a.png", "image/png", png(400, 300));
  const doc = w.files.add("d.pdf", "application/pdf", pdf([["One"], ["Two"]]));
  const outs: unknown[] = [
    await call(w, "previews.get", { fileId: img.fileId }),
    await call(w, "previews.get", { fileId: doc.fileId, page: 2 }),
    await call(w, "previews.thumbnails", { fileIds: [img.fileId, doc.fileId], size: "s" }),
    await call(w, "previews.pages", { fileId: doc.fileId, from: 1, count: 2 }),
  ];
  assert.doesNotMatch(JSON.stringify(outs), /data:/);
  for (const table of ["previews_file", "previews_image", "previews_gc", "previews_queue"]) assert.doesNotMatch(JSON.stringify(w.rows(table)), /data:|base64/, table);
  assert.ok(!Object.keys(w.rows("previews_image")[0] ?? {}).includes("data"));
}));

test("a pdf keeps its thumbnail and page images as separate blobs, pages come back as references that open", () => with_(async (w) => {
  const f = w.files.add("deck.pdf", "application/pdf", pdf([["One"], ["Two"], ["Three"]]));
  const first = await call(w, "previews.get", { fileId: f.fileId, page: 1 });
  assert.match(String(first["url"]), REF);
  const thumb = await call(w, "previews.get", { fileId: f.fileId });
  assert.notEqual(thumb["url"], first["url"], "thumbnail and page one are two blobs");
  const pages = await call(w, "previews.pages", { fileId: f.fileId, from: 1, count: 3 });
  const list = pages["pages"] as Row[];
  assert.equal(list.length, 3);
  for (const p of list) {
    assert.match(String(p["url"]), REF);
    const open = blobOf(w, String(p["url"]));
    assert.equal(open.meta.contentType, "image/png");
    assert.deepEqual(dimsOf(w, String(p["url"])), { width: Number(p["width"]), height: Number(p["height"]) });
  }
  assert.equal(new Set(list.map((p) => p["url"])).size, 3);
  assertNoLeaks(w);
}));

test("making an image again replaces its blob: the old one is deleted, none is left behind", () => with_(async (w) => {
  const f = w.files.add("a.png", "image/png", png(300, 100));
  await call(w, "previews.render", { fileId: f.fileId });
  const before = [...w.blobs.items.keys()];
  assert.equal(before.length, 4);
  w.advance(1000);
  await call(w, "previews.render", { fileId: f.fileId, force: true });
  assert.equal(w.blobs.items.size, 4);
  assert.ok(before.every((id) => !w.blobs.items.has(id)), "every old blob went");
  assert.deepEqual([...w.blobs.deletes].sort(), [...before].sort());
  assertNoLeaks(w);

  // the same slot written twice through the store
  const fileId = "fil_x";
  const m = { kind: "thumb" as const, size: "m", page: 0, bytes: png(8, 8), width: 8, height: 8 };
  const one = await putImage(w.ctx, fileId, 1, m);
  const two = await putImage(w.ctx, fileId, 1, { ...m, bytes: png(9, 9), width: 9, height: 9 });
  assert.notEqual(one.id, two.id);
  assert.equal(w.blobs.items.has(one.id), false);
  assert.equal(findImage(w.ctx, fileId, 1, "thumb", "m", 0)?.["blob_id"], two.id);
  assert.equal(findImage(w.ctx, fileId, 1, "thumb", "m", 0)?.["width"], 9);
}));

test("when a new version replaces the preview of version one, the blobs of version one are deleted", () => with_(async (w) => {
  const f = w.files.add("p.png", "image/png", png(1000, 500, [1, 1, 1, 255]));
  await call(w, "previews.get", { fileId: f.fileId });
  const v1 = w.rows("previews_image").map((r) => String(r["blob_id"]));
  w.files.edit(f.fileId, png(1000, 500, [2, 2, 2, 255]));
  await call(w, "previews.get", { fileId: f.fileId });
  w.files.edit(f.fileId, png(1000, 500, [3, 3, 3, 255]));
  await call(w, "previews.get", { fileId: f.fileId });
  assert.ok(!w.rows("previews_image").some((r) => r["version"] === 1));
  assert.ok(v1.every((id) => !w.blobs.items.has(id)), "version one's blobs are gone");
  assert.deepEqual([...new Set(w.rows("previews_image").map((r) => r["version"]))].sort(), [2, 3]);
  assertNoLeaks(w);
}));

test("file.purged hands its blobs to the next render pass, which deletes them", () => with_(async (w) => {
  const a = w.files.add("a.png", "image/png", png(300, 100));
  const b = w.files.add("b.png", "image/png", png(300, 100));
  await call(w, "previews.get", { fileId: a.fileId });
  await call(w, "previews.get", { fileId: b.fileId });
  const aBlobs = w.rows("previews_image").filter((r) => r["file_id"] === a.fileId).map((r) => String(r["blob_id"]));
  assert.equal(aBlobs.length, 4);

  const purge = versionConsumer.on["file.purged"];
  assert.ok(purge);
  const payload = new TextEncoder().encode(JSON.stringify({ fileId: a.fileId }));
  purge(w.db, { at: w.ctx.now(), actor: "usr_owner", payload });
  purge(w.db, { at: w.ctx.now(), actor: "usr_owner", payload });   // replay changes nothing
  assert.ok(!w.rows("previews_image").some((r) => r["file_id"] === a.fileId));
  assert.deepEqual(w.rows("previews_gc").map((r) => String(r["blob_id"])).sort(), [...aBlobs].sort(), "listed once each");
  assert.ok(aBlobs.every((id) => w.blobs.items.has(id)), "a projection deletes nothing");

  await call(w, "previews.health", {});
  assert.equal(w.rows("previews_gc").length, 4, "a health probe does not collect");
  await call(w, "previews.render", { fileId: b.fileId });
  assert.equal(w.rows("previews_gc").length, 0);
  assert.ok(aBlobs.every((id) => !w.blobs.items.has(id)), "the purged file's blobs are deleted");
  assertNoLeaks(w);
}));

test("dropImages removes one version or a whole file, blobs and rows together", () => with_(async (w) => {
  const m = (size: string) => ({ kind: "thumb" as const, size, page: 0, bytes: png(4, 4), width: 4, height: 4 });
  for (const v of [1, 2]) for (const s of ["s", "m"]) await putImage(w.ctx, "fil_d", v, m(s));
  await putImage(w.ctx, "fil_other", 1, m("s"));
  assert.equal(await dropImages(w.ctx, "fil_d", 1), 2);
  assert.deepEqual(w.rows("previews_image").map((r) => [r["file_id"], r["version"]]).sort(), [["fil_d", 2], ["fil_d", 2], ["fil_other", 1]]);
  assert.equal(await dropImages(w.ctx, "fil_d"), 2);
  assert.equal(await dropImages(w.ctx, "fil_d"), 0);
  assert.equal(w.blobs.items.size, 1);
  assertNoLeaks(w);
}));

test("refusals: a blob over the limit leaves the cached preview whole; a missing blob port is an internal error; another module's blob id is refused", () => with_(async (w) => {
  const f = w.files.add("a.png", "image/png", png(300, 100));
  w.blobs.failPut = "validation.too_large";
  await expectCode("validation.too_large", () => call(w, "previews.render", { fileId: f.fileId }));
  assert.equal(w.rows("previews_image").length, 0, "no row points at a blob that was never stored");
  assert.equal(w.blobs.items.size, 0);
  const ok = await call(w, "previews.get", { fileId: f.fileId });
  assert.equal(ok["ready"], true, "the next read makes the preview");
  assertNoLeaks(w);

  const bare: Ctx = { ...w.ctx };
  delete bare.blobs;
  await expectCode("internal.unexpected", () => putImage(bare, "fil_n", 1, { kind: "thumb", size: "s", page: 0, bytes: png(2, 2), width: 2, height: 2 }));

  // a gc entry that names a blob of another module is refused, and stays listed for the lead to see
  w.blobs.foreign.add("blb_" + "f".repeat(32));
  w.db.run("INSERT INTO previews_gc (blob_id, queued_at) VALUES (?, ?)", "blb_" + "f".repeat(32), 1);
  await expectCode("permission.no_grant", () => sweepGc(w.ctx));
  assert.equal(w.rows("previews_gc").length, 1);
}));
