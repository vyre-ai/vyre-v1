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
    await w.ok(MEMBER, "files.write", {
      fileId: f.fileId,
      content: { text: "my words" },
      reason: "Edit",
      idempotencyKey: w.idem(),
    });
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
    await w.ok(MEMBER, "files.create", {
      folderId: added.folderId,
      name: "Brief.txt",
      content: { text: "brief" },
      idempotencyKey: w.idem(),
    });
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
    await w.ok(MEMBER, "files.write", {
      fileId: f.fileId,
      content: { text: "my words" },
      reason: "Edit",
      idempotencyKey: w.idem(),
    });
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
      await w.ok(MEMBER, "files.write", {
        fileId: f.fileId,
        content: { text: `edited ${f.name}` },
        reason: "Edit",
        idempotencyKey: w.idem(),
      });
    }
    drive.files.delete("d1");
    drive.files.delete("d2");
    await sync(added.mountId);
    await sync(added.mountId);
    assert.deepEqual(drive.creates, [], "nothing was sent: the file is gone there");
    const open = await w.ok(MEMBER, "mounts.open", { fileId: a.fileId });
    assert.equal(open.source.notSent?.goneThere, true, JSON.stringify(open.source));
    assert.match(open.source.notSent.reason, /deleted at Google Drive while you had changes here/);
    assert.equal(
      (await w.ok(MEMBER, "files.read", { fileId: a.fileId })).text,
      "edited Plan.txt",
      "the edit is still here",
    );
    await w.ok(MEMBER, "mounts.resolve", { fileId: a.fileId, choice: "keep_here" });
    await w.ok(MEMBER, "mounts.resolve", { fileId: b.fileId, choice: "discard" });
    await sync(added.mountId);
    await sync(added.mountId);
    assert.equal(
      [...drive.files.values()].filter((f) => f.name === "Plan.txt").length,
      1,
      "Keep it here: one new Plan.txt at Drive",
    );
    assert.equal(drive.text(drive.byName("Plan.txt")!.id), "edited Plan.txt");
    assert.equal(drive.byName("Other.txt"), undefined, "Discard sends nothing");
    const kept = await fileNamed(added.folderId, "Other.txt");
    assert.ok(kept, "Discard drops the unsent edit only: the file stays in Files");
    assert.equal((await w.ok(MEMBER, "files.read", { fileId: kept.fileId })).text, "other", "as it was at Drive, without the edit");
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
      await w.ok(MEMBER, "files.write", {
        fileId: f.fileId,
        content: { text: t },
        reason: "Edit",
        idempotencyKey: w.idem(),
      });
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

import { bootWorld } from "../fixtures/suite/world.ts";

/**
 * The daemon is stopped at the moment Drive has applied one write and before it answers (a crash in the middle of an upload, a rename, a move, a delete or a create), started again over the same data, and
 * the passes run: nothing is lost and nothing is doubled.
 */
async function crashMidWrite(
  prefix: string,
  o: {
    seed: (d: Parameters<NonNullable<Parameters<typeof bootDriveWorld>[1]>>[0]) => void;
    act: (
      w: Awaited<ReturnType<typeof bootDriveWorld>>["w"],
      added: { folderId: string; mountId: string },
      find: (n: string) => Promise<{ fileId: string } | undefined>,
    ) => Promise<void>;
    crashOn: (r: { method: string; path: string }) => boolean;
    check: (
      drive: Awaited<ReturnType<typeof bootDriveWorld>>["drive"],
      w: Awaited<ReturnType<typeof bootDriveWorld>>["w"],
      added: { folderId: string; mountId: string },
    ) => Promise<void>;
  },
): Promise<void> {
  const { w, drive, mount, fileNamed, opts } = await bootDriveWorld(prefix, o.seed);
  let w2: Awaited<ReturnType<typeof bootWorld>> | undefined;
  try {
    const added = await mount();
    await o.act(w, added, (n) => fileNamed(added.folderId, n));
    await w.d.hooks?.pump?.();
    let stopped: Promise<unknown> = Promise.resolve();
    drive.state.crashOn = {
      match: o.crashOn,
      stop: () => {
        stopped = Promise.race([w.stop(true), new Promise((ok) => setTimeout(ok, 4000))]);
        return stopped;
      },
    };
    void w.call(MEMBER, "mounts.sync_now", { mountId: added.mountId, idempotencyKey: w.idem() }).catch(() => undefined);
    for (let i = 0; i < 100 && drive.state.crashOn !== null; i++) await new Promise((ok) => setTimeout(ok, 50));
    assert.equal(drive.state.crashOn, null, "the crash point was reached");
    await stopped;
    w2 = await bootWorld({ ...opts, dir: w.dir });
    await w2.d.hooks?.pump?.();
    for (let i = 0; i < 3; i++) {
      await w2.ok(MEMBER, "mounts.sync_now", { mountId: added.mountId, idempotencyKey: `again-${prefix}-${i}` });
      await w2.d.hooks?.pump?.();
    }
    await o.check(drive, w2 as never, added);
    const row = await w2.ok(MEMBER, "mounts.get", { mountId: added.mountId });
    assert.equal(row.mount.state, "idle", String(row.mount.error ?? ""));
  } finally {
    await (w2 ?? w).stop();
  }
}

const find = (d: { files: Map<string, { name: string; trashed: boolean; parents: string[] }> }, n: string) =>
  [...d.files.values()].filter((f) => f.name === n && !f.trashed);

test("the daemon stopped in the middle of an upload: after the restart Drive has the edit once, as one revision, and no copy is made", async () => {
  await crashMidWrite("crashup", {
    seed: (d) => void d.put({ id: "d1", name: "Plan.txt", mimeType: "text/plain" }, "first words"),
    act: async (w, _a, f) => {
      const x = (await f("Plan.txt"))!;
      await w.ok(MEMBER, "files.read", { fileId: x.fileId });
      await w.ok(MEMBER, "files.write", {
        fileId: x.fileId,
        content: { text: "my words" },
        reason: "Edit",
        idempotencyKey: w.idem(),
      });
    },
    crashOn: (r) => r.path.startsWith("/upload/drive/v3/files/d1"),
    check: async (drive, w2, added) => {
      assert.equal(drive.text("d1"), "my words");
      assert.equal(drive.files.get("d1")!.head, 2, "one revision for the edit, not two");
      // known and said in the report: the pass after the restart sees Drive's newer revision (the edit that landed) with the edit still waiting, and calls it a change on both sides; the person picks Keep both
      // or Use theirs. Nothing is lost and nothing is doubled; the row is flagged where it need not be.
      const listed = await w2.ok(MEMBER, "files.list", { section: "space", folder: added.folderId });
      const mine = listed.files.find((x: { name: string }) => x.name === "Plan.txt");
      assert.equal(
        (await w2.ok(MEMBER, "files.read", { fileId: mine.fileId })).text,
        "my words",
        "the edit is still here",
      );
      assert.equal(find(drive, "Plan.txt").length, 1);
      assert.equal([...drive.files.values()].length, 1, "no copy, no second file");
    },
  });
});

test("the daemon stopped in the middle of a rename, a move and a delete: after the restart each is done once at the same file", async () => {
  const seed = (d: { put: (f: object, b?: string) => unknown }) => {
    d.put({ id: "d1", name: "Plan.txt", mimeType: "text/plain" }, "plan");
    d.put({ id: "dir1", name: "Reports", mimeType: "application/vnd.google-apps.folder" }, "");
  };
  await crashMidWrite("crashrename", {
    seed,
    act: async (w, _a, f) =>
      void (await w.ok(MEMBER, "files.rename", {
        fileId: (await f("Plan.txt"))!.fileId,
        name: "Plan 2026.txt",
        idempotencyKey: w.idem(),
      })),
    crashOn: (r) => r.method === "PATCH" && r.path === "/drive/v3/files/d1",
    check: async (drive) => {
      assert.equal(drive.files.get("d1")!.name, "Plan 2026.txt");
      assert.equal(drive.files.get("d1")!.head, 1, "a rename is not a revision");
      assert.equal(
        [...drive.files.values()].filter((x) => x.mimeType !== "application/vnd.google-apps.folder").length,
        1,
      );
    },
  });
  await crashMidWrite("crashmove", {
    seed,
    act: async (w, a, f) => {
      const listed = await w.ok(MEMBER, "files.list", { section: "space", folder: a.folderId });
      const dir = (listed.folders ?? []).find((x: { name: string }) => x.name === "Reports");
      await w.ok(MEMBER, "files.move", {
        fileId: (await f("Plan.txt"))!.fileId,
        toFolderId: dir.folderId,
        idempotencyKey: w.idem(),
      });
    },
    crashOn: (r) => r.method === "PATCH" && r.path === "/drive/v3/files/d1",
    check: async (drive) => {
      assert.deepEqual(drive.files.get("d1")!.parents, ["dir1"], "moved once, same file");
      assert.equal([...drive.files.values()].filter((x) => x.name === "Plan.txt").length, 1);
    },
  });
  await crashMidWrite("crashdelete", {
    seed,
    act: async (w, _a, f) =>
      void (await w.ok(MEMBER, "files.delete", { fileId: (await f("Plan.txt"))!.fileId, idempotencyKey: w.idem() })),
    crashOn: (r) => r.method === "PATCH" && r.path === "/drive/v3/files/d1",
    check: async (drive) => {
      assert.equal(drive.files.get("d1")!.trashed, true, "in Drive's Trash once");
      assert.equal(drive.creates.length, 0);
    },
  });
});

test("the daemon stopped in the middle of a create: after the restart Drive has one file, not two", async () => {
  await crashMidWrite("crashcreate", {
    seed: (d) => void d.put({ id: "d1", name: "Plan.txt", mimeType: "text/plain" }, "plan"),
    act: async (w, a) =>
      void (await w.ok(MEMBER, "files.create", {
        folderId: a.folderId,
        name: "Brief.txt",
        content: { text: "brief" },
        idempotencyKey: w.idem(),
      })),
    crashOn: (r) => r.method === "POST" && r.path === "/upload/drive/v3/files",
    check: async (drive) => {
      assert.equal(find(drive, "Brief.txt").length, 1, "one Brief.txt");
      assert.equal(drive.text(find(drive, "Brief.txt")[0]!.id ?? ""), "brief");
    },
  });
});

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
    await w.ok(MEMBER, "files.write", { fileId: f.fileId, content: { text: "my words" }, reason: "Edit", idempotencyKey: w.idem() });
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
    await w.ok(MEMBER, "files.write", { fileId: f.fileId, content: { text: "my words" }, reason: "Edit", idempotencyKey: w.idem() });
    drive.state.interpose = { id: "d1", text: "kim's words" };
    await sync(added.mountId);
    await sync(added.mountId);
    assert.ok(drive.byName("Plan (Kim's version).txt"), "their revision is found on the second page and kept");
  } finally {
    await w.stop();
  }
});

test("an edit left unsent by a stop inside its quiet time is sent after the boot by the pass that was scheduled before the stop (jobs survive a restart)", async () => {
  const { w, drive, mount, fileNamed, opts } = await bootDriveWorld("drvboot", (d) => {
    d.put({ id: "d1", name: "Plan.txt", mimeType: "text/plain" }, "first words");
  });
  let w2: Awaited<ReturnType<typeof bootWorld>> | undefined;
  try {
    const added = await mount();
    const f = await fileNamed(added.folderId, "Plan.txt");
    assert.ok(f);
    await w.ok(MEMBER, "files.read", { fileId: f.fileId });
    await w.ok(MEMBER, "files.write", { fileId: f.fileId, content: { text: "my words" }, reason: "Edit", idempotencyKey: w.idem() });
    await w.d.hooks?.pump?.();
    await w.ok(MEMBER, "mounts.sync_now", { mountId: added.mountId, auto: true, idempotencyKey: w.idem() }); // the scheduled kind: it leaves the fresh edit and schedules the pass for its quiet time
    assert.equal(drive.text("d1"), "first words");
    await w.stop(true); // stopped inside the quiet time
    w2 = await bootWorld({ ...opts, dir: w.dir });
    // the scheduled pass survived the stop (jobs live in the module database); it runs when it is due
    for (let i = 0; i < 45 && drive.text("d1") !== "my words"; i++) {
      await new Promise((ok) => setTimeout(ok, 1000));
      await (w2.d as unknown as { schedule: { tick(): Promise<number> } }).schedule.tick();
    }
    assert.equal(drive.text("d1"), "my words", `the edit is sent after the boot, without anyone pressing anything ${JSON.stringify(w2.logsLike(/schedule|mounts/i).slice(-6))}`);
  } finally {
    await (w2 ?? w).stop();
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
    await w.ok(MEMBER, "files.write", { fileId: f.fileId, content: { text: "my words" }, reason: "Edit", idempotencyKey: w.idem() });
    const orig = drive.elsewhere;
    void orig;
    drive.state.interpose = { id: "d1", text: "their words", by: { name: "Kim/..\\Ito\u0007", email: "kim@firm.test" } };
    await sync(added.mountId);
    await sync(added.mountId);
    const names = [...drive.files.values()].map((x) => x.name);
    assert.ok(names.includes("Plan (Kim..Ito's version).txt"), names.join(" | "));
    assert.ok(names.every((n) => !/[\\/\u0000-\u001f]/.test(n)));
  } finally {
    await w.stop();
  }
});
