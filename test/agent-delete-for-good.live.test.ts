// Delete an agent for good (F77), on a booted daemon, then scan everything: every table of every database file, as text, for a canary placed in each store the agent keeps. The canary appears nowhere after
// the job except the shared channel's message (the chat's record, shown under the agent's name) and the audit rows that stay on purpose. The job is killed half way and the daemon booted again, and run twice.
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { scan } from "./support/canary-scan.ts";
import { boot, call, hostLog, connect, makeAgent, scriptedModel, seededDir, waitFor } from "./support/live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const C = (what: string): string => `CANARY_${what}_9f3a1c`;
const model = scriptedModel(async function* () {
  yield { type: "text", text: "noted" };
});

test("an agent deleted for good leaves its canaries nowhere but the shared channel's message and the audit; killed half way and booted again it finishes; twice is no error", async () => {
  const dir = seededDir();
  let d: Daemon = await boot(dir, model);
  const results: Record<string, unknown> = {};
  try {
    await connect(d);
    const agentId = await makeAgent(d, "Desk");
    const agent = (await call(d, "agents.get", { agentId })).data.agent;
    const canaries = {
      memory: C("memory"),
      chat: C("chat1to1"),
      file: C("filefolder"),
      routine: C("routine"),
      shared: C("sharedchannel"),
    };
    // a memory fact in the agent's own layer
    const fact = await call(d, "memory.remember", {
      text: canaries.memory,
      layer: "agent",
      agentId,
      idempotencyKey: "m1",
    });
    assert.equal(fact.status, 200, JSON.stringify(fact.data));
    // a one-to-one chat with a message
    const chat = await call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "c1" });
    const threadId = chat.data.thread.threadId as string;
    await call(d, "chat.post", { threadId, body: canaries.chat, idempotencyKey: "c1p" });
    // a file in its folder
    const file = await call(d, "files.create", {
      folderId: agent.folderId,
      name: "notes.txt",
      content: { text: canaries.file },
      idempotencyKey: "f1",
    });
    assert.equal(file.status, 200, JSON.stringify(file.data));
    // a routine
    const routine = await call(d, "agents.routine.save", {
      agentId,
      title: "Morning",
      cron: "0 9 * * 1-5",
      prompt: canaries.routine,
      idempotencyKey: "r1",
    });
    assert.equal(routine.status, 200, JSON.stringify(routine.data));
    // a shared channel with a message from a person
    const ch = await call(d, "channels.create", {
      name: "team",
      visibility: "public",
      agentIds: [agentId],
      idempotencyKey: "ch1",
    });
    assert.equal(ch.status, 200, JSON.stringify(ch.data));
    results["channel"] = ch.data.channel;
    const sharedPost = await call(d, "chat.post", {
      threadId: ch.data.channel.mainThreadId,
      body: canaries.shared,
      idempotencyKey: "sh1",
    });
    assert.equal(sharedPost.status, 200, JSON.stringify(sharedPost.data));
    // a task assigned to it
    const task = await call(d, "tasks.create", {
      title: "Check the desk",
      assigned: { kind: "agent", id: agentId },
      idempotencyKey: "t1",
    });
    assert.equal(task.status, 200, JSON.stringify(task.data));

    const taskId = task.data.task?.taskId ?? task.data.taskId ?? task.data.task?.id;
    // delete (Trash): it leaves the lists; restore brings it back; delete again
    assert.equal((await call(d, "agents.delete", { agentId })).status, 200);
    assert.equal((await call(d, "agents.get", { agentId })).status, 404);
    assert.equal((await call(d, "agents.restore", { agentId })).status, 200, "restore brings it back");
    assert.equal((await call(d, "agents.get", { agentId })).status, 200);
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal((await call(d, "agents.delete", { agentId })).status, 200);
    // one event, one line: Trash, restore and Trash again leave one "was deleted." line in the channel, and delete for good adds none
    const lines = async (): Promise<number> =>
      (
        (await call(d, "chat.messages.list", { threadId: ch.data.channel.mainThreadId })).data.messages as Array<{
          body?: string;
        }>
      ).filter((m) => m.body === "Desk was deleted.").length;
    await waitFor(async () => ((await lines()) >= 1 ? true : null), 20_000);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(
      await lines(),
      1,
      `the channel shows the line once (${JSON.stringify(((await call(d, "chat.messages.list", { threadId: ch.data.channel.mainThreadId })).data.messages as Array<{ body?: string; kind?: string }>).map((m) => [m.kind, m.body]))})`,
    );

    results["logEarly"] = hostLog(d);
    const preview = await call(d, "agents.delete_preview", { agentId });
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    results["preview"] = preview.data;
    assert.ok(
      preview.data.named.every((n: { link: string }) => /^\/(tasks|goals|automations|projects)\//.test(n.link)),
      "each name that needs someone has a link",
    );
    assert.ok(preview.data.chats >= 1 && preview.data.memory >= 1 && preview.data.routines >= 1, "real counts");
    assert.match(preview.data.backups, /Backups/);

    // delete for good, and kill the daemon in the middle of the job
    const pressed = await call(d, "agents.delete_for_good", { agentId });
    assert.equal(pressed.status, 200, JSON.stringify(pressed.data));
    await d.stop();
    d = await boot(dir, model);
    await waitFor(async () => {
      const l = await call(d, "agents.trash.list", {});
      return l.data.agents?.some((a: { agentId: string }) => a.agentId === agentId) ? null : true;
    }, 60_000);
    // twice is no error
    const again = await call(d, "agents.delete_for_good", { agentId });
    assert.ok(
      again.status === 200 || again.status === 404,
      `pressing again on an erased agent is the same as for any gone thing, not a failure (${again.status})`,
    );
    results["logAfter"] = hostLog(d);
    assert.equal(await lines(), 1, "after delete for good the channel still shows the line once");
    const t = await call(d, "tasks.get", { taskId });
    results["task"] = t.data;
    assert.ok(!JSON.stringify(t.data).includes(`"id":"${agentId}"`), "the task no longer names the agent");
    assert.equal((await call(d, "agents.get", { agentId })).status, 404, "the id resolves to nothing");
    await d.stop();

    // the log: no event payload names the agent any more, so a replay of any projection (access grants, chat, engine) cannot bring its grants or its name back (kernel isErased makes an erased payload a no-op)
    const ev = new DatabaseSync(path.join(dir, "events.db"), { readOnly: true });
    const logHits = (
      ev.prepare("SELECT type FROM events WHERE instr(CAST(payload AS TEXT), ?) > 0").all(agentId) as { type: string }[]
    ).map((r) => r.type);
    const cacheHits = (
      ev.prepare("SELECT key FROM idempotency WHERE instr(CAST(result AS TEXT), ?) > 0").all(agentId) as {
        key: string;
      }[]
    ).map((r) => r.key);
    ev.close();
    results["logHits"] = { logHits, cacheHits };
    assert.deepEqual(
      [logHits, cacheHits],
      [["agent.erased"], []],
      "only the audit record of the erase (agent.erased: id and name at the time) names the agent in the log, and no kept answer does, so a replay cannot bring its grants or its name back",
    );
    const found = scan(dir, Object.values(canaries));
    results["hits"] = Object.fromEntries([...found].map(([k, v]) => [k, [...v]]));
    const bad = [...found].flatMap(([where, set]) =>
      [...set].filter((c) => c !== canaries.shared).map((c) => `${c} in ${where}`),
    );
    // the shared message may stand in the chat and in the event log that carried it; nothing else may hold any canary
    const sharedOnly = [...found].filter(([, set]) => set.has(canaries.shared));
    assert.ok(sharedOnly.length > 0, "the shared channel's message stays");
    assert.deepEqual(bad, [], `canaries left behind:\n${bad.join("\n")}`);
  } finally {
    console.log(JSON.stringify(results, null, 1));
    if (process.env["TMPDIR"])
      fs.writeFileSync(path.join(process.env["TMPDIR"], "agdel-hits.json"), JSON.stringify(results, null, 1));
    await d.stop().catch(() => undefined);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Trash keeps an agent as long as the Space keeps Trash, and then deletes it for good by itself (the clock moves, as the Files Trash tests do)", async () => {
  const dir = seededDir();
  let clock = Date.now();
  const d = await boot(dir, model, { now: () => clock });
  try {
    await connect(d);
    const agentId = await makeAgent(d, "Clockwork");
    assert.equal((await call(d, "agents.delete", { agentId })).status, 200);
    clock += 29 * 86_400_000;
    await new Promise((r) => setTimeout(r, 4_500));
    assert.ok(
      (await call(d, "agents.trash.list", {})).data.agents.some((a: { agentId: string }) => a.agentId === agentId),
      "29 days in: still in Trash",
    );
    clock += 2 * 86_400_000;
    await waitFor(
      async () =>
        (await call(d, "agents.trash.list", {})).data.agents.some((a: { agentId: string }) => a.agentId === agentId)
          ? null
          : true,
      60_000,
    );
    assert.equal((await call(d, "agents.get", { agentId })).status, 404);
  } finally {
    await d.stop().catch(() => undefined);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
