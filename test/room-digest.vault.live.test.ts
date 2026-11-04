// A member's own Mine API key runs a server turn AND the room's digest batch on a Team server with the REAL Vault: no stand-in session. Both reach the vendor with her key, taken out of her Vault because
// the person the work is for holds it. The digest's one-shot ran as the pseudo-agent id "memory-upkeep", which is not a member of the Space, so the Vault refused it (engine.vault_unreadable,
// auth.unauthenticated) and nothing was written. The vendor here is a stand-in behind fetch; it records the key it is given and the system prompt of each request.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { boot, hostLog, seededDir, waitFor } from "./support/live.ts";
import { api, door, join } from "./member-key-kit.ts";

const OWN_KEY = "sk-own-MAYAapiKEY0123456789abcdefXYZ0123"; // secret-scan: fake

test("a member's own Mine API key runs her turn and the room digest from the real Vault; another member cannot use it", { timeout: 300_000 }, async () => {
  const seen: Array<{ auth: string; system: string }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("https://api.openai.com/")) return real(input, init);
    const h = new Headers(init?.headers as HeadersInit | undefined);
    const auth = h.get("authorization") ?? "";
    if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "gpt-test" }] }), { status: auth === `Bearer ${OWN_KEY}` ? 200 : 401, headers: { "content-type": "application/json" } });
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: unknown }> };
    seen.push({ auth, system: JSON.stringify(body.messages?.find((m) => m.role === "system")?.content ?? "").slice(0, 400) });
    if (auth !== `Bearer ${OWN_KEY}`) return new Response("{}", { status: 401 });
    const sse = `data: ${JSON.stringify({ id: "c1", choices: [{ index: 0, delta: { role: "assistant", content: "Launch is Friday 13 November." }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "c1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 } })}\n\ndata: [DONE]\n\n`;
    return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  const dir = seededDir();
  const d = await boot(dir, null, { realVault: true });
  try {
    const maya = await join(d, "maya");
    const omar = await join(d, "omar");
    assert.equal((await door(d, maya.token, "unlock", maya.personKey)).status, 204);
    const as = (token: string, cap: string, input: Record<string, unknown>) => api(d, token, cap, { idempotencyKey: `rd-${cap}-${Math.random().toString(36).slice(2)}`, ...input });
    const prov = await as(maya.token, "providers.add", { providerKey: "openai", connection: "api_key", apiKey: OWN_KEY, scope: "mine" });
    assert.equal(prov.status, 200, JSON.stringify(prov.data));
    assert.equal((await as(maya.token, "providers.set_space_use", { providerId: prov.data.provider.id, allow: true })).status, 200);
    assert.equal((await api(d, d.token, "engine.pool.status", {})).status, 200, "the engine runtime is built");
    const agent = (await as(maya.token, "agents.create", { name: "Intake", role: "You answer briefly." })).data.agent.agentId as string;
    const chan = await as(maya.token, "channels.create", { name: "launch", visibility: "invite", memberIds: [omar.personId], agentIds: [agent] });
    assert.equal(chan.status, 200, JSON.stringify(chan.data));
    const threadId = chan.data.channel.mainThreadId as string;
    await waitFor(async () => { await d.hooks?.pump?.(); return (await api(d, maya.token, "chat.messages.list", { threadId })).status === 200 ? true : null; }, 20_000);
    await as(maya.token, "threads.set_mode", { threadId, mode: "auto" });
    // agents of a channel reply in a thread under the asking message by default; this test reads the channel itself
    await as(maya.token, "threads.set_agent_replies", { threadId, inThreads: false });
    assert.equal((await as(maya.token, "engine.set_model", { threadId, agentId: agent, model: "gpt-test", provider: "openai" })).status, 200);
    // 32 lines in the room: enough for a digest batch
    for (let i = 1; i <= 32; i++) {
      const who = i % 2 === 0 ? omar.token : maya.token;
      for (let tries = 0; tries < 90; tries++) {
        const r = await api(d, who, "chat.post", { threadId, body: i === 1 ? "We ship the portal on Friday 13 November." : `Message ${i}: item ${i} is on track.`, mentions: [], idempotencyKey: `rd-m${i}` });
        if (r.status === 200) break;
        if (!JSON.stringify(r.data).includes("rate_limit")) assert.fail(JSON.stringify(r.data).slice(0, 200));
        await new Promise<void>((res) => setTimeout(res, 1_000));
      }
    }
    // the tag: her turn answers from her key, and building its context starts the digest batch
    assert.equal((await api(d, maya.token, "chat.post", { threadId, body: "@Intake when do we ship?", mentions: [{ kind: "agent", id: agent }], idempotencyKey: "rd-tag" })).status, 200);
    const reply = await waitFor(async () => {
      await d.hooks?.pump?.();
      const ms = (await api(d, maya.token, "chat.messages.list", { threadId })).data.messages as Array<{ author: { kind: string }; body: string }>;
      return ms.find((m) => m.author.kind === "agent" && m.body.trim() !== "")?.body ?? null;
    }, 90_000, () => `${JSON.stringify(seen.map((x) => [x.auth === `Bearer ${OWN_KEY}`, x.system.slice(0, 60)]))} ${hostLog(d).slice(0, 2500)}`);
    assert.match(reply, /Launch is Friday/);
    // the digest batch ran on her key too and was written
    let stored = "";
    for (let i = 0; i < 60 && stored === ""; i++) {
      for (const f of [d.paths.events, d.paths.modules]) { try { const db = new DatabaseSync(f, { readOnly: true }); const r = db.prepare("SELECT text FROM engine_room_digest WHERE thread_id = ?").all(threadId) as Array<{ text: string }>; db.close(); if (r[0]) stored = r[0].text; } catch { /* not this file */ } }
      if (stored === "") await new Promise<void>((res) => setTimeout(res, 500));
    }
    assert.match(stored, /Launch is Friday/, `the digest was written from her key; vendor saw ${JSON.stringify(seen.map((x) => [x.auth === `Bearer ${OWN_KEY}`, x.system.slice(0, 50)]))} log ${hostLog(d).slice(0, 1800)}`);
    assert.ok(seen.length >= 2 && seen.every((x) => x.auth === `Bearer ${OWN_KEY}`), "every request carried her key");
    assert.ok(seen.some((x) => /digest/i.test(x.system)), "one of them was the digest batch");
    // another member cannot run on her account
    const resolved = await api(d, omar.token, "engine.account.resolve", { threadId, agentId: agent });
    assert.ok(resolved.data.accountRef !== "#" && !JSON.stringify(resolved.data).includes(OWN_KEY));
  } finally { globalThis.fetch = real; await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
