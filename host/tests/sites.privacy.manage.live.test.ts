// F48/F56/F62, sites privacy, part: who may change who reaches a site, an artifact's folder and its deletion. Real daemon, two people (shared pieces in sites.privacy.kit.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { OWNER, NOAH, seededDir, boot, raw, reachOf, make } from "./sites.privacy.kit.ts";

test("changing who may reach a site needs its owner or someone who manages it, for every value, and an agent never does it (F56 R1)", async () => {
  const d = await boot(seededDir());
  try {
    const id = await make(d, "Olivia's site");
    const get = async (): Promise<{ access: string; live: boolean }> =>
      (
        JSON.parse((await raw(d, "/v1/sites/get", { siteId: id })).text) as {
          data: { site: { access: string; live: boolean } };
        }
      ).data.site;
    const before = await get();
    // the site is the Space's: "space" would change nothing, so it is the three that change it
    for (const access of ["public", "password", "private"]) {
      const r = await raw(d, "/v1/sites/update", { siteId: id, access }, NOAH);
      assert.equal(r.status, 403, `a plain member set ${access}: ${r.text.slice(0, 160)}`);
      assert.match(r.text, /Only the owner of this site, or someone who manages it/);
      const a = await raw(d, "/v1/sites/update", { siteId: id, access }, "tok-agent-olivia");
      assert.equal(a.status, 403, `an agent acting for the owner set ${access}: ${a.text.slice(0, 160)}`);
    }
    assert.deepEqual(await get(), before, "a refused change changed nothing");
    assert.equal(await reachOf(d, id, NOAH), "edit", "and nothing moved the site in the kernel");
    // the owner may, and a member the owner gave Manage may
    assert.equal((await raw(d, "/v1/sites/update", { siteId: id, access: "private" })).status, 200);
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(
      (
        await raw(d, "/v1/access/share", {
          idempotencyKey: "mgr",
          resource: { type: "site", id },
          subject: { kind: "person", id: "usr_noah" },
          level: "manage",
        })
      ).status,
      200,
    );
    assert.equal(
      (await raw(d, "/v1/sites/update", { siteId: id, access: "space" }, NOAH)).status,
      200,
      "a manager sets it back",
    );
    // a rename is not an access change: a member who may edit still renames
    assert.equal((await raw(d, "/v1/sites/update", { siteId: id, name: "Renamed" }, NOAH)).status, 200);
  } finally {
    await d.stop();
  }
});

test("an artifact's folder cannot be moved or renamed from Files, nor the Artifacts folder above it; the page stays closed to a member (F62)", async () => {
  const d = await boot(seededDir());
  try {
    const r = await raw(d, "/v1/sites/artifact_publish", {
      title: "Okapi artifact",
      html: "<p>OKAPIWORD</p>",
      idempotencyKey: "ok1",
    });
    assert.equal(r.status, 200, r.text);
    const siteId = (JSON.parse(r.text) as { data: { artifactId: string } }).data.artifactId;
    const f = d.db!.all(
      "SELECT id, parent_id FROM files_folder WHERE id = (SELECT target_folder FROM sites_site WHERE id = ?)",
      siteId,
    )[0] as { id: string; parent_id: string };
    const roots = JSON.parse((await raw(d, "/v1/files/tree", {})).text) as {
      data: { roots: { key: string; folderId: string }[] };
    };
    const personal = roots.data.roots.find((x) => x.key.startsWith("personal"))!.folderId;
    const words = /This folder belongs to the artifact Okapi artifact\./;
    const move = await raw(d, "/v1/files/folder/move", { folderId: f.id, toParentId: personal });
    assert.equal(move.status, 422, move.text);
    assert.match(move.text, words);
    const up = await raw(d, "/v1/files/folder/move", { folderId: f.id });
    assert.equal(up.status, 422, up.text);
    const ren = await raw(d, "/v1/files/folder/rename", { folderId: f.id, name: "Mine now" });
    assert.equal(ren.status, 422, ren.text);
    assert.match(ren.text, words);
    // the Artifacts folder above it
    const parent = await raw(d, "/v1/files/folder/move", { folderId: f.parent_id, toParentId: personal });
    assert.equal(parent.status, 422, parent.text);
    assert.match(parent.text, /The Artifacts folder stays where it is/);
    await new Promise((x) => setTimeout(x, 1500));
    const reach = JSON.parse(
      (await raw(d, "/v1/access/reach", { items: [{ type: "folder", id: f.id }] }, NOAH)).text,
    ) as { data: { items: { level: string }[] } };
    assert.equal(reach.data.items[0]!.level, "none", "a member still has no reach on the folder");
    assert.equal(/OKAPIWORD/.test((await raw(d, "/v1/search/query", { q: "OKAPIWORD" }, NOAH)).text), false);
  } finally {
    await d.stop();
  }
});

test("deleting an artifact takes its pages out of reach and out of search for everyone, the person it was shared with included (F62)", async () => {
  const d = await boot(seededDir());
  try {
    const r = await raw(d, "/v1/sites/artifact_publish", {
      title: "Lemur artifact",
      html: "<p>LEMURWORD</p>",
      idempotencyKey: "lm1",
    });
    assert.equal(r.status, 200, r.text);
    const siteId = (JSON.parse(r.text) as { data: { artifactId: string } }).data.artifactId;
    const folder = (d.db!.all("SELECT target_folder AS f FROM sites_site WHERE id = ?", siteId)[0] as { f: string }).f;
    const fileId = (d.db!.all("SELECT id FROM files_file WHERE folder_id = ?", folder)[0] as { id: string }).id;
    assert.equal(
      (
        await raw(d, "/v1/access/share", {
          idempotencyKey: "lm-share",
          resource: { type: "site", id: siteId },
          subject: { kind: "person", id: "usr_noah" },
          level: "view",
        })
      ).status,
      200,
    );
    await new Promise((x) => setTimeout(x, 2000));
    const finds = async (who: string): Promise<boolean> =>
      /LEMURWORD/.test((await raw(d, "/v1/search/query", { q: "LEMURWORD" }, who)).text);
    const folderReach = async (who: string): Promise<string> =>
      (
        JSON.parse((await raw(d, "/v1/access/reach", { items: [{ type: "folder", id: folder }] }, who)).text) as {
          data: { items: { level: string }[] };
        }
      ).data.items[0]!.level;
    assert.equal(await finds(NOAH), true, "the person it was shared with reads the page");
    assert.notEqual(await folderReach(NOAH), "none");
    const del = await raw(d, "/v1/sites/delete", { siteId, idempotencyKey: "lm-del" });
    assert.equal(del.status, 200, del.text);
    await new Promise((x) => setTimeout(x, 1500));
    for (const who of [NOAH, OWNER])
      assert.equal(await finds(who), false, `${who} still finds a deleted artifact's page`);
    assert.equal(await folderReach(NOAH), "none", "the share holder still reaches the folder of a deleted artifact");
    assert.notEqual(
      (await raw(d, "/v1/files/read", { fileId, as: "base64" }, NOAH)).status,
      200,
      "the share holder still reads the page",
    );
    // the owner keeps the page in their own Trash, as with any deleted folder: it is there to restore, and nobody else reaches it
    const trashed = d.db!.all("SELECT deleted_at FROM files_file WHERE id = ?", fileId)[0] as {
      deleted_at: number | null;
    };
    assert.ok(trashed.deleted_at !== null, "the page is in Trash");
  } finally {
    await d.stop();
  }
});
