// Files mounts on a booted daemon (spec 2.16 Mounts): a GitHub repository (a local bare git repo stands in as the remote, through git's own URL rewrite, so the mount sees the address it always sees) and
// a folder on a computer (the device reports its changes). Nothing is faked inside the daemon: files, git, mounts and the engine of the mount are live.
// GitHub: the files appear in Files, a second commit on the remote arrives with Sync now, an edit made in Vyre is committed and pushed back to the remote.
// A folder on a computer: a device report makes the files appear, a changed file is a new version, an edit made in Vyre and a different edit on the device keep both copies.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../fixtures/seed/core/index.ts";
import { fakePlatform } from "../host/src/platform/index.ts";
import type { FetchFn } from "../host/src/platform/probes.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../host/src/daemon/daemon.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Remote Dev", GIT_AUTHOR_EMAIL: "dev@example.test", GIT_COMMITTER_NAME: "Remote Dev", GIT_COMMITTER_EMAIL: "dev@example.test" } }).trim();

/** A GitHub that knows one App with one installation (acme) and hands out a token; every request is recorded. */
function githubStandIn() {
  const seen: string[] = [];
  const http = async (url: string, init: { method?: string } = {}) => {
    const u = new URL(url);
    seen.push(`${init.method ?? "GET"} ${u.hostname}${u.pathname}`);
    const reply = (status: number, body: unknown) => ({ status, headers: { get: () => null }, text: async () => JSON.stringify(body) });
    if (u.hostname !== "api.github.com") return reply(404, {});
    if (u.pathname === "/app/installations") return reply(200, [{ id: 7, account: { login: "acme" }, repository_selection: "all", permissions: {} }]);
    if (u.pathname.endsWith("/installation")) return reply(200, { id: 7, account: { login: "acme" } });
    if (u.pathname === "/app/installations/7/access_tokens") return reply(201, { token: "ghs_standin_token", expires_at: new Date(Date.now() + 3_000_000).toISOString() });
    return reply(404, { message: "Not Found" });
  };
  return { seen, http, vault: { secret: async (h: string) => (h === "#GitHub_App_Id" ? "12345" : ""), signRs256: async () => "c2ln" } };
}

async function boot(extra: { http?: never; vault?: never } | Record<string, unknown> = {}): Promise<{ d: Daemon; dir: string }> {
  const core = bootCore();
  const dir = tmp("vyre-mounts-live-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux", hostname: "mounts-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    ...extra,
  });
  return { d, dir };
}

async function call(d: Daemon, cap: string, input: unknown): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}
const WRITES = new Set(["mounts.sync_now", "mounts.pause", "mounts.resume", "mounts.remove", "mounts.add", "mounts.local_report", "files.write", "files.folder.create", "git.commit", "git.push", "settings.set_space"]);
let keys = 0;
const ok = async (d: Daemon, cap: string, input: unknown): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, WRITES.has(cap) && !(input as { idempotencyKey?: string }).idempotencyKey ? { ...(input as object), idempotencyKey: `mounts-live-${cap}-${++keys}` } : input);
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

/** A new folder at the top of the Space for a mount to go into. */
async function intoFolder(d: Daemon, name: string): Promise<string> {
  const tree = await ok(d, "files.tree", {});
  const root = (tree.roots as Array<{ folderId?: string }>).find((r) => r.folderId)?.folderId;
  assert.ok(root, "Files has a root folder");
  return (await ok(d, "files.folder.create", { idempotencyKey: `into-${name}`, parentId: root, name })).folder.folderId as string;
}

const filesIn = async (d: Daemon, folderId: string): Promise<Array<{ fileId: string; name: string; version: number }>> => (await ok(d, "files.list", { folder: folderId })).files;
const textOf = async (d: Daemon, fileId: string): Promise<string> => (await ok(d, "files.read", { fileId, as: "text" })).text as string;

test("mounts live: a GitHub repository mounts into Files, takes a new commit on Sync now, and an edit made in Vyre is committed and pushed back to the remote", async () => {
  const work = tmp("vyre-mounts-remote-");
  const bare = path.join(work, "site.git");
  const clone = path.join(work, "clone");
  git(work, "init", "-q", "--bare", "-b", "main", bare);
  git(work, "clone", "-q", bare, clone);
  fs.writeFileSync(path.join(clone, "README.md"), "# Site\nFirst version.\n");
  fs.mkdirSync(path.join(clone, "docs"));
  fs.writeFileSync(path.join(clone, "docs", "guide.md"), "Guide.\n");
  git(clone, "add", "."); git(clone, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "first");
  git(clone, "push", "-q", "origin", "HEAD:main");
  // the mount registers https://github.com/acme/site.git as its remote; git's own URL rewrite sends that address to the local bare repository
  const gitEnv = { GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: `url.file://${bare}.insteadOf`, GIT_CONFIG_VALUE_0: "https://github.com/acme/site.git", GIT_CONFIG_KEY_1: "protocol.file.allow", GIT_CONFIG_VALUE_1: "always" };
  const gh = githubStandIn();
  const { d } = await boot({ http: gh.http, vault: gh.vault, gitEnv });
  try {
    const into = await intoFolder(d, "Mounted");
    const added = await ok(d, "mounts.add", { idempotencyKey: "mount-gh", into, source: { kind: "github", ref: "acme/site", branch: "main" }, name: "site", reviewChanges: false });
    const mountId = added.mountId as string;
    const listed = (await ok(d, "mounts.list", {})).mounts as Array<{ mountId: string; kind: string; state: string; ref?: string; error?: string }>;
    const row = listed.find((m) => m.mountId === mountId)!;
    assert.equal(row.state, "idle", `the first sync ran: ${row.error ?? ""}`);
    assert.equal(row.kind, "github");
    const top = await filesIn(d, added.folderId);
    const readme = top.find((f) => f.name === "README.md");
    assert.ok(readme, `README.md appears in Files: ${JSON.stringify(top)}`);
    assert.equal(await textOf(d, readme!.fileId), "# Site\nFirst version.\n");
    const sub = (await ok(d, "files.list", { folder: added.folderId })).folders as Array<{ folderId: string; name: string }>;
    const docs = sub.find((f) => f.name === "docs");
    assert.ok(docs, "a folder of the repository is a folder in Files");
    assert.ok((await filesIn(d, docs!.folderId)).some((f) => f.name === "guide.md"));

    // a second commit on the remote arrives with Sync now
    fs.writeFileSync(path.join(clone, "NEWS.md"), "News.\n");
    git(clone, "add", "."); git(clone, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "second"); git(clone, "push", "-q", "origin", "HEAD:main");
    await ok(d, "mounts.sync_now", { mountId });
    assert.ok((await filesIn(d, added.folderId)).some((f) => f.name === "NEWS.md"), "the new file arrived");

    // an edit made in Vyre goes back out: write, commit, push, and the remote has it
    await ok(d, "files.write", { idempotencyKey: "gh-edit", fileId: readme!.fileId, content: { text: "# Site\nEdited in Vyre.\n" }, reason: "Edit" });
    await ok(d, "git.commit", { idempotencyKey: "gh-commit", folderId: added.folderId, message: "Edit the readme in Vyre" });
    // main is a protected branch: the push waits for a yes (the Gate), and goes once the Space stops protecting it
    const held = await call(d, "git.push", { idempotencyKey: "gh-push-held", folderId: added.folderId, branch: "main" });
    assert.equal(held.status, 202, "a push to a protected branch is held");
    assert.equal(held.data.status, "held");
    await ok(d, "git.protect", { idempotencyKey: "gh-unprotect", folderId: added.folderId, branches: [] });
    await ok(d, "git.push", { idempotencyKey: "gh-push", folderId: added.folderId, branch: "main" });
    git(clone, "pull", "-q", "origin", "main");
    assert.equal(fs.readFileSync(path.join(clone, "README.md"), "utf8"), "# Site\nEdited in Vyre.\n", "the remote holds the edit made in Vyre");
    assert.match(git(clone, "log", "-1", "--format=%s"), /Edit the readme in Vyre/);

    // pause, resume and remove
    await ok(d, "mounts.pause", { mountId });
    assert.equal((await ok(d, "mounts.get", { mountId })).mount.state, "paused");
    await ok(d, "mounts.resume", { mountId });
    assert.equal((await ok(d, "mounts.remove", { mountId, keepCopy: true })).removed, true);
    assert.ok((await filesIn(d, added.folderId)).some((f) => f.name === "README.md"), "kept as a plain folder");
  } finally {
    await d.stop();
  }
});

test("mounts live: a folder on a computer fills Files from the device's reports, a changed file is a new version, and an edit in Vyre beside a different edit on the device keeps both", async () => {
  const { d } = await boot();
  try {
    const into = await intoFolder(d, "Computer");
    const deviceId = "dev_macbook1";   // the computer that holds the folder; only it may report for the mount
    const added = await ok(d, "mounts.add", { idempotencyKey: "mount-local", into, source: { kind: "local", deviceId, localPath: "/Users/olivia/Contracts" }, name: "Contracts", mode: "server_copy" });
    const mountId = added.mountId as string;
    const refused = await call(d, "mounts.sync_now", { mountId });
    assert.notEqual(refused.status, 200, "a computer's folder syncs when the computer reports, not on demand");

    const blob = async (text: string): Promise<string> => {
      const bytes = Buffer.from(text);
      const slot = await ok(d, "files.upload_url", { size: bytes.length });
      const token = new URL(slot.url, "http://vyred").searchParams.get("token");
      await d.hooks!.call("files.put_upload", { blobId: slot.blobId, token, base64: bytes.toString("base64") });
      return slot.blobId as string;
    };
    const report = (changes: unknown[]): Promise<any> => ok(d, "mounts.local_report", { idempotencyKey: `rep-${Math.random().toString(36).slice(2)}`, mountId, deviceId, changes });   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r1 = await report([{ path: "nda.txt", op: "add", blobId: await blob("NDA v1"), mtime: 1_760_000_000_000 }, { path: "2026/lease.txt", op: "add", blobId: await blob("Lease"), mtime: 1_760_000_000_001 }]);
    assert.equal(r1.applied, 2);
    const nda = (await filesIn(d, added.folderId)).find((f) => f.name === "nda.txt")!;
    assert.ok(nda, "nda.txt appears in Files");
    assert.equal(await textOf(d, nda.fileId), "NDA v1");
    const sub = ((await ok(d, "files.list", { folder: added.folderId })).folders as Array<{ folderId: string; name: string }>).find((f) => f.name === "2026")!;
    assert.ok((await filesIn(d, sub.folderId)).some((f) => f.name === "lease.txt"), "a folder of the computer is a folder in Files");

    await report([{ path: "nda.txt", op: "modify", blobId: await blob("NDA v2"), mtime: 1_760_000_100_000 }]);
    assert.equal(await textOf(d, nda.fileId), "NDA v2");
    assert.equal((await filesIn(d, added.folderId)).find((f) => f.name === "nda.txt")!.version, nda.version + 1, "a new version, not a new file");

    // an edit in Vyre, then a different edit on the device: neither is lost
    await ok(d, "files.write", { idempotencyKey: "loc-edit", fileId: nda.fileId, content: { text: "NDA edited in Vyre" }, reason: "Edit" });
    await d.hooks?.pump?.(); await d.projections?.pump();
    assert.equal((await ok(d, "mounts.get", { mountId })).mount.pendingChanges, 1, "the mount sees one change waiting that was made in Vyre");
    const clash = await report([{ path: "nda.txt", op: "modify", blobId: await blob("NDA edited on the computer"), mtime: 1_760_000_200_000 }]);
    assert.equal(clash.conflicts, 1, "the two edits are a conflict");
    const mounts = (await ok(d, "mounts.list", {})).mounts as Array<{ mountId: string; conflicts: number; state: string; lastSyncAt?: number }>;
    const row = mounts.find((m) => m.mountId === mountId)!;
    assert.ok(row.lastSyncAt, "the line has a last sync");
    assert.equal(await textOf(d, nda.fileId), "NDA edited on the computer");
    const versions = (await ok(d, "files.versions", { fileId: nda.fileId })).versions as Array<{ versionId: string }>;
    assert.ok(versions.length >= 4, "the history keeps the edit made in Vyre");
  } finally { await d.stop(); }
});
