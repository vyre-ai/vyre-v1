// A crew coder started in a chat that has no project gets its first turn every time (found by l-crews, 5 Nov: the job ended "lost" and its row said "Could not finish", while crew.journey, which starts its coder inside a
// project, never hit it). No repository, no project and no teammate made first: the coder is made for the job and its work folder is made from the chat's own folder. The model vendor is a scripted session that
// answers once the work folder exists, as the real opener's prepareWorkFolder would hold it; nothing else in the daemon is faked.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { workFolder } from "../modules/engine/sandbox.ts";
import { boot, connect, hostLog, makeAgent, ok, post, scriptedModel, seededDir, startChat, stop, waitFor } from "./support/eco-live.ts";

const COUNT = Number(process.env["CREW_FIRST_N"] ?? 4);

test("a coder started in a chat with no project runs its first turn, every time, and its job is never lost", { timeout: 240_000 }, async () => {
  let dir = "";
  let owner = "";
  let lead = "";
  const ran = new Set<string>();
  const model = scriptedModel(async function* (input) {
    if (input.agent.id === lead) return;
    ran.add(input.threadId);
    const work = workFolder(dir, owner, input.threadId, input.agent.id);
    await waitFor(async () => (fs.existsSync(path.join(work, ".git")) ? true : null), 20_000);
    yield { type: "text", text: "Done." };
  });
  const d = await boot(seededDir(), model);
  dir = d.paths.root;
  try {
    await connect(d);
    lead = await makeAgent(d, "Lead");
    owner = (await ok(d, "agents.get", { agentId: lead })).agent.ownerId as string;
    const chat = await startChat(d, lead, "plainfirst");
    const jobs: Array<{ jobId: string; threadId: string }> = [];
    for (let i = 1; i <= COUNT; i++) {
      const job = (await ok(d, "engine.crew.start", { threadId: chat, title: `Task ${i}`, brief: `Write file ${i}.`, idempotencyKey: `plainfirst-${i}` })).job as { jobId: string; threadId: string };
      jobs.push(job);
    }
    await waitFor(async () => (ran.size === jobs.length ? true : null), 60_000, () => `only ${ran.size} of ${jobs.length} coders had a first turn: ${hostLog(d).slice(-3000)}`);
    await waitFor(async () => {
      await d.hooks?.pump?.();
      const rows = (await ok(d, "engine.crew.list", { threadId: chat })).jobs as Array<{ jobId: string; state: string }>;
      return rows.length === jobs.length && rows.every((r) => r.state === "done") ? rows : null;
    }, 60_000, () => `jobs did not all finish: ${hostLog(d).slice(-3000)}`);
    const rows = (await ok(d, "engine.crew.list", { threadId: chat })).jobs as Array<{ state: string }>;
    assert.deepEqual(rows.map((r) => r.state), jobs.map(() => "done"), "no job ended lost or failed");
  } finally { await stop(d); }
});

test("the same, started by the lead's own tool call during its turn, as a person meets it", { timeout: 240_000 }, async () => {
  let dir = "";
  let owner = "";
  let lead = "";
  const ran = new Set<string>();
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== lead) {
      ran.add(input.threadId);
      const work = workFolder(dir, owner, input.threadId, input.agent.id);
      await waitFor(async () => (fs.existsSync(path.join(work, ".git")) ? true : null), 20_000);
      yield { type: "text", text: "Done." };
      return;
    }
    if (/start the coders/.test(input.trigger?.body ?? "")) {
      yield* run("tool_search", { query: "crew teammate" });
      for (let i = 1; i <= COUNT; i++) yield* run("crew_start", { threadId: input.threadId, idempotencyKey: `plainfirst-tool-${i}`, title: `Task ${i}`, brief: `Write file ${i}.` });
      yield { type: "text", text: "Started them." };
    }
  });
  const d = await boot(seededDir(), model);
  dir = d.paths.root;
  try {
    await connect(d);
    lead = await makeAgent(d, "Lead");
    owner = (await ok(d, "agents.get", { agentId: lead })).agent.ownerId as string;
    const chat = await startChat(d, lead, "plainfirst2");
    await post(d, chat, lead, "start the coders", "plainfirst-ask");
    const why = async (): Promise<string> => {
      const rows = (await ok(d, "engine.crew.list", { threadId: chat })).jobs as Array<{ jobId: string; threadId: string; state: string }>;
      const per: string[] = [];
      for (const r of rows) per.push(`${r.state}:${JSON.stringify(((await ok(d, "engine.turns.list", { threadId: r.threadId })).turns as Array<{ state: string; error?: unknown }>).map((t) => [t.state, t.error]))}`);
      const stuck = rows.filter((r) => r.state === "working").map((r) => r.threadId);
      const lines = hostLog(d).split('","').filter((l) => stuck.some((t) => l.includes(t))).map((l) => l.slice(0, 260));
      return `${per.join(" | ")} STUCKLOG ${JSON.stringify(lines)} QUEUE ${JSON.stringify(((await ok(d, "engine.queue.list", { threadId: stuck[0] ?? chat }).catch((e) => String(e))) as unknown))}`.slice(0, 5000);
    };
    let detail = "";
    await waitFor(async () => (ran.size === COUNT ? true : null), 60_000, () => `only ${ran.size} of ${COUNT} coders had a first turn`).catch(async (e) => { detail = await why(); throw new Error(`${String(e)} JOBS ${detail}`); });
    await waitFor(async () => {
      await d.hooks?.pump?.();
      const rows = (await ok(d, "engine.crew.list", { threadId: chat })).jobs as Array<{ state: string }>;
      return rows.length === COUNT && rows.every((r) => r.state === "done") ? rows : null;
    }, 60_000, () => `jobs did not all finish: ${hostLog(d).slice(-3000)}`);
  } finally { await stop(d); }
});
