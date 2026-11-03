// The Space image from a picture: which files open, the square kept at each zoom and drag, the name in Files, and the save (upload to Shared knowledge/Branding, then make it the Space image).
import test from "node:test";
import assert from "node:assert/strict";
import { BRANDING_PATH, FULL, base64Bytes, cropSquare, dragged, imageName, isPicture, notPictureLine, saveSpaceImage, splitDataUrl } from "./space-image.ts";

test("a PNG, JPEG, WebP or GIF opens; SVG, a PDF and a huge file do not, and the line says why", () => {
  for (const f of [{ name: "logo.png", type: "image/png" }, { name: "a.JPG", type: "" }, { name: "b", type: "image/webp" }, { name: "c.gif" }]) assert.equal(isPicture(f), true, f.name);
  for (const f of [{ name: "logo.svg", type: "image/svg+xml" }, { name: "deck.pdf", type: "application/pdf" }, { name: "x.png", type: "image/png", size: 21 * 1024 * 1024 }]) assert.equal(isPicture(f), false, f.name);
  assert.equal(notPictureLine({ name: "logo.svg", type: "image/svg+xml" }), "logo.svg is not a PNG, JPEG, WebP or GIF picture.");
  assert.match(notPictureLine({ name: "x.png", size: 21 * 1024 * 1024 }), /over 20 MB/);
});

test("the kept square: the short side at zoom 1, centred; smaller when zoomed; held inside when moved", () => {
  assert.deepEqual(cropSquare({ w: 960, h: 540 }, FULL), { sx: 210, sy: 0, side: 540 });
  assert.deepEqual(cropSquare({ w: 400, h: 400 }, { zoom: 2, x: 0, y: 0 }), { sx: 100, sy: 100, side: 200 });
  assert.deepEqual(cropSquare({ w: 960, h: 540 }, { zoom: 1, x: -10_000, y: 0 }), { sx: 0, sy: 0, side: 540 }, "never past the left edge");
  assert.deepEqual(cropSquare({ w: 960, h: 540 }, { zoom: 9, x: 0, y: 0 }).side, 135, "zoom stops at 4");
  // dragging the picture right shows more of its left: the square moves left, and stops at the edge
  const moved = dragged({ w: 960, h: 540 }, FULL, 110, 0, 220);
  assert.equal(cropSquare({ w: 960, h: 540 }, moved).sx, 0);
  assert.equal(moved.x, -210, "the stored centre is where the square really is, so a drag back moves at once");
  const back = dragged({ w: 960, h: 540 }, moved, -22, 0, 220);
  assert.ok(cropSquare({ w: 960, h: 540 }, back).sx > 0);
});

test("names, sizes and data: addresses", () => {
  assert.equal(imageName(new Date(2026, 10, 3, 4, 20, 5)), "Space image 2026-11-03 at 04.20.05.png");
  assert.equal(imageName(new Date(2026, 0, 1, 0, 0, 0), "jpg"), "Space image 2026-01-01 at 00.00.00.jpg");
  assert.equal(base64Bytes("AAAA"), 3);
  assert.deepEqual(splitDataUrl("data:image/png;base64,AAAA"), { mime: "image/png", base64: "AAAA" });
  assert.equal(splitDataUrl("https://x/y.png"), null);
});

test("save uploads the square to Shared knowledge/Branding as the person, then makes it the Space image", async () => {
  const calls: Array<[string, unknown]> = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push([cap, input]);
    if (cap === "files.resolve") return { kind: "folder", folderId: "fld_brand" };
    if (cap === "files.create") return { file: { fileId: "fil_new" } };
    return { space: {} };
  };
  const id = await saveSpaceImage(call, { mime: "image/png", base64: "AAAA" }, new Date(2026, 10, 3, 4, 20, 5), "k1");
  assert.equal(id, "fil_new");
  assert.deepEqual(calls, [
    ["files.resolve", { path: BRANDING_PATH }],
    ["files.create", { folderId: "fld_brand", name: "Space image 2026-11-03 at 04.20.05.png", content: { base64: "AAAA" }, mime: "image/png", idempotencyKey: "space-image:k1" }],
    ["spaces.update", { logoFileId: "fil_new" }],
  ]);
  // no Branding folder: nothing is uploaded and the line says what to do
  const none = async (cap: string): Promise<unknown> => (cap === "files.resolve" ? { kind: "file" } : assert.fail(`no ${cap}`));
  await assert.rejects(() => saveSpaceImage(none, { mime: "image/png", base64: "AAAA" }, new Date(), "k2"), /Branding folder is missing/);
});
