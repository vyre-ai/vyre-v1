// Share on a folder in the real app: in a Team Space the folder menu's Share opens the same ShareSheet Records uses, on the folder, through access.share.
// Needs the production web export (VYRE_APP_DIST) and Chromium; with VYRE_REQUIRE_CHROME=1 (CI) it fails instead of skipping.
import test from "node:test";
import assert from "node:assert/strict";
import { bootScreens, browserOrSkip, open, seat, shoot } from "./support/mail-browser.ts";

test("files share journey, team: a folder's Share opens the sheet on that folder", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "team" }, env);
  try {
    const w = s.world;
    const tree = (await w.owner.ok("files.tree", {})) as { roots: Array<{ key: string; kind: string; folderId?: string }> };
    const root = tree.roots.find((r) => r.key === "personal" && r.folderId !== undefined)?.folderId;
    assert.ok(root, `the Space has a top folder: ${JSON.stringify(tree).slice(0, 400)}`);
    await w.owner.ok("files.folder.create", { parentId: root, name: "Shared plans", idempotencyKey: "share-journey-folder" });
    const me = await seat(s, w.owner, "Owner");
    await open(me, s, "/files");
    await me.page.getByTestId("files-place").waitFor({ timeout: 20_000 });
    const row = me.page.getByText("Shared plans", { exact: true }).first();
    await row.waitFor({ timeout: 20_000 });
    await row.click({ button: "right" });
    await me.page.getByText("Share…", { exact: true }).first().click({ timeout: 10_000 });
    await me.page.getByTestId("files-share").waitFor({ timeout: 15_000 });
    await me.page.getByText("Share \u201CShared plans\u201D").waitFor({ timeout: 15_000 });   // titled with the folder's own name
    await me.page.getByText(/Folder\. Sharing it covers everything inside/).waitFor({ timeout: 15_000 });
    await shoot(me.page, "shots-evidence/files-share", "team-folder-share");
    assert.equal(await me.page.getByTestId("share-error").count(), 0, "no error line");
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { await s.close(); }
});
