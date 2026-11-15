// An agent's FIRST calls in one turn on an API engine, through the real tool layer, real handlers and a booted daemon (16 Nov 2026, the owner: "its first attempts are always failing"): a file made with no folder,
// then written and read in the same turn (nothing "read it first" for what the turn just made), a task made and updated, a record made and updated, a file whose name is taken. Every call is the first one a model
// writes from the tool's inputs: no key, no version, no folder, no chat. Only the model is scripted.
import test from "node:test";
import assert from "node:assert/strict";
import { claimedSpace, hostLog, scriptedModel, stop, waitFor } from "./support/eco-live.ts";

const table = [
  "| Rank | Applicant | Score |",
  "| --- | --- | --- |",
  ...Array.from({ length: 42 }, (_, i) => `| ${i + 1} | Applicant ${i + 1} | ${90 - i} |`),
].join("\n");

test("an agent's first calls in one turn all work: a file with no folder written and read at once, a task, a record, a taken name", async () => {
  let agent = "";
  const answers: Array<{ step: string; ok: boolean; content: unknown }> = [];
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== agent || !/first calls/.test(input.trigger?.body ?? "")) return;
    const call = async function* (step: string, tool: string, args: unknown) {
      const r = yield* run(tool, args);
      answers.push({ step, ok: r.ok, content: r.content });
      return r;
    };
    for (const q of ["files create write read", "tasks create update", "records create update"])
      yield* run("tool_search", { query: q });
    const made = yield* call("files_create", "files_create", { name: "Shortlist (16 Nov 2026).md", text: table });
    const fileId = /"fileId":"(fil_[a-z0-9]+)"/.exec(JSON.stringify(made.content))?.[1] ?? "fil_missing";
    yield* call("files_write", "files_write", { fileId, content: { text: `${table}\n\nAdded after.` } });
    yield* call("files_read", "files_read", { fileId });
    yield* call("files_create again", "files_create", { name: "Shortlist (16 Nov 2026).md", text: "second" });
    const task = yield* call("tasks_create", "tasks_create", { title: "Follow up with the top three" });
    const taskId = /"id":"(tsk_[a-z0-9]+)"/.exec(JSON.stringify(task.content))?.[1] ?? "tsk_missing";
    yield* call("tasks_update", "tasks_update", { taskId, summary: "Called two of three" });
    const rec = yield* call("records_create", "records_create", { type: "contact", fields: { name: "Dana Fox" } });
    const recordId = /"id":"(rec_[a-z0-9]+)"/.exec(JSON.stringify(rec.content))?.[1] ?? "rec_missing";
    yield* call("records_update", "records_update", { type: "contact", recordId, patch: { name: "Dana Fox-Lee" } });
    yield { type: "text", text: "All done." };
  });
  const s = await claimedSpace(model);
  agent = s.assistant;
  try {
    const chat = (await s.api("chat.start", { kind: "chat", agentIds: [agent], idempotencyKey: "fc-chat" })).thread
      .threadId as string;
    await s.api("threads.set_mode", { threadId: chat, mode: "auto" });
    await s.api("chat.post", {
      threadId: chat,
      body: "do the first calls",
      mentions: [{ kind: "agent", id: agent }],
      idempotencyKey: "fc-ask",
    });
    await waitFor(
      async () => {
        await s.d.hooks?.pump?.();
        return answers.length >= 8 ? true : null;
      },
      60_000,
      () => answers.map((a) => `${a.step}:${a.ok}:${JSON.stringify(a.content).slice(0, 260)}`).join(" | "),
    );
    const failed = answers.filter((a) => !a.ok).map((a) => `${a.step}: ${JSON.stringify(a.content).slice(0, 400)}`);
    assert.deepEqual(failed, [], "every first call worked");
    const read = answers.find((a) => a.step === "files_read");
    assert.match(JSON.stringify(read?.content), /Added after/, "the file holds what was written after it was made");
    const again = answers.find((a) => a.step === "files_create again");
    assert.match(JSON.stringify(again?.content), /Shortlist \(16 Nov 2026\) \(2\)\.md/, "a taken name becomes (2)");
    console.log(`first calls in one turn: ${answers.length} calls, ${answers.filter((a) => a.ok).length} worked`);
  } finally {
    await stop(s.d).catch(() => undefined);
  }
});
