// The crew on a person's own computer (owner tests 4 Nov, DESIGN-crew.md): any chat can start a crew, with or without a project, on a Space with no GitHub, and the owner's own Assistant does the setup
// itself. The Space is claimed the way a person claims one, so the Assistant exists as it does for every real person. Nothing inside the daemon is faked but the model vendor, a scripted session that makes
// the tool calls a model would.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { claimedSpace, hostLog, scriptedModel, stop, waitFor } from "./support/eco-live.ts";
import { workFolder } from "../modules/engine/sandbox.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

type Answer = { ok: boolean; content: { data?: any; error?: { code?: string; message?: string } } };   // eslint-disable-line @typescript-eslint/no-explicit-any
const data = (a: Answer, what: string): any => { assert.equal(a.ok, true, `${what}: ${JSON.stringify(a.content)}`); return a.content.data; };   // eslint-disable-line @typescript-eslint/no-explicit-any
const git = (cwd: string, ...args: string[]): string => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};

test("the owner's Assistant makes a project in one go, every read of the id list gives resolves, it adds a teammate and provisions a computer; a Space agent asked by the owner is refused", async () => {
  const out: Record<string, any> = {};   // eslint-disable-line @typescript-eslint/no-explicit-any
  let assistant = ""; let spaceAgent = "";
  let d: Daemon | undefined;
  const model = scriptedModel(async function* (input, run) {
    if (!/make a project/.test(input.trigger?.body ?? "")) return;
    const mine = input.agent.id === assistant;
    if (!mine && input.agent.id !== spaceAgent) return;
    yield* run("tool_search", { query: "projects create get list members teammates" });
    yield* run("tool_search", { query: "projects get project" });
    yield* run("tool_search", { query: "computers provision" });
    if (!mine) {
      // a Space agent acting for the owner: it makes a project (it is only edit-level) but is not the owner on it
      const made = data((yield* run("projects_create", { type: "project", title: "By a Space agent", idempotencyKey: "sa1" })) as Answer, "projects_create");
      await d!.hooks?.pump?.();
      out["sa_mate"] = yield* run("projects_teammates_create", { projectId: made.projectId, name: "Nope", role: "member", idempotencyKey: "sa-t1" });
      out["sa_prov"] = yield* run("computers_provision", { agentId: spaceAgent, idempotencyKey: "sa-cp1" });
      return;
    }
    const made = data((yield* run("projects_create", { type: "project", title: "Crew test", idempotencyKey: "p1" })) as Answer, "projects_create");
    out["made"] = made;
    await d!.hooks?.pump?.();
    out["list"] = data((yield* run("projects_list", {})) as Answer, "projects_list");
    out["get"] = data((yield* run("projects_get", { projectId: made.projectId })) as Answer, "projects_get");
    out["members"] = data((yield* run("projects_members_list", { projectId: made.projectId })) as Answer, "projects_members_list");
    out["mates"] = data((yield* run("projects_teammates_list", { projectId: made.projectId })) as Answer, "projects_teammates_list");
    out["mate"] = data((yield* run("projects_teammates_create", { projectId: made.projectId, name: "Ember", role: "member", idempotencyKey: "t1" })) as Answer, "projects_teammates_create");
    out["computer"] = data((yield* run("computers_provision", { agentId: assistant, idempotencyKey: "cp1" })) as Answer, "computers_provision");
    yield { type: "text", text: "done" };
  });
  const s = await claimedSpace(model);
  d = s.d; assistant = s.assistant;
  try {
    spaceAgent = (await s.api("agents.create", { name: "Space helper", role: "You help.", idempotencyKey: "sa-agent" })).agent.agentId as string;
    for (const [who, key] of [[assistant, "a"], [spaceAgent, "b"]] as const) {
      const chat = (await s.api("chat.start", { kind: "chat", agentIds: [who], idempotencyKey: `setup-${key}` })).thread.threadId as string;
      await s.api("chat.post", { threadId: chat, body: "make a project", mentions: [{ kind: "agent", id: who }], idempotencyKey: `setup-${key}-post` });
      await waitFor(async () => (key === "a" ? out["computer"] : out["sa_prov"]) !== undefined ? true : null, 40_000, () => `${hostLog(d!)} ${JSON.stringify(out).slice(0, 600)}`);
    }
    const id = out["made"].projectId as string;
    assert.deepEqual(out["list"].projects.map((p: { projectId: string }) => p.projectId), [id], "one project, not a half-made second");
    assert.equal(out["get"].project.projectId, id);
    assert.equal(out["members"].members.find((m: { principal: string }) => m.principal === s.owner)?.role, "lead");
    assert.deepEqual(out["mates"].teammates, []);
    assert.equal(out["mate"].teammate.madeForProject, true);
    assert.equal(out["computer"].computer.agentId, assistant);
    // the project's chat starts with someone to answer: its maker's Assistant, so a plain message is not met with silence
    await s.d.hooks?.pump?.();
    const channel = (await s.api("channels.get", { channelId: out["made"].channelId })).channel as { mainThreadId: string };
    const thread = (await s.api("threads.get", { threadId: channel.mainThreadId })).thread as { agents: Array<{ agentId: string }> };
    assert.deepEqual(thread.agents.map((a) => a.agentId), [assistant], "the project chat has its lead from the start");
    const route = await s.api("engine.route.preview", { threadId: channel.mainThreadId });
    assert.deepEqual(route.responders, [assistant], "a plain message in the project chat is answered by its lead");
    // a Space agent is not the owner's hands: it is refused where the Assistant passes
    assert.equal((out["sa_mate"] as Answer).ok, false, JSON.stringify(out["sa_mate"]));
    assert.equal((out["sa_prov"] as Answer).ok, false, JSON.stringify(out["sa_prov"]));
  } finally { await stop(d); }
});

test("making a project that fails half way leaves no project behind", async () => {
  const out: Record<string, any> = {};   // eslint-disable-line @typescript-eslint/no-explicit-any
  let assistant = "";
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== assistant || !/make a project/.test(input.trigger?.body ?? "")) return;
    yield* run("tool_search", { query: "projects create list" });
    // a starter nobody can give a role to: refused before anything is made
    out["bad"] = yield* run("projects_create", { type: "project", title: "Never made", members: [{ principal: "usr_nobody", role: "member" }], idempotencyKey: "bad1" });
    out["list"] = yield* run("projects_list", {});
  });
  const s = await claimedSpace(model);
  assistant = s.assistant;
  try {
    const chat = (await s.api("chat.start", { kind: "chat", agentIds: [assistant], idempotencyKey: "setup2" })).thread.threadId as string;
    await s.api("chat.post", { threadId: chat, body: "make a project", mentions: [{ kind: "agent", id: assistant }], idempotencyKey: "setup2-post" });
    await waitFor(async () => (out["list"] !== undefined ? true : null), 40_000, () => hostLog(s.d));
    assert.equal((out["bad"] as Answer).ok, false);
    assert.deepEqual(((out["list"] as Answer).content.data.projects as unknown[]), []);
    assert.equal(((await s.api("projects.list", {})).projects as unknown[]).length, 0);
  } finally { await stop(s.d); }
});

/** "Start a crew of two" in a chat: the Assistant starts two teammates with nothing set up first, each works on its own branch, a result card arrives for each, and Merge lands both. */
async function crewOfTwo(o: { inProject: boolean }): Promise<void> {
  let lead = ""; let dir = ""; let owner = ""; let project = "";
  const started: Answer[] = [];
  const seen = new Map<string, string>();   // teammate agent id -> the file it adds
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id === lead) {
      if (!/start a crew of two/.test(input.trigger?.body ?? "")) return;
      yield* run("tool_search", { query: "crew teammate" });
      for (const name of ["toggle", "test"]) {
        started.push((yield* run("crew_start", { threadId: input.threadId, idempotencyKey: `local-${name}`, title: `Add the dark mode ${name}`, brief: `Add dark-mode-${name}.txt` })) as Answer);
      }
      yield { type: "text", text: "Started two teammates." };
      return;
    }
    // a teammate: the first time it runs it adds its file on its own branch
    const work = workFolder(dir, owner, input.threadId, input.agent.id);
    await waitFor(async () => (fs.existsSync(path.join(work, ".git")) ? true : null), 20_000);
    const file = seen.get(input.agent.id) ?? `dark-mode-${seen.size === 0 ? "toggle" : "test"}.txt`;
    seen.set(input.agent.id, file);
    fs.writeFileSync(path.join(work, file), `${file}\n`);
    git(work, "add", "-A"); git(work, "commit", "--quiet", "-m", `add ${file}`);
    yield { type: "text", text: `Added ${file}.` };
  });
  const s = await claimedSpace(model);
  dir = s.d.paths.root; lead = s.assistant; owner = s.owner;
  try {
    const chatIn: Record<string, unknown> = { kind: "chat", agentIds: [lead], title: "Dark mode", idempotencyKey: `local-chat-${o.inProject}` };
    if (o.inProject) {
      project = (await s.api("projects.create", { type: "project", title: "Local site", idempotencyKey: "local-project" })).projectId as string;
      chatIn["scopeType"] = "project"; chatIn["scopeId"] = project;
    }
    const chat = (await s.api("chat.start", chatIn)).thread.threadId as string;
    await s.api("chat.post", { threadId: chat, body: "start a crew of two to add a dark mode toggle and a test", mentions: [{ kind: "agent", id: lead }], idempotencyKey: `local-ask-${o.inProject}` });

    const cards = await waitFor(async () => {
      const ms = (await s.api("chat.messages.list", { threadId: chat })).messages as Array<{ author: { id: string }; blocks: Array<{ type: string; data: Record<string, any> }> }>;   // eslint-disable-line @typescript-eslint/no-explicit-any
      const found = ms.filter((m) => m.blocks.some((b) => b.type === "crew_result"));
      return found.length >= 2 ? found : null;
    }, 60_000, () => `${hostLog(s.d)} ${JSON.stringify(started).slice(0, 700)}`);
    assert.equal(cards.length, 2);
    for (const a of started) assert.equal(a.ok, true, JSON.stringify(a.content));

    // nothing was set up first, and the repository is a real one on this computer with main as its start, no remote
    const jobs = (await s.api("engine.crew.list", { threadId: chat })).jobs as Array<{ jobId: string; branch: string; state: string; projectId?: string; agentId: string }>;
    assert.equal(jobs.length, 2);
    assert.deepEqual(jobs.map((j) => j.state), ["done", "done"]);
    assert.equal(new Set(jobs.map((j) => j.branch)).size, 2, "each teammate has its own branch");
    for (const j of jobs) assert.ok(j.branch.startsWith("crew/"), j.branch);
    assert.deepEqual(jobs.map((j) => j.projectId ?? null), o.inProject ? [project, project] : [null, null]);
    const repo = (await (o.inProject ? s.api("engine.crew.repo.get", { projectId: project }) : s.api("engine.crew.chat_repo", { threadId: chat }))).repo as { path: string; baseBranch: string; branch: string };
    assert.deepEqual([repo.baseBranch, repo.branch], ["main", "main"]);
    assert.ok(repo.path.startsWith(path.join(dir, "trees") + path.sep), repo.path);
    assert.equal(git(repo.path, "remote").trim(), "", "no remote: GitHub is optional");
    // the teammates belong to the chat (or its project), not to the Agents page
    const listed = (await s.api("agents.list", {})).agents as Array<{ agentId: string }>;
    for (const j of jobs) assert.equal(listed.some((a) => a.agentId === j.agentId), false, "a crew teammate is not on the Agents page");
    if (!o.inProject) {
      const t = (await s.api("threads.get", { threadId: chat })).thread as { folderId?: string };
      assert.ok(t.folderId, "the chat has its work folder in Files");
      assert.ok(repo.path.endsWith(t.folderId!), "the repository is in that folder");
    }

    // Merge, the button on each card: both branches land
    for (const j of jobs) assert.equal((await s.api("engine.crew.merge", { jobId: j.jobId, idempotencyKey: `local-merge-${j.jobId}` })).landed, true);
    for (const f of ["dark-mode-toggle.txt", "dark-mode-test.txt"]) assert.equal(fs.readFileSync(path.join(repo.path, f), "utf8"), `${f}\n`);
    assert.deepEqual((await s.api("engine.crew.list", { threadId: chat })).jobs.map((j: { state: string }) => j.state), ["merged", "merged"]);
  } finally { await stop(s.d); }
}

test("in a plain chat, on a Space with no GitHub, 'start a crew of two' makes the chat's folder and repository, two teammates on their own branches, a result card each, and Merge lands them", async () => { await crewOfTwo({ inProject: false }); });
test("in a project chat the same crew uses the project's repository and its roles", async () => { await crewOfTwo({ inProject: true }); });
