// The Drive write-back's rules that need no restart: a stale write is refused, a member's own mount goes Read only and back, keep_both on a Read only mount, a file with many revisions, and the kept copy's safe name.
// Split from mounts.drive.safety.live.test.ts, which ran 122 s against its 120 s cap in CI (16 Nov 2026). The cases that stop and restart the daemon stay there together (they do not pass in a file of their own). No case and no cap changed.
import test from "node:test";
import assert from "node:assert/strict";
import { MEMBER } from "../fixtures/suite/world.ts";
import { bootDriveWorld } from "./mounts.drive.live.test.ts";

test("a write to a connected file someone changed since it was read is refused in one sentence, and the other person's version is untouched", async () => {
  const { w, drive, mount, fileNamed, sync } = await bootDriveWorld("drvstaleagent", (d) => {
    d.put({ id: "d1", name: "Plan.txt", mimeType: "text/plain" }, "first words");
  });
  try {
    const added = await mount();
    const f = await fileNamed(added.folderId, "Plan.txt");
    assert.ok(f);
    const read = await w.ok(MEMBER, "files.read", { fileId: f.fileId });
    const seen = (await w.ok(MEMBER, "files.get", { fileId: f.fileId })).file.version as number;
    assert.equal(read.text, "first words");
    drive.elsewhere("d1", "kim's words"); // Kim saves at Drive after the reader read it
    await sync(added.mountId); // the pass brings her version in
    const refused = await w.call(MEMBER, "files.write", {
      fileId: f.fileId,
      content: { text: "the reader's words" },
      baseVersion: seen,
      reason: "Edit",
      idempotencyKey: w.idem(),
    });
    assert.equal(refused.status, 409, refused.text);
    assert.equal(refused.error?.message, "The file changed since it was read.");
    await sync(added.mountId);
    assert.equal(drive.text("d1"), "kim's words", "nothing was sent over Kim's version");
    assert.equal((await w.ok(MEMBER, "files.read", { fileId: f.fileId })).text, "kim's words");
  } finally {
    await w.stop();
  }
});

test("a member who connected a folder can make their own mount Read only and back; nothing is sent while it is read only", async () => {
  const { w, drive, mount, fileNamed, sync } = await bootDriveWorld("drvromember", (d) => {
    d.put({ id: "d1", name: "Plan.txt", mimeType: "text/plain" }, "first words");
  });
  try {
    const added = await mount(); // Noah (a member) connected it, two-way
    const f = await fileNamed(added.folderId, "Plan.txt");
    assert.ok(f);
    await w.ok(MEMBER, "mounts.update", { mountId: added.mountId, pullOnly: true });
    assert.equal((await w.ok(MEMBER, "mounts.get", { mountId: added.mountId })).mount.readOnly, true);
    await w.ok(MEMBER, "files.read", { fileId: f.fileId });
    await w.ok(MEMBER, "files.write", {
      fileId: f.fileId,
      content: { text: "edited" },
      reason: "Edit",
      idempotencyKey: w.idem(),
    });
    await sync(added.mountId);
    assert.equal(drive.text("d1"), "first words", "a Read only mount sends nothing");
    await w.ok(MEMBER, "mounts.update", { mountId: added.mountId, pullOnly: false });
    assert.equal((await w.ok(MEMBER, "mounts.get", { mountId: added.mountId })).mount.readOnly, false);
  } finally {
    await w.stop();
  }
});

test("keep_both is refused on a Read only mount (it would write a copy at the provider) and Use theirs still works", async () => {
  const { w, drive, mount, fileNamed, sync } = await bootDriveWorld("drvkbro", (d) => {
    d.put({ id: "d1", name: "Plan.txt", mimeType: "text/plain" }, "first words");
  });
  try {
    const added = await mount();
    const f = await fileNamed(added.folderId, "Plan.txt");
    assert.ok(f);
    await w.ok(MEMBER, "files.read", { fileId: f.fileId });
    await w.ok(MEMBER, "files.write", {
      fileId: f.fileId,
      content: { text: "my words" },
      reason: "Edit",
      idempotencyKey: w.idem(),
    });
    drive.elsewhere("d1", "kim's words");
    await sync(added.mountId);
    assert.equal((await w.ok(MEMBER, "mounts.open", { fileId: f.fileId })).source.conflict, true);
    await w.ok(MEMBER, "mounts.update", { mountId: added.mountId, pullOnly: true });
    const refused = await w.call(MEMBER, "mounts.resolve", { fileId: f.fileId, choice: "keep_both" });
    assert.notEqual(refused.status, 200);
    assert.match(refused.error?.message ?? "", /read only, so a copy cannot be saved at Google Drive/);
    assert.deepEqual(drive.creates, [], "nothing was written at the provider");
    await w.ok(MEMBER, "mounts.resolve", { fileId: f.fileId, choice: "use_theirs" });
    assert.equal((await w.ok(MEMBER, "files.read", { fileId: f.fileId })).text, "kim's words");
  } finally {
    await w.stop();
  }
});

test("the between-check finds the other revision in a file with many revisions (every page of the list is read)", async () => {
  const { w, drive, mount, fileNamed, sync } = await bootDriveWorld("drvpages", (d) => {
    d.put({ id: "d1", name: "Plan.txt", mimeType: "text/plain" }, "r1");
    for (const t of ["r2", "r3", "r4", "r5"]) d.elsewhere("d1", t);
  });
  try {
    drive.state.revPageSize = 2;
    const added = await mount();
    const f = await fileNamed(added.folderId, "Plan.txt");
    assert.ok(f);
    await w.ok(MEMBER, "files.read", { fileId: f.fileId });
    await w.ok(MEMBER, "files.write", {
      fileId: f.fileId,
      content: { text: "my words" },
      reason: "Edit",
      idempotencyKey: w.idem(),
    });
    drive.state.interpose = { id: "d1", text: "kim's words" };
    await sync(added.mountId);
    await sync(added.mountId);
    assert.ok(drive.byName("Plan (Kim's version).txt"), "their revision is found on the second page and kept");
  } finally {
    await w.stop();
  }
});

test("the name of the copy that keeps their version is made safe: no path characters or control characters from the provider's display name", async () => {
  const { w, drive, mount, fileNamed, sync } = await bootDriveWorld("drvsafe", (d) => {
    d.put({ id: "d1", name: "Plan.txt", mimeType: "text/plain" }, "first words");
  });
  try {
    const added = await mount();
    const f = await fileNamed(added.folderId, "Plan.txt");
    assert.ok(f);
    await w.ok(MEMBER, "files.read", { fileId: f.fileId });
    await w.ok(MEMBER, "files.write", {
      fileId: f.fileId,
      content: { text: "my words" },
      reason: "Edit",
      idempotencyKey: w.idem(),
    });
    const orig = drive.elsewhere;
    void orig;
    drive.state.interpose = {
      id: "d1",
      text: "their words",
      by: { name: "Kim/..\\Ito\u0007", email: "kim@firm.test" },
    };
    await sync(added.mountId);
    await sync(added.mountId);
    const names = [...drive.files.values()].map((x) => x.name);
    assert.ok(names.includes("Plan (Kim..Ito's version).txt"), names.join(" | "));
    assert.ok(names.every((n) => !/[\\/\u0000-\u001f]/.test(n)));
  } finally {
    await w.stop();
  }
});
