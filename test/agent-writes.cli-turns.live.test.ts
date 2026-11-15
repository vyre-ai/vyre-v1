// F50 on CLI engines, the two cases beside test/agent-writes.cli.live.test.ts (same fake claude, the real MCP session): a person's change lands inside an agent's turn, and two agents in one chat.
// They are a file of their own so that each file boots at most two daemons and stays well inside its 120 s cap on a busy runner (the three cases in one file took 122 s in CI).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, call, connect, makeAgent, seededDir, waitFor, lastAgentReply } from "./support/live.ts";
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
