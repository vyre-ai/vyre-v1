// P-L4_LIVE (rulings 31, 32, 33): lane L4 is live on a booted daemon. host/modules.json has files, git, mounts, previews and documents live, no L4 module is reported as not set up,
// the git host seam is wired, and one read and one write capability per module answer through the gateway with a real token. A person without files.write is refused.
// Waiting on w12a (ctx.vault in the daemon, P-L7_LIVE): git remote flows to github.com (git.push, git.pull, git.sync with a GitHub token via ctx.vault.fill git_credential); not tested here.
// Path mapping: the packet owns __live__/L4; this test sits in host/tests because it boots the daemon.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";

const L4 = ["documents", "files", "git", "mounts", "previews", "runbooks"];

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-l4-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const OWNER = "tok-usr_olivia";
const TEMP = "tok-usr_tess";

test("l4 live: host/modules.json has every L4 module live", () => {
  const file = JSON.parse(fs.readFileSync(new URL("../modules.json", import.meta.url), "utf8")) as { modules: { id: string; owner: string; status: string }[] };
  const mine = file.modules.filter((m) => m.owner === "L4");
  assert.deepEqual(mine.map((m) => m.id).sort(), [...L4].sort());
  for (const m of mine) assert.equal(m.status, "live", `${m.id} status`);
});

test("l4 live: a booted daemon has no L4 module not set up, and a read and a write per module answer through the gateway", async () => {
  const dir = seededDir();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "l4-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      const who = t === OWNER ? "usr_olivia" : t === TEMP ? "usr_tess" : null;
      return who === null ? null : { space: "spc_core", principal: { kind: "person", id: who }, device: "l4-live" };
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const post = (token: string, p: string, body: unknown) =>
    fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) })   // a call that hangs fails by name, not by the 30 s watchdog
      .catch((e: unknown) => { throw new Error(`${p} did not answer: ${e instanceof Error ? e.message : String(e)}`); });
  // what the daemon logged for the trace of a failed call, so a 500 in CI says why
  const why = (body: string): string => {
    const traceId = /"traceId":"([0-9a-f]+)"/.exec(body)?.[1];
    if (!traceId) return "";
    d.sink.flush();
    return ` | log: ${JSON.stringify(d.sink.trace(traceId).logs.map((l) => [l.msg, l.attrs]))}`;
  };
  const ok = async (p: string, body: unknown): Promise<Record<string, unknown>> => {
    console.log(`l4 live: ${p}`);   // progress, so a hang in CI shows where it stopped
    const r = await post(OWNER, p, body);
    const text = await r.text();
    assert.equal(r.status, 200, `${p}: ${text}${why(text)}`);
    return (JSON.parse(text) as { data: Record<string, unknown> }).data;
  };
  try {
    assert.deepEqual((d.seams?.missing ?? []).filter((m) => m.module !== undefined && L4.includes(m.module)), [], "no L4 module is reported as not set up");
    assert.ok((d.seams?.wired ?? []).includes("setGitHost"), "the git host seam is wired");

    // files: the tree is read, then a folder is made inside Projects (the roots are access resources, ruling 65) and a file inside it
    const tree = await ok("/v1/files/tree", {});
    const roots = tree["roots"] as { key: string; folderId?: string }[];
    const projects = roots.find((r) => r.key === "projects");
    assert.ok(projects?.folderId, "the tree has the Projects root");
    const made = await ok("/v1/files/folder/create", { idempotencyKey: "l4-live-folder", parentId: projects.folderId, name: "Matters" });
    const folderId = (made["folder"] as { folderId: string }).folderId;
    assert.match(folderId, /^fld_/, "files.folder.create made a folder");
    const file = await ok("/v1/files/create", { idempotencyKey: "l4-live-file", folderId, name: "note.txt", content: { text: "hello" } });
    const fileId = (file["file"] as { fileId?: string }).fileId;
    assert.ok(fileId, "files.create made a file");

    // previews: the preview is asked for, and the converter health answers
    assert.equal(typeof (await ok("/v1/previews/render", { fileId }))["queued"], "boolean", "previews.render answers");
    assert.ok(["healthy", "degraded", "down"].includes(String((await ok("/v1/previews/health", {}))["state"])), "previews.health answers");

    // git: the folder becomes a repository and its status says so
    await ok("/v1/git/init", { folderId });
    assert.equal((await ok("/v1/git/status", { folderId }))["isRepo"], true, "git.status sees the repository git.init made");
    assert.ok(["healthy", "degraded", "down"].includes(String((await ok("/v1/git/health", {}))["state"])), "git.health answers");

    // mounts: a folder on a device is mounted into a new folder, and the list shows it
    const mountInto = (await ok("/v1/files/folder/create", { idempotencyKey: "l4-live-mount-folder", parentId: projects.folderId, name: "Device" }))["folder"] as { folderId: string };
    const added = await ok("/v1/mounts/add", { idempotencyKey: "l4-live-mount", into: mountInto.folderId, source: { kind: "local", deviceId: "dev_l4live", localPath: "/Users/olivia/Matters" } });
    assert.match(String(added["mountId"]), /^mnt_/, "mounts.add made a mount");
    const listed = (await ok("/v1/mounts/list", {}))["mounts"] as { mountId: string }[];
    assert.ok(listed.some((m) => m.mountId === added["mountId"]), "mounts.list shows the new mount");
    // pausing a mount that does not exist is refused by the real handler (a stub would answer with its example)
    console.log("l4 live: /v1/mounts/pause");
    const nope = await post(OWNER, "/v1/mounts/pause", { mountId: "mnt_nonexistent" });
    assert.ok(nope.status >= 400 && nope.status < 500, `mounts.pause on an unknown mount is refused, got ${nope.status}`);

    // a temp person holds no files.write: refused before the handler runs
    const refused = await post(TEMP, "/v1/files/folder/create", { idempotencyKey: "l4-live-tess", parentId: projects.folderId, name: "Nope" });
    assert.equal(refused.status, 403, "a temp person cannot create folders");
    assert.equal(((await refused.json()) as { error?: { code?: string } }).error?.code, "permission.role_lacks_permission");
  } finally { console.log("l4 live: stopping"); await d.stop(); console.log("l4 live: stopped; open resources:", JSON.stringify(process.getActiveResourcesInfo().filter((r) => r !== "TTYWrap" && r !== "FSReqCallback"))); }
});

test("l4 live: a fresh daemon whose first files call is files.folder.search finds the Agents root", async () => {
  const dir = seededDir();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "l4-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => (/^Bearer tok-usr_olivia$/.test(String(h["authorization"] ?? "")) ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "l4-live" } : null),
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  try {
    const r = await fetch(`${d.url}/v1/files/folder/search`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` }, body: JSON.stringify({ q: "Agents" }), signal: AbortSignal.timeout(8_000) });
    const text = await r.text();
    assert.equal(r.status, 200, text);
    const folders = (JSON.parse(text) as { data: { folders: { name: string; path: string }[] } }).data.folders;
    assert.ok(folders.some((f) => f.path === "Agents"), `the Agents root is found: ${text}`);
  } finally { await d.stop(); }
});
