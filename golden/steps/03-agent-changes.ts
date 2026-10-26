// Golden flow 3: agent changes reviewed and pushed (spec 2.16, 4.6; ARCH 4.6). Work in a git folder is committed, the branch is protected, the push to it is held by the Gate as an Approve line,
// a person approves and the push goes out once. Through the gateway; the remote is a local bare repository. The agent turn that makes the change is flow 7's half.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootTolerant, expectStatus, short, Trail } from "./02-space.ts";
import type { Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";

export const LIVE_FOR_CHANGES = ["files", "git", "gate", "tasks", "agents", "devices", "access", "spaces"];
export const GAPS: Gap[] = [];

export async function runChanges(live: readonly string[]): Promise<{ events: Observed[]; trail: Trail }> {
  const trail = new Trail();
  const { s } = await bootTolerant(trail, live);
  if (!s) return { events: [], trail };
  try {
    const admin = s.d.token;
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), "golden-3-remote-"));
    spawnSync("git", ["init", "--bare", "-b", "main", remote]);
    const root = await trail.step("the Space has a root folder", async () => {
      const list = expectStatus(await s.call("files.list", admin, { section: "space" }), 200, "files.list");
      const f = (list.folders ?? list.items ?? []).find((x: { id?: string; folderId?: string }) => x.id ?? x.folderId);
      assert.ok(f, `files.list ${short(list)}`);
      return (f.id ?? f.folderId) as string;
    });
    const folder = await trail.step("a project folder is made and turned into a repository", async () => {
      const made = expectStatus(await s.call("files.folder.create", admin, { idempotencyKey: "golden-3-folder", parentId: root!, name: "site-copy" }), 200, "files.folder.create").folder.folderId as string;
      expectStatus(await s.call("git.init", admin, { folderId: made, branch: "main" }), 200, "git.init");
      return made;
    }, ["the Space has a root folder"]);
    await trail.step("a change is committed", async () => {
      expectStatus(await s.call("files.create", admin, { idempotencyKey: "golden-3-file", folderId: folder!, name: "home.md", content: { text: "# Home\nNew wording." } }), 200, "files.create");
      const out = expectStatus(await s.call("git.commit", admin, { idempotencyKey: "golden-3-commit", folderId: folder!, message: "Reword the home page" }), 200, "git.commit");
      assert.ok(out.sha, `commit ${short(out)}`);
    }, ["a project folder is made and turned into a repository"]);
    await trail.step("the main branch is protected and the remote added", async () => {
      expectStatus(await s.call("git.protect", admin, { folderId: folder!, branches: ["main"] }), 200, "git.protect");
      expectStatus(await s.call("git.remote_add", admin, { folderId: folder!, name: "origin", url: remote }), 200, "git.remote_add");
    }, ["a change is committed"]);
    const held = await trail.step("the push to the protected branch is held by the Gate", async () => {
      const r = await s.call("git.push", admin, { idempotencyKey: "golden-3-push", folderId: folder!, remote: "origin", branch: "main" });
      assert.ok(r.status === 202 && r.body?.data?.status === "held" && r.body.data.taskId, `git.push should be held: ${r.status} ${short(r.body)}`);
      return r.body.data.taskId as string;
    }, ["the main branch is protected and the remote added"]);
    await trail.step("a person approves and the push goes out", async () => {
      expectStatus(await s.call("tasks.act", admin, { taskId: held!, action: "approve" }), 200, "tasks.act");
      const log = spawnSync("git", ["-C", remote, "log", "--oneline", "main"], { encoding: "utf8" });
      assert.match(log.stdout, /Reword the home page/, `remote log: ${log.stdout}${log.stderr}`);
    }, ["the push to the protected branch is held by the Gate"]);
    return { events: await s.events(), trail };
  } finally { await s.stop(); }
}

export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runChanges([]);
  if (trail.failures.length) throw new Error(`flow 3 failed:\n${trail.report()}`);
  return events;
}
