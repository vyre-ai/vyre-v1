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

import { OWNER } from "../fixtures/suite/world.ts";

test("a file deleted at Drive while an edit waits: the edit is not lost and not sent, the row says so, and Keep it here puts it back as one new file; Discard drops it", async () => {
  const { w, drive, mount, fileNamed, sync } = await bootDriveWorld("drvgone", (d) => {
    d.put({ id: "d1", name: "Plan.txt", mimeType: "text/plain" }, "first words");
    d.put({ id: "d2", name: "Other.txt", mimeType: "text/plain" }, "other");
  });
  try {
    const added = await mount();
    const a = await fileNamed(added.folderId, "Plan.txt");
    const b = await fileNamed(added.folderId, "Other.txt");
    assert.ok(a && b);
    for (const f of [a, b]) {
      await w.ok(MEMBER, "files.read", { fileId: f.fileId });
      await w.ok(MEMBER, "files.write", { fileId: f.fileId, content: { text: `edited ${f.name}` }, reason: "Edit", idempotencyKey: w.idem() });
    }
    drive.files.delete("d1");
    drive.files.delete("d2");
    await sync(added.mountId);
    await sync(added.mountId);
    assert.deepEqual(drive.creates, [], "nothing was sent: the file is gone there");
    const open = await w.ok(MEMBER, "mounts.open", { fileId: a.fileId });
    assert.equal(open.source.notSent?.goneThere, true, JSON.stringify(open.source));
    assert.match(open.source.notSent.reason, /deleted at Google Drive while you had changes here/);
    assert.equal((await w.ok(MEMBER, "files.read", { fileId: a.fileId })).text, "edited Plan.txt", "the edit is still here");
    await w.ok(MEMBER, "mounts.resolve", { fileId: a.fileId, choice: "keep_here" });
    await w.ok(MEMBER, "mounts.resolve", { fileId: b.fileId, choice: "discard" });
    await sync(added.mountId);
    await sync(added.mountId);
    assert.equal([...drive.files.values()].filter((f) => f.name === "Plan.txt").length, 1, "Keep it here: one new Plan.txt at Drive");
    assert.equal(drive.text(drive.byName("Plan.txt")!.id), "edited Plan.txt");
    assert.equal(drive.byName("Other.txt"), undefined, "Discard sends nothing");
    assert.equal(await fileNamed(added.folderId, "Other.txt"), undefined, "and the file is gone from Files");
    const row = await w.ok(MEMBER, "mounts.get", { mountId: added.mountId });
    assert.equal(row.mount.state, "idle", String(row.mount.error ?? ""));
  } finally {
    await w.stop();
  }
});

test("a save by someone who did not connect the folder says whose connection writes", async () => {
  const { w, mount, fileNamed } = await bootDriveWorld("drvwho", (d) => {
    d.put({ id: "d1", name: "Plan.txt", mimeType: "text/plain" }, "first words");
  });
  try {
    const added = await mount(); // Noah (MEMBER) connected it
    const f = await fileNamed(added.folderId, "Plan.txt");
    assert.ok(f);
    const mine = await w.ok(MEMBER, "mounts.open", { fileId: f.fileId });
    assert.equal(mine.source.writesAs, undefined, "your own connection says nothing");
    const theirs = await w.ok(OWNER, "mounts.open", { fileId: f.fileId });
    assert.equal(theirs.source.writesAs?.email, "noah@firm.test");
    assert.ok(theirs.source.writesAs?.by);
  } finally {
    await w.stop();
  }
});

test("a pass the scheduler starts leaves a fresh edit for its quiet time (one revision for a long edit); the person's Sync now sends at once", async () => {
  const { w, drive, mount, fileNamed } = await bootDriveWorld("drvquiet", (d) => {
    d.put({ id: "d1", name: "Plan.txt", mimeType: "text/plain" }, "first words");
  });
  try {
    const added = await mount();
    const f = await fileNamed(added.folderId, "Plan.txt");
    assert.ok(f);
    await w.ok(MEMBER, "files.read", { fileId: f.fileId });
    for (const t of ["one", "two", "three"]) {
      await w.ok(MEMBER, "files.write", { fileId: f.fileId, content: { text: t }, reason: "Edit", idempotencyKey: w.idem() });
    }
    await w.d.hooks?.pump?.();
    await w.ok(MEMBER, "mounts.sync_now", { mountId: added.mountId, auto: true, idempotencyKey: w.idem() });
    assert.equal(drive.files.get("d1")!.head, 1, "an edit made a moment ago is not sent by a scheduled pass");
    await w.ok(MEMBER, "mounts.sync_now", { mountId: added.mountId, idempotencyKey: w.idem() });
    assert.equal(drive.text("d1"), "three", "Sync now sends it");
    assert.equal(drive.files.get("d1")!.head, 2, "one revision for three saves");
  } finally {
    await w.stop();
  }
});
