// The Space image on a booted daemon (rc.16), the way Console sets it: the owner finds Shared knowledge/Branding, uploads the cropped square there, and saves it as the Space image. Then
// anyone may ask for it, signed in or not (the sign-in and join pages show it before sign-in), Choose from Files finds pictures in any Space folder, and a file that is not a picture is refused.
import test from "node:test";
import assert from "node:assert/strict";
import { bootAgentGateSpace, LIVE_FOR_GATE_REPLY } from "../golden/steps/07-agent-gate.ts";
import { expectStatus } from "../golden/steps/02-space.ts";

const LIVE = [...LIVE_FOR_GATE_REPLY, "spaces", "identity", "members"];
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("the owner uploads a square to Branding and saves it as the Space image; anyone sees it, a non-picture is refused", async () => {
  const s = await bootAgentGateSpace([...new Set(LIVE)]);
  try {
    const owner = s.signedIn("usr_olivia");
    const before = expectStatus(await s.call("spaces.image", null, {}), 200, "spaces.image before sign-in");
    assert.deepEqual(before, {}, "no image yet: the letter shows");

    const branding = expectStatus(await s.call("files.resolve", owner, { path: "Shared knowledge/Branding" }), 200, "files.resolve");
    assert.equal(branding.kind, "folder");
    const made = expectStatus(await s.call("files.create", owner, { folderId: branding.folderId, name: "Space image 2026-11-03 at 04.20.00.png", content: { base64: PNG }, mime: "image/png", idempotencyKey: "space-image-1" }), 200, "files.create");
    const fileId = made.file.fileId as string;
    const saved = expectStatus(await s.call("spaces.update", owner, { logoFileId: fileId }), 200, "spaces.update");
    assert.equal(saved.space.logoFileId, fileId);

    // the faces: a visitor on the sign-in page, and a signed-in tile that already shows it
    const visitor = expectStatus(await s.call("spaces.image", null, {}), 200, "spaces.image as a visitor");
    assert.deepEqual(visitor, { logoFileId: fileId, image: `data:image/png;base64,${PNG}` });
    assert.deepEqual(expectStatus(await s.call("spaces.image", owner, { known: fileId }), 200, "spaces.image known"), { logoFileId: fileId });
    assert.equal(expectStatus(await s.call("spaces.switcher", owner, {}), 200, "spaces.switcher").logoFileId, fileId, "the tile's read names it");

    // Choose from Files: the picture is found in Branding, from the whole Space section, newest first
    const found = expectStatus(await s.call("files.list", owner, { section: "space", deep: true, kind: "image", sort: "updated", dir: "desc", q: "space image" }), 200, "files.list deep");
    assert.deepEqual(found.files.map((f: { fileId: string }) => f.fileId), [fileId]);

    // a text file is not a picture: refused, and the image stays
    const note = expectStatus(await s.call("files.create", owner, { folderId: branding.folderId, name: "brand.md", content: { text: "# Brand" }, idempotencyKey: "space-image-2" }), 200, "files.create note").file.fileId;
    const refused = await s.call("spaces.update", owner, { name: "Renamed", logoFileId: note });
    assert.equal(refused.status, 422, JSON.stringify(refused.body).slice(0, 300));
    assert.match(refused.body.error.message, /PNG, JPEG, WebP or GIF/);
    assert.equal(expectStatus(await s.call("spaces.image", null, {}), 200, "after refusal").logoFileId, fileId);

    // removed: everyone sees the letter again
    expectStatus(await s.call("spaces.update", owner, { logoFileId: null }), 200, "remove");
    assert.deepEqual(expectStatus(await s.call("spaces.image", null, {}), 200, "after remove"), {});
  } finally { await s.stop(); }
});
