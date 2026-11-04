// The room pack against a real model (owner approved small real-model tests, 4 Nov): needs OPENCODE_API_KEY in the environment (a flat OpenCode Go plan, nothing metered); skipped without it. Seeds a
// 300-message channel of two people, then tags the agent 3 times with the pack and 3 times without (VYRE_ROOM_PACK=off), timing the tag to the first visible text (engine.live_turns), and
// prints the one real digest batch the 300 messages cause. The key is only ever read from the environment and is never printed.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { boot, call, hostLog, seededDir, waitFor } from "./support/live.ts";
import { join } from "./member-key-kit.ts";

const KEY = process.env["OPENCODE_API_KEY"];

test("real model: time to first visible text in a seeded 300-message room, with and without the pack, and one real digest", { skip: !KEY && "OPENCODE_API_KEY is not set", timeout: 900_000 }, async () => {
  if (process.env["SPY"]) {
    const real = globalThis.fetch;
    let n = 0;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("opencode.ai") && n++ < 3) {
        const h = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k, k.toLowerCase() === "authorization" ? (() => { const got = String(v).slice(7); let pre = 0; while (pre < got.length && got[pre] === KEY![pre]) pre++; return `Bearer <${got.length} chars, common prefix ${pre}, is substring ${KEY!.includes(got)}, has newline ${/\s/.test(got)}, first4 ${got.slice(0, 4)}>`; })() : v]));
        const b = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        console.log(`SPY ${url} headers ${JSON.stringify(h)} body keys ${Object.keys(b).join(",")} model ${String(b["model"])} tools ${Array.isArray(b["tools"]) ? b["tools"].length : 0}`);
      }
      return real(input, init);
    }) as typeof fetch;
  }
  const d = await boot(seededDir(), null, { realVault: true });
  try {
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    assert.equal(unlock.status, 204);
    const prov = await call(d, "providers.add", { providerKey: "opencode-go", connection: "api_key", apiKey: KEY, scope: "mine", idempotencyKey: "rr-prov" });
    assert.equal(prov.status, 200, JSON.stringify(prov.data).replaceAll(KEY!, "***"));
    const models = (await call(d, "engine.models.list", { refresh: true, wait: true })).data.models as Array<{ model: string; allowed: boolean }> | undefined;
    const ok = (models ?? []).filter((m) => m.allowed);
    const model = ok.find((m) => /glm-5\.3-flash/i.test(m.model))?.model ?? ok.find((m) => /flash/i.test(m.model))?.model ?? ok[0]?.model;
    console.log(`models: ${ok.map((m) => m.model).join(", ")}; using ${model}`);
    assert.ok(model, "the account lists a model");
    const accts = (await call(d, "engine.accounts.list", { place: "chat" })).data.accounts as Array<{ ref: string; name: string; provider: string; usable: boolean; kind: string }>;
    console.log(`accounts: ${accts.map((a) => `${a.ref}|${a.provider}|${a.kind}|usable ${a.usable}`).join("; ")}`);
    const omar = await join(d, "omar");
    const made0 = await call(d, "agents.create", { name: "Intake", role: "You answer intake questions briefly.", idempotencyKey: "rr-agent" });
    const agent = made0.data.agent.agentId as string;
    await call(d, "agents.update", { agentId: agent, patch: { model }, idempotencyKey: "rr-agent-model" });
    const made = await call(d, "channels.create", { name: "launch", visibility: "invite", memberIds: [omar.personId], agentIds: [agent], idempotencyKey: "rr-chan" });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const threadId = made.data.channel.mainThreadId as string;
    await waitFor(async () => { await d.hooks?.pump?.(); return (await call(d, "chat.messages.list", { threadId })).status === 200 ? true : null; }, 20_000);
    await call(d, "threads.set_mode", { threadId, mode: "auto", idempotencyKey: "rr-auto" });
    const pick = await call(d, "engine.set_model", { threadId, agentId: agent, model, provider: "opencode_go", idempotencyKey: "rr-pick" });
    console.log(`set_model ${pick.status} ${JSON.stringify(pick.data).slice(0, 200)}`);
    const script = [
      "We ship the client portal on Friday 13 November. Maya owns the launch checklist.", "Omar owns the pricing page and the FAQ.", "Decision: pricing stays at 49 a month, no annual discount for launch.",
      "Blocked: the SSO redirect fails on staging, Omar is chasing the vendor.", "Sam from support joins on Wednesday for the customer email.", "Decision: the launch email goes out Thursday 12 November at 9am.",
    ];
    const N = Number(process.env["ROOM_N"] ?? 300);
    for (let i = 1; i <= N; i++) {
      const as = i % 2 === 0 ? omar.token : d.token;
      const body = i <= script.length * 40 && i % 40 === 1 ? script[(i - 1) / 40]! : `Message ${i}: checklist item ${i} is ${i % 7 === 0 ? "blocked on pricing" : "on track"}.`;
      for (let tries = 0; tries < 90; tries++) {
        const r = await fetch(`${d.url}/v1/chat/post`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${as}` }, body: JSON.stringify({ threadId, body, mentions: [], idempotencyKey: `rr-m${i}` }) });
        const t = await r.text();
        if (r.status === 200) break;
        if (!t.includes("rate_limit")) assert.fail(`post ${i}: ${t.slice(0, 200)}`);
        await new Promise<void>((res) => setTimeout(res, 1_000));
      }
    }
    const firstText = async (pack: "on" | "off", n: number): Promise<number> => {
      if (pack === "off") process.env["VYRE_ROOM_PACK"] = "off"; else delete process.env["VYRE_ROOM_PACK"];
      const t0 = Date.now();
      for (let tries = 0; tries < 90; tries++) {
        const p = await call(d, "chat.post", { threadId, body: `@Intake what is the launch date and who owns pricing? (${n})`, mentions: [{ kind: "agent", id: agent }], idempotencyKey: `rr-tag${n}` });
        if (p.status === 200) break;
        if (!JSON.stringify(p.data).includes("rate_limit")) assert.fail(JSON.stringify(p.data).slice(0, 200));
        await new Promise<void>((res) => setTimeout(res, 1_000));
      }
      const seen = ((await call(d, "chat.messages.list", { threadId })).data.messages as unknown[]).length;
      const at = await waitFor(async () => {
        const r = await call(d, "engine.live_turns", { threadId });
        const turns = (r.data.turns ?? []) as Array<{ text: string }>;
        if (turns.some((x) => x.text.trim() !== "")) return Date.now();
        // a short reply can be done between two polls: the message itself is then the first visible text
        const m = (await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ author: { kind: string }; body: string }>;
        return m.slice(seen).some((x) => x.author.kind === "agent" && x.body.trim() !== "") ? Date.now() : null;
      }, 120_000, () => hostLog(d).replaceAll(KEY!, "***").slice(0, 7000));
      // let the turn finish before the next one
      await waitFor(async () => { const r = await call(d, "engine.live_turns", { threadId }); return ((r.data.turns ?? []) as unknown[]).length === 0 ? true : null; }, 180_000);
      await new Promise<void>((res) => setTimeout(res, 800));
      return at - t0;
    };
    await firstText("off", 0);   // the first turn builds the runtime and warms the connection
    const on: number[] = [], off: number[] = [];
    for (let n = 1; n <= 3; n++) { off.push(await firstText("off", n * 2)); on.push(await firstText("on", n * 2 + 1)); }
    console.log(`REAL first visible text (ms), model ${model}: without the pack ${off.join(", ")}; with the pack ${on.join(", ")}`);
    const last = (await call(d, "chat.messages.list", { threadId, limit: 4 })).data.messages as Array<{ author: { kind: string }; body: string }>;
    console.log(`last reply: ${last.filter((m) => m.author.kind === "agent").at(-1)?.body.slice(0, 300)}`);
    // the digest the 300 messages caused
    let digest = "";
    for (let i = 0; i < 60 && digest === ""; i++) {
      for (const f of [d.paths.events, d.paths.modules]) {
        try { const db = new DatabaseSync(f, { readOnly: true }); const r = db.prepare("SELECT text, up_to_seq FROM engine_room_digest WHERE thread_id = ?").all(threadId) as Array<{ text: string; up_to_seq: number }>; db.close(); if (r[0]) digest = `${r[0].text}\n(up to message ${r[0].up_to_seq})`; } catch { /* not in this file */ }
      }
      if (digest === "") await new Promise<void>((res) => setTimeout(res, 1_000));
    }
    console.log(`DIGEST:\n${digest || "(none written)"}`);

    // ---- the walk: what the agent knew and did not know, asked in plain words as Omar
    const ask = async (tid: string, as: string, body: string, key: string): Promise<string> => {
      const before = ((await call(d, "chat.messages.list", { threadId: tid })).data.messages as unknown[]).length;
      for (let tries = 0; tries < 90; tries++) {
        const r = await fetch(`${d.url}/v1/chat/post`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${as}` }, body: JSON.stringify({ threadId: tid, body, mentions: [{ kind: "agent", id: agent }], idempotencyKey: key }) });
        const t = await r.text();
        if (r.status === 200) break;
        if (!t.includes("rate_limit")) assert.fail(t.slice(0, 200));
        await new Promise<void>((res) => setTimeout(res, 1_000));
      }
      return waitFor(async () => {
        const m = (await call(d, "chat.messages.list", { threadId: tid })).data.messages as Array<{ author: { kind: string }; body: string }>;
        const a = m.slice(before).filter((x) => x.author.kind === "agent" && x.body.trim() !== "");
        return a.length ? a.map((x) => x.body).join(" ") : null;
      }, 120_000);
    };
    // 1. a channel: tagged by Omar
    console.log(`WALK channel: ${(await ask(threadId, omar.token, "@Intake in one sentence: when does the launch email go out, and what is blocked?", "rr-w1")).slice(0, 400)}`);
    // 2. a thread under a message of the channel
    const msgs = (await call(d, "chat.messages.list", { threadId, limit: 200 })).data.messages as Array<{ messageId: string; body: string }>;
    const parent = msgs.find((m) => m.body.startsWith("Decision: pricing stays"))!;
    const th = await call(d, "chat.thread", { threadId, messageId: parent.messageId, idempotencyKey: "rr-thread" });
    assert.equal(th.status, 200, JSON.stringify(th.data));
    console.log(`WALK thread: ${(await ask(th.data.thread.threadId as string, omar.token, "@Intake what is the decision this thread hangs off, in one sentence?", "rr-w2")).slice(0, 400)}`);
    // 3. a room that gained a person: the owner talks with the agent alone first, then Omar joins and asks about it
    const priv = await call(d, "channels.create", { name: "plans", visibility: "invite", agentIds: [agent], idempotencyKey: "rr-chan2" });
    assert.equal(priv.status, 200, JSON.stringify(priv.data));
    const pt = priv.data.channel.mainThreadId as string;
    await waitFor(async () => { await d.hooks?.pump?.(); return (await call(d, "chat.messages.list", { threadId: pt })).status === 200 ? true : null; }, 20_000);
    await call(d, "threads.set_mode", { threadId: pt, mode: "auto", idempotencyKey: "rr-auto2" });
    await call(d, "engine.set_model", { threadId: pt, agentId: agent, model, provider: "opencode_go", idempotencyKey: "rr-pick2" });
    await ask(pt, d.token, "@Intake private note for me only: my budget ceiling for the Acme deal is 80000 dollars, remember it.", "rr-w3a");
    const add = await call(d, "channels.members.add", { channelId: priv.data.channel.channelId, personIds: [omar.personId], idempotencyKey: "rr-add2" });
    assert.equal(add.status, 200, JSON.stringify(add.data));
    await waitFor(async () => { await d.hooks?.pump?.(); return (await call(d, "chat.messages.list", { threadId: pt }).then((r) => r)).status === 200 ? true : null; }, 20_000);
    await new Promise<void>((res) => setTimeout(res, 1_500));
    console.log(`WALK gained-a-person: ${(await ask(pt, omar.token, "@Intake what is the budget ceiling for the Acme deal that was discussed here earlier?", "rr-w3b")).slice(0, 400)}`);
  } finally { delete process.env["VYRE_ROOM_PACK"]; await d.stop(); }
});
