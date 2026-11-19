// A blob of a site's database backup is read only by whoever manages the site; every other blob keeps the view level on its resource (r42-sites-run).
import assert from "node:assert/strict";
import { test } from "node:test";
import { blobReadCheck } from "./blobs.ts";

test("a database backup takes manage on the site it belongs to, so a member who can only view the site cannot read it", () => {
  assert.deepEqual(blobReadCheck({ type: "site_backup", id: "sit_a" }), {
    action: { perm: null, level: "manage" },
    resource: { type: "site", id: "sit_a" },
  });
});

test("a preview, a thumbnail or a site's own file keeps the view level", () => {
  assert.deepEqual(blobReadCheck({ type: "file", id: "fil_a" }), { action: { perm: null, level: "view" }, resource: { type: "file", id: "fil_a" } });
  assert.deepEqual(blobReadCheck({ type: "site", id: "sit_a" }), { action: { perm: null, level: "view" }, resource: { type: "site", id: "sit_a" } });
});
