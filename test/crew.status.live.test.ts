// engine.crew.status (owner, 4 Nov 2026): one read of the crew of a chat for the Island, the header chip and the Crew pane: a helper and a teammate, each with state, model, account, branch, files, tokens and cost, the
// parent's id, and totals for the whole crew. Real chat, engine, git and tools on a booted daemon; only the model is scripted.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { claimedSpace, hostLog, scriptedModel, stop, waitFor } from "./support/eco-live.ts";
import { workFolder } from "../modules/engine/sandbox.ts";

const git = (cwd: string, ...args: string[]): void => { const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }); assert.equal(r.status, 0, r.stderr); };

test("the crew of a chat in one read: a helper and a teammate with their states, branch, files, usage and parent, and the totals", async () => {
  let lead = ""; let chat = ""; let dir = ""; let owner = "";
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id === lead && input.threadId === chat) {
      if (!/start both/.test(input.trigger?.body ?? "")) return;
      yield* run("tool_search", { query: "sub task helper" }); yield* run("tool_search", { query: "crew teammate" });
      yield* run("sub_task_model", { threadId: chat, title: "Read the page", instruction: "Read it.", idempotencyKey: "cs-h" });
      yield* run("crew_start", { threadId: chat, title: "Add a file", brief: "Add status.txt.", idempotencyKey: "cs-t" });
      yield { type: "text", text: "Started both." };
      return;
    }
    if (input.agent.id === lead) { yield { type: "text", text: "The page lists three plans." }; yield { type: "usage", inputTokens: 120, outputTokens: 30 }; return; }
    // the teammate: its own copy, one commit
    const work = workFolder(dir, owner, input.threadId, input.agent.id);
    await waitFor(async () => (fs.existsSync(path.join(work, ".git")) ? true : null), 20_000);
    fs.writeFileSync(path.join(work, "status.txt"), "a\nb\n");
    git(work, "add", "-A"); git(work, "commit", "--quiet", "-m", "add status");
    yield { type: "text", text: "Added status.txt." };
  });
  const s = await claimedSpace(model);
  lead = s.assistant; dir = s.d.paths.root; owner = s.owner;
  try {
    chat = (await s.api("chat.start", { kind: "chat", agentIds: [lead], title: "Crew status", idempotencyKey: "cs-chat" })).thread.threadId as string;
    await s.api("chat.post", { threadId: chat, body: "start both", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "cs-ask" });
    const st = await waitFor(async () => {
      const r = await s.api("engine.crew.status", { threadId: chat });
      return r.members.length === 2 && r.members.every((m: { state: string }) => m.state === "done") ? r : null;
    }, 60_000, () => hostLog(s.d)).catch(async (e) => { console.log("STATUS", JSON.stringify(await s.api("engine.crew.status", { threadId: chat })), JSON.stringify(((await s.api("chat.messages.list", { threadId: chat })).messages as Array<{ author: { kind: string }; body: string }>).map((m) => [m.author.kind, m.body.slice(0, 120)]))); throw e; });
    const helper = st.members.find((m: { kind: string }) => m.kind === "helper");
    const mate = st.members.find((m: { kind: string }) => m.kind === "teammate");
    assert.equal(helper.parentThreadId, chat);
    assert.equal(mate.parentThreadId, chat, "the parent's id");
    assert.match(mate.branch, /^crew\//);
    assert.deepEqual(mate.files, [{ path: "status.txt", added: 2, deleted: 0 }]);
    assert.deepEqual([mate.added, mate.deleted], [2, 0]);
    assert.equal(typeof helper.elapsedMs, "number");
    assert.equal(helper.found, "The page lists three plans.");
    // the totals are the sums of what the members report, nothing more
    assert.equal(st.totals.members, 2);
    assert.equal(st.totals.done, 2);
    assert.equal(st.totals.filesChanged, 1);
    assert.equal(st.totals.tokensIn, st.members.reduce((n: number, m: { tokensIn: number }) => n + m.tokensIn, 0));
    assert.equal(st.totals.costMicros, st.members.reduce((n: number, m: { costMicros: number }) => n + m.costMicros, 0));
    assert.ok(st.totals.tokensIn >= 120, `the helper's usage row is counted: ${JSON.stringify(st.totals)}`);
  } finally { await stop(s.d); }
});
