// The Chrome panel draws agent faces from its own copy of the curated library (src/ui/faces.js, generated from ui/src/Avatar/library.ts). The copy must match the library, a stored face draws, and nothing from the app is ever markup.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { build } from "../scripts/avatars/chrome-faces.ts";

const file = new URL("../apps/chrome/src/ui/faces.js", import.meta.url);

test("faces.js is what scripts/avatars/chrome-faces.ts writes from the library (rerun it after changing the faces)", () => {
  assert.ok(fs.existsSync(file), "run: node --import tsx scripts/avatars/chrome-faces.ts");
  assert.equal(fs.readFileSync(file, "utf8"), build());
});

test("every drawn face is there, with no tint rect and no script", async () => {
  const m = await import("../apps/chrome/src/ui/faces.js");
  for (const fam of ["faces", "friends", "blobs", "glass"]) {
    const list = (m.FACE_SVGS as Record<string, string[]>)[fam]!;
    assert.equal(list.length, 24, fam);
    for (const svg of list) { assert.match(svg, /^<svg /); assert.ok(!/<script|onload|<foreignObject/i.test(svg)); }
  }
  assert.equal(m.FACE_TINTS.length, 8);
});
