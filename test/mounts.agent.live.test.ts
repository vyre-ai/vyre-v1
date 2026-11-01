// A chat agent and a mounted folder (rc.8 mounts; booted daemon with files, mounts, chat, agents and the turn engine live, the model stand-in turns "TOOL <name> <json>" into a real tool call).
// A folder on a computer is mounted and the device reports its files, so what the agent sees is what a Drive, OneDrive, SharePoint or GitHub mount leaves in Files: ordinary files in an ordinary folder.
// The agent lists the mount folder and reads a file through files_list and files_read; a write into a mount that has Review changes on is not applied, it waits as a change for a person to approve.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, newAgent, say, seededDir, waitFor } from "./memory-live-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

let keys = 0;
const ok = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `ma-${cap}-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

test("mounts live: a chat agent lists a mounted folder and reads its file through the file tools, and a write into it waits for review", async () => {
  const d = await boot(seededDir());
  try {
    await connect(d);
    const agent = await newAgent(d, "Keeper");
    const tree = await ok(d, "files.tree", {});
    const root = (tree.roots as Array<{ folderId?: string }>).find((r) => r.folderId)?.folderId;
    assert.ok(root, "Files has a root folder");
    const into = (await ok(d, "files.folder.create", { parentId: root, name: "Mounted" })).folder.folderId as string;
    const deviceId = "dev_macbook1";
    const added = await ok(d, "mounts.add", { into, source: { kind: "local", deviceId, localPath: "/Users/olivia/Contracts" }, name: "Contracts", mode: "server_copy", reviewChanges: true });
    const bytes = Buffer.from("NDA v1");
    const slot = await ok(d, "files.upload_url", { size: bytes.length });
    const token = new URL(slot.url, "http://vyred").searchParams.get("token");
    await d.hooks!.call("files.put_upload", { blobId: slot.blobId, token, base64: bytes.toString("base64") });
    await ok(d, "mounts.local_report", { mountId: added.mountId, deviceId, changes: [{ path: "nda.txt", op: "add", blobId: slot.blobId, mtime: 1_760_000_000_000 }] });
    const nda = ((await ok(d, "files.list", { folder: added.folderId })).files as Array<{ fileId: string; name: string }>).find((f) => f.name === "nda.txt");
    assert.ok(nda, "the mounted file is in Files");

    // an agent reaches what a person shares with it, as for any folder: the mount is shared with the agent the way the sheet's Who can see it shares with a person
    await ok(d, "access.share", { resource: { type: "folder", id: added.folderId }, subject: { kind: "agent", id: agent.id }, level: "edit" });
    const listed = await say(d, agent.id, `TOOL files_list ${JSON.stringify({ folder: added.folderId })}`, "ma-list");
    assert.match(listed.reply, /TOOL RESULT ok/, listed.reply);
    assert.match(listed.reply, /nda\.txt/, "the agent sees the mount folder's file");

    const read = await say(d, agent.id, `TOOL files_read ${JSON.stringify({ fileId: nda!.fileId, as: "text" })}`, "ma-read");
    assert.match(read.reply, /TOOL RESULT ok/, read.reply);
    assert.match(read.reply, /NDA v1/, "the agent reads the mounted file's content");

    // Ask mode: the agent stops before the step and the person it works for is asked to allow it; nothing is written and the turn waits on the approval
    const askThread = (await ok(d, "chat.start", { kind: "chat", agentIds: [agent.id] })).thread.threadId as string;
    await ok(d, "threads.set_mode", { threadId: askThread, mode: "ask" });
    await ok(d, "chat.post", { threadId: askThread, body: `TOOL files_write ${JSON.stringify({ fileId: nda!.fileId, content: { text: "NDA changed in Ask mode" }, reason: "Agent edit", idempotencyKey: "ma-agent-write-ask" })}`, mentions: [{ kind: "agent", id: agent.id }] });
    const hold = await waitFor(async () => {
      await d.hooks?.pump?.();
      const holds = (await call(d, "gate.holds.list", { states: ["held"] })).data.holds as Array<{ act: string; capName: string; taskId: string }> | undefined;
      return holds?.find((h) => h.capName === "files.write") ?? null;
    });
    assert.equal(hold.act, "approve", "the step waits for the person to allow it");
    assert.equal((await ok(d, "files.read", { fileId: nda!.fileId, as: "text" })).text, "NDA v1", "Ask mode wrote nothing");

    // Allow, as the chat's approval card does (tasks.act approve): the turn continues and the write goes on, held back only by the mount's Review changes
    await ok(d, "tasks.act", { taskId: hold.taskId, action: "approve" });
    const staged = await waitFor(async () => {
      await d.hooks?.pump?.();
      const open = (await call(d, "changesets.list", { folderId: added.folderId, state: "open" })).data.changesets as unknown[] | undefined;
      return open && open.length > 0 ? open : null;
    });
    assert.ok(staged.length >= 1, "after Allow the write waits as a change for review");

    // Deny with a reason: the turn ends and the reason reaches the agent
    const denyThread = (await ok(d, "chat.start", { kind: "chat", agentIds: [agent.id] })).thread.threadId as string;
    await ok(d, "threads.set_mode", { threadId: denyThread, mode: "ask" });
    await ok(d, "chat.post", { threadId: denyThread, body: `TOOL files_write ${JSON.stringify({ fileId: nda!.fileId, content: { text: "NDA denied edit" }, reason: "Agent edit", idempotencyKey: "ma-agent-write-deny" })}`, mentions: [{ kind: "agent", id: agent.id }] });
    const second = await waitFor(async () => {
      await d.hooks?.pump?.();
      const holds = (await call(d, "gate.holds.list", { states: ["held"] })).data.holds as Array<{ taskId: string; capName: string }> | undefined;
      return holds?.find((h) => h.capName === "files.write") ?? null;
    });
    await ok(d, "tasks.act", { taskId: second.taskId, action: "reject", note: "Wait for Maya" });
    const task = (await ok(d, "tasks.get", { taskId: second.taskId })).task as { state: string };
    assert.notEqual(task.state, "awaiting_approval", "the denied hold is answered");
    const told = await waitFor(async () => {
      await d.hooks?.pump?.();
      const msgs = (await call(d, "chat.messages.list", { threadId: denyThread })).data.messages as Array<{ author?: { kind?: string }; body?: string }>;
      return msgs.find((m) => m.author?.kind === "agent" && /Wait for Maya/.test(m.body ?? ""))?.body ?? null;
    });
    assert.match(told, /Wait for Maya/, "the reason reaches the agent");
    assert.equal((await ok(d, "files.read", { fileId: nda!.fileId, as: "text" })).text, "NDA v1", "a denied step wrote nothing");

    // Auto mode: the agent may act without asking first, so what holds the write back is the mount's own Review changes
    const started = await ok(d, "chat.start", { kind: "chat", agentIds: [agent.id] });
    const threadId = started.thread.threadId as string;
    await ok(d, "threads.set_mode", { threadId, mode: "auto" });
    await ok(d, "chat.post", { threadId, body: `TOOL files_write ${JSON.stringify({ fileId: nda!.fileId, content: { text: "NDA changed by the agent" }, reason: "Agent edit", idempotencyKey: "ma-agent-write" })}`, mentions: [{ kind: "agent", id: agent.id }] });
    const wrote = await waitFor(async () => {
      await d.hooks?.pump?.();
      const m = ((await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ author?: { kind?: string }; body?: string }>).find((x) => x.author?.kind === "agent" && (x.body ?? "") !== "");
      return m?.body ?? null;
    });
    assert.match(wrote, /TOOL RESULT ok/, wrote);
    const text = (await ok(d, "files.read", { fileId: nda!.fileId, as: "text" })).text as string;
    assert.equal(text, "NDA v1", `the agent's write did not land: ${wrote}`);
    const open = await ok(d, "changesets.list", { folderId: added.folderId, state: "open" });
    assert.ok((open.changesets as unknown[]).length >= 1, `the write waits as a change for review: ${wrote}`);
  } finally { await d.stop(); }
});
