// Rewind, files half: a checkpoint per turn in a shadow repository outside the folder; going back restores edited and deleted files, removes files made since, and can itself be gone back from.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkpointTurn, erase, points, prune, pruneSpace, restore, snapshot, storeOf } from "../checkpoints.ts";
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

test("node_modules, logs and secret files (.env, keys) are not kept; the store cannot live inside the folder; a made-up checkpoint is refused", async () => {
  const w = world();
  try {
    put(w.workDir, "keep.txt", "k");
    put(w.workDir, "node_modules/x/index.js", "big");
    put(w.workDir, "run.log", "noise");
    put(w.workDir, ".env", "TOKEN=abc");
    put(w.workDir, "keys/server.pem", "-----BEGIN");
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
      waitMs: 5000,
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

test("retention: older than the count or the age are dropped, the space is freed, the newest is always kept, and a pruned point is not here any more", async () => {
  const w = world();
  try {
    put(w.workDir, "a.txt", "1");
    const made = [];
    for (let i = 0; i < 6; i++) {
      put(w.workDir, "a.txt", `v${i}`);
      made.push(await snapshot({ ...w, label: `turn ${i}`, now: 1_000_000 + i * 1000 }));
    }
    const dropped = await prune({ ...w, now: 1_010_000, keep: 4 });
    assert.equal(dropped, 2);
    const left = await points(w);
    assert.deepEqual(
      left.map((p) => p.label),
      ["turn 5", "turn 4", "turn 3", "turn 2"],
    );
    await assert.rejects(restore({ ...w, sha: made[0]!.sha, now: 2_000_000 }), /not here any more/);
    // by age: everything is older than the limit, but the newest stays
    assert.equal(await prune({ ...w, now: 9_000_000_000, maxAgeMs: 1000 }), 3);
    assert.equal((await points(w)).length, 1);
    // over the store's cap: the oldest go, the newest stays
    put(w.workDir, "b.txt", "x".repeat(50_000));
    await snapshot({ ...w, label: "turn 6", now: 9_000_001_000 });
    await snapshot({ ...w, label: "turn 7", now: 9_000_002_000 });
    await prune({ ...w, now: 9_000_002_500, cap: 1 });
    assert.deepEqual(
      (await points(w)).map((p) => p.label),
      ["turn 7"],
    );
  } finally {
    fs.rmSync(w.root, { recursive: true, force: true });
  }
});

test("a turn waits only a moment for its point: a slow one finishes in the background; a store that cannot be written never stops the turn", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "ckpt-bg-"));
  try {
    const dir = workFolder(data, "usr_dana", "thr_bg", "agt_dex");
    fs.writeFileSync(path.join(dir, "f.txt"), "x");
    const t0 = Date.now();
    const r = await checkpointTurn({
      dataDir: data,
      person: "usr_dana",
      thread: "thr_bg",
      agent: "agt_dex",
      turnId: "trn_1",
      now: 1,
      waitMs: 0,
    });
    assert.equal(r.point, null);
    assert.equal(r.background, true);
    assert.ok(Date.now() - t0 < 100, "the turn did not wait");
    const store = storeOf(data, dir);
    for (let i = 0; i < 100 && (await points({ gitDir: store, workDir: dir })).length === 0; i++)
      await new Promise((res) => setTimeout(res, 30));
    assert.equal((await points({ gitDir: store, workDir: dir })).length, 1, "the point was saved in the background");
    // the checkpoints folder cannot be written: reported, not thrown
    fs.rmSync(path.join(data, "checkpoints"), { recursive: true, force: true });
    fs.writeFileSync(path.join(data, "checkpoints"), "a file where the folder should be");
    const bad = await checkpointTurn({
      dataDir: data,
      person: "usr_dana",
      thread: "thr_bg",
      agent: "agt_dex",
      turnId: "trn_2",
      now: 2,
    });
    assert.equal(bad.point, null);
    assert.ok(bad.why, "the reason is kept");
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test("a Space over its cap loses the store touched longest ago; erasing a thread, an agent or a person removes their points", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "ckpt-space-"));
  try {
    const take = async (person: string, thread: string, agent: string, now: number) => {
      const dir = workFolder(data, person, thread, agent);
      fs.writeFileSync(path.join(dir, "f.txt"), "x".repeat(20_000));
      await checkpointTurn({ dataDir: data, person, thread, agent, turnId: `t${now}`, now, waitMs: 5000 });
      return storeOf(data, dir);
    };
    const a = await take("usr_dana", "thr_1", "agt_dex", 1);
    await new Promise((r) => setTimeout(r, 20));
    const b = await take("usr_dana", "thr_2", "agt_dex", 2);
    const c = await take("usr_maya", "thr_1", "agt_nova", 3);
    assert.ok([a, b, c].every((s) => fs.existsSync(s)));
    assert.equal(pruneSpace(data, 1), 3, "over the cap: stores go, oldest first");
    for (const s of [a, b, c]) assert.equal(fs.existsSync(s), false);
    const a2 = await take("usr_dana", "thr_1", "agt_dex", 4);
    const b2 = await take("usr_dana", "thr_2", "agt_dex", 5);
    const c2 = await take("usr_maya", "thr_1", "agt_nova", 6);
    erase(data, { threadId: "thr_1" });
    assert.deepEqual(
      [a2, b2, c2].map((s) => fs.existsSync(s)),
      [false, true, false],
      "a thread's points go for every person",
    );
    const a3 = await take("usr_dana", "thr_3", "agt_dex", 7);
    erase(data, { agentId: "agt_dex" });
    assert.deepEqual(
      [a3, b2].map((s) => fs.existsSync(s)),
      [false, false],
      "an agent's points go in every chat",
    );
    const c3 = await take("usr_maya", "thr_9", "agt_nova", 8);
    const d3 = await take("usr_dana", "thr_9", "agt_nova", 9);
    erase(data, { personId: "usr_maya" });
    assert.deepEqual(
      [c3, d3].map((s) => fs.existsSync(s)),
      [false, true],
      "a person's points go with the person",
    );
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

// The reviewer's setup (r-agents, d3e48dcf4): the agent controls its work folder, so a symlink in it can point anywhere the server may write. Going back must never touch a path through one.
test("a point where d is a symlink to an outside folder, and a later point where d is a real folder: going back never removes the outside file", async () => {
  const w = world();
  const outside = path.join(w.root, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "precious.txt"), "keep me");
  try {
    fs.symlinkSync(outside, path.join(w.workDir, "d"));
    put(w.workDir, "a.txt", "1");
    const p = await snapshot({ ...w, label: "turn p", now: 1_000_000 });
    fs.rmSync(path.join(w.workDir, "d")); // the link itself
    fs.mkdirSync(path.join(w.workDir, "d"));
    fs.writeFileSync(path.join(w.workDir, "d", "precious.txt"), "the agent's own");
    await snapshot({ ...w, label: "turn q", now: 2_000_000 });
    await restore({ ...w, sha: p.sha, now: 3_000_000 });
    assert.equal(fs.readFileSync(path.join(outside, "precious.txt"), "utf8"), "keep me", "the outside file survived");
    assert.ok(fs.lstatSync(path.join(w.workDir, "d")).isSymbolicLink(), "d is the link it was at the point");
  } finally {
    fs.rmSync(w.root, { recursive: true, force: true });
  }
});

test("a symlink swapped in after the point: putting a file back never writes or removes through it", async () => {
  const w = world();
  const outside = path.join(w.root, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "a.txt"), "outside a");
  fs.writeFileSync(path.join(outside, "b.txt"), "outside b");
  try {
    put(w.workDir, "d/a.txt", "inside a");
    put(w.workDir, "d/b.txt", "inside b");
    const p = await snapshot({ ...w, label: "turn p", now: 1_000_000 });
    fs.rmSync(path.join(w.workDir, "d"), { recursive: true });
    fs.symlinkSync(outside, path.join(w.workDir, "d")); // the agent swaps the folder for a link to somewhere else
    await restore({ ...w, sha: p.sha, now: 2_000_000 });
    assert.equal(fs.readFileSync(path.join(outside, "a.txt"), "utf8"), "outside a", "not overwritten through the link");
    assert.equal(fs.readFileSync(path.join(outside, "b.txt"), "utf8"), "outside b");
    assert.equal(fs.lstatSync(path.join(w.workDir, "d")).isDirectory(), true, "the link was replaced by the folder");
    assert.equal(fs.readFileSync(path.join(w.workDir, "d", "a.txt"), "utf8"), "inside a");
  } finally {
    fs.rmSync(w.root, { recursive: true, force: true });
  }
});

test("a folder that holds a link to an outside folder is removed as a link, never followed; modes and binary files come back", async () => {
  const w = world();
  const outside = path.join(w.root, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "x.txt"), "x");
  try {
    put(w.workDir, "a.txt", "1");
    fs.writeFileSync(path.join(w.workDir, "bin.dat"), Buffer.from([0, 255, 254, 1, 2, 0]));
    fs.writeFileSync(path.join(w.workDir, "run.sh"), "#!/bin/sh\n", { mode: 0o755 });
    const p = await snapshot({ ...w, label: "turn p", now: 1_000_000 });
    fs.mkdirSync(path.join(w.workDir, "made"));
    fs.symlinkSync(outside, path.join(w.workDir, "made", "link"));
    fs.writeFileSync(path.join(w.workDir, "bin.dat"), "changed");
    fs.rmSync(path.join(w.workDir, "run.sh"));
    await restore({ ...w, sha: p.sha, now: 2_000_000 });
    assert.equal(fs.readFileSync(path.join(outside, "x.txt"), "utf8"), "x", "the outside folder is untouched");
    assert.equal(fs.existsSync(path.join(w.workDir, "made", "link")), false, "the link is gone");
    assert.deepEqual(
      [...fs.readFileSync(path.join(w.workDir, "bin.dat"))],
      [0, 255, 254, 1, 2, 0],
      "binary content is exact",
    );
    assert.equal(fs.statSync(path.join(w.workDir, "run.sh")).mode & 0o111, 0o111, "the executable bit is back");
  } finally {
    fs.rmSync(w.root, { recursive: true, force: true });
  }
});

test("a folder too big to keep is skipped in the background with the reason, and never delays or fails the turn", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "ckpt-big-"));
  try {
    const dir = workFolder(data, "usr_dana", "thr_big", "agt_dex");
    for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(dir, `f${i}.txt`), "x");
    const t0 = Date.now();
    const r = await checkpointTurn({
      dataDir: data,
      person: "usr_dana",
      thread: "thr_big",
      agent: "agt_dex",
      turnId: "trn_1",
      now: 1,
      waitMs: 5000,
      maxFiles: 10,
    });
    assert.equal(r.point, null);
    assert.match(r.why ?? "", /too many files/);
    assert.ok(Date.now() - t0 < 2000);
    assert.equal((await points({ gitDir: storeOf(data, dir), workDir: dir })).length, 0, "nothing was saved");
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});
