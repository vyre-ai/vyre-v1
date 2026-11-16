// A connected Google Drive folder when the daemon stops in the middle of a write or with an edit waiting: after the restart nothing is lost and nothing is doubled.
import test from "node:test";
import assert from "node:assert/strict";
import { MEMBER, bootWorld } from "../fixtures/suite/world.ts";
import { bootDriveWorld } from "./mounts.drive.live.test.ts";
import { crashMidWrite, find } from "./support/crash-mid-write.ts";
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
    await w.ok(MEMBER, "files.write", {
      fileId: f.fileId,
      content: { text: "my words" },
      reason: "Edit",
      idempotencyKey: w.idem(),
    });
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
    assert.equal(
      drive.text("d1"),
      "my words",
      `the edit is sent after the boot, without anyone pressing anything ${JSON.stringify(w2.logsLike(/schedule|mounts/i).slice(-6))}`,
    );
  } finally {
    await (w2 ?? w).stop();
  }
});
