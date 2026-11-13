// Someone taken out of a chat and added back holds again what being in it gives: their view of the agents the chat made for itself. The grant is written with an idempotency key, and a key
// built from ids alone (chat, agent, person) made the second add replay the first add's answer and write nothing. A booted daemon, the real chat and access modules.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, seededDir } from "./memory-live-kit.ts";
import { api, join, ok, standIn } from "./member-key-kit.ts";

test("a person removed from a chat and added back sees the chat's own agent again", async () => {
  const dir = seededDir();
  const d = await boot(dir, standIn);
  try {
    const ana = await join(d, "ana");
    const ben = await join(d, "ben");
    const threadId = (await ok(d, ana.token, "chat.start", { kind: "chat", agentIds: [], personId: ben.personId }))
      .thread.threadId as string;
    const agentId = (await ok(d, ana.token, "threads.agent.create", { threadId, name: "Rejoin checker" }))
      .agentId as string;
    const sees = async (): Promise<boolean> =>
      (await api(d, ben.token, "access.shares_of", { resource: { type: "agent", id: agentId } })).status === 200;
    assert.equal(await sees(), true, "Ben, in the chat, sees its agent");
    await ok(d, ana.token, "threads.members.remove", { threadId, personId: ben.personId });
    assert.equal(await sees(), false, "taken out, he does not");
    await ok(d, ana.token, "threads.members.add", { threadId, personId: ben.personId });
    assert.equal(await sees(), true, "added back, he sees it again");

    // a project: the same for a role taken away and given again
    const projectId = (await ok(d, ana.token, "projects.create", { type: "project", title: "Rejoin" }))
      .projectId as string;
    const onProject = async (): Promise<boolean> =>
      (await api(d, ben.token, "access.shares_of", { resource: { type: "project", id: projectId } })).status === 200;
    await ok(d, ana.token, "projects.members.set", { projectId, principal: ben.personId, role: "member" });
    assert.equal(await onProject(), true, "a Member holds the project");
    await ok(d, ana.token, "projects.members.remove", { projectId, principal: ben.personId });
    assert.equal(await onProject(), false);
    await ok(d, ana.token, "projects.members.set", { projectId, principal: ben.personId, role: "member" });
    assert.equal(await onProject(), true, "given the role again, he holds the project again");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
