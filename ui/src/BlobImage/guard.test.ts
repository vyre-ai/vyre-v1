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
    "the Space image is a data: address from spaces.image (shell/spaces/model.ts), never a Space blob address",
  "apps/app/src/places/settings/ui.tsx": "github.com avatars, another site's address",
  "apps/app/src/places/chats/rightpane/BrowserLive.tsx":
    "a live browser frame: an object address made on this page from the stream's own bytes (BrowserLive createObjectURL), never a Space blob address",
  "apps/app/src/places/chats/computer/LiveScreen.tsx": "a live screen stream address with its own ticket",
  "ui/src/LiveSurface/index.tsx":
    "frames of a live computer or browser: object addresses made on this page from the stream's own bytes, never a Space blob address",
  "apps/app/src/places/chats/rightpane/PreviewImage.tsx":
    "a browser preview picture: a data address (data:image/png;base64) the capability returns, never a Space blob address",
  "apps/app/src/places/chats/conversation/webpage.tsx":
    "a page's screenshot: shown only when it matches ^data:image/(jpeg|png|webp);base64 (the SHOT test in this file), never a Space blob address",
  "apps/app/src/places/chats/conversation/LiveCard.tsx":
    "a frozen still: built here as data:image/png;base64 from a files.read answer (LiveCard setStill), never a Space blob address",
  "apps/app/src/places/chats/conversation/chrome-cards.tsx":
    "a step thumbnail: shown only when it matches ^data:image/(jpeg|png|webp);base64 (the THUMB test in this file), never a Space blob address",
  "apps/app/src/onboarding/ProviderLogo.tsx": "static provider logos",
  "apps/app/src/console/pages/SpaceImage.tsx": "the picture being cropped: a local file read to a data address",
  "ui/src/EmailBuilder/index.tsx": "the email's own pictures, addresses the sender typed",
  "ui/src/Composer/index.tsx": "a local object address of a file being attached",
  "ui/src/AppIcon/index.tsx": "static brand marks",
  "ui/src/Avatar/index.tsx":
    "faces drawn to data addresses; a custom face (spec.url) is parsed only as a data:image address (agentface.ts); a profile photo goes through BlobImage's useBlobSrc",
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
  // another host is never the Space's blob, whatever the path (a reply can name any host); the Space's own origin is
  assert.equal(isSpaceBlob("https://x.example/spaces/spc_1/blobs/blb_abc?v=1"), false);
  assert.equal(isSpaceBlob("https://x.example/spaces/spc_1/blobs/blb_abc?v=1", "https://other.example"), false);
  assert.equal(isSpaceBlob("https://x.example/spaces/spc_1/blobs/blb_abc?v=1", "https://x.example"), true);
  assert.equal(isSpaceBlob("//x.example/spaces/spc_1/blobs/blb_abc"), false);
  assert.equal(isSpaceBlob("data:image/png;base64,AAAA"), false);
  assert.equal(isSpaceBlob("https://github.com/x.png"), false);
  assert.equal(isSpaceBlob("blob:http://a/1"), false);
});
