// The Add people and agents footer against a booted daemon (lane l-addsheet): the sheet tells a newcomer which files folder and which records they get, so those names must be the real ones the
// server holds, never the chat's own name. A chat made about a record names that record by its title and the chat's folder by its folder name; a project names its own folder and, only when
// records are linked to it, its records; a plain chat has neither and the sentence says nothing about them.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, call, connect, scriptedModel, seededDir } from "./support/live.ts";
import { loadAdd } from "../apps/app/src/places/chats/addsheet/useAddSheet.tsx";
import { addLines } from "../ui/src/AccessSheet/model.ts";

test("the footer names the real folder and record of a chat, a project's folder and linked records, and nothing for a plain chat", async () => {
  const dir = seededDir();
  const d = await boot(dir, scriptedModel(async function* () { yield { type: "text", text: "Done." }; }));
  try {
    await connect(d);
    const api = async (cap: string, input: unknown): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await call(d, cap, input);
      assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data).slice(0, 300)}`);
      return r.data;
    };
    const made = (await api("agents.create", { name: "Footer agent", idempotencyKey: "ft-agent" })).agent as { agentId: string; ownerId: string };
    const agentId = made.agentId;
    const me = { id: made.ownerId, name: "Owner" };
    const deps = { call: (cap: string, input: unknown) => api(cap, input), me: { id: me.id, name: me.name }, nameOf: (id: string) => id, newKey: () => `k${Math.random()}`, toast: () => undefined };
    const footer = async (open: Parameters<typeof loadAdd>[1]): Promise<string> => {
      const r = await loadAdd(deps, open);
      assert.ok(r, "the sheet opens");
      return addLines({ target: r.target, picks: [{ key: "person:usr_x", kind: "person", id: "usr_x", name: "Sara", role: "member" }], earlier: false, ownerName: me.name })[0]?.text ?? "";
    };

    // a project with a folder of its own, and a second project whose record is linked to it
    const linked = await api("projects.create", { type: "project", title: "Client file", idempotencyKey: "ft-linked" });
    const alone = await api("projects.create", { type: "project", title: "Quiet project", idempotencyKey: "ft-alone" });
    const withLinks = await api("projects.create", { type: "project", title: "Busy project", idempotencyKey: "ft-busy" });
    const linkedRecordId = (await api("projects.overview", { projectId: linked.projectId })).project.recordId as string;
    await api("projects.links.link", { projectId: withLinks.projectId, kind: "record", ref: linkedRecordId });
    const folderOf = async (projectId: string): Promise<string> => {
      const ov = await api("projects.overview", { projectId });
      return (await api("files.folder.get", { folderId: ov.project.folderId })).folder.name as string;
    };

    const busy = await footer({ projectId: withLinks.projectId });
    const quiet = await footer({ projectId: alone.projectId });
    console.log("PROJECT WITH LINKS:", busy);
    console.log("PROJECT WITHOUT LINKS:", quiet);
    assert.equal(busy, "They'll see this chat's messages from now on, Busy project's files, and its 1 linked record.");
    assert.equal(quiet, "They'll see this chat's messages from now on, and Quiet project's files.");
    await folderOf(alone.projectId);

    // a chat about a record, in a folder; and a plain chat
    const folderId = (await api("projects.overview", { projectId: alone.projectId })).project.folderId as string;
    const aboutRecord = (await api("chat.start", { kind: "chat", agentIds: [agentId], title: "About the client", recordId: linkedRecordId, folderId, idempotencyKey: "ft-chat-1" })).thread.threadId as string;
    const plain = (await api("chat.start", { kind: "chat", agentIds: [agentId], title: "Just talking", idempotencyKey: "ft-chat-2" })).thread.threadId as string;
    const about = await footer({ threadId: aboutRecord });
    const none = await footer({ threadId: plain });
    console.log("CHAT ABOUT A RECORD:", about);
    console.log("PLAIN CHAT:", none);
    assert.ok(about.includes(`its files folder ${await folderOf(alone.projectId)}`), about);
    assert.match(about, /and records in Client file\.$/, "the record is named by its title, not the chat's title");
    assert.ok(!about.includes("About the client"), "never the chat's own name");
    assert.equal(none, "They'll see this chat's messages from now on.");
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
