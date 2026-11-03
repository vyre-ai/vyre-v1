// The owner's rc.20 test on a Team server (a booted server-role daemon, the member-key kit): a member picked Claude Sonnet 5.5 and the Space's AI key serves only other models.
//   unlocked  her sign-in is open on the server: the turn runs on her own Claude, the picked model
//   locked    she signed out, the server does not hold her key: the turn says "Your Claude Code sign-in is locked on this server. Unlock Vyre on your device, or pick another model."
//             and nothing runs on the Space's key under the picked model's name
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, hostLog, seededDir, waitFor } from "./memory-live-kit.ts";
import { api, connectClaude, door, join, ok, standIn } from "./member-key-kit.ts";
import { fakeSpaceKey, setSpaceKey } from "./support/space-key-endpoint.ts";

test("Sonnet picked on a Team server: unlocked it runs on her own sign-in; locked it refuses in one plain line and the Space key runs nothing", { timeout: 120_000 }, async () => {
  const stub = await fakeSpaceKey();
  const dir = seededDir();
  const d = await boot(dir, standIn, undefined, { vault: undefined } as unknown as NonNullable<Parameters<typeof boot>[3]>);
  try {
    await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.alloc(32, 3).toString("base64") }) });
    await setSpaceKey(d, d.token, stub);
    const agentId = (await ok(d, d.token, "agents.create", { name: "Spark", role: "You help the team." })).agent.agentId as string;
    const rubab = await join(d, "rubab");
    assert.equal((await door(d, rubab.token, "unlock", rubab.personKey)).status, 204);
    const mine = await connectClaude(d, rubab.token, "Rubab_Claude");

    const pickedChat = async (token: string, body: string): Promise<string> => {
      const threadId = (await ok(d, token, "chat.start", { kind: "chat", agentIds: [agentId] })).thread.threadId as string;
      await ok(d, token, "engine.set_model", { threadId, agentId, model: "claude-sonnet-5-5", idempotencyKey: `pm-${threadId}` });
      await ok(d, token, "chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }] });
      return threadId;
    };
    const thread = async (token: string, threadId: string) => {
      await d.hooks?.pump?.();
      const ms = ((await api(d, token, "chat.messages.list", { threadId })).data.messages ?? []) as Array<{ author?: { kind?: string }; body?: string; blocks?: Array<{ type?: string; data?: { text?: string; code?: string; detail?: string } }> }>;
      return { reply: ms.find((m) => m.author?.kind === "agent" && (m.body ?? "") !== "")?.body, status: ms.flatMap((m) => m.blocks ?? []).filter((b) => b.type === "turn_status").map((b) => b.data ?? {}) };
    };

    // unlocked: her own Claude runs the picked model
    const t1 = await pickedChat(rubab.token, "hello");
    const reply = await waitFor(async () => (await thread(rubab.token, t1)).reply ?? null, 40_000, () => hostLog(d));
    assert.equal(reply, `ran for ${rubab.personId} on subscription ${mine}`);

    // locked: another session of hers that never handed the key over, after she signed out of the first
    const browser = (await api(d, null, "identity.sign_in", { username: "rubab", password: "correct horse battery staple 9", deviceName: "Chrome", deviceClass: "web" })).data.session.token as string;
    await ok(d, rubab.token, "identity.sign_out", {});
    const t2 = await pickedChat(browser, "hello again");
    const failed = await waitFor(async () => (await thread(browser, t2)).status.find((s) => s.code === "engine.model_unavailable") ?? null, 40_000, () => hostLog(d));
    assert.equal(failed.detail, "Your Claude Code sign-in is locked on this server. Unlock Vyre on your device, or pick another model.");
    assert.equal((await thread(browser, t2)).reply, undefined, "nothing answered under the picked model's name");
  } finally { await d.stop(); await stub.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
