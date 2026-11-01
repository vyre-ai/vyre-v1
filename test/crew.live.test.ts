// The crew on a booted daemon (DESIGN-crew.md, step 1): a project with a repository on this computer, a teammate started from a lead's chat, its own thread under that chat, and its own copy of the repository
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

test("the lead starts a teammate with a tool, the teammate finishes and one result card wakes the lead, a person presses Merge and the branch lands, and the lead's own ask to merge holds at the Gate", async () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-crew-repo-")));
  git(repo, "init", "--quiet", "-b", "main");
  fs.writeFileSync(path.join(repo, "README.md"), "a small site\n");
  git(repo, "add", "-A"); git(repo, "commit", "--quiet", "-m", "first");

  let dir = "";
  let owner = "";
  let teammate = "";
  let project = "";
  let lead = "";
  let startAnswer = "";
  let sawCard = "";
  let jobId = "";
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id === teammate) {
      const work = workFolder(dir, owner, input.threadId);
      await waitFor(async () => (fs.existsSync(path.join(work, "README.md")) ? true : null), 20_000);
      fs.writeFileSync(path.join(work, "dark-mode.txt"), "toggle: on\n");   // left uncommitted on purpose: the finish commits it
      yield { type: "text", text: "Added the toggle; the test passes." };
      return;
    }
    if (input.agent.id !== lead) return;
    const ask = input.trigger?.body ?? "";
    if (/build dark mode/.test(ask)) {
      yield* run("tool_search", { query: "crew teammate" });
      const r = yield* run("crew_start", { threadId: input.threadId, idempotencyKey: "crew2-tool-start", projectId: project, teammateId: teammate, title: "Dark mode", brief: "Add a dark mode toggle and a test." });
      startAnswer = JSON.stringify(r.content).slice(0, 400);
      yield { type: "text", text: "Started Ember on dark mode." };
    } else if (input.trigger?.author.id === teammate) {
      sawCard = ask;
      yield* run("tool_search", { query: "crew teammate" });
      const jobs = yield* run("crew_list", { threadId: input.threadId });
      jobId = (((jobs.content as { data?: { jobs?: Array<{ jobId: string }> } }).data?.jobs) ?? [])[0]?.jobId ?? "";
      // an agent's merge is held for a person: this call parks the turn until someone answers, which this test never does
      yield* run("crew_merge", { jobId, idempotencyKey: "crew2-tool-merge" });
      yield { type: "text", text: "Reviewed the card." };
    }
  });
  const d = await boot(seededDir(), model);
  dir = d.paths.root;
  try {
    await connect(d);
    lead = await makeAgent(d, "Lead");
    owner = (await ok(d, "agents.get", { agentId: lead })).agent.ownerId as string;
    project = (await ok(d, "projects.create", { type: "project", title: "Small site", idempotencyKey: "crew2-project" })).projectId as string;
    teammate = (await ok(d, "projects.teammates.create", { projectId: project, name: "Ember", role: "member", idempotencyKey: "crew2-ember" })).teammate.agentId as string;
    await ok(d, "engine.crew.repo.set", { projectId: project, path: repo });
    const chat = await startChat(d, lead, "crew2");

    await ok(d, "chat.post", { threadId: chat, body: "build dark mode", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "crew2-ask" });
    // the card: one message from the teammate in the lead's chat, mentioning the lead, carrying the result
    const card = await waitFor(async () => {
      const ms = (await ok(d, "chat.messages.list", { threadId: chat })).messages as Array<{ author: { id: string }; body: string; blocks: Array<{ type: string; data: Record<string, any> }> }>;   // eslint-disable-line @typescript-eslint/no-explicit-any
      return ms.find((m) => m.author.id === teammate && m.blocks.some((b) => b.type === "crew_result")) ?? null;
    }, 40_000, () => `START ${startAnswer.slice(0, 80)}`).catch(async (e) => {
      const jobs = (await ok(d, "engine.crew.list", { threadId: chat })).jobs as Array<{ threadId: string; state: string }>;
      const helper = jobs[0] ? ((await ok(d, "chat.messages.list", { threadId: jobs[0].threadId })).messages as Array<{ author: { kind: string }; body: string }>).map((m) => `${m.author.kind}:${m.body.slice(0, 80)}`) : [];
      const lm = ((await ok(d, "chat.messages.list", { threadId: chat })).messages as Array<{ author: { kind: string }; body: string }>).map((m) => `${m.author.kind}:${m.body.slice(0, 80)}`);
      throw new Error(`${String(e).slice(0, 100)} JOBS ${JSON.stringify(jobs.map((j) => j.state))} HELPER ${JSON.stringify(helper)} LEAD ${JSON.stringify(lm)} LOG ${hostLog(d).split("\",\"").filter((l) => /bridge|engine|crew|turn/i.test(l)).join(" || ").slice(0, 2500)}`);
    });
    const data = card.blocks.find((b) => b.type === "crew_result")!.data;
    assert.deepEqual([data["name"], data["title"], data["branch"], data["state"], data["ahead"]], ["Ember", "Dark mode", "crew/ember-1", "done", 1]);
    assert.deepEqual((data["files"] as Array<{ path: string }>).map((f) => f.path), ["dark-mode.txt"]);
    assert.match(card.body, /Ember finished "Dark mode": 1 commit, 1 file on crew\/ember-1\./);
    assert.match(card.body, /the test passes/);
    const cards = ((await ok(d, "chat.messages.list", { threadId: chat })).messages as Array<{ author: { id: string }; blocks: Array<{ type: string }> }>).filter((m) => m.blocks.some((b) => b.type === "crew_result"));
    assert.equal(cards.length, 1, "one card, not a stream");
    // the result is posted exactly once: no second copy of it, no "reply could not be shown" on a healthy turn, nothing refused in the log
    const lines = ((await ok(d, "chat.messages.list", { threadId: chat })).messages as Array<{ author: { id: string }; body: string; blocks: Array<{ type: string; data?: { code?: string } }> }>);
    assert.equal(lines.filter((m) => m.author.id === teammate).length, 1, "the teammate has one message in the lead's chat");
    assert.equal(lines.filter((m) => m.blocks.some((b) => b.type === "turn_status" && b.data?.code === "engine.post_failed")).length, 0, "no lost-reply notice");
    assert.doesNotMatch(hostLog(d), /could not post an agent reply|could not even say/);

    // the card woke the lead, which listed the crew and asked to merge: that is held at the Gate for a person, and nothing landed
    const hold = await waitFor(async () => {
      const holds = (await ok(d, "gate.holds.list", {})).holds as Array<{ holdId: string; act: string; state: string }>;
      return holds.find((h) => h.act === "push_protected") ?? null;
    }, 60_000, () => `${hostLog(d)} SAW ${sawCard.slice(0, 100)}`);
    assert.equal(hold.state, "held");
    assert.match(sawCard, /Ember finished "Dark mode"/);
    assert.notEqual(jobId, "");
    assert.equal(fs.existsSync(path.join(repo, "dark-mode.txt")), false, "the lead's merge did not land anything");

    // a person presses Merge: it lands
    const landed = await ok(d, "engine.crew.merge", { jobId, idempotencyKey: "crew2-merge" });
    assert.deepEqual([landed.landed, landed.job.state], [true, "merged"]);
    assert.equal(fs.readFileSync(path.join(repo, "dark-mode.txt"), "utf8"), "toggle: on\n");
    assert.match(git(repo, "log", "--format=%s", "-n", "3"), /Merge crew\/ember-1/);
    assert.deepEqual((await ok(d, "engine.crew.list", { threadId: chat })).jobs.map((j: { state: string }) => j.state), ["merged"]);

    // a person talks to the teammate directly in its own thread (a plain helper thread would refuse), and the teammate picks up again: a second card follows
    const threadOfJob = (await ok(d, "engine.crew.list", { threadId: chat })).jobs[0].threadId as string;
    await ok(d, "chat.post", { threadId: threadOfJob, body: "Also add a footer.", mentions: [{ kind: "agent", id: teammate }], idempotencyKey: "crew2-steer" });
    await waitFor(async () => {
      const ms = (await ok(d, "chat.messages.list", { threadId: chat })).messages as Array<{ blocks: Array<{ type: string }> }>;
      return ms.filter((m) => m.blocks.some((b) => b.type === "crew_result")).length >= 2 ? true : null;
    }, 40_000, () => hostLog(d));
    // and the lead can message it too
    assert.equal((await ok(d, "engine.crew.message", { jobId, body: "One more thing.", idempotencyKey: "crew2-msg" })).sent, true);
    await waitFor(async () => {
      const ms = (await ok(d, "chat.messages.list", { threadId: chat })).messages as Array<{ blocks: Array<{ type: string }> }>;
      return ms.filter((m) => m.blocks.some((b) => b.type === "crew_result")).length >= 3 ? true : null;
    }, 40_000, () => hostLog(d));
    // the lead can wait on the checks of a pull request: the host watches, the Crew tab shows the wait
    const wait = (await ok(d, "engine.crew.wait", { threadId: chat, repo: "acme/site", number: 12, idempotencyKey: "crew2-wait" })).wait;
    assert.deepEqual([wait.label, wait.state], ["acme/site#12", "pending"]);
    assert.deepEqual((await ok(d, "engine.crew.list", { threadId: chat })).waits.map((w: { label: string }) => w.label), ["acme/site#12"]);
    // pushing the merged work to the remote is an outward act: it holds at the Gate and nothing leaves until a person approves
    const remote = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-crew-remote-")));
    git(remote, "init", "--quiet", "--bare", "-b", "main");
    git(repo, "remote", "add", "origin", remote);
    const pushed = await call(d, "engine.crew.push", { jobId, idempotencyKey: "crew2-push" });
    assert.equal(pushed.status, 202, JSON.stringify(pushed.data));
    assert.equal(pushed.data.status, "held");
    assert.notEqual(spawnSync("git", ["rev-parse", "--verify", "main"], { cwd: remote }).status, 0, "nothing reached the remote");
    // stopping a teammate that is idle leaves the job as it was; stopping is for a running one
    assert.equal((await ok(d, "engine.crew.stop", { jobId, idempotencyKey: "crew2-stop" })).job.jobId, jobId);
  } finally { await stop(d); }
});

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
    const work = workFolder(dirData, owner, input.threadId);
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
    const work = workFolder(dirData, owner, input.threadId);
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
