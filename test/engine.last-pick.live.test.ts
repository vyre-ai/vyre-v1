// A new chat starts on the model its person last picked (owner rule, 4 Nov): on a booted Team server with the member-key kit.
//   she picks Sonnet in one chat; a new chat, on a second device too, starts on Sonnet as its own pick (the resolver and the thread agree)
//   with Sonnet served by nothing here, the new chat still holds her pick and the turn says so in the refusal line: nothing runs in its place
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, hostLog, seededDir, waitFor } from "./memory-live-kit.ts";
import { api, connectClaude, door, join, ok, standIn, PASSWORD } from "./member-key-kit.ts";
import { fakeSpaceKey, setSpaceKey } from "./support/space-key-endpoint.ts";

test("a new chat starts on the model the person last picked, on any of their devices; unavailable, it refuses and swaps nothing", { timeout: 120_000 }, async () => {
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

    const start = async (token: string): Promise<string> => (await ok(d, token, "chat.start", { kind: "chat", agentIds: [agentId] })).thread.threadId as string;
    const modelOf = async (token: string, threadId: string): Promise<string | undefined> => {
      await d.hooks?.pump?.();
      return (await ok(d, token, "engine.usage.get", { threadId, agentId })).model as string | undefined;   // what the composer shows: the chat's own pick, else the agent's
    };

    // a first chat: nothing picked, nothing remembered; she picks Sonnet there
    const first = await start(rubab.token);
    assert.equal(await modelOf(rubab.token, first), undefined);
    await ok(d, rubab.token, "engine.set_model", { threadId: first, agentId, model: "claude-sonnet-5-5", idempotencyKey: "lp-1" });

    // a new chat starts on Sonnet, before any message; so does one from a second device (another session of hers)
    const second = await start(rubab.token);
    assert.equal(await waitFor(async () => (await modelOf(rubab.token, second)) ?? null, 20_000, () => hostLog(d)), "claude-sonnet-5-5");
    const phone = (await api(d, null, "identity.sign_in", { username: "rubab", password: PASSWORD, deviceName: "Phone", deviceClass: "web" })).data.session.token as string;
    const third = await start(phone);
    assert.equal(await waitFor(async () => (await modelOf(phone, third)) ?? null, 20_000, () => hostLog(d)), "claude-sonnet-5-5");

    // the new chat runs on her own Claude, the picked model, with no pick made in it
    await ok(d, rubab.token, "chat.post", { threadId: second, body: "hello", mentions: [{ kind: "agent", id: agentId }] });
    const reply = await waitFor(async () => { await d.hooks?.pump?.(); const ms = ((await api(d, rubab.token, "chat.messages.list", { threadId: second })).data.messages ?? []) as Array<{ author?: { kind?: string }; body?: string }>; return ms.find((m) => m.author?.kind === "agent" && (m.body ?? "") !== "")?.body ?? null; }, 40_000, () => hostLog(d));
    assert.equal(reply, `ran for ${rubab.personId} on subscription ${mine}`);

    // an explicit pick in a chat updates what a new chat starts on
    await ok(d, rubab.token, "engine.set_model", { threadId: second, agentId, model: "glm-test", provider: "custom", idempotencyKey: "lp-2" });
    const fourth = await start(rubab.token);
    assert.equal(await waitFor(async () => (await modelOf(rubab.token, fourth)) ?? null, 20_000, () => hostLog(d)), "glm-test");

    // Sonnet is picked again and nothing here can run it (she signed out: the key is not held, the Space key serves only glm): the turn refuses and swaps nothing
    await ok(d, rubab.token, "engine.set_model", { threadId: fourth, agentId, model: "claude-sonnet-5-5", idempotencyKey: "lp-3" });
    const browser = (await api(d, null, "identity.sign_in", { username: "rubab", password: PASSWORD, deviceName: "Chrome", deviceClass: "web" })).data.session.token as string;
    await ok(d, rubab.token, "identity.sign_out", {});
    const fifth = await start(browser);
    assert.equal(await waitFor(async () => (await modelOf(browser, fifth)) ?? null, 20_000, () => hostLog(d)), "claude-sonnet-5-5", "the chat still shows her last pick");
    await ok(d, browser, "chat.post", { threadId: fifth, body: "hello again", mentions: [{ kind: "agent", id: agentId }] });
    const refused = await waitFor(async () => { await d.hooks?.pump?.(); const ms = ((await api(d, browser, "chat.messages.list", { threadId: fifth })).data.messages ?? []) as Array<{ author?: { kind?: string }; body?: string; blocks?: Array<{ type?: string; data?: { code?: string; detail?: string } }> }>; return { reply: ms.find((m) => m.author?.kind === "agent" && (m.body ?? "") !== "")?.body, status: ms.flatMap((m) => m.blocks ?? []).find((b) => b.type === "turn_status" && b.data?.code === "engine.model_unavailable")?.data }; }, 40_000, () => hostLog(d));
    assert.equal(refused.reply, undefined, "nothing answered under Sonnet's name");
    assert.match(String(refused.status?.detail), /^Your Claude Code sign-in is locked on this server\./);
  } finally { await d.stop(); await stub.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
