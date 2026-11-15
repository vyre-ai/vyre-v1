// A connected Google Drive folder when the daemon stops in the middle of a write or with an edit waiting: after the restart nothing is lost and nothing is doubled.
import test from "node:test";
import assert from "node:assert/strict";
import { MEMBER } from "../fixtures/suite/world.ts";
import { crashMidWrite, find } from "./support/crash-mid-write.ts";
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
