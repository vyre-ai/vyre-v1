// Chat-brain live tests, second file (the first is chat-brain.live.test.ts): tool sets that follow the agent, the reviewer seat and Undo, on a booted daemon with a scripted model vendor. Split so each file stays
// under the 20 s a test file may take.
import test from "node:test";
import assert from "node:assert/strict";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";
import { boot, call, connect, hostLog, makeAgent, post, say, scriptedModel, seededDir, waitFor } from "./support/live.ts";

test("API chats apply the agent's deny list and plan mode to their tools, as the asker", async () => {
  const model = scriptedModel(async function* (input, run) {
    const text = input.trigger?.body ?? "";
    const r = yield* run("records_create", { type: "contact", fields: { name: text }, idempotencyKey: `rc-${text}` });
    yield { type: "text", text: r.ok ? "created" : `refused ${(r.content as { error?: { code?: string } }).error?.code}` };
  });
  const d = await boot(seededDir(), model);
  try {
    await connect(d);
    const open = await makeAgent(d, "Open");
    const closed = await makeAgent(d, "Closed", "You may not write records.", { toolsDenied: ["records_create"] });
    assert.equal((await say(d, open, "Ada Open", "dl1")).reply, "created");
    assert.match((await say(d, closed, "Bea Closed", "dl2")).reply, /^refused /, "the deny list is applied");
    const rows = (await call(d, "records.query", { type: "contact", limit: 50 })).data.rows as Array<{ fields: { name: string } }>;
    assert.ok(rows.some((r) => r.fields.name === "Ada Open") && !rows.some((r) => r.fields.name === "Bea Closed"));
    // plan mode: the agent reads and plans, and changes nothing
    const started = await call(d, "chat.start", { kind: "chat", agentIds: [open], idempotencyKey: "pm-start" });
    const threadId = started.data.thread.threadId as string;
    assert.equal((await call(d, "threads.set_plan_mode", { threadId, planMode: true, idempotencyKey: "pm-on" })).status, 200);
    assert.equal(await post(d, threadId, open, "Cy Planned", "pm1"), "refused permission.plan_mode");
  } finally { await d.stop(); }
});

test("the reviewer seat: an agent reviewer is asked in the chat after the lead's turn and answers once; a person reviewer gets a Review task", async () => {
  const model: OpenSession = async () => ({
    warm: true,
    async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
      const reviewing = /^Asking .* to check this\./.test(input.trigger?.body ?? "");
      yield { type: "text", text: reviewing ? `Approved by ${input.agent.id.slice(-4)}.` : `Done: ${input.trigger?.body ?? ""}` };
      yield { type: "done" };
    },
    sendToolResult() {}, inject() {}, async cancel() {}, async close() {},
  } as EngineSession);
  const d = await boot(seededDir(), model);
  try {
    await connect(d);
    const lead = await makeAgent(d, "Drafter", "You draft.");
    const rev = await makeAgent(d, "Checker", "You check.");
    const started = await call(d, "chat.start", { kind: "chat", agentIds: [lead], idempotencyKey: "rv-start" });
    const threadId = started.data.thread.threadId as string;
    assert.equal((await call(d, "engine.reviewer.set", { threadId, reviewer: { kind: "agent", id: lead } })).status, 422, "the lead cannot review itself");
    const set = await call(d, "engine.reviewer.set", { threadId, reviewer: { kind: "agent", id: rev } });
    assert.equal(set.status, 200, JSON.stringify(set.data));
    assert.deepEqual((await call(d, "engine.reviewer.get", { threadId })).data.reviewer, { kind: "agent", id: rev });
    await post(d, threadId, lead, "draft the letter", "rv1");
    const approved = await waitFor(async () => {
      await d.hooks?.pump?.();
      const ms = (await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ author: { id: string }; body: string }>;
      return ms.find((m) => m.author.id === rev && /^Approved/.test(m.body)) ?? null;
    }, 20_000, () => hostLog(d));
    assert.ok(approved);
    const all = (await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ author: { id: string }; body: string }>;
    assert.ok(all.some((m) => m.author.id === lead && m.body === "Done: draft the letter"));
    assert.equal(all.filter((m) => /^Asking .* to check this\.$/.test(m.body) && m.author.id === lead).length, 1, "asked once, not again after the reviewer's own verdict");
    assert.match(all.find((m) => /^Asking /.test(m.body))!.body, /^Asking Checker to check this\.$/, "by name, in one quiet line");
    assert.equal((all.find((m) => /^Asking /.test(m.body)) as unknown as { kind: string }).kind, "quiet", "a quiet system line, not a reply");
    await new Promise<void>((r) => setTimeout(r, 1500));
    await d.hooks?.pump?.();
    const later = (await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ author: { id: string }; body: string }>;
    assert.deepEqual(later.map((m) => m.body), all.map((m) => m.body), "the verdict is addressed to the person, so the lead does not answer it");
    // a person reviewer gets a task and the chat is not interrupted
    assert.equal((await call(d, "engine.reviewer.set", { threadId, reviewer: { kind: "person", id: "usr_mia" } })).status, 200);
    await post(d, threadId, lead, "draft the second letter", "rv2");
    const tasks = await waitFor(async () => {
      await d.hooks?.pump?.();
      const r = await call(d, "tasks.list", { scope: "assigned_by_me" });
      const rows = (r.data.tasks ?? []) as Array<{ kind?: string; title?: string; assigned?: { id?: string } }>;
      const mine = rows.filter((t) => /Review Drafter/.test(t.title ?? ""));
      return mine.length > 0 ? mine : null;
    }, 20_000, () => hostLog(d));
    assert.equal(tasks[0]!.assigned?.id, "usr_mia");
    assert.equal((await call(d, "engine.reviewer.set", { threadId, reviewer: null })).status, 200);
    assert.equal((await call(d, "engine.reviewer.get", { threadId })).data.reviewer, null);
  } finally { await d.stop(); }
});

test("undo: one Undo on a turn puts back every record and file the agent changed, and a second Undo is refused", async () => {
  let existing = "";
  let folder = "";
  let doc = "";
  const model = scriptedModel(async function* (_input, run) {
    const a = yield* run("records_create", { type: "contact", fields: { name: "Undo Me", phone: "555-9999" }, idempotencyKey: "u1" });
    const b = yield* run("records_update", { type: "contact", recordId: existing, patch: { phone: "555-0000", title: "Changed" } });
    yield* run("tool_search", { query: "create a file" });
    const c = yield* run("files_create", { folderId: folder, name: "made.md", content: { text: "made by the agent" }, idempotencyKey: "u3" });
    const e = yield* run("files_write", { fileId: doc, content: { text: "rewritten by the agent" }, baseVersion: 1, reason: "tidy" });
    yield { type: "text", text: a.ok && b.ok && c.ok && e.ok ? "done" : `failed ${JSON.stringify([a.ok, b.ok, c.content]).slice(0, 400)}` };
  });
  const d = await boot(seededDir(), model);
  try {
    await connect(d);
    const agent = await makeAgent(d, "Editor");
    existing = (await call(d, "records.create", { type: "contact", fields: { name: "Keep Me", phone: "555-1111", title: "Analyst" }, idempotencyKey: "u0" })).data.record.id as string;
    const roots = (await call(d, "files.list", { section: "space" })).data.folders as Array<{ name: string; folderId: string }>;
    folder = roots.find((f) => f.name === "Projects")!.folderId;
    doc = (await call(d, "files.create", { folderId: folder, name: "notes.md", content: { text: "original notes" }, idempotencyKey: "u5" })).data.file.fileId as string;
    const { threadId, reply } = await say(d, agent, "tidy the contacts", "undo");
    assert.equal(reply, "done", reply);
    const block = await waitFor(async () => {
      await d.hooks?.pump?.();
      const ms = (await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ blocks?: Array<{ type: string; data: { turnId: string; summary: string; changes: Array<{ label: string; undoable: boolean }> } }> }>;
      return ms.flatMap((m) => m.blocks ?? []).find((b) => b.type === "turn_changes") ?? null;
    }, 20_000, () => hostLog(d));
    assert.match(block.data.summary, /^4 changes made$/);
    assert.deepEqual(block.data.changes.map((c) => c.label).sort(), ["Changed phone, title on a contact", "Created a contact", "Created a file", "Edited a file"]);
    const turnId = block.data.turnId;
    assert.equal((await call(d, "engine.turn.changes", { threadId, turnId })).data.changes.length, 4);
    const undo = await call(d, "engine.turn.undo", { threadId, turnId });
    assert.equal(undo.status, 200, JSON.stringify(undo.data));
    assert.deepEqual(undo.data, { undone: 4, left: [] });
    const rows = (await call(d, "records.query", { type: "contact", limit: 100 })).data.rows as Array<{ id: string; fields: Record<string, unknown> }>;
    assert.ok(!rows.some((r) => r.fields["name"] === "Undo Me"), "the contact the agent created is in Trash");
    const kept = rows.find((r) => r.id === existing)!;
    assert.equal(kept.fields["phone"], "555-1111");
    assert.equal(kept.fields["title"], "Analyst");
    const files = (await call(d, "files.list", { folder })).data.files as Array<{ name: string }>;
    assert.ok(!files.some((f) => f.name === "made.md"));
    assert.equal((await call(d, "files.read", { fileId: doc, as: "text" })).data.text, "original notes", "the edited file is back to the version before the turn");
    assert.equal((await call(d, "engine.turn.undo", { threadId, turnId })).status, 422, "a turn is undone once");
    assert.equal((await call(d, "engine.turn.changes", { threadId, turnId })).data.undone, true);
  } finally { await d.stop(); }
});
