// A picture the Space serves is shown through ui/BlobImage (a bare address answers 401: an image element sends no token). This fails on any image source outside it: a file that draws an <Image>, an <img> or
// createElement("img") must use BlobImage/BlobImg, or be listed here with why its address can never be a blob address of the Space.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isSpaceBlob } from "./address.ts";

const root = new URL("../../../", import.meta.url).pathname;
const ALLOW: Record<string, string> = {
  "ui/src/BlobImage/index.tsx": "the component itself",
  "apps/app/src/join/kit.tsx": "the join screens' own static logos",
  "apps/app/src/shell/spaces/SpaceSwitcher.tsx":
    "a Space's own image: a data address the Space settings store (NOT verified, listed for the lead)",
  "apps/app/src/places/settings/ui.tsx": "github.com avatars, another site's address",
  "apps/app/src/places/chats/rightpane/BrowserLive.tsx":
    "a live browser frame (a data address or the stream) from the computer, not a Files blob (NOT verified)",
  "apps/app/src/places/chats/computer/LiveScreen.tsx": "a live screen stream address with its own ticket",
  "apps/app/src/places/chats/conversation/webpage.tsx": "a page's own screenshot data address (NOT verified)",
  "apps/app/src/places/chats/conversation/LiveCard.tsx":
    "a frozen still, a data address read through files.read (NOT verified)",
  "apps/app/src/places/chats/conversation/chrome-cards.tsx": "a step's thumbnail data address (NOT verified)",
  "apps/app/src/places/chats/rightpane/WorkSections.tsx":
    "a step's picture read from Files as a data address (useStepPicture) (NOT verified)",
  "apps/app/src/onboarding/ProviderLogo.tsx": "static provider logos",
  "apps/app/src/console/pages/SpaceImage.tsx": "the picture being cropped: a local file read to a data address",
  "ui/src/EmailBuilder/index.tsx": "the email's own pictures, addresses the sender typed",
  "ui/src/Composer/index.tsx": "a local object address of a file being attached",
  "ui/src/AppIcon/index.tsx": "static brand marks",
  "ui/src/Avatar/index.tsx":
    "faces drawn to data addresses, a person's picture read through files.read to a data address, or another site's address (NOT verified for spec.url)",
  "ui/src/Avatar/cache.ts": "text of a comment about its data-address bitmaps",
  "apps/app/src/places/apps/shell/form-preview.ts":
    "an HTML string for a sandboxed form preview, pictures the form author typed",
  "apps/app/src/places/chats/notes/parts.tsx": "note pictures are data addresses (notes.image)",
};
const DRAWS = /<Image\b|<img\b|createElement\(\s*"img"/;

function* sources(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* sources(p);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/sample|fixtures/.test(p)) yield p;
  }
}

test("no image source outside ui/BlobImage: every file that draws a picture uses BlobImage or says why it cannot be a Space blob address", () => {
  const bare: string[] = [];
  for (const base of ["ui/src", "apps/app/src"])
    for (const file of sources(path.join(root, base))) {
      const rel = path.relative(root, file);
      const text = fs.readFileSync(file, "utf8");
      if (!DRAWS.test(text) || /BlobImage|BlobImg/.test(text) || rel in ALLOW) continue;
      bare.push(rel);
    }
  assert.deepEqual(
    bare,
    [],
    "these files draw a picture without BlobImage: use it, or list the file in ALLOW with the reason",
  );
  for (const k of Object.keys(ALLOW)) assert.ok(fs.existsSync(path.join(root, k)), `${k} is listed but gone`);
});

test("which addresses are the Space's blobs", () => {
  assert.equal(isSpaceBlob("/spaces/spc_1/blobs/blb_abc"), true);
  assert.equal(isSpaceBlob("https://x.example/spaces/spc_1/blobs/blb_abc?v=1"), true);
  assert.equal(isSpaceBlob("data:image/png;base64,AAAA"), false);
  assert.equal(isSpaceBlob("https://github.com/x.png"), false);
  assert.equal(isSpaceBlob("blob:http://a/1"), false);
});
