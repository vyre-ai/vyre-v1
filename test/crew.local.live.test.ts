// The crew on a person's own computer (owner test 4 Nov, DESIGN-crew.md): a Space with no Docker and no GitHub, the owner's assistant doing the setup itself. Nothing inside the daemon is faked but
// the model vendor, a scripted session that makes the tool calls a model would.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, hostLog, makeAgent, ok, scriptedModel, seededDir, startChat, stop, waitFor } from "./support/eco-live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

type Answer = { ok: boolean; content: { data?: any; error?: { code?: string; message?: string } } };   // eslint-disable-line @typescript-eslint/no-explicit-any
const data = (a: Answer, what: string): any => { assert.equal(a.ok, true, `${what}: ${JSON.stringify(a.content)}`); return a.content.data; };   // eslint-disable-line @typescript-eslint/no-explicit-any

test("the owner's assistant makes a project all in one go, and every read of the id list gives resolves; it adds a teammate and provisions a computer", async () => {
  const out: Record<string, any> = {};   // eslint-disable-line @typescript-eslint/no-explicit-any
  let lead = "";
  let d: Daemon | undefined;
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== lead || !/make a project/.test(input.trigger?.body ?? "")) return;
    yield* run("tool_search", { query: "projects create get list members teammates" });
    yield* run("tool_search", { query: "projects get project" });
    yield* run("tool_search", { query: "computers provision" });
    const made = data((yield* run("projects_create", { type: "project", title: "Crew test", members: [{ principal: "usr_noah", role: "member" }], idempotencyKey: "p1" })) as Answer, "projects_create");
    out["made"] = made;
    await d!.hooks?.pump?.();
    out["list"] = data((yield* run("projects_list", {})) as Answer, "projects_list");
    out["get"] = data((yield* run("projects_get", { projectId: made.projectId })) as Answer, "projects_get");
    out["members"] = data((yield* run("projects_members_list", { projectId: made.projectId })) as Answer, "projects_members_list");
    out["mates"] = data((yield* run("projects_teammates_list", { projectId: made.projectId })) as Answer, "projects_teammates_list");
    out["mate"] = data((yield* run("projects_teammates_create", { projectId: made.projectId, name: "Ember", role: "member", idempotencyKey: "t1" })) as Answer, "projects_teammates_create");
    out["computer"] = data((yield* run("computers_provision", { agentId: lead, idempotencyKey: "cp1" })) as Answer, "computers_provision");
    yield { type: "text", text: "done" };
  });
  d = await boot(seededDir(), model);
  try {
    await connect(d);
    lead = await makeAgent(d, "Lead");
    const chat = await startChat(d, lead, "setup1");
    await ok(d, "chat.post", { threadId: chat, body: "make a project", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "setup1-post" });
    await waitFor(async () => (out["computer"] !== undefined ? true : null), 40_000, () => `${hostLog(d!)} ${JSON.stringify(out).slice(0, 600)}`);
    const id = out["made"].projectId as string;
    assert.deepEqual(out["list"].projects.map((p: { projectId: string }) => p.projectId), [id], "one project, not a half-made second");
    assert.equal(out["get"].project.projectId, id);
    assert.equal(out["members"].members.find((m: { principal: string }) => m.principal === "usr_olivia")?.role, "lead");
    assert.deepEqual(out["mates"].teammates, []);
    assert.equal(out["mate"].teammate.madeForProject, true);
    assert.equal(out["computer"].computer.agentId, lead);
    // the people a project starts with get their grant on it, written by the host once the project exists
    const shares = (await ok(d, "access.shares_of", { resource: { type: "project", id } })).shares as Array<{ grant: { subject: { id: string }; level: string } }>;
    assert.equal(shares.find((s) => s.grant.subject.id === "usr_noah")?.grant.level, "edit", "Noah holds Edit on the project");
  } finally { await stop(d); }
});

test("making a project that fails half way leaves no project behind", async () => {
  const out: Record<string, any> = {};   // eslint-disable-line @typescript-eslint/no-explicit-any
  let lead = "";
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== lead || !/make a project/.test(input.trigger?.body ?? "")) return;
    yield* run("tool_search", { query: "projects create list" });
    // a starter nobody can give a role to: refused before anything is made
    out["bad"] = yield* run("projects_create", { type: "project", title: "Never made", members: [{ principal: "usr_nobody", role: "member" }], idempotencyKey: "bad1" });
    out["list"] = yield* run("projects_list", {});
  });
  const d = await boot(seededDir(), model);
  try {
    await connect(d);
    lead = await makeAgent(d, "Lead");
    const chat = await startChat(d, lead, "setup2");
    await ok(d, "chat.post", { threadId: chat, body: "make a project", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "setup2-post" });
    await waitFor(async () => (out["list"] !== undefined ? true : null), 40_000, () => hostLog(d));
    assert.equal((out["bad"] as Answer).ok, false);
    assert.deepEqual(((out["list"] as Answer).content.data.projects as unknown[]), []);
    assert.equal(((await call(d, "projects.list", {})).data.projects as unknown[]).length, 0);
  } finally { await stop(d); }
});

// ---- a crew on the person's own computer: no Docker, no GitHub, no repository yet ----

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fakePlatform } from "../host/src/platform/index.ts";
import { workFolder } from "../modules/engine/sandbox.ts";

const git = (cwd: string, ...args: string[]): string => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};

test("in a Space with no Docker and no GitHub, a project with no repository: 'start a crew of two' makes the repository, two teammates work on their own branches, and Merge lands them", async () => {
  let dir = ""; let owner = ""; let lead = ""; let project = "";
  const mates: Record<string, string> = {};
  const started: Answer[] = [];
  const model = scriptedModel(async function* (input, run) {
    const mate = Object.entries(mates).find(([, id]) => id === input.agent.id)?.[0];
    if (mate) {
      const work = workFolder(dir, owner, input.threadId, input.agent.id);
      await waitFor(async () => (fs.existsSync(path.join(work, ".git")) ? true : null), 20_000);
      fs.writeFileSync(path.join(work, `${mate.toLowerCase()}.txt`), `${mate} was here\n`);
      git(work, "add", "-A"); git(work, "commit", "--quiet", "-m", `${mate} adds a file`);
      yield { type: "text", text: `${mate} finished.` };
      return;
    }
    if (input.agent.id !== lead || !/start a crew of two/.test(input.trigger?.body ?? "")) return;
    yield* run("tool_search", { query: "crew teammate" });
    for (const [name, id] of Object.entries(mates)) {
      started.push((yield* run("crew_start", { threadId: input.threadId, projectId: project, teammateId: id, title: `${name}'s part`, brief: `Add ${name.toLowerCase()}.txt`, idempotencyKey: `local-${name}` })) as Answer);
    }
    yield { type: "text", text: "Started two teammates." };
  });
  // a computer with git and no Docker: `docker info` finds nothing
  const seeded = seededDir();
  const platform = fakePlatform({
    os: "linux", hostname: "no-docker", free: 80e9,
    commands: { [`findmnt -n -o SOURCE --target ${seeded}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" } },
  });
  const d = await boot(seeded, model, { platform });
  dir = d.paths.root;
  try {
    await connect(d);
    lead = await makeAgent(d, "Lead");
    owner = (await ok(d, "agents.get", { agentId: lead })).agent.ownerId as string;
    project = (await ok(d, "projects.create", { type: "project", title: "Local site", idempotencyKey: "local-project" })).projectId as string;
    for (const name of ["Ember", "Birch"]) mates[name] = (await ok(d, "projects.teammates.create", { projectId: project, name, role: "member", idempotencyKey: `local-${name}-mate` })).teammate.agentId as string;
    assert.equal((await ok(d, "engine.crew.repo.get", { projectId: project })).repo, null, "no repository yet");
    const chat = await startChat(d, lead, "local1");
    await ok(d, "chat.post", { threadId: chat, body: "start a crew of two", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "local1-ask" });

    const cards = await waitFor(async () => {
      const ms = (await ok(d, "chat.messages.list", { threadId: chat })).messages as Array<{ author: { id: string }; blocks: Array<{ type: string; data: Record<string, any> }> }>;   // eslint-disable-line @typescript-eslint/no-explicit-any
      const found = ms.filter((m) => m.blocks.some((b) => b.type === "crew_result"));
      return found.length >= 2 ? found : null;
    }, 60_000, () => `${hostLog(d)} ${JSON.stringify(started).slice(0, 500)}`);
    assert.equal(cards.length, 2);
    for (const a of started) assert.equal(a.ok, true, JSON.stringify(a.content));

    // the repository the crew made is a real one on this computer, with main as its start, in the project's own folder
    const repo = (await ok(d, "engine.crew.repo.get", { projectId: project })).repo as { path: string; baseBranch: string; branch: string };
    assert.deepEqual([repo.baseBranch, repo.branch], ["main", "main"]);
    assert.ok(repo.path.startsWith(path.join(dir, "trees") + path.sep), repo.path);
    assert.equal(git(repo.path, "rev-parse", "--is-inside-work-tree").trim(), "true");
    assert.equal(git(repo.path, "remote").trim(), "", "no remote: GitHub is optional");

    const jobs = (await ok(d, "engine.crew.list", { threadId: chat })).jobs as Array<{ jobId: string; branch: string; state: string }>;
    assert.deepEqual(jobs.map((j) => j.branch).sort(), ["crew/birch-1", "crew/ember-1"]);
    assert.deepEqual(jobs.map((j) => j.state), ["done", "done"]);
    for (const c of cards) assert.equal(c.blocks.find((b) => b.type === "crew_result")!.data["ahead"], 1);

    // Merge, the button on each card: both branches land
    for (const j of jobs) assert.equal((await ok(d, "engine.crew.merge", { jobId: j.jobId, idempotencyKey: `local-merge-${j.jobId}` })).landed, true);
    assert.equal(fs.readFileSync(path.join(repo.path, "ember.txt"), "utf8"), "Ember was here\n");
    assert.equal(fs.readFileSync(path.join(repo.path, "birch.txt"), "utf8"), "Birch was here\n");
    assert.deepEqual((await ok(d, "engine.crew.list", { threadId: chat })).jobs.map((j: { state: string }) => j.state), ["merged", "merged"]);
  } finally { await stop(d); }
});
