// The crew on a booted daemon (DESIGN-crew.md, step 1): a project with a repository on this computer, a teammate started from a lead's chat, its own thread under that chat, and its own copy of the repository
// on its own branch. Nothing inside the daemon is faked but the model vendor, a scripted session that does what the teammate's tool calls would do: it edits and commits in its own folder.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workFolder } from "../modules/engine/sandbox.ts";
import { boot, connect, hostLog, makeAgent, ok, scriptedModel, seededDir, startChat, stop, waitFor } from "./support/eco-live.ts";

const git = (cwd: string, ...args: string[]): string => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};

test("a teammate started from a chat works in its own copy of the repository on its own branch, and the original is untouched", async () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-crew-repo-")));
  git(repo, "init", "--quiet", "-b", "main");
  fs.writeFileSync(path.join(repo, "README.md"), "a small site\n");
  git(repo, "add", "-A"); git(repo, "commit", "--quiet", "-m", "first");

  let dir = "";
  let owner = "";
  let teammate = "";
  const model = scriptedModel(async function* (input) {
    // only the teammate edits; the lead has nothing to say in this test
    if (input.agent.id !== teammate) return;
    const work = workFolder(dir, owner, input.threadId);
    // the real opener awaits the folder before a session starts (prepareWorkFolder); this stand-in has no opener, so it waits for the copy start is making
    await waitFor(async () => (fs.existsSync(path.join(work, "README.md")) ? true : null), 20_000); 
    fs.writeFileSync(path.join(work, "dark-mode.txt"), "toggle: on\n");
    git(work, "add", "-A"); git(work, "commit", "--quiet", "-m", "add the dark mode toggle");
    yield { type: "text", text: "Added the toggle and committed it." };
  });
  const d = await boot(seededDir(), model);
  dir = d.paths.root;
  try {
    await connect(d);
    const project = (await ok(d, "projects.create", { type: "project", title: "Small site", idempotencyKey: "crew-project" })).projectId as string;
    teammate = (await ok(d, "projects.teammates.create", { projectId: project, name: "Ember", role: "member", idempotencyKey: "crew-ember" })).teammate.agentId as string;
    const lead = await makeAgent(d, "Lead");
    owner = (await ok(d, "agents.get", { agentId: lead })).agent.ownerId as string;
    const chat = await startChat(d, lead, "crew1");

    // no repository yet: the start says so in words
    const early = await fetch(`${d.url}/v1/engine/crew/start`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ threadId: chat, projectId: project, teammateId: teammate, title: "Dark mode", brief: "Add a dark mode toggle.", idempotencyKey: "crew-early" }) });
    assert.equal(early.status, 422, await early.text());
    // a folder that is not a repository is refused
    const bad = await fetch(`${d.url}/v1/engine/crew/repo/set`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ projectId: project, path: os.tmpdir() }) });
    assert.equal(bad.status, 422, await bad.text());
    const set = await ok(d, "engine.crew.repo.set", { projectId: project, path: repo });
    assert.deepEqual([set.repo.baseBranch, set.repo.branch], ["main", "main"]);
    assert.equal((await ok(d, "engine.crew.repo.get", { projectId: project })).repo.path, repo);

    const job = (await ok(d, "engine.crew.start", { threadId: chat, projectId: project, teammateId: teammate, title: "Dark mode", brief: "Add a dark mode toggle.", idempotencyKey: "crew-start" })).job;
    assert.deepEqual([job.branch, job.base, job.state, job.leadThreadId], ["crew/ember-1", "main", "working", chat]);
    assert.notEqual(job.threadId, chat, "the teammate has a thread of its own");

    // its thread hangs under the lead's chat as a helper, and the lead's chat lists the job
    const helpers = (await ok(d, "chat.helpers.list", { threadId: chat })).helpers as Array<{ threadId: string }>;
    assert.deepEqual(helpers.map((h) => h.threadId), [job.threadId]);
    assert.deepEqual((await ok(d, "engine.crew.list", { threadId: chat })).jobs.map((j: { jobId: string; name?: string }) => [j.jobId, j.name]), [[job.jobId, "Ember"]]);

    // the teammate's turn ran in its own copy
    const work = workFolder(dir, owner, job.threadId);
    await waitFor(async () => (fs.existsSync(path.join(work, "dark-mode.txt")) ? true : null), 15_000, () => hostLog(d)).catch(async (e) => {
      const ms = (await ok(d, "chat.messages.list", { threadId: job.threadId })).messages as Array<{ author: { kind: string }; body: string; blocks: unknown[] }>;
      throw new Error(`${String(e).slice(0, 200)} THREAD ${JSON.stringify(ms.map((m) => [m.author.kind, m.body, JSON.stringify(m.blocks).slice(0, 200)]))} WORK ${fs.existsSync(work) ? fs.readdirSync(work) : "missing"}`);
    });
    assert.equal(git(work, "rev-parse", "--abbrev-ref", "HEAD").trim(), "crew/ember-1");
    assert.match(git(work, "log", "--format=%s", "main..HEAD"), /add the dark mode toggle/);
    assert.equal(git(work, "remote").trim(), "", "the copy has no remote to push to");
    assert.equal(fs.existsSync(path.join(repo, "dark-mode.txt")), false, "nothing reached the original");
    assert.equal(git(repo, "log", "--oneline").trim().split("\n").length, 1, "the original has its one commit");

    // a second job for the same teammate is a second branch
    const again = (await ok(d, "engine.crew.start", { threadId: chat, projectId: project, teammateId: teammate, title: "Footer", brief: "Add a footer.", idempotencyKey: "crew-start-2" })).job;
    assert.equal(again.branch, "crew/ember-2");
    assert.notEqual(workFolder(dir, owner, again.threadId), work);
    // let its turn finish before the daemon stops
    await waitFor(async () => (((await ok(d, "chat.messages.list", { threadId: again.threadId })).messages as Array<{ author: { kind: string } }>).some((m) => m.author.kind === "agent") ? true : null), 20_000, () => hostLog(d));
  } finally { await stop(d); }
});
