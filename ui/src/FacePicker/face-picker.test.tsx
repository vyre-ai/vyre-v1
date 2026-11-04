// ui/FacePicker: the "Choose a face" sheet as it draws, where it starts, what a pick is stored as, and the uploaded picture's size.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { FacePicker, startFace } from "./index.tsx";
import { squareDataUrl } from "./image.ts";
import type { Canvasish } from "./image.ts";
import { DRAWN, IMG_MAX_CHARS, PER_FAMILY, TINTS, formatFace, parseFace } from "../Avatar/agentface.ts";

const noop = (): void => {};

test("the sheet has a preview with the name under it, the four expressions, underline tabs for every family, 24 faces, 8 tints, Shuffle, Upload and Done", () => {
  const html = renderToStaticMarkup(<FacePicker name="Intake" value="av1:friends:3:2" taken={[]} onDone={noop} />);
  assert.match(html, /role="dialog"/);
  assert.match(html, /Choose a face/);
  assert.ok(html.includes("Intake"), "the name under the preview");
  for (const t of ["Faces", "Friends", "Blobs", "Glass", "Emoji", "Upload"]) assert.ok(html.includes(`>${t}<`), t);
  for (const e of ["Idle", "Working", "Asleep", "Finished"]) assert.ok(html.includes(`>${e}<`), e);
  assert.equal((html.match(/data-testid="face-picker-friends-\d+"/g) ?? []).length, PER_FAMILY, "24 curated faces on the Friends tab");
  assert.equal((html.match(/data-testid="face-picker-tint-\d"/g) ?? []).length, TINTS.length);
  for (const id of ["face-picker-shuffle", "face-picker-upload-tab", "face-picker-done"]) assert.ok(html.includes(`data-testid="${id}"`), id);
  assert.match(html, /role="tablist"/);
});

test("it starts on the face the agent wears, or on a suggestion nobody in the Space has", () => {
  assert.deepEqual(startFace("av1:blobs:9:4", []), { fam: "blobs", i: 9, tint: 4 });
  const taken = DRAWN.flatMap((f) => Array.from({ length: PER_FAMILY }, (_, i) => `av1:${f}:${i}:0`)).filter((t) => t !== "av1:glass:7:0");
  const s = startFace("pick-old-seed", taken, () => 0.5);
  assert.equal(formatFace(s).replace(/:\d+$/, ""), "av1:glass:7", "the one face left");
  assert.ok(parseFace(formatFace(s)));
});

test("a stored face reads back the same after a reload", () => {
  const face = formatFace({ fam: "friends", i: 12, tint: 5 });
  assert.deepEqual(startFace(face, []), { fam: "friends", i: 12, tint: 5 });
});

test("an uploaded picture is cropped square and shrunk until it fits in IMG_MAX_CHARS; one that cannot fit is refused", async () => {
  const sizes: number[] = [];
  const make = (len: (edge: number, q: number) => number) => (): Canvasish => {
    const c: Canvasish = {
      width: 0, height: 0,
      getContext: () => ({ drawImage: (...a: unknown[]) => { sizes.push(c.width); void a; } }),
      toDataURL: (_t, q) => `data:image/webp;base64,${"A".repeat(len(c.width, q))}`,
    };
    return c;
  };
  const bitmap = async () => ({ width: 400, height: 300 });
  const ok = await squareDataUrl(new Blob(["x"]), { bitmap, canvas: make((edge, q) => Math.round(edge * edge * q * 0.9)) });
  assert.ok(ok !== null && ok.length <= IMG_MAX_CHARS && parseFace(`av1:img:${ok}`) !== null);
  assert.equal(sizes[0], 192, "starts at 192 px");
  const never = await squareDataUrl(new Blob(["x"]), { bitmap, canvas: make(() => IMG_MAX_CHARS * 2) });
  assert.equal(never, null);
  const broken = await squareDataUrl(new Blob(["x"]), { bitmap: async () => { throw new Error("not a picture"); }, canvas: make(() => 10) });
  assert.equal(broken, null);
});
