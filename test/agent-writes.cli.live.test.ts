// F50, the case the owner meets most: agents on CLI engines (the fake claude of host/tests/fixtures/fake-cli-driver, through the real MCP session). Two agents asked together, neither reads first. B's turn begins, A's
// turn changes the thing and ends, then B writes: B is refused in plain words (the engine told the tool layer when B's turn began), B reads again and writes on top, and both changes survive.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, call, connect, makeAgent, post, seededDir, waitFor, lastAgentReply } from "./support/live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const FAKE_CLI = fileURLToPath(new URL("../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const cli = { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)] };
const SLOW = 7000;

let k = 0;
const c = (d: Daemon, cap: string, input: Record<string, unknown>) =>
  call(d, cap, { idempotencyKey: `cw-${cap}-${++k}`, ...input });

async function chatOf(d: Daemon, agentId: string, tag: string): Promise<string> {
  const id = (await c(d, "chat.start", { kind: "chat", agentIds: [agentId] })).data.thread.threadId as string;
  await c(d, "threads.set_mode", { threadId: id, mode: "auto" });
  return id;
}

/** B's slow write is posted first (its turn begins, then it waits), A's write runs and ends, then B's write is answered. */
async function race(
  d: Daemon,
  A: { id: string; thread: string },
  B: { id: string; thread: string },
  a: string,
  b: string,
): Promise<{ a: string; b: string }> {
  const before = ((await c(d, "chat.messages.list", { threadId: B.thread })).data.messages as unknown[]).length;
  await c(d, "chat.post", {
    threadId: B.thread,
    body: `toolslow ${SLOW} ${b}`,
    mentions: [{ kind: "agent", id: B.id }],
  });
  await new Promise((r) => setTimeout(r, 1500)); // B's turn has begun
  const ra = await post(d, A.thread, A.id, a, `cw-a-${++k}`);
  const rb = await waitFor(() => lastAgentReply(d, B.thread, before), 40_000);
  return { a: ra, b: rb };
}

test(
  "CLI agents: B writes a thing it never read after A changed it in the same round: B is refused, reads again, writes on top, both survive",
  { timeout: 280_000 },
  async () => {
    const dir = seededDir();
    const d = await boot(dir, null, { engineCli: cli });
    try {
      await connect(d);
      const ann = await makeAgent(d, "Ann");
      const bob = await makeAgent(d, "Bob");
      const A = { id: ann, thread: await chatOf(d, ann, "a") };
      const B = { id: bob, thread: await chatOf(d, bob, "b") };
      const share = async (type: string, id: string) => {
        for (const ag of [ann, bob])
          await c(d, "access.share", { resource: { type, id }, subject: { kind: "agent", id: ag }, level: "edit" });
      };
      const refused = (r: string) => /refused/.test(r) && /changed after you (started working|last read it)/.test(r);

      // ---- a file
      const tree = await c(d, "files.tree", {});
      const root = (tree.data.roots as Array<{ folderId?: string }>).find((r) => r.folderId)?.folderId;
      const folder = (await c(d, "files.folder.create", { parentId: root, name: "Shared" })).data.folder.folderId;
      await share("folder", folder);
      const f = (await c(d, "files.create", { folderId: folder, name: "n.txt", content: { text: "start" } })).data.file
        .fileId as string;
      const textOf = async () => String((await c(d, "files.read", { fileId: f, as: "text" })).data.text);
      let r = await race(
        d,
        A,
        B,
        `tool files_write ${JSON.stringify({ fileId: f, content: { text: "start + ANN" } })}`,
        `files_write ${JSON.stringify({ fileId: f, content: { text: "start + BOB" } })}`,
      );
      console.log("MEASURE cli file:", r.a.slice(0, 60), "|", r.b.slice(0, 200));
      assert.match(r.a, /files_write answered/);
      assert.ok(refused(r.b), `B refused: ${r.b.slice(0, 300)}`);
      assert.equal(await textOf(), "start + ANN", "A's change stands");
      const reread = await post(
        d,
        B.thread,
        B.id,
        `tool files_read ${JSON.stringify({ fileId: f, as: "text" })}`,
        `cw-f-r`,
      );
      assert.match(reread, /start \+ ANN/);
      const redo = await post(
        d,
        B.thread,
        B.id,
        `tool files_write ${JSON.stringify({ fileId: f, content: { text: "start + ANN + BOB" } })}`,
        `cw-f-w`,
      );
      assert.match(redo, /files_write answered/);
      assert.equal(await textOf(), "start + ANN + BOB", "both changes survive");

      // ---- a record
      const rec = (await c(d, "records.create", { type: "contact", fields: { name: "Dana Fox" } })).data.record;
      await share("record", rec.id);
      const nameOf = async () =>
        (await c(d, "records.get", { type: "contact", recordId: rec.id })).data.record.fields.name;
      r = await race(
        d,
        A,
        B,
        `tool records_update ${JSON.stringify({ type: "contact", recordId: rec.id, patch: { name: "Dana (ANN)" } })}`,
        `records_update ${JSON.stringify({ type: "contact", recordId: rec.id, patch: { name: "Dana (BOB)" } })}`,
      );
      console.log("MEASURE cli record:", r.b.slice(0, 200));
      assert.ok(refused(r.b), `B refused: ${r.b.slice(0, 300)}`);
      assert.equal(await nameOf(), "Dana (ANN)");
      await post(
        d,
        B.thread,
        B.id,
        `tool records_get ${JSON.stringify({ type: "contact", recordId: rec.id })}`,
        `cw-r-r`,
      );
      const rr = await post(
        d,
        B.thread,
        B.id,
        `tool records_update ${JSON.stringify({ type: "contact", recordId: rec.id, patch: { name: "Dana (ANN, BOB)" } })}`,
        `cw-r-w`,
      );
      assert.match(rr, /records_update answered/);
      assert.equal(await nameOf(), "Dana (ANN, BOB)");

      // ---- a task
      const task = (
        await c(d, "tasks.create", { title: "Shared", summary: "o", assigned: { kind: "person", id: "usr_olivia" } })
      ).data.task;
      await share("task", task.id);
      const summaryOf = async () => (await c(d, "tasks.get", { taskId: task.id })).data.task.summary;
      r = await race(
        d,
        A,
        B,
        `tool tasks_update ${JSON.stringify({ taskId: task.id, summary: "ANN" })}`,
        `tasks_update ${JSON.stringify({ taskId: task.id, summary: "BOB" })}`,
      );
      console.log("MEASURE cli task:", r.b.slice(0, 200));
      assert.ok(refused(r.b), `B refused: ${r.b.slice(0, 300)}`);
      assert.equal(await summaryOf(), "ANN");
      await post(d, B.thread, B.id, `tool tasks_get ${JSON.stringify({ taskId: task.id })}`, `cw-t-r`);
      const tr = await post(
        d,
        B.thread,
        B.id,
        `tool tasks_update ${JSON.stringify({ taskId: task.id, summary: "ANN and BOB" })}`,
        `cw-t-w`,
      );
      assert.match(tr, /tasks_update answered/);
      assert.equal(await summaryOf(), "ANN and BOB");

      // ---- a memory page
      const page = (
        await c(d, "memory.page.put", { title: "Shared page", kind: "topic", layer: "space", notes: "start" })
      ).data.page;
      const notesOf = async () => (await c(d, "memory.page.get", { pageId: page.pageId })).data.notes;
      r = await race(
        d,
        A,
        B,
        `toolfind memory_write_page ${JSON.stringify({ pageId: page.pageId, notes: "start + ANN" })}`,
        `memory_write_page ${JSON.stringify({ pageId: page.pageId, notes: "start + BOB" })}`,
      );
      console.log("MEASURE cli page:", r.a.slice(0, 600), "|", r.b.slice(0, 200));
      assert.ok(refused(r.b) || /changed/.test(r.b), `B refused: ${r.b.slice(0, 300)}`);
      assert.equal(await notesOf(), "start + ANN");
      await post(d, B.thread, B.id, `toolfind memory_page_get ${JSON.stringify({ pageId: page.pageId })}`, `cw-p-r`);
      const pr = await post(
        d,
        B.thread,
        B.id,
        `toolfind memory_write_page ${JSON.stringify({ pageId: page.pageId, notes: "start + ANN + BOB" })}`,
        `cw-p-w`,
      );
      assert.match(pr, /memory_write_page answered/);
      assert.equal(await notesOf(), "start + ANN + BOB");

      // ---- an automation
      const def = (n: string) => ({
        triggers: [{ key: "record_change", config: {}, filter: { type: "contact", op: "created" } }],
        nodes: [{ id: "more", key: "records.create", title: n, input: { type: "contact", fields: { name: n } } }],
      });
      const auto = (await c(d, "automations.create", { name: "Flow", definition: def("o") })).data.automation;
      const titleOf = async () =>
        (await c(d, "automations.get", { automationId: auto.id })).data.automation.definition.nodes[0].title;
      r = await race(
        d,
        A,
        B,
        `toolfind automations_update ${JSON.stringify({ automationId: auto.id, definition: def("ANN") })}`,
        `automations_update ${JSON.stringify({ automationId: auto.id, definition: def("BOB") })}`,
      );
      console.log("MEASURE cli automation:", r.a.slice(0, 120), "|", r.b.slice(0, 200));
      assert.ok(refused(r.b) || /changed|version/.test(r.b), `B refused: ${r.b.slice(0, 300)}`);
      assert.equal(await titleOf(), "ANN");
    } finally {
      await d.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "a person's change lands inside an agent's turn: the agent, which never read the thing, is refused and the person's change stands",
  { timeout: 120_000 },
  async () => {
    const dir = seededDir();
    const d = await boot(dir, null, { engineCli: cli });
    try {
      await connect(d);
      const bob = await makeAgent(d, "Bob");
      const B = { id: bob, thread: await chatOf(d, bob, "b") };
      const tree = await c(d, "files.tree", {});
      const root = (tree.data.roots as Array<{ folderId?: string }>).find((r) => r.folderId)?.folderId;
      const folder = (await c(d, "files.folder.create", { parentId: root, name: "Shared" })).data.folder.folderId;
      await c(d, "access.share", {
        resource: { type: "folder", id: folder },
        subject: { kind: "agent", id: bob },
        level: "edit",
      });
      const f = (await c(d, "files.create", { folderId: folder, name: "n.txt", content: { text: "start" } })).data.file
        .fileId as string;
      const rec = (await c(d, "records.create", { type: "contact", fields: { name: "Dana Fox" } })).data.record;
      await c(d, "access.share", {
        resource: { type: "record", id: rec.id },
        subject: { kind: "agent", id: bob },
        level: "edit",
      });
      const before = ((await c(d, "chat.messages.list", { threadId: B.thread })).data.messages as unknown[]).length;
      await c(d, "chat.post", {
        threadId: B.thread,
        body: `toolslow ${SLOW} files_write ${JSON.stringify({ fileId: f, content: { text: "start + BOB" } })}`,
        mentions: [{ kind: "agent", id: bob }],
      });
      await new Promise((r) => setTimeout(r, 1500));
      assert.equal((await c(d, "files.write", { fileId: f, content: { text: "start + PERSON" } })).status, 200);
      const reply = await waitFor(() => lastAgentReply(d, B.thread, before), 40_000);
      assert.match(reply, /refused/);
      assert.match(reply, /changed after you (started working|last read it)/);
      assert.equal(String((await c(d, "files.read", { fileId: f, as: "text" })).data.text), "start + PERSON");

      const before2 = ((await c(d, "chat.messages.list", { threadId: B.thread })).data.messages as unknown[]).length;
      await c(d, "chat.post", {
        threadId: B.thread,
        body: `toolslow ${SLOW} records_update ${JSON.stringify({ type: "contact", recordId: rec.id, patch: { name: "Dana (BOB)" } })}`,
        mentions: [{ kind: "agent", id: bob }],
      });
      await new Promise((r) => setTimeout(r, 1500));
      await c(d, "records.update", { type: "contact", recordId: rec.id, patch: { name: "Dana (PERSON)" } });
      const reply2 = await waitFor(() => lastAgentReply(d, B.thread, before2), 40_000);
      assert.match(reply2, /refused/);
      assert.equal(
        (await c(d, "records.get", { type: "contact", recordId: rec.id })).data.record.fields.name,
        "Dana (PERSON)",
      );
    } finally {
      await d.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "two agents in ONE chat: B's turn begins, A's turn changes the file, then B (never read it) writes and is refused",
  { timeout: 120_000 },
  async () => {
    const dir = seededDir();
    const d = await boot(dir, null, { engineCli: cli });
    try {
      await connect(d);
      const ann = await makeAgent(d, "Ann");
      const bob = await makeAgent(d, "Bob");
      const threadId = (await c(d, "chat.start", { kind: "chat", agentIds: [ann, bob] })).data.thread
        .threadId as string;
      await c(d, "threads.set_mode", { threadId, mode: "auto" });
      const tree = await c(d, "files.tree", {});
      const root = (tree.data.roots as Array<{ folderId?: string }>).find((r) => r.folderId)?.folderId;
      const folder = (await c(d, "files.folder.create", { parentId: root, name: "Shared" })).data.folder.folderId;
      for (const ag of [ann, bob])
        await c(d, "access.share", {
          resource: { type: "folder", id: folder },
          subject: { kind: "agent", id: ag },
          level: "edit",
        });
      const f = (await c(d, "files.create", { folderId: folder, name: "n.txt", content: { text: "start" } })).data.file
        .fileId as string;
      const agentReply = async (agentId: string, after: number): Promise<string | null> => {
        await d.hooks?.pump?.();
        const msgs = (await c(d, "chat.messages.list", { threadId })).data.messages as Array<{
          author?: { kind?: string; id?: string };
          body?: string;
        }>;
        return (
          msgs.slice(after).find((m) => m.author?.kind === "agent" && m.author.id === agentId && (m.body ?? "") !== "")
            ?.body ?? null
        );
      };
      const count = async () => ((await c(d, "chat.messages.list", { threadId })).data.messages as unknown[]).length;
      const at = await count();
      await c(d, "chat.post", {
        threadId,
        body: `toolslow ${SLOW} files_write ${JSON.stringify({ fileId: f, content: { text: "start + BOB" } })}`,
        mentions: [{ kind: "agent", id: bob }],
      });
      await new Promise((r) => setTimeout(r, 1500));
      await c(d, "chat.post", {
        threadId,
        body: `toolfind files_write ${JSON.stringify({ fileId: f, content: { text: "start + ANN" } })}`,
        mentions: [{ kind: "agent", id: ann }],
      });
      const a = await waitFor(() => agentReply(ann, at), 40_000);
      const b = await waitFor(() => agentReply(bob, at), 40_000);
      console.log("MEASURE cli one chat:", a.slice(0, 80), "|", b.slice(0, 220));
      assert.match(a, /files_write answered/);
      assert.match(b, /refused/);
      assert.match(b, /changed after you (started working|last read it)/);
      assert.equal(String((await c(d, "files.read", { fileId: f, as: "text" })).data.text), "start + ANN");
    } finally {
      await d.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
