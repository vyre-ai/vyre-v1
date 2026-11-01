// What a session's work folder gets before its first turn (session.ts prepareWorkFolder): a teammate thread of the crew gets its copy of the repository on its own branch, any other thread gets only the memory guide,
// and the guide never overwrites a file the repository tracks nor shows up as work the teammate did.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { git } from "../crew-git.ts";
import { prepareWorkFolder } from "../session.ts";
import { workFolder } from "../sandbox.ts";

const tmp = (): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-crew-prep-")));
const ID = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

test("a crew thread gets its repository copy, the guide stays out of its commits and leaves a tracked CLAUDE.md alone; another thread gets only the guide", async () => {
  const repo = tmp();
  await git(["init", "--quiet", "-b", "main"], repo);
  fs.writeFileSync(path.join(repo, "CLAUDE.md"), "the project's own notes\n");
  await git(["add", "-A"], repo, ID);
  await git(["commit", "--quiet", "-m", "first"], repo, ID);
  const data = tmp();
  fs.mkdirSync(path.join(data, "work"), { recursive: true });
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    const i = input as { threadId?: string };
    if (cap === "engine.crew.workspace") return { workspace: i.threadId === "thr_crew" ? { jobId: "crw_1", repo, base: "main", branch: "crew/ember-1", name: "Ember" } : null };
    if (cap === "agents.get") return { agent: { name: "Ember" } };
    if (cap === "memory.map.get") return { map: { body: "memory map" } };
    if (cap === "threads.get") return { thread: { kind: "chat" } };
    throw new Error(`unexpected ${cap}`);
  };
  await prepareWorkFolder(call, data, { agent: { id: "agt_e" }, asker: "usr_a", threadId: "thr_crew" });
  const dir = workFolder(data, "usr_a", "thr_crew");
  assert.equal((await git(["rev-parse", "--abbrev-ref", "HEAD"], dir)).out.trim(), "crew/ember-1");
  assert.equal(fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8"), "the project's own notes\n", "a tracked file of the repository is not overwritten");
  assert.ok(fs.existsSync(path.join(dir, "AGENTS.md")), "the guide the repository lacks is written");
  assert.equal((await git(["status", "--porcelain"], dir)).out.trim(), "", "the guide is not shown as the teammate's work");
  // a second call (the next turn) changes nothing
  fs.writeFileSync(path.join(dir, "mine.txt"), "work\n");
  await prepareWorkFolder(call, data, { agent: { id: "agt_e" }, asker: "usr_a", threadId: "thr_crew" });
  assert.equal(fs.readFileSync(path.join(dir, "mine.txt"), "utf8"), "work\n");

  await prepareWorkFolder(call, data, { agent: { id: "agt_e" }, asker: "usr_a", threadId: "thr_plain" });
  const plain = workFolder(data, "usr_a", "thr_plain");
  assert.deepEqual(fs.readdirSync(plain).sort(), ["AGENTS.md", "CLAUDE.md"]);
  assert.equal(fs.existsSync(path.join(plain, ".git")), false);
});
