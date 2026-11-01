// The crew's copy of a repository (modules/engine/crew-git.ts) against real git in temp folders: a clone on its own branch, work committed in it, a summary, and the branch landed back.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GitError, branchFacts, cleanBranch, commitLeftovers, git, landBranch, prepareClone, pushBase, repoHead, summarize } from "../crew-git.ts";

const tmp = (): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-crew-git-")));
const ID = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

async function repo(): Promise<string> {
  const dir = tmp();
  await git(["init", "--quiet", "-b", "main"], dir);
  fs.writeFileSync(path.join(dir, "README.md"), "hello\n");
  await git(["add", "-A"], dir, ID);
  assert.equal((await git(["commit", "--quiet", "-m", "first"], dir, ID)).code, 0);
  return dir;
}

test("a branch name is plain: no spaces, no climbing, nothing git reads as an option", () => {
  assert.equal(cleanBranch("crew/ember-1"), "crew/ember-1");
  for (const bad of ["", "a b", "-x", "a..b", "a/", "x.lock", "$(id)"]) assert.throws(() => cleanBranch(bad), GitError, bad);
});

test("the repository head is read, and a folder that is not a repository is refused in words", async () => {
  const r = await repo();
  const head = await repoHead(r);
  assert.equal(head.branch, "main");
  assert.match(head.sha, /^[0-9a-f]{40}$/);
  await assert.rejects(repoHead(tmp()), /not a git repository/);
  await assert.rejects(repoHead("relative/path"), /not a folder/);
});

test("the copy is its own repository on its own branch, cut off from the original, and a second open changes nothing", async () => {
  const r = await repo();
  const dest = path.join(tmp(), "work");
  const made = await prepareClone({ repo: r, dest, branch: "crew/ember-1", base: "main", ident: { name: "Ember", email: "ember@vyre.invalid" } });
  assert.equal(made.created, true);
  assert.equal(fs.readFileSync(path.join(dest, "README.md"), "utf8"), "hello\n");
  assert.equal((await git(["rev-parse", "--abbrev-ref", "HEAD"], dest)).out.trim(), "crew/ember-1");
  assert.equal((await git(["remote"], dest)).out.trim(), "", "no remote to push to");
  assert.equal((await git(["config", "user.name"], dest)).out.trim(), "Ember");
  fs.writeFileSync(path.join(dest, "mine.txt"), "work in progress\n");
  assert.equal((await prepareClone({ repo: r, dest, branch: "crew/ember-1", base: "main", ident: { name: "Ember", email: "e@e" } })).created, false);
  assert.equal(fs.readFileSync(path.join(dest, "mine.txt"), "utf8"), "work in progress\n", "the teammate's files are left as they were");
  assert.equal(fs.existsSync(path.join(r, "mine.txt")), false, "nothing reached the original");
});

test("a folder with other files in it is refused, not cloned over", async () => {
  const r = await repo();
  const dest = tmp();
  fs.writeFileSync(path.join(dest, "stray.txt"), "x");
  await assert.rejects(prepareClone({ repo: r, dest, branch: "crew/a", base: "main", ident: { name: "A", email: "a@a" } }), /already holds files/);
});

test("the summary names the commits and files since the start, and leftovers are saved as a commit", async () => {
  const r = await repo();
  const dest = path.join(tmp(), "work");
  await prepareClone({ repo: r, dest, branch: "crew/x", base: "main", ident: { name: "X", email: "x@x" } });
  fs.writeFileSync(path.join(dest, "a.txt"), "1\n2\n");
  assert.equal((await summarize(dest, "main")).dirty, true);
  assert.equal(await commitLeftovers(dest, "add a.txt"), true);
  assert.equal(await commitLeftovers(dest, "nothing"), false);
  const s = await summarize(dest, "main");
  assert.deepEqual([s.branch, s.ahead, s.dirty], ["crew/x", 1, false]);
  assert.deepEqual(s.commits.map((c) => c.subject), ["add a.txt"]);
  assert.deepEqual(s.files, [{ path: "a.txt", added: 2, deleted: 0 }]);
});

test("landing fetches the branch back and merges it when the repository is on the base and clean; otherwise the branch waits", async () => {
  const r = await repo();
  const dest = path.join(tmp(), "work");
  await prepareClone({ repo: r, dest, branch: "crew/x", base: "main", ident: { name: "X", email: "x@x" } });
  fs.writeFileSync(path.join(dest, "a.txt"), "new\n");
  await commitLeftovers(dest, "add a.txt");
  fs.writeFileSync(path.join(r, "dirty.txt"), "uncommitted");
  const held = await landBranch({ repo: r, clone: dest, branch: "crew/x", base: "main" });
  assert.deepEqual([held.landed, held.ref], [false, "crew/x"]);
  assert.match(String(held.note), /uncommitted/);
  assert.equal(fs.existsSync(path.join(r, "a.txt")), false);
  fs.rmSync(path.join(r, "dirty.txt"));
  const done = await landBranch({ repo: r, clone: dest, branch: "crew/x", base: "main" });
  assert.equal(done.landed, true);
  assert.equal(fs.readFileSync(path.join(r, "a.txt"), "utf8"), "new\n");
});

test("a branch that conflicts with the base is undone, not left half merged", async () => {
  const r = await repo();
  const dest = path.join(tmp(), "work");
  await prepareClone({ repo: r, dest, branch: "crew/x", base: "main", ident: { name: "X", email: "x@x" } });
  fs.writeFileSync(path.join(dest, "README.md"), "theirs\n");
  await commitLeftovers(dest, "edit readme");
  fs.writeFileSync(path.join(r, "README.md"), "ours\n");
  await git(["commit", "--quiet", "-am", "edit readme on main"], r, ID);
  const out = await landBranch({ repo: r, clone: dest, branch: "crew/x", base: "main" });
  assert.equal(out.landed, false);
  assert.match(String(out.note), /does not merge cleanly/);
  assert.equal(fs.readFileSync(path.join(r, "README.md"), "utf8"), "ours\n");
  assert.equal((await git(["status", "--porcelain"], r)).out.trim(), "", "the repository is clean again");
});

test("pushing sends the base branch to the origin from the host, and a repository with no origin says so", async () => {
  const r = await repo();
  const none = await pushBase({ repo: r, base: "main" });
  assert.deepEqual([none.pushed, /no remote/.test(String(none.note))], [false, true]);
  const bare = tmp();
  await git(["init", "--quiet", "--bare", "-b", "main"], bare);
  await git(["remote", "add", "origin", bare], r);
  const sent = await pushBase({ repo: r, base: "main" });
  assert.equal(sent.pushed, true);
  assert.match((await git(["log", "--oneline", "main"], bare)).out, /first/);
  const refused = await pushBase({ repo: r, base: "nope" });
  assert.equal(refused.pushed, false);
});

test("the repository says whether a branch is merged and pushed, however it got there: the button, a person in a terminal, or a push", async () => {
  const r = await repo();
  const dest = path.join(tmp(), "work");
  await prepareClone({ repo: r, dest, branch: "crew/ember-1", base: "main", ident: { name: "Ember", email: "ember@vyre.invalid" } });
  const o = { repo: r, clone: dest, branch: "crew/ember-1", base: "main" };
  assert.deepEqual(await branchFacts(o), { ahead: 0, merged: false, pushed: false }, "no work yet is not merged");
  fs.writeFileSync(path.join(dest, "a.txt"), "a\n");
  await commitLeftovers(dest, "add a");
  assert.deepEqual(await branchFacts(o), { ahead: 1, merged: false, pushed: false }, "committed, not in the base");
  // a person merges it in a terminal, with no Merge button involved
  await git(["fetch", "--quiet", dest, "+crew/ember-1:refs/heads/crew/ember-1"], r);
  assert.equal((await git(["merge", "--no-ff", "--no-edit", "crew/ember-1"], r, ID)).code, 0);
  assert.deepEqual(await branchFacts(o), { ahead: 1, merged: true, pushed: false }, "merged by hand reads as merged");
  // a remote that has the base reads as pushed
  const remote = tmp();
  await git(["init", "--bare", "--quiet", "-b", "main"], remote);
  await git(["remote", "add", "origin", remote], r);
  assert.equal((await pushBase({ repo: r, base: "main" })).pushed, true);
  assert.deepEqual(await branchFacts(o), { ahead: 1, merged: true, pushed: true });
  assert.equal(await branchFacts({ ...o, clone: path.join(tmp(), "gone") }), null, "a copy that is gone says nothing");
});
