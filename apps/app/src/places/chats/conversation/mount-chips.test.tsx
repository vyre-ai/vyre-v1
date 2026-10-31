// A sent message that links or attaches a mounted file shows the provider's logo and the mount's name on its chip (rc.8 mounts); a file that is not mounted draws nothing extra.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { MountRefs, originOf } from "./attachments.tsx";

const mounts = [{ mountId: "m1", folderId: "fld_s", kind: "google_drive", provider: "Google Drive", name: "Sales", state: "idle", mode: "server_copy", reviewChanges: true, pendingChanges: 0, conflicts: 0 }] as never;

test("originOf finds the mount of a file by its mount id and of a folder by its folder id, with the provider's brand", () => {
  assert.deepEqual(originOf(mounts, { mountId: "m1" }), { brand: "gdrive", provider: "Google Drive", mount: "Sales" });
  assert.equal(originOf(mounts, { folderId: "fld_s" })?.mount, "Sales");
  assert.equal(originOf(mounts, { mountId: "other" }), null);
  assert.equal(originOf(mounts, {}), null);
});

test("MountRefs draws nothing for links that are not files or folders", () => {
  const html = renderToStaticMarkup(createElement(MountRefs, { refs: [{ kind: "record", id: "rec_1", title: "Elena" }], data: { call: async () => ({}), nav: { openBeside() {} } } as never }));
  assert.equal(html, "");
});
