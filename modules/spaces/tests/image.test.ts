// The Space image (rc.16): spaces.update { logoFileId } reads the picture as the caller and keeps a copy, so its faces show it everywhere, the join and sign-in pages included, where nobody can
// read Files yet. spaces.image hands the copy out as a data: address, only when it differs from what the caller already shows. A file that is not a picture the Space can use changes nothing.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { PIXEL_PNG, world } from "../handlers/extra/memdb.ts";
import type { FakeFile } from "../handlers/extra/memdb.ts";
import { configureSpaceAdmin, extraHandlers } from "../handlers/extra/index.ts";
import { IMAGE_MAX_BYTES } from "../handlers/extra/core.ts";
import type { ExtraCtx } from "../handlers/extra/core.ts";

type Fn = (ctx: ExtraCtx, input: never) => Promise<unknown>;
const call = (name: string, ctx: ExtraCtx, input: unknown): Promise<any> => (extraHandlers as unknown as Record<string, Fn>)[name]!(ctx, input as never);   // eslint-disable-line @typescript-eslint/no-explicit-any
const failed = async (p: Promise<unknown>): Promise<VyreErr> => {
  try { await p; } catch (e) { assert.ok(e instanceof VyreErr, "a typed error"); return e; }
  throw new Error("expected the call to fail");
};
function ready(files: Record<string, FakeFile> = {}) {
  const w = world({ files });
  configureSpaceAdmin(w.drivers);
  return w;
}
afterEach(() => configureSpaceAdmin(null));

test("a picture saved as the Space image is read as the caller, kept, and handed out as a data: address", async () => {
  const w = ready({ fil_logo: { mime: "image/png", base64: PIXEL_PNG } });
  assert.deepEqual(await call("spaces.image", w.ctx, {}), {}, "no image yet: the letter shows");
  const out = await call("spaces.update", w.ctx, { logoFileId: "fil_logo" });
  assert.equal(out.space.logoFileId, "fil_logo");
  assert.deepEqual(w.calls.map((c) => [c.cap, c.input]), [["files.read", { fileId: "fil_logo", as: "base64" }]], "read through Files, as the caller");
  assert.deepEqual(await call("spaces.image", w.ctx, {}), { logoFileId: "fil_logo", image: `data:image/png;base64,${PIXEL_PNG}` });
  assert.deepEqual(await call("spaces.image", w.ctx, { known: "fil_logo" }), { logoFileId: "fil_logo" }, "a face that already shows it gets no bytes");
  assert.deepEqual((w.events.at(-1)!.payload as { fields: string[] }).fields, ["logoFileId"]);
});

test("anyone may ask for it: the sign-in and join pages show it before sign-in", async () => {
  const w = ready();
  await call("spaces.update", w.ctx, { logoFileId: "fil_logo" });
  const visitor = { ...w.ctx, principal: { kind: "actor", id: "act_anon_0123456789abcdef" } } as unknown as ExtraCtx;
  assert.match((await call("spaces.image", visitor, {})).image, /^data:image\/png;base64,/);
});

test("a file that is not a picture the Space can use is refused before anything is written", async () => {
  const big = "A".repeat(Math.ceil(((IMAGE_MAX_BYTES + 10) * 4) / 3));
  const w = ready({
    fil_svg: { mime: "image/svg+xml", base64: "PHN2Zy8+" }, fil_pdf: { mime: "application/pdf", base64: "JVBERi0=" }, fil_big: { mime: "image/png", base64: big },
    fil_cut: { mime: "image/png", base64: PIXEL_PNG, truncated: true }, fil_gone: { refuse: "validation.not_found" }, fil_huge: { refuse: "validation.too_large" },
  });
  await call("spaces.update", w.ctx, { logoFileId: "fil_ok" });
  w.events.length = 0;
  for (const [id, line] of [["fil_svg", /PNG, JPEG, WebP or GIF/], ["fil_pdf", /PNG, JPEG, WebP or GIF/], ["fil_big", /under 256 KB/], ["fil_cut", /under 256 KB/], ["fil_gone", /cannot be read/], ["fil_huge", /under 256 KB/]] as const) {
    const e = await failed(call("spaces.update", w.ctx, { name: "Renamed", logoFileId: id }));
    assert.equal(e.error.code, "validation.bad_input", id);
    assert.match(e.error.message, line, id);
  }
  const space = (await call("spaces.get", w.ctx, {})).space;
  assert.deepEqual([space.name, space.logoFileId], ["Northwind", "fil_ok"], "nothing was written, not even the name sent with it");
  assert.equal((await call("spaces.image", w.ctx, {})).logoFileId, "fil_ok");
  assert.deepEqual(w.events, []);
});

test("removing the image takes the copy too; a profile save that repeats the logo does not read it again", async () => {
  const w = ready();
  await call("spaces.update", w.ctx, { logoFileId: "fil_logo" });
  w.calls.length = 0;
  await call("spaces.update", w.ctx, { name: "Northwind Law", logoFileId: "fil_logo" });
  assert.deepEqual(w.calls, [], "the same file is not read again");
  await call("spaces.update", w.ctx, { name: "Northwind Law" });
  assert.equal((await call("spaces.image", w.ctx, {})).logoFileId, "fil_logo", "a save without logoFileId leaves the image");
  await call("spaces.update", w.ctx, { logoFileId: null });
  assert.deepEqual(await call("spaces.image", w.ctx, {}), {});
});

test("a logo chosen before the copy was kept shows the letter until it is chosen again", async () => {
  const w = ready();
  w.raw.run("UPDATE spaces_profile SET logo_file_id = ? WHERE id = ?", "fil_old", "spc_test");
  assert.deepEqual(await call("spaces.image", w.ctx, {}), {});
  await call("spaces.update", w.ctx, { logoFileId: "fil_new" });
  assert.equal((await call("spaces.image", w.ctx, {})).logoFileId, "fil_new");
});
