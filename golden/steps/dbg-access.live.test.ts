import test from "node:test";
import { bootFlowSpace } from "./02-space.ts";
const LIVE = ["agents", "access", "devices", "chat", "engine", "files", "vault", "tasks", "runs", "memory"];
test("probe", async () => {
  const s = await bootFlowSpace(LIVE);
  try {
    const olivia = s.d.token, noah = s.signedIn("usr_noah");
    const ch = (await s.call("channels.create", olivia, { idempotencyKey: "p-ch", name: "secret", visibility: "invite" })).body.data.channel as { channelId: string; mainThreadId: string };
    const m = (await s.call("chat.post", olivia, { idempotencyKey: "p-m", threadId: ch.mainThreadId, body: "hush" })).body.data.message.messageId as string;
    const row = async (label: string, cap: string, body: unknown) => { const r = await s.call(cap, noah, body); console.error("PROBE", label, r.status, JSON.stringify(r.body).slice(0, 140)); };
    await row("channels.list", "channels.list", {});
    await row("channels.get", "channels.get", { channelId: ch.channelId });
    await row("threads.get", "threads.get", { threadId: ch.mainThreadId });
    await row("messages.list", "chat.messages.list", { threadId: ch.mainThreadId });
    await row("message.get", "chat.message.get", { threadId: ch.mainThreadId, messageId: m });
    await row("post", "chat.post", { idempotencyKey: "n1", threadId: ch.mainThreadId, body: "hi" });
    await row("react", "chat.react", { idempotencyKey: "n2", threadId: ch.mainThreadId, messageId: m, emoji: "👍" });
    await row("pin", "chat.pin", { threadId: ch.mainThreadId, messageId: m });
    await row("search", "chat.search", { query: "hush" });
    await row("threads.list", "threads.list", {});
    await row("members.add", "threads.members.add", { threadId: ch.mainThreadId, personId: "usr_noah" });
    await row("add_agent", "threads.add_agent", { threadId: ch.mainThreadId, agentId: "agt_scout" });
    await row("channels.join", "channels.join", { channelId: ch.channelId });
  } finally { await s.stop(); }
});
