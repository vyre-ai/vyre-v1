// Archive, delete and leave on a booted daemon, over HTTP with real tokens for two people (rc.8): Olivia archives a chat with Noah and it leaves HER list only; a plain message from Noah leaves it
// archived, an @mention of Olivia brings it back; a chat only Olivia is in (with an agent) is deleted, hidden everywhere, and restored by Undo; Noah leaves the direct message and Olivia keeps it.
import test from "node:test";
import assert from "node:assert/strict";
import { bootFlowSpace, expectStatus } from "./02-space.ts";

const LIVE = ["agents", "access", "devices", "chat", "engine", "files", "vault", "tasks", "runs"];
type Rec = Record<string, Array<{ threadId: string }>>;
const listed = (r: Rec): string[] => ["starred", "today", "yesterday", "earlier"].flatMap((k) => (r[k] ?? []).map((x) => x.threadId));

test("a chat archived by one person stays in the other's list; a mention brings it back; delete hides a private chat until Undo; leave keeps the chat for the other person", async () => {
  const s = await bootFlowSpace(LIVE);
  try {
    const olivia = s.d.token;
    const noah = s.signedIn("usr_noah");
    const recent = async (token: string): Promise<Rec> => expectStatus(await s.call("chat.recent", token, {}), 200, "chat.recent") as Rec;

    // a direct message, and a private chat with an agent (the Space's agent; with no AI account its turn fails fast, which is nothing to this flow)
    const dm = expectStatus(await s.call("chat.start", olivia, { idempotencyKey: "arc-dm", kind: "chat", agentIds: [], personId: "usr_noah" }), 200, "chat.start dm").thread.threadId as string;
    expectStatus(await s.call("chat.post", olivia, { idempotencyKey: "arc-dm-1", threadId: dm, body: "hello Noah" }), 200, "chat.post");
    const agent = expectStatus(await s.call("agents.create", olivia, { idempotencyKey: "arc-agent", name: "Archivist", role: "Keeps notes" }), 200, "agents.create").agent.agentId as string;
    const solo = expectStatus(await s.call("chat.start", olivia, { idempotencyKey: "arc-solo", kind: "chat", agentIds: [agent] }), 200, "chat.start solo").thread.threadId as string;
    expectStatus(await s.call("chat.post", olivia, { idempotencyKey: "arc-solo-1", threadId: solo, body: "keep this", mentions: [{ kind: "agent", id: agent }] }), 200, "chat.post solo");
    assert.ok(listed(await recent(olivia)).includes(dm) && listed(await recent(noah)).includes(dm), "both see the direct message");

    // archive: hers only
    expectStatus(await s.call("threads.archive", olivia, { threadId: dm }), 200, "threads.archive");
    const mine = await recent(olivia);
    assert.ok(!listed(mine).includes(dm) && mine["archived"]!.some((x) => x.threadId === dm), "Olivia: in Archived, not in the days");
    const his = await recent(noah);
    assert.ok(listed(his).includes(dm) && (his["archived"] ?? []).length === 0, "Noah still has it where it was");

    // a plain message stays quiet; an @mention of her brings it back
    expectStatus(await s.call("chat.post", noah, { idempotencyKey: "arc-dm-2", threadId: dm, body: "you around?" }), 200, "chat.post noah");
    assert.ok((await recent(olivia))["archived"]!.some((x) => x.threadId === dm), "still archived after a plain message");
    expectStatus(await s.call("chat.post", noah, { idempotencyKey: "arc-dm-3", threadId: dm, body: "@Olivia look", mentions: [{ kind: "person", id: "usr_olivia" }] }), 200, "chat.post mention");
    const back = await recent(olivia);
    assert.ok(listed(back).includes(dm) && !back["archived"]!.some((x) => x.threadId === dm), "the mention put it back in her list");

    // delete a chat only she is in: hidden now, back with Undo; a chat with another person is refused with the offer to leave
    expectStatus(await s.call("threads.delete", olivia, { threadId: solo }), 200, "threads.delete");
    const gone = await recent(olivia);
    assert.ok(!listed(gone).includes(solo) && !gone["archived"]!.some((x) => x.threadId === solo), "deleted: in no section");
    expectStatus(await s.call("threads.restore", olivia, { threadId: solo }), 200, "threads.restore");
    assert.ok(listed(await recent(olivia)).includes(solo), "Undo brought it back");
    const refused = await s.call("threads.delete", olivia, { threadId: dm });
    assert.equal(refused.status, 422, "a chat with Noah in it is left, not deleted");

    // leave: Noah goes, Olivia keeps the direct message
    expectStatus(await s.call("threads.leave", noah, { threadId: dm }), 200, "threads.leave");
    assert.ok(!listed(await recent(noah)).includes(dm), "Noah left");
    assert.ok(listed(await recent(olivia)).includes(dm), "Olivia still has it");
  } finally { await s.stop(); }
});
