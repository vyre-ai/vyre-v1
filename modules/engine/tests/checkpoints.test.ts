// Rewind, files half: a checkpoint per turn in a shadow repository outside the folder; going back restores edited and deleted files, removes files made since, and can itself be gone back from.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkpointTurn, points, restore, snapshot, storeOf } from "../checkpoints.ts";
import { workFolder } from "../sandbox.ts";

function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ckpt-"));
  const workDir = path.join(root, "work");
  fs.mkdirSync(workDir);
  return { root, workDir, gitDir: path.join(root, "store.git") };
}
const put = (w: string, f: string, c: string): void => {
  fs.mkdirSync(path.dirname(path.join(w, f)), { recursive: true });
  fs.writeFileSync(path.join(w, f), c);
};
const read = (w: string, f: string): string | null =>
  fs.existsSync(path.join(w, f)) ? fs.readFileSync(path.join(w, f), "utf8") : null;

test("a point per turn; going back restores an edit and a deleted file and removes a file made since", async () => {
  const w = world();
  try {
    put(w.workDir, "a.txt", "one");
    put(w.workDir, "dir/b.txt", "bee");
    const p1 = await snapshot({ ...w, label: "turn 1", now: 1_000_000 });
    assert.equal(p1.files, 2);
    put(w.workDir, "a.txt", "two");
    fs.rmSync(path.join(w.workDir, "dir/b.txt"));
    put(w.workDir, "c.txt", "new");
    const p2 = await snapshot({ ...w, label: "turn 2", now: 2_000_000 });
    assert.notEqual(p1.sha, p2.sha);
    const r = await restore({ ...w, sha: p1.sha, now: 3_000_000 });
    assert.equal(read(w.workDir, "a.txt"), "one");
    assert.equal(read(w.workDir, "dir/b.txt"), "bee");
    assert.equal(read(w.workDir, "c.txt"), null, "a file made after the point is removed");
    assert.deepEqual([r.restored, r.removed], [2, 1]);
    // the rewind is undone by going back to the point it took first
    await restore({ ...w, sha: r.undoPoint.sha, now: 4_000_000 });
    assert.equal(read(w.workDir, "a.txt"), "two");
    assert.equal(read(w.workDir, "c.txt"), "new");
    assert.equal(read(w.workDir, "dir/b.txt"), null);
    const list = await points(w);
    assert.equal(list[0]!.label, "Before going back");
    assert.ok(list.some((p) => p.label === "turn 1" && p.files === 2));
  } finally {
    fs.rmSync(w.root, { recursive: true, force: true });
  }
});

test("node_modules and logs are not kept; the store cannot live inside the folder; a made-up checkpoint is refused", async () => {
  const w = world();
  try {
    put(w.workDir, "keep.txt", "k");
    put(w.workDir, "node_modules/x/index.js", "big");
    put(w.workDir, "run.log", "noise");
    const p = await snapshot({ ...w, label: "t", now: 1_000 });
    assert.equal(p.files, 1);
    await assert.rejects(
      snapshot({ gitDir: path.join(w.workDir, "store"), workDir: w.workDir, label: "t", now: 1 }),
      /inside the folder/,
    );
    await assert.rejects(restore({ ...w, sha: "0".repeat(40), now: 2 }), /not here/);
    await assert.rejects(restore({ ...w, sha: "--force", now: 2 }), /not a checkpoint/);
    assert.equal(read(w.workDir, "node_modules/x/index.js"), "big", "left alone");
  } finally {
    fs.rmSync(w.root, { recursive: true, force: true });
  }
});

test("a turn's checkpoint lives beside the work folders, never inside one, and is labelled with the turn", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "ckpt-data-"));
  try {
    const dir = workFolder(data, "usr_dana", "thr_one", "agt_dex");
    fs.writeFileSync(path.join(dir, "notes.txt"), "hello");
    const store = storeOf(data, dir);
    assert.ok(path.relative(dir, store).startsWith(".."), "the store is outside the work folder");
    assert.ok(store.startsWith(path.join(fs.realpathSync(data), "checkpoints")));
    const r = await checkpointTurn({
      dataDir: data,
      person: "usr_dana",
      thread: "thr_one",
      agent: "agt_dex",
      turnId: "trn_1",
      now: 5_000,
    });
    assert.equal(r.point?.label, "turn trn_1");
    assert.equal(r.point?.files >= 1, true);
    assert.equal((await points({ gitDir: store, workDir: dir })).length, 1);
    // a data folder that is really a file cannot hold a work folder: reported, not thrown, so the turn goes on
    const notADir = path.join(data, "plain-file");
    fs.writeFileSync(notADir, "x");
    const none = await checkpointTurn({
      dataDir: notADir,
      person: "p",
      thread: "t",
      agent: "a",
      turnId: "x",
      now: 1,
    });
    assert.equal(none.point, null);
    assert.ok(none.why);
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});
