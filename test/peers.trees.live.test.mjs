// Live sync, blob deletions and git repositories between two computers of a Personal Space (lane l-multidevice). Two booted daemons and a real relay node:
//   - a write on A shows on B in about a second, with no round on a timer: A's write wakes B (debounced), the 5 s round stays as the fallback;
//   - a blob deleted on A is deleted on B, and B never fetches it again;
//   - an agent's repository travels whole; a branch that moved on one side fast-forwards on the other; a branch that moved on both keeps both, theirs as <branch>@<computer>, never overwritten.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRelay } from "../relay/node/server.js";
import { boot, firstComputer, pause, stageSecond } from "./peers-kit.mjs";

const git = (dir, ...args) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=t@example.com", "-c", "init.defaultBranch=main", ...args], { cwd: dir, encoding: "utf8" }).trim();
const commit = (dir, file, text) => { fs.writeFileSync(path.join(dir, file), text); git(dir, "add", file); git(dir, "commit", "--quiet", "-m", `${file}: ${text}`); return git(dir, "rev-parse", "HEAD"); };
const until = async (ok, ms, what) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ok()) return Date.now(); await pause(50); } assert.fail(what); };
const rounds = async (d, n = 3) => { for (let i = 0; i < n; i++) await d.peers.sync.round(); };

test("a write shows on the other computer in about a second; deletions and git history travel; diverged branches keep both", { timeout: 60_000 }, async () => {
  const relay = createRelay();
  const base = await relay.listen();
  let A = null, B = null;
  try {
    const first = await firstComputer(base);
    A = first.A;
    const dirA = first.dirA;
    const { dirB } = await stageSecond(A, dirA);
    B = await boot(dirB, ["--space", "spc_staged", "--relay", base, "--peer-name", "Home laptop"]);
    await B.peers.tick();
    await A.peers.tick();
    await rounds(B, 1);
    await rounds(A, 1);

    // live: no round runs on a timer here (the kit sets it to an hour); the write wakes the other computer
    const t0 = Date.now();
    A.db.run("INSERT INTO chat_thread (id, kind, title, createdAt) VALUES ('thr_live', 'private', 'Live from the office', 1)");
    const t1 = await until(() => B.db.all("SELECT 1 FROM chat_thread WHERE id = 'thr_live'").length === 1, 5_000, "the write reached B");
    assert.ok(t1 - t0 < 2_500, `it took ${t1 - t0} ms`);
    B.db.run("UPDATE chat_thread SET title = 'Edited on the laptop' WHERE id = 'thr_live'");
    await until(() => A.db.all("SELECT title FROM chat_thread WHERE id = 'thr_live'")[0]?.title === "Edited on the laptop", 5_000, "and back the other way");

    // a blob deleted on A is deleted on B, and stays deleted
    const rel = path.join("ctx", "blb_gone0001");
    fs.mkdirSync(path.join(dirA, "blobs", "ctx"), { recursive: true });
    fs.writeFileSync(path.join(dirA, "blobs", rel), "sealed contents");
    await rounds(A, 1);
    for (let i = 0; i < 7 && !fs.existsSync(path.join(dirB, "blobs", rel)); i++) await B.peers.sync.round();
    assert.ok(fs.existsSync(path.join(dirB, "blobs", rel)), "the blob reached B");
    await rounds(B, 1);
    fs.rmSync(path.join(dirA, "blobs", rel));
    await rounds(A, 1);
    assert.equal(A.db.all("SELECT count(*) AS n FROM network_peer_blob_gone WHERE path = ?", rel.split(path.sep).join("/"))[0].n, 1, "A wrote the tombstone");
    await rounds(B, 2);
    assert.equal(fs.existsSync(path.join(dirB, "blobs", rel)), false, "B deleted its copy");
    await rounds(B, 7);
    assert.equal(fs.existsSync(path.join(dirB, "blobs", rel)), false, "and never fetches it again");

    // an agent's repository: made on A, it arrives whole on B
    const repoA = path.join(dirA, "trees", "fld_repo1");
    fs.mkdirSync(repoA, { recursive: true });
    git(repoA, "init", "--quiet");
    const c1 = commit(repoA, "README.md", "one");
    git(repoA, "branch", "feature");
    await rounds(B, 3);
    const repoB = path.join(dirB, "trees", "fld_repo1");
    assert.equal(git(repoB, "rev-parse", "main"), c1, "main arrived");
    assert.equal(git(repoB, "rev-parse", "feature"), c1, "and every branch");
    assert.equal(fs.readFileSync(path.join(repoB, "README.md"), "utf8"), "one", "checked out");

    // moved on one side: a fast-forward on the other
    const c2 = commit(repoB, "README.md", "two");
    await rounds(A, 3);
    assert.equal(git(repoA, "rev-parse", "main"), c2, "A's main fast-forwarded");

    // moved on both: each keeps its own, and the other's sits beside it, never over it
    const onA = commit(repoA, "a.txt", "office");
    const onB = commit(repoB, "b.txt", "laptop");
    await rounds(A, 3);
    await rounds(B, 3);
    assert.equal(git(repoA, "rev-parse", "main"), onA, "A's main is A's");
    assert.equal(git(repoA, "rev-parse", "main@Home-laptop"), onB, "B's is beside it on A");
    assert.equal(git(repoB, "rev-parse", "main"), onB, "B's main is B's");
    assert.equal(git(repoB, "rev-parse", "main@Office-iMac"), onA, "A's is beside it on B");
    assert.equal(git(repoA, "branch", "--list", "*@*@*"), "", "a branch kept beside does not travel on");
  } finally {
    await B?.stop();
    await A?.stop();
    await relay.close();
  }
});
