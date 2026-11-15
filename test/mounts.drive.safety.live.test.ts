// The Drive write-back's data-safety rules, on a booted daemon against the stand-in Drive (the real invoke path: an error from another module arrives as a HostError, never a VyreErr).
// 1. one file Drive refuses: the per-file sentence, and the mount stays healthy. 2. a create whose answer is lost and is retried makes one file, never two. 3. a change saved at Drive between
// the check and the upload is noticed, kept beside the file, and named to the person.
import test from "node:test";
import assert from "node:assert/strict";
import { MEMBER } from "../fixtures/suite/world.ts";
import { bootDriveWorld } from "./mounts.drive.live.test.ts";

test("one file Drive refuses: the file says it in words and the mount stays healthy (a HostError from the Google module, not a VyreErr)", async () => {
  const { w, drive, mount, fileNamed, sync } = await bootDriveWorld("drvdeny", (d) => {
    d.put({ id: "d1", name: "Plan.txt", mimeType: "text/plain" }, "first words");
    d.put({ id: "d2", name: "Other.txt", mimeType: "text/plain" }, "other");
  });
  try {
    const added = await mount();
    const f = await fileNamed(added.folderId, "Plan.txt");
    assert.ok(f);
    await w.ok(MEMBER, "files.read", { fileId: f.fileId });
    drive.files.get("d1")!.canEdit = false; // the person's edit right was taken away after the folder was listed
    await w.ok(MEMBER, "files.write", { fileId: f.fileId, content: { text: "my words" }, reason: "Edit", idempotencyKey: w.idem() });
    await sync(added.mountId);
    const row = await w.ok(MEMBER, "mounts.get", { mountId: added.mountId });
    assert.equal(row.mount.state, "idle", `the mount is healthy: ${row.mount.error ?? ""}`);
    const opened = await w.ok(MEMBER, "mounts.open", { fileId: f.fileId });
    assert.match(opened.source.notSent?.reason ?? "", /You can no longer change this at Google Drive/);
    assert.equal(drive.text("d1"), "first words", "Drive was not written");
  } finally {
    await w.stop();
  }
});

test("a create whose answer is lost is retried and Drive still has one file (and one folder)", async () => {
  const { w, drive, mount, sync } = await bootDriveWorld("drvdup", (d) => {
    d.put({ id: "d1", name: "Plan.txt", mimeType: "text/plain" }, "plan");
  });
  try {
    const added = await mount();
    await w.ok(MEMBER, "files.create", { folderId: added.folderId, name: "Brief.txt", content: { text: "brief" }, idempotencyKey: w.idem() });
    await w.ok(MEMBER, "files.folder.create", { parentId: added.folderId, name: "Reports", idempotencyKey: w.idem() });
    drive.state.createThen503 = 2; // each create makes the item and answers 503
    for (let i = 0; i < 3; i++) await sync(added.mountId);
    const named = (n: string) => [...drive.files.values()].filter((f) => f.name === n && !f.trashed);
    assert.equal(named("Brief.txt").length, 1, "one Brief.txt after three passes");
    assert.equal(named("Reports").length, 1, "one Reports folder after three passes");
    const row = await w.ok(MEMBER, "mounts.get", { mountId: added.mountId });
    assert.equal(row.mount.state, "idle", String(row.mount.error ?? ""));
  } finally {
    await w.stop();
  }
});

test("a change saved at Drive between the check and the upload is not lost: it is kept beside the file and the row names who and when", async () => {
  const { w, drive, mount, fileNamed, sync } = await bootDriveWorld("drvbetween", (d) => {
    d.put({ id: "d1", name: "Plan.txt", mimeType: "text/plain" }, "first words");
  });
  try {
    const added = await mount();
    const f = await fileNamed(added.folderId, "Plan.txt");
    assert.ok(f);
    await w.ok(MEMBER, "files.read", { fileId: f.fileId });
    await w.ok(MEMBER, "files.write", { fileId: f.fileId, content: { text: "my words" }, reason: "Edit", idempotencyKey: w.idem() });
    drive.state.interpose = { id: "d1", text: "kim's words" }; // Kim saves after the check and before the upload
    await sync(added.mountId);
    await sync(added.mountId);
    assert.equal(drive.text("d1"), "my words", "the edit is the file");
    const beside = drive.byName("Plan (Kim's version).txt");
    assert.ok(beside, "their version is kept beside it at Drive");
    assert.equal(drive.text(beside.id), "kim's words");
    const opened = await w.ok(MEMBER, "mounts.open", { fileId: f.fileId });
    const line = opened.source.notSent?.reason ?? "";
    assert.match(line, /Kim Ito changed this at Google Drive at 2026-/);
    assert.match(line, /Plan \(Kim's version\)\.txt/);
  } finally {
    await w.stop();
  }
});
