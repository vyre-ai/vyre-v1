// A lead agent and its helper (a crew teammate working in its own thread under the lead's chat), on a booted daemon: the lead, working for the owner, stops its helper's turn (a person's agent may reach
// the turns the person could), and "stop every helper" (engine.helpers.stop_all) from the lead stops the helper too. Only the model is scripted.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  boot,
  connect,
  makeAgent,
  ok,
  scriptedModel,
  seededDir,
  startChat,
  stop,
  waitFor,
} from "./support/eco-live.ts";

test("a lead agent stops its helper's turn, and stops every helper", async () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-stop-repo-")));
  const git = (...a: string[]) =>
    spawnSync("git", a, {
      cwd: repo,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });
  git("init", "--quiet", "-b", "main");
  fs.writeFileSync(path.join(repo, "README.md"), "a small site\n");
  git("add", "-A");
  git("commit", "--quiet", "-m", "first");

  let teammate = "";
  let helperThread = "";
  const held: string[] = [];
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id === teammate) {
      held.push(input.threadId);
      await new Promise<void>(() => undefined); // working until a Stop cancels it
      return;
    }
    const body = String(input.trigger?.body ?? "");
    if (/STOP-ONE/.test(body)) {
      yield* run("tool_search", { query: "engine stop" });
      const r = yield* run("engine_stop", { threadId: helperThread, agentId: teammate });
      yield { type: "text", text: `RESULT ${JSON.stringify(r.content).slice(0, 200)}` };
    } else if (/STOP-ALL/.test(body)) {
      yield* run("tool_search", { query: "engine helpers stop_all" });
      const r = yield* run("engine_helpers_stop_all", { threadId: String(input.threadId) });
      yield { type: "text", text: `RESULT ${JSON.stringify(r.content).slice(0, 200)}` };
    }
  });
  const d = await boot(seededDir(), model);
  try {
    await connect(d);
    const project = (await ok(d, "projects.create", { type: "project", title: "Small site", idempotencyKey: "sh-p" }))
      .projectId as string;
    teammate = (
      await ok(d, "projects.teammates.create", {
        projectId: project,
        name: "Ember",
        role: "member",
        idempotencyKey: "sh-t",
      })
    ).teammate.agentId as string;
    const lead = await makeAgent(d, "Lead");
    const chat = await startChat(d, lead, "sh");
    await ok(d, "threads.set_mode", { threadId: chat, mode: "auto", idempotencyKey: "sh-auto" });
    await ok(d, "engine.crew.repo.set", { projectId: project, path: repo });
    const start = async (key: string): Promise<string> =>
      (
        await ok(d, "engine.crew.start", {
          threadId: chat,
          projectId: project,
          teammateId: teammate,
          title: key,
          brief: "Work.",
          idempotencyKey: key,
        })
      ).job.threadId as string;
    helperThread = await start("sh-job1");
    await waitFor(async () => (held.includes(helperThread) ? true : null), 20_000);
    const working = async (): Promise<string[]> =>
      (((await ok(d, "engine.now", {})).working ?? []) as Array<{ agentId: string; threadId?: string }>)
        .filter((w) => w.threadId === helperThread)
        .map((w) => w.agentId);
    assert.deepEqual(await working(), [teammate]);

    const said = async (needle: string): Promise<string> => {
      const before = ((await ok(d, "chat.messages.list", { threadId: chat })).messages as unknown[]).length;
      await ok(d, "chat.post", {
        threadId: chat,
        body: needle,
        mentions: [{ kind: "agent", id: lead }],
        idempotencyKey: `sh-${needle}`,
      });
      return waitFor(async () => {
        const ms = (await ok(d, "chat.messages.list", { threadId: chat })).messages as Array<{
          author: { id: string };
          body: string;
        }>;
        return ms.slice(before).find((m) => m.author.id === lead && /RESULT/.test(m.body))?.body ?? null;
      }, 30_000);
    };
    const one = await said("STOP-ONE");
    assert.match(one, /"stopped":1/, `the lead stops its helper's turn: ${one}`);
    await waitFor(async () => ((await working()).length === 0 ? true : null), 10_000);

    // a second helper, stopped by "stop every helper"
    helperThread = await start("sh-job2");
    await waitFor(async () => (held.includes(helperThread) ? true : null), 20_000);
    const all = await said("STOP-ALL");
    assert.match(all, /"stopped":[1-9]/, `stop every helper from the lead: ${all}`);
    await waitFor(async () => ((await working()).length === 0 ? true : null), 10_000);
  } finally {
    await stop(d);
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
