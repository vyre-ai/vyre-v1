// @reads /modules/git/handlers/ops.ts
// @reads /modules/git/migrations/0001_git_core.sql
// @reads /manifests/git.ts
// git operations against a real git binary in temp directories: init, status, commit, log, show, diff, branches, remotes, pull, push, sync, protection and the credential path.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import manifest from "../../../manifests/git.ts";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { handlers } from "../impl.ts";
import { isProtectedCall } from "../handlers/ops.ts";
import { MIGRATION, TOKEN, world } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

const A = "fld_alpha";
const B = "fld_beta";
const REMOTE = "https://example.test/acme/site.git";
const GH = "https://github.com/acme/site.git";

async function expectCode(code: string, run: () => Promise<unknown>): Promise<VyreErr> {
  try {
    await run();
  } catch (e) {
    assert.ok(e instanceof VyreErr, e instanceof Error ? e.stack : "throw");
    assert.equal(e.error.code, code, e.error.message);
    return e;
  }
  assert.fail(`expected ${code}`);
}

async function with_(run: (w: World) => Promise<void>): Promise<void> {
  const w = world();
  try {
    await run(w);
  } finally {
    w.cleanup();
  }
}

type Out = Record<string, unknown>;
const call = (w: World, cap: keyof typeof handlers, input: Record<string, unknown>): Promise<Out> => (handlers[cap] as (c: typeof w.ctx, i: unknown) => Promise<Out>)(w.ctx, input);

async function started(w: World, folderId = A): Promise<void> {
  await call(w, "git.init", { folderId });
}

async function committed(w: World, folderId = A, file = "a.txt", text = "one\ntwo\nthree\n", message = "first"): Promise<string> {
  w.write(folderId, file, text);
  return (await call(w, "git.commit", { folderId, message })).sha as string;
}

test("migration: git_protection is the only table, and the module has no other state", () => {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  assert.deepEqual([...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]), ["git_protection"]);
});

test("health: git runs and reports its version", () => with_(async (w) => {
  const h = await call(w, "git.health", {});
  assert.equal(h["state"], "healthy");
  assert.match(String(h["version"]), /^\d+\.\d+/);
  assert.equal(typeof h["latencyMs"], "number");
  w.failNext("--version", { code: 127, stdout: "", stderr: "git: not found" });
  const down = await call(w, "git.health", {});
  assert.equal(down["state"], "down");
  w.failNext("--version", { code: 0, stdout: "git version 2.17.1\n", stderr: "" });
  assert.equal((await call(w, "git.health", {}))["state"], "degraded");
}));

test("init: a folder becomes a repository on the branch asked for, once; other folders are not repositories", () => with_(async (w) => {
  const before = await call(w, "git.status", { folderId: A });
  assert.deepEqual([before["isRepo"], before["clean"], before["changes"], before["remotes"], before["protected"]], [false, true, [], [], false]);
  const r = await call(w, "git.init", { folderId: A, branch: "trunk" });
  assert.deepEqual(r, { branch: "trunk" });
  assert.ok(fs.existsSync(path.join(w.tree(A), ".git")));
  assert.deepEqual(w.eventsNamed("git.initialized"), [{ folderId: A, branch: "trunk" }]);
  assert.deepEqual(await call(w, "git.init", { folderId: A }), { branch: "trunk" });
  assert.equal(w.eventsNamed("git.initialized").length, 1, "starting history again changes nothing");
  await expectCode("validation.bad_input", () => call(w, "git.init", { folderId: B, branch: "-bad" }));
  await expectCode("validation.bad_input", () => call(w, "git.init", { folderId: B, branch: "has space" }));
  await expectCode("validation.bad_input", () => call(w, "git.init", { folderId: "../escape" }));
  await expectCode("validation.precondition_failed", () => call(w, "git.commit", { folderId: B, message: "x" }));
}));

test("status, commit and log: counts, authorship by kind, paths, paging", () => with_(async (w) => {
  await started(w);
  w.write(A, "a.txt", "one\ntwo\nthree\n");
  w.write(A, "docs/b.md", "# B\n");
  let s = await call(w, "git.status", { folderId: A });
  assert.deepEqual([s["isRepo"], s["branch"], s["clean"], s["ahead"], s["behind"]], [true, "main", false, 0, 0]);
  const byPath = new Map((s["changes"] as { path: string; status: string; added: number; removed: number; staged: boolean }[]).map((c) => [c.path, c]));
  assert.deepEqual(byPath.get("a.txt"), { path: "a.txt", status: "untracked", added: 3, removed: 0, staged: false });
  assert.deepEqual(byPath.get("docs/b.md"), { path: "docs/b.md", status: "untracked", added: 1, removed: 0, staged: false });
  assert.equal(s["head"], undefined, "no commit yet");

  await expectCode("validation.precondition_failed", () => call(w, "git.commit", { folderId: A, message: "none", paths: [] }));
  const first = await call(w, "git.commit", { folderId: A, message: "first\n\nbody line" });
  assert.match(String(first["sha"]), /^[0-9a-f]{40}$/);
  assert.equal(first["files"], 2);
  const committedEvent = w.eventsNamed("git.committed")[0] as Record<string, unknown>;
  assert.deepEqual([committedEvent["folderId"], committedEvent["sha"], committedEvent["branch"], committedEvent["by"], committedEvent["files"], committedEvent["message"]], [A, first["sha"], "main", "usr_maya", 2, "first\n\nbody line"]);
  s = await call(w, "git.status", { folderId: A });
  assert.deepEqual([s["clean"], s["head"], s["protected"]], [true, first["sha"], true]);
  await expectCode("validation.precondition_failed", () => call(w, "git.commit", { folderId: A, message: "again" }));

  // an agent edits one file and commits only that path; the other change stays in the working copy
  w.write(A, "a.txt", "one\nTWO\nthree\nfour\n");
  w.write(A, "docs/b.md", "# B changed\n");
  s = await call(w, "git.status", { folderId: A });
  const edited = new Map((s["changes"] as { path: string; status: string; added: number; removed: number }[]).map((c) => [c.path, c]));
  assert.deepEqual([edited.get("a.txt")?.status, edited.get("a.txt")?.added, edited.get("a.txt")?.removed], ["modified", 2, 1]);
  const agent = w.as({ kind: "agent", id: "agt_scout" });
  const second = await (handlers["git.commit"] as (c: typeof agent, i: unknown) => Promise<Out>)(agent, { folderId: A, message: "tweak a", paths: ["a.txt"] });
  assert.equal(second["files"], 1);
  s = await call(w, "git.status", { folderId: A });
  assert.deepEqual((s["changes"] as { path: string }[]).map((c) => c.path), ["docs/b.md"]);

  // a person can name the author of a commit for someone else
  const third = await call(w, "git.commit", { folderId: A, message: "tweak b", author: { name: "Dana", kind: "actor", id: "act_dana" } });
  const log = await call(w, "git.log", { folderId: A });
  const commits = log["commits"] as { sha: string; message: string; author: { name: string; kind: string; id?: string }; files: number; parents: string[]; at: number }[];
  assert.deepEqual(commits.map((c) => c.message), ["tweak b", "tweak a", "first\n\nbody line"]);
  assert.deepEqual(commits.map((c) => c.author), [
    { name: "Dana", kind: "actor", id: "act_dana" },
    { name: "agt_scout", kind: "agent", id: "agt_scout" },
    { name: "usr_maya", kind: "person", id: "usr_maya" },
  ]);
  assert.deepEqual(commits.map((c) => c.files), [1, 1, 2]);
  assert.deepEqual(commits[0]?.parents, [second["sha"]]);
  assert.deepEqual(commits[2]?.parents, []);
  assert.equal(commits[0]?.sha, third["sha"]);
  assert.ok((commits[0]?.at ?? 0) > 1_700_000_000_000);
  assert.equal(log["next"], undefined);

  const paged = await call(w, "git.log", { folderId: A, limit: 2 });
  assert.equal((paged["commits"] as unknown[]).length, 2);
  assert.equal(paged["next"], commits[1]?.sha);
  const rest = await call(w, "git.log", { folderId: A, limit: 2, before: paged["next"] });
  assert.deepEqual((rest["commits"] as { message: string }[]).map((c) => c.message), ["first\n\nbody line"]);
  const forFile = await call(w, "git.log", { folderId: A, path: "docs/b.md" });
  assert.deepEqual((forFile["commits"] as { message: string }[]).map((c) => c.message), ["tweak b", "first\n\nbody line"]);
  await expectCode("validation.bad_input", () => call(w, "git.log", { folderId: A, path: "../x" }));
  await expectCode("validation.bad_input", () => call(w, "git.log", { folderId: A, before: "nothex" }));
  await expectCode("validation.precondition_failed", () => call(w, "git.log", { folderId: B }));
}));

test("show and diff: files with counts and hunks with line numbers", () => with_(async (w) => {
  await started(w);
  const first = await committed(w);
  w.write(A, "a.txt", "one\nTWO\nthree\nfour\n");
  w.write(A, "old.txt", "keep\nme\n");
  const second = (await call(w, "git.commit", { folderId: A, message: "edit and add" }))["sha"] as string;

  const shown = await call(w, "git.show", { folderId: A, sha: second, path: "a.txt" });
  assert.equal((shown["commit"] as { sha: string }).sha, second);
  assert.deepEqual((shown["files"] as { path: string; status: string; added: number; removed: number }[]).map((f) => [f.path, f.status, f.added, f.removed]), [["a.txt", "modified", 2, 1], ["old.txt", "added", 2, 0]]);
  const hunks = shown["hunks"] as { hunkId: string; oldStart: number; oldLines: number; newStart: number; newLines: number; lines: { op: string; text: string }[] }[];
  assert.equal(hunks.length, 1);
  assert.deepEqual([hunks[0]?.hunkId, hunks[0]?.oldStart, hunks[0]?.newStart], ["h1", 1, 1]);
  assert.deepEqual(hunks[0]?.lines.filter((l) => l.op !== "ctx"), [{ op: "del", text: "two" }, { op: "add", text: "TWO" }, { op: "add", text: "four" }]);
  const rootShown = await call(w, "git.show", { folderId: A, sha: first });
  assert.deepEqual((rootShown["files"] as { path: string; status: string }[]).map((f) => [f.path, f.status]), [["a.txt", "added"]]);
  assert.deepEqual(rootShown["hunks"], [], "no path, no hunks");
  await expectCode("validation.precondition_failed", () => call(w, "git.show", { folderId: A, sha: "0123456" }));

  // working copy against HEAD
  w.write(A, "a.txt", "ONE\nTWO\nthree\nfour\n");
  fs.rmSync(path.join(w.tree(A), "old.txt"));
  const d = await call(w, "git.diff", { folderId: A });
  assert.deepEqual((d["files"] as { path: string; status: string; added: number; removed: number; staged: boolean }[]).map((f) => [f.path, f.status, f.added, f.removed, f.staged]), [["a.txt", "modified", 1, 1, false], ["old.txt", "deleted", 0, 2, false]]);
  assert.equal((d["hunks"] as unknown[]).length, 2);
  const one = await call(w, "git.diff", { folderId: A, path: "a.txt" });
  assert.deepEqual((one["files"] as { path: string }[]).map((f) => f.path), ["a.txt"]);
  // between two commits
  const between = await call(w, "git.diff", { folderId: A, from: first, to: second });
  assert.deepEqual((between["files"] as { path: string; status: string }[]).map((f) => [f.path, f.status]), [["a.txt", "modified"], ["old.txt", "added"]]);
  await expectCode("validation.bad_input", () => call(w, "git.diff", { folderId: A, from: "--output=/tmp/x" }));
}));

test("branches: create, duplicate, switch, list with the protected flag, delete; protected and current branches stay", () => with_(async (w) => {
  await started(w);
  await expectCode("validation.precondition_failed", () => call(w, "git.branch", { folderId: A, action: "create", name: "feature" }));
  const base = await committed(w);
  assert.deepEqual(await call(w, "git.branch", { folderId: A, action: "create", name: "feature/one" }), { branch: "feature/one" });
  await expectCode("validation.duplicate", () => call(w, "git.branch", { folderId: A, action: "create", name: "feature/one" }));
  await expectCode("validation.bad_input", () => call(w, "git.branch", { folderId: A, action: "create", name: "bad..name" }));
  await expectCode("validation.bad_input", () => call(w, "git.branch", { folderId: A, action: "create", name: "ok", from: "--exec=x" }));
  await call(w, "git.branch", { folderId: A, action: "switch", name: "feature/one" });
  const listed = await call(w, "git.list_branches", { folderId: A });
  assert.equal(listed["current"], "feature/one");
  assert.deepEqual((listed["branches"] as { name: string; remote: boolean; sha: string; protected: boolean }[]).map((b) => [b.name, b.remote, b.sha === base, b.protected]), [["feature/one", false, true, false], ["main", false, true, true]]);
  assert.equal((await call(w, "git.status", { folderId: A }))["branch"], "feature/one");
  await expectCode("validation.precondition_failed", () => call(w, "git.branch", { folderId: A, action: "delete", name: "feature/one" }));
  await expectCode("validation.precondition_failed", () => call(w, "git.branch", { folderId: A, action: "delete", name: "main" }));
  await expectCode("validation.precondition_failed", () => call(w, "git.branch", { folderId: A, action: "switch", name: "nope" }));
  await call(w, "git.branch", { folderId: A, action: "switch", name: "main" });
  await call(w, "git.branch", { folderId: A, action: "delete", name: "feature/one" });
  assert.deepEqual(w.eventsNamed("git.branch_changed"), [
    { folderId: A, branch: "feature/one", action: "create" },
    { folderId: A, branch: "feature/one", action: "switch" },
    { folderId: A, branch: "main", action: "switch" },
    { folderId: A, branch: "feature/one", action: "delete" },
  ]);
  assert.deepEqual(((await call(w, "git.list_branches", { folderId: A }))["branches"] as { name: string }[]).map((b) => b.name), ["main"]);
}));

test("remotes: https only, no credentials in the address, no duplicates; listed in status; removed", () => with_(async (w) => {
  await started(w);
  assert.deepEqual(await call(w, "git.remote_add", { folderId: A, name: "origin", url: REMOTE }), { ok: true });
  await expectCode("validation.duplicate", () => call(w, "git.remote_add", { folderId: A, name: "origin", url: REMOTE }));
  await expectCode("validation.bad_input", () => call(w, "git.remote_add", { folderId: A, name: "up", url: "https://user:pw@example.test/x.git" }));
  await expectCode("validation.bad_input", () => call(w, "git.remote_add", { folderId: A, name: "up", url: "http://example.test/x.git" }));
  await expectCode("validation.bad_input", () => call(w, "git.remote_add", { folderId: A, name: "up", url: "git@github.com:acme/site.git" }));
  await expectCode("validation.bad_input", () => call(w, "git.remote_add", { folderId: A, name: "-x", url: REMOTE }));
  assert.deepEqual((await call(w, "git.status", { folderId: A }))["remotes"], [{ name: "origin", url: REMOTE }]);
  assert.deepEqual(await call(w, "git.remote_remove", { folderId: A, name: "origin" }), { ok: true });
  assert.deepEqual(await call(w, "git.remote_remove", { folderId: A, name: "origin" }), { ok: false });
  assert.deepEqual((await call(w, "git.status", { folderId: A }))["remotes"], []);
  assert.deepEqual([w.eventsNamed("git.remote_added").length, w.eventsNamed("git.remote_removed").length], [1, 1]);
}));

test("push, pull and sync round trip through a remote; fast-forward, merge and the refusals", () => with_(async (w) => {
  await w.bare();
  await started(w, A);
  await call(w, "git.remote_add", { folderId: A, name: "origin", url: REMOTE });
  const c1 = await committed(w, A);
  // main is protected, but the Gate sits in front of the handler; the handler itself pushes
  const pushed = await call(w, "git.push", { folderId: A });
  assert.deepEqual(pushed, { pushed: true, sha: c1 });
  assert.deepEqual(w.eventsNamed("git.pushed"), [{ folderId: A, branch: "main", remote: "origin", sha: c1, protectedBranch: true }]);
  const st = await call(w, "git.status", { folderId: A });
  assert.deepEqual([st["upstream"], st["ahead"], st["behind"]], ["origin/main", 0, 0]);
  await expectCode("validation.precondition_failed", () => call(w, "git.push", { folderId: A, remote: "nowhere" }));
  await expectCode("validation.precondition_failed", () => call(w, "git.push", { folderId: A, branch: "missing" }));

  // a second folder clones by pulling into an empty history
  await started(w, B);
  await call(w, "git.remote_add", { folderId: B, name: "origin", url: REMOTE });
  const first = await call(w, "git.pull", { folderId: B });
  assert.deepEqual([first["updated"], first["sha"], first["conflicts"]], [true, c1, []]);
  assert.equal(w.read(B, "a.txt"), "one\ntwo\nthree\n");
  assert.deepEqual(w.eventsNamed("git.pulled")[0], { folderId: B, branch: "main", to: c1, conflicts: 0 });
  const again = await call(w, "git.pull", { folderId: B });
  assert.deepEqual([again["updated"], again["sha"]], [false, c1], "nothing new, nothing changes");

  // A moves on; B fast-forwards
  w.write(A, "a.txt", "one\ntwo\nthree\nfour\n");
  const c2 = (await call(w, "git.commit", { folderId: A, message: "four" }))["sha"] as string;
  await call(w, "git.push", { folderId: A });
  const ff = await call(w, "git.pull", { folderId: B, strategy: "ff_only" });
  assert.deepEqual([ff["updated"], ff["sha"]], [true, c2]);
  assert.equal(w.read(B, "a.txt"), "one\ntwo\nthree\nfour\n");

  // both sides add a different file: a merge pull brings the other side in; ff_only refuses
  w.write(A, "from-a.txt", "a\n");
  await call(w, "git.commit", { folderId: A, message: "a side" });
  await call(w, "git.push", { folderId: A });
  w.write(B, "from-b.txt", "b\n");
  await call(w, "git.commit", { folderId: B, message: "b side" });
  await expectCode("validation.precondition_failed", () => call(w, "git.pull", { folderId: B, strategy: "ff_only" }));
  const merged = await call(w, "git.pull", { folderId: B, strategy: "merge" });
  assert.deepEqual([merged["updated"], merged["conflicts"]], [true, []]);
  assert.equal(w.read(B, "from-a.txt"), "a\n");

  // the remote moved ahead while B was behind: push is refused, sync pulls then pushes
  w.write(A, "again.txt", "x\n");
  await call(w, "git.commit", { folderId: A, message: "more a" });
  await call(w, "git.push", { folderId: A });
  const refused = await expectCode("validation.precondition_failed", () => call(w, "git.push", { folderId: B }));
  assert.match(refused.error.message, /Pull first/);
  const synced = await call(w, "git.sync", { folderId: B });
  assert.deepEqual([synced["pulled"], synced["pushed"], synced["conflicts"]], [true, true, []]);
  assert.equal(w.read(B, "again.txt"), "x\n");
  const after = await call(w, "git.status", { folderId: B });
  assert.deepEqual([after["clean"], after["ahead"], after["behind"]], [true, 0, 0]);
}));

test("pull conflicts are listed, not hidden: merge leaves them for the reviewer, rebase backs out", () => with_(async (w) => {
  await w.bare();
  await started(w, A);
  await call(w, "git.remote_add", { folderId: A, name: "origin", url: REMOTE });
  await committed(w, A);
  await call(w, "git.push", { folderId: A });
  await started(w, B);
  await call(w, "git.remote_add", { folderId: B, name: "origin", url: REMOTE });
  await call(w, "git.pull", { folderId: B });

  w.write(A, "a.txt", "one\nA says two\nthree\n");
  await call(w, "git.commit", { folderId: A, message: "a edit" });
  await call(w, "git.push", { folderId: A });
  w.write(B, "a.txt", "one\nB says two\nthree\n");
  const local = (await call(w, "git.commit", { folderId: B, message: "b edit" }))["sha"] as string;

  const rebased = await call(w, "git.pull", { folderId: B, strategy: "rebase" });
  assert.deepEqual([rebased["updated"], rebased["conflicts"], rebased["sha"]], [false, ["a.txt"], local]);
  assert.equal((await call(w, "git.status", { folderId: B }))["clean"], true, "the rebase was backed out");
  assert.equal(w.read(B, "a.txt"), "one\nB says two\nthree\n");

  const merged = await call(w, "git.pull", { folderId: B, strategy: "merge" });
  assert.deepEqual([merged["updated"], merged["conflicts"]], [false, ["a.txt"]]);
  const s = await call(w, "git.status", { folderId: B });
  assert.deepEqual((s["changes"] as { path: string; status: string }[]).map((c) => [c.path, c.status]), [["a.txt", "conflicted"]]);
  assert.match(w.read(B, "a.txt"), /<<<<<<<[\s\S]*B says two[\s\S]*A says two[\s\S]*>>>>>>>/);
  assert.equal((w.eventsNamed("git.pulled").at(-1) as { conflicts: number }).conflicts, 1);
  // sync stops at the conflict and does not push
  const synced = await call(w, "git.sync", { folderId: B });
  assert.deepEqual([synced["pushed"], synced["conflicts"]], [false, ["a.txt"]]);
}));

test("remote failures: sign-in, unreachable and plain refusals come back in the catalogue's terms", () => with_(async (w) => {
  await started(w);
  await call(w, "git.remote_add", { folderId: A, name: "origin", url: REMOTE });
  await committed(w);
  w.failNext("push", { code: 128, stdout: "", stderr: "fatal: Authentication failed for 'https://example.test/acme/site.git/'" });
  await expectCode("provider.auth_failed", () => call(w, "git.push", { folderId: A }));
  w.failNext("push", { code: 128, stdout: "", stderr: "fatal: unable to access 'https://example.test/': Could not resolve host: example.test" });
  const down = await expectCode("provider.unavailable", () => call(w, "git.push", { folderId: A }));
  assert.equal(down.error.retryable, true);
  w.failNext("fetch", { code: 124, stdout: "", stderr: "timed out" });
  await expectCode("provider.unavailable", () => call(w, "git.pull", { folderId: A }));
  w.failNext("push", { code: 1, stdout: "", stderr: "remote: some other refusal" });
  const other = await expectCode("validation.precondition_failed", () => call(w, "git.push", { folderId: A }));
  assert.match(other.error.message, /some other refusal/);
  await expectCode("validation.bad_input", () => call(w, "git.pull", { folderId: A, strategy: "squash" }));
  await expectCode("validation.bad_input", () => call(w, "git.pull", { folderId: A, remote: "--upload-pack=x" }));
}));

test("credentials: the installation token reaches git in the child environment only; never in .git/config, argv, events or errors", () => with_(async (w) => {
  await w.bare();
  await started(w);
  await call(w, "git.remote_add", { folderId: A, name: "origin", url: GH });
  await committed(w);
  const res = await call(w, "git.push", { folderId: A });
  assert.equal(res["pushed"], true);

  assert.deepEqual(w.calls.filter((c) => c.cap === "github.installation_token").map((c) => c.input), [{ repo: "acme/site" }]);
  assert.equal(w.filled.length, 1);
  assert.deepEqual([w.filled[0]?.handle, w.filled[0]?.kind], ["#GitHub_App_Token", "git_credential"]);
  const header = `AUTHORIZATION: basic ${btoa(`x-access-token:${TOKEN}`)}`;
  const pushCall = w.execCalls.find((c) => c.argv.includes("push"));
  assert.ok(pushCall, "git push ran");
  const values = Object.entries(pushCall.env).filter(([k]) => k.startsWith("GIT_CONFIG_VALUE_")).map(([, v]) => v);
  assert.ok(values.includes(header), "the header is in the child environment");
  const keys = Object.entries(pushCall.env).filter(([k]) => k.startsWith("GIT_CONFIG_KEY_")).map(([, v]) => v);
  assert.ok(keys.includes("http.https://github.com/.extraheader"));
  assert.equal(pushCall.env["GIT_CONFIG_COUNT"], String(keys.length), "the remote rewrite entries stay and the header is added after them");

  const encoded = btoa(`x-access-token:${TOKEN}`);
  const config = fs.readFileSync(path.join(w.tree(A), ".git", "config"), "utf8");
  assert.ok(!config.includes(TOKEN) && !config.includes(encoded) && !/extraheader/i.test(config), ".git/config holds no credential");
  assert.ok(!config.includes("@github.com"), "the remote address carries no sign-in");
  for (const c of w.execCalls) assert.ok(!c.argv.join(" ").includes(TOKEN) && !c.argv.join(" ").includes(encoded), `argv of ${c.argv.slice(0, 6).join(" ")} is clean`);
  assert.ok(!JSON.stringify(w.events).includes(TOKEN) && !JSON.stringify(w.events).includes(encoded), "events hold no credential");
  assert.ok(!fs.readdirSync(path.join(w.tree(A), ".git")).some((f) => f === "credentials"), "no credential file");

  // a git error that echoes the token is scrubbed before it is read
  w.failNext("push", { code: 1, stdout: "", stderr: `remote: odd failure for https://x-access-token:${TOKEN}@github.com/acme/site.git (${encoded})` });
  const e = await expectCode("validation.precondition_failed", () => call(w, "git.push", { folderId: A }));
  assert.ok(!e.error.message.includes(TOKEN) && !e.error.message.includes(encoded), e.error.message);
  assert.ok(e.error.message.includes("***"));

  // pull uses the same path
  const pull = await call(w, "git.pull", { folderId: A });
  assert.equal(pull["updated"], false);
  assert.equal(w.filled.length, 3, "one fill per remote call");
  assert.equal(w.calls.filter((c) => c.cap === "github.installation_token").length, 3);

  // a remote that is not on github.com gets no token at all
  await call(w, "git.remote_add", { folderId: A, name: "mirror", url: REMOTE });
  const before = w.filled.length;
  await call(w, "git.push", { folderId: A, remote: "mirror" });
  assert.equal(w.filled.length, before);
}));

test("credentials: a missing token or handle is a sign-in failure, and nothing is sent", () => with_(async (w) => {
  await w.bare();
  await started(w);
  await call(w, "git.remote_add", { folderId: A, name: "origin", url: GH });
  await committed(w);
  const ctx = w.ctx;
  const original = ctx.call.bind(ctx);
  const noHandle = { ...ctx, call: async (cap: string, input: unknown) => (cap === "github.installation_token" ? { expiresAt: 1 } : original(cap as never, input)) } as typeof ctx;
  try {
    await (handlers["git.push"] as (c: typeof ctx, i: unknown) => Promise<unknown>)(noHandle, { folderId: A });
    assert.fail("expected an error");
  } catch (e) {
    assert.ok(e instanceof VyreErr);
    assert.equal(e.error.code, "provider.auth_failed");
  }
  assert.ok(!w.execCalls.some((c) => c.argv.includes("push")), "git push never ran");
  const noFill = { ...ctx, vault: { ...ctx.vault, fill: async () => {} } } as typeof ctx;
  try {
    await (handlers["git.pull"] as (c: typeof ctx, i: unknown) => Promise<unknown>)(noFill, { folderId: A });
    assert.fail("expected an error");
  } catch (e) {
    assert.ok(e instanceof VyreErr);
    assert.equal(e.error.code, "provider.auth_failed");
  }
  assert.ok(!w.execCalls.some((c) => c.argv.includes("fetch")), "git fetch never ran");
}));

test("protected branches: the Gate predicate follows the folder list, then the Space setting; delete and force are not offered", () => with_(async (w) => {
  await started(w);
  await committed(w);
  const gated = manifest.capabilities.filter((c) => (c as { gate?: unknown }).gate !== undefined).map((c) => [c.name, (c as { gate: { act: string; when?: string } }).gate] as const);
  assert.deepEqual(gated.map(([n]) => n), ["git.push", "git.sync"]);
  for (const [, g] of gated) assert.deepEqual(g, { act: "push_protected", when: "git.is_protected(input.branch)" });
  assert.ok(!manifest.capabilities.some((c) => /force/.test(c.name)), "there is no force push");

  // what the Gate asks, for the input the call carries
  assert.equal(await isProtectedCall(w.ctx, { folderId: A, branch: "main" }), true);
  assert.equal(await isProtectedCall(w.ctx, { folderId: A, branch: "master" }), true);
  assert.equal(await isProtectedCall(w.ctx, { folderId: A, branch: "feature" }), false);
  assert.equal(await isProtectedCall(w.ctx, { folderId: A }), true, "no branch: the current one (main)");
  await call(w, "git.branch", { folderId: A, action: "create", name: "feature" });
  await call(w, "git.branch", { folderId: A, action: "switch", name: "feature" });
  assert.equal(await isProtectedCall(w.ctx, { folderId: A }), false, "no branch: the current one (feature)");
  assert.equal(await isProtectedCall(w.ctx, { folderId: B }), false, "not a repository");
  assert.equal(await isProtectedCall(w.ctx, null), false);
  assert.equal(await isProtectedCall(w.ctx, { folderId: "nope" }), false);

  // the folder's own list replaces the Space setting
  const set = await call(w, "git.protect", { folderId: A, branches: ["release", "feature", "release"] });
  assert.deepEqual(set, { branches: ["release", "feature"] });
  assert.deepEqual(w.eventsNamed("git.protection_changed"), [{ folderId: A, branches: ["release", "feature"] }]);
  assert.equal(await isProtectedCall(w.ctx, { folderId: A, branch: "main" }), false);
  assert.equal(await isProtectedCall(w.ctx, { folderId: A }), true, "feature is current and now protected");
  assert.equal(await isProtectedCall(w.ctx, { folderId: B, branch: "main" }), true, "another folder still follows the Space setting");
  assert.equal((await call(w, "git.status", { folderId: A }))["protected"], true);
  await call(w, "git.branch", { folderId: A, action: "switch", name: "main" });
  await expectCode("validation.precondition_failed", () => call(w, "git.branch", { folderId: A, action: "delete", name: "feature" }));
  await expectCode("validation.bad_input", () => call(w, "git.protect", { folderId: A, branches: ["--all"] }));
  await expectCode("validation.bad_input", () => call(w, "git.protect", { folderId: A, branches: "main" }));
  // a damaged row falls back to the Space setting
  w.db.rows.set(A, { folder_id: A, branches: "{not json", updated_at: 1 });
  assert.equal(await isProtectedCall(w.ctx, { folderId: A, branch: "main" }), true);
  // the push event says whether the branch was protected
  await w.bare();
  w.db.rows.delete(A);
  await call(w, "git.remote_add", { folderId: A, name: "origin", url: REMOTE });
  await call(w, "git.push", { folderId: A, branch: "feature" });
  await call(w, "git.push", { folderId: A, branch: "main" });
  assert.deepEqual(w.eventsNamed("git.pushed").map((e) => [(e as { branch: string }).branch, (e as { protectedBranch: boolean }).protectedBranch]), [["feature", false], ["main", true]]);
}));

test("operations on one folder run one at a time", () => with_(async (w) => {
  await started(w);
  await committed(w);
  w.write(A, "x.txt", "x\n");
  w.write(A, "y.txt", "y\n");
  const results = await Promise.allSettled([
    call(w, "git.commit", { folderId: A, message: "x", paths: ["x.txt"] }),
    call(w, "git.commit", { folderId: A, message: "y", paths: ["y.txt"] }),
  ]);
  assert.deepEqual(results.map((r) => r.status), ["fulfilled", "fulfilled"]);
  const log = await call(w, "git.log", { folderId: A });
  assert.deepEqual((log["commits"] as { message: string }[]).map((c) => c.message).sort(), ["first", "x", "y"]);
}));
