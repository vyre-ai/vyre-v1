// An invite-only channel is for the people in it. Noah (a plain member of the Space, not in the channel) must not read it, write in it, react or pin in it, open threads under it, see it in a list or a
// search, add people or agents to it, or connect an outside agent: every one answers as if the channel were not there. A public channel stays open to the Space, and once Olivia adds Noah he is in.
import test from "node:test";
import assert from "node:assert/strict";
import { bootFlowSpace, expectStatus } from "./02-space.ts";

const LIVE = ["agents", "access", "devices", "chat", "engine", "files", "vault", "tasks", "runs", "memory"];

test("invite-only channel: a member of the Space who is not in it can do nothing with it; a public channel is open; adding him opens it", async () => {
  const s = await bootFlowSpace(LIVE);
  try {
    const olivia = s.d.token;
    const noah = s.signedIn("usr_noah");
    const secret = expectStatus(await s.call("channels.create", olivia, { idempotencyKey: "ca-secret", name: "secret", visibility: "invite" }), 200, "channels.create").channel as { channelId: string; mainThreadId: string };
    const open = expectStatus(await s.call("channels.create", olivia, { idempotencyKey: "ca-open", name: "open", visibility: "public" }), 200, "channels.create open").channel as { channelId: string; mainThreadId: string };
    const said = expectStatus(await s.call("chat.post", olivia, { idempotencyKey: "ca-m", threadId: secret.mainThreadId, body: "hush hush plan" }), 200, "chat.post").message.messageId as string;
    const agent = expectStatus(await s.call("agents.create", olivia, { idempotencyKey: "ca-agent", name: "Keeper", role: "Keeps" }), 200, "agents.create").agent.agentId as string;
    const T = secret.mainThreadId;

    const refused = async (label: string, cap: string, body: Record<string, unknown>): Promise<void> => {
      const r = await s.call(cap, noah, body);
      assert.ok(r.status >= 400 && r.status < 500, `${label}: expected a refusal, got ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    };
    // reads
    await refused("channels.get", "channels.get", { channelId: secret.channelId });
    await refused("threads.get", "threads.get", { threadId: T });
    await refused("messages.list", "chat.messages.list", { threadId: T });
    await refused("message.get", "chat.message.get", { threadId: T, messageId: said });
    await refused("transcript.read", "chat.transcript.read", { threadId: T });
    await refused("transcript.summary", "chat.transcript.summary", { threadId: T });
    // writes
    await refused("post", "chat.post", { idempotencyKey: "n-post", threadId: T, body: "let me in" });
    await refused("react", "chat.react", { idempotencyKey: "n-react", threadId: T, messageId: said, emoji: "👍" });
    await refused("pin", "chat.pin", { threadId: T, messageId: said });
    await refused("thread under a message", "chat.thread", { idempotencyKey: "n-thr", threadId: T, messageId: said });
    await refused("mark_read", "threads.mark_read", { threadId: T });
    // people and agents
    await refused("members.add", "threads.members.add", { threadId: T, personId: "usr_noah" });
    await refused("add_agent", "threads.add_agent", { threadId: T, agentId: agent });
    await refused("channels.update", "channels.update", { channelId: secret.channelId, visibility: "public" });
    await refused("outside agent", "channels.connect_outside_agent", { channelId: secret.channelId, name: "claude code" });
    await refused("join", "channels.join", { channelId: secret.channelId });
    // lists and search
    const names = (body: any): string[] => ((body.data?.channels ?? []) as Array<{ name: string }>).map((c) => c.name);
    assert.deepEqual(names((await s.call("channels.list", noah, {})).body), ["open"], "the list shows only the channel he may see");
    const threads = ((await s.call("threads.list", noah, {})).body.data?.threads ?? []) as Array<{ threadId: string }>;
    assert.ok(!threads.some((x) => x.threadId === T), "the channel is not among his threads");
    const hits = (await s.call("chat.search", noah, { q: "hush" })).body.data?.hits as unknown[] | undefined;
    assert.equal((hits ?? []).length, 0, "search finds nothing in it");
    // nothing he tried left a mark
    const after = expectStatus(await s.call("chat.messages.list", olivia, { threadId: T }), 200, "list as owner").messages as Array<{ body: string }>;
    assert.deepEqual(after.map((m) => m.body), ["hush hush plan"]);

    // a public channel is open to the Space
    expectStatus(await s.call("chat.post", noah, { idempotencyKey: "n-open", threadId: open.mainThreadId, body: "hello all" }), 200, "post in the public channel");

    // once he is added, he is in
    expectStatus(await s.call("threads.members.add", olivia, { threadId: T, personId: "usr_noah" }), 200, "members.add by owner");
    expectStatus(await s.call("chat.messages.list", noah, { threadId: T }), 200, "list as member");
    expectStatus(await s.call("chat.post", noah, { idempotencyKey: "n-in", threadId: T, body: "thanks" }), 200, "post as member");
    assert.ok(names((await s.call("channels.list", noah, {})).body).includes("secret"), "and the list shows it");
  } finally { await s.stop(); }
});
