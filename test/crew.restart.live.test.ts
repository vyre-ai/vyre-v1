// A restart in the middle of a teammate's work (split out of crew.live.test.ts so each file stays inside its time cap on a busy runner): nothing is lost.
// on its own branch. Nothing inside the daemon is faked but the model vendor, a scripted session that does what the teammate's tool calls would do: it edits and commits in its own folder.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workFolder } from "../modules/engine/sandbox.ts";
import { boot, call, connect, hostLog, makeAgent, ok, scriptedModel, seededDir, startChat, stop, waitFor } from "./support/eco-live.ts";

const git = (cwd: string, ...args: string[]): string => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};

test("a restart mid-work loses nothing: the job is still there, the teammate's copy is as it was, the work finishes once and one card arrives", async () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-crew-repo-")));
  git(repo, "init", "--quiet", "-b", "main");
  fs.writeFileSync(path.join(repo, "README.md"), "a small site\n");
  git(repo, "add", "-A"); git(repo, "commit", "--quiet", "-m", "first");

  const dirData = seededDir();
  let owner = ""; let teammate = ""; let project = ""; let chat = ""; let jobThread = "";
  let running = false;
  // the first daemon's teammate starts its work and never finishes: the daemon is stopped under it
  const hang = scriptedModel(async function* (input) {
    if (input.agent.id !== teammate) return;
    const work = workFolder(dirData, owner, input.threadId, teammate);
    await waitFor(async () => (fs.existsSync(path.join(work, "README.md")) ? true : null), 20_000);
    fs.writeFileSync(path.join(work, "half-done.txt"), "started\n");
    running = true;
    await new Promise<void>(() => undefined);
  });
  const first = await boot(dirData, hang);
  let jobId = "";
  try {
    await connect(first);
    const lead = await makeAgent(first, "Lead");
    owner = (await ok(first, "agents.get", { agentId: lead })).agent.ownerId as string;
    project = (await ok(first, "projects.create", { type: "project", title: "Small site", idempotencyKey: "crew3-project" })).projectId as string;
    teammate = (await ok(first, "projects.teammates.create", { projectId: project, name: "Ember", role: "member", idempotencyKey: "crew3-ember" })).teammate.agentId as string;
    await ok(first, "engine.crew.repo.set", { projectId: project, path: repo });
    chat = await startChat(first, lead, "crew3");
    const job = (await ok(first, "engine.crew.start", { threadId: chat, projectId: project, teammateId: teammate, title: "Dark mode", brief: "Add a dark mode toggle.", idempotencyKey: "crew3-start" })).job;
    jobId = job.jobId; jobThread = job.threadId;
    await waitFor(async () => (running ? true : null), 30_000, () => hostLog(first));
  } finally { await stop(first); }

  // the same data directory, a new daemon, a teammate that can finish
  const model = scriptedModel(async function* (input) {
    if (input.agent.id !== teammate) return;
    const work = workFolder(dirData, owner, input.threadId, teammate);
    assert.equal(fs.readFileSync(path.join(work, "half-done.txt"), "utf8"), "started\n", "the copy is as the first daemon left it");
    fs.writeFileSync(path.join(work, "dark-mode.txt"), "toggle: on\n");
    yield { type: "text", text: "Finished after the restart." };
  });
  const second = await boot(dirData, model);
  try {
    await connect(second);
    const before = (await ok(second, "engine.crew.list", { threadId: chat })).jobs as Array<{ jobId: string; state: string; branch: string }>;
    assert.deepEqual(before.map((j) => [j.jobId, j.branch]), [[jobId, "crew/ember-1"]], "the crew is still there");
    const card = await waitFor(async () => {
      const ms = (await ok(second, "chat.messages.list", { threadId: chat })).messages as Array<{ blocks: Array<{ type: string; data: Record<string, unknown> }> }>;
      const cards = ms.flatMap((m) => m.blocks).filter((b) => b.type === "crew_result");
      return cards.length > 0 ? cards : null;
    }, 90_000, () => hostLog(second));
    assert.equal(card.length, 1, "one card, not two");
    assert.deepEqual((card[0]!.data["files"] as Array<{ path: string }>).map((f) => f.path).sort(), ["dark-mode.txt", "half-done.txt"]);
    assert.equal(jobThread, (await ok(second, "engine.crew.list", { threadId: chat })).jobs[0].threadId);
    assert.equal((await ok(second, "engine.crew.list", { threadId: chat })).jobs[0].state, "done");
  } finally { await stop(second); }
});
