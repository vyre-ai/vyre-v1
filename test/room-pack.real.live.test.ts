// The room pack against a real model (owner approved small real-model tests, 4 Nov): needs OPENCODE_API_KEY in the environment (a flat OpenCode Go plan, nothing metered); skipped without it. Seeds a
// 300-message channel of two people, then tags the agent 3 times with the pack and 3 times without (VYRE_ROOM_PACK=off), timing the tag to the first visible text (engine.live_turns), and
// prints the one real digest batch the 300 messages cause. The key is only ever read from the environment and is never printed.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { boot, hostLog, seededDir, waitFor } from "./support/live.ts";
import { api, door, join } from "./member-key-kit.ts";

const KEY = process.env["OPENCODE_API_KEY"];

test("real model: time to first visible text in a seeded 300-message room, with and without the pack, and one real digest", { skip: !KEY && "OPENCODE_API_KEY is not set", timeout: 1_700_000 }, async () => {
  let phase = "pre-join";
  const leaks: string[] = [];
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
      if (url.includes("chat/completions") && /(80|61)[, ]?000/.test(String(init?.body ?? ""))) {
        const body = String(init?.body ?? "");
        const hits = [...body.matchAll(/(80|61)[, ]?000/g)].slice(0, 4).map((m) => body.slice(Math.max(0, m.index! - 260), m.index! + 60).replace(/\\n/g, " / "));
        if (phase === "post-join") leaks.push(hits[0] ?? "");
        console.log("OUT|LEAKSRC[" + phase + "] " + JSON.stringify(hits));
      }
      return real(input, init);
    }) as typeof fetch;
  }
  const d = await boot(seededDir(), null, { realVault: true });   // the real Vault: her key comes out of her own Vault, as in a Team Space
  try {
    // the person who owns the key is a member who joined the way a person does: the Space reads her Vault only while her key is held (the https door), so a turn on her account needs her signed in
    const maya = await join(d, "maya");
    assert.equal((await door(d, maya.token, "unlock", maya.personKey)).status, 204);
    const as = async (token: string, cap: string, input: Record<string, unknown>): Promise<{ status: number; data: any }> => api(d, token, cap, { idempotencyKey: `rr-${cap}-${Math.random().toString(36).slice(2)}`, ...input });   // eslint-disable-line @typescript-eslint/no-explicit-any
    const prov = await as(maya.token, "providers.add", { providerKey: "opencode-go", connection: "api_key", apiKey: KEY, scope: "mine" });
    assert.equal(prov.status, 200, JSON.stringify(prov.data).replaceAll(KEY!, "***"));
    const allowed = await as(maya.token, "providers.set_space_use", { providerId: prov.data.provider.id, allow: true });
    assert.equal(allowed.status, 200, JSON.stringify(allowed.data));
    const models = (await api(d, maya.token, "engine.models.list", { refresh: true, wait: true })).data.models as Array<{ model: string; allowed: boolean }> | undefined;
    const ok = (models ?? []).filter((m) => m.allowed);
    const model = ok.find((m) => /glm-5\.3-flash/i.test(m.model))?.model ?? ok.find((m) => /flash/i.test(m.model))?.model;
    console.log(`using ${model} of ${ok.length} models`);
    assert.ok(model, "the account lists a model");
    // the first engine call builds the runtime that routes a tag into a turn
    assert.equal((await api(d, d.token, "engine.pool.status", {})).status, 200);
    const omar = await join(d, "omar");
    assert.equal((await door(d, omar.token, "unlock", omar.personKey)).status, 204);
    const provO = await as(omar.token, "providers.add", { providerKey: "opencode-go", connection: "api_key", apiKey: KEY, scope: "mine" });
    assert.equal(provO.status, 200, JSON.stringify(provO.data).replaceAll(KEY!, "***"));
    assert.equal((await as(omar.token, "providers.set_space_use", { providerId: provO.data.provider.id, allow: true })).status, 200);
    const made0 = await as(maya.token, "agents.create", { name: "Intake", role: "You answer intake questions briefly." });
    assert.equal(made0.status, 200, JSON.stringify(made0.data));
    const agent = made0.data.agent.agentId as string;
    await as(maya.token, "agents.update", { agentId: agent, patch: { model } });
    const made = await as(maya.token, "channels.create", { name: "launch", visibility: "invite", memberIds: [omar.personId], agentIds: [agent] });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const threadId = made.data.channel.mainThreadId as string;
    await waitFor(async () => { await d.hooks?.pump?.(); return (await api(d, maya.token, "chat.messages.list", { threadId })).status === 200 ? true : null; }, 20_000);
    await as(maya.token, "threads.set_mode", { threadId, mode: "auto" });
    // agents of a channel reply in a thread under the asking message by default; this test reads the channel itself
    await as(maya.token, "threads.set_agent_replies", { threadId, inThreads: false });
    const pick = await as(maya.token, "engine.set_model", { threadId, agentId: agent, model, provider: "opencode_go" });
    console.log(`set_model ${pick.status} ${JSON.stringify(pick.data).slice(0, 200)}`);
    const script = [
      "We ship the client portal on Friday 13 November. Maya owns the launch checklist.", "Omar owns the pricing page and the FAQ.", "Decision: pricing stays at 49 a month, no annual discount for launch.",
      "Blocked: the SSO redirect fails on staging, Omar is chasing the vendor.", "Sam from support joins on Wednesday for the customer email.", "Decision: the launch email goes out Thursday 12 November at 9am.",
    ];
    const N = Number(process.env["ROOM_N"] ?? 300);
    for (let i = 1; i <= N; i++) {
      const who = i % 2 === 0 ? omar.token : maya.token;
      const body = i <= script.length * 40 && i % 40 === 1 ? script[(i - 1) / 40]! : `Message ${i}: checklist item ${i} is ${i % 7 === 0 ? "blocked on pricing" : "on track"}.`;
      for (let tries = 0; tries < 90; tries++) {
        const r = await fetch(`${d.url}/v1/chat/post`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify({ threadId, body, mentions: [], idempotencyKey: `rr-m${i}` }) });
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
        const p = await api(d, maya.token, "chat.post", { threadId, body: `@Intake what is the launch date and who owns pricing? (${n})`, mentions: [{ kind: "agent", id: agent }], idempotencyKey: `rr-tag${n}` });
        if (p.status === 200) break;
        if (!JSON.stringify(p.data).includes("rate_limit")) assert.fail(JSON.stringify(p.data).slice(0, 200));
        await new Promise<void>((res) => setTimeout(res, 1_000));
      }
      const seqOf = async (): Promise<number> => ((await api(d, maya.token, "chat.messages.list", { threadId, limit: 5 })).data.messages as Array<{ threadSeq: number }>).reduce((n, m) => Math.max(n, m.threadSeq), 0);
      const seen = await seqOf();   // the window holds the newest 50, so a count never moves: the sequence does
      const at = await waitFor(async () => {
        await d.hooks?.pump?.();
        const r = await api(d, maya.token, "engine.live_turns", { threadId });
        const turns = (r.data.turns ?? []) as Array<{ text: string }>;
        if (turns.some((x) => x.text.trim() !== "")) return Date.now();
        // a short reply can be done between two polls: the message itself is then the first visible text
        const m = (await api(d, maya.token, "chat.messages.list", { threadId, limit: 10 })).data.messages as Array<{ threadSeq: number; author: { kind: string }; body: string }>;
        return m.some((x) => x.threadSeq > seen && x.author.kind === "agent" && x.body.trim() !== "") ? Date.now() : null;
      }, 60_000, () => hostLog(d).replaceAll(KEY!, "***").slice(0, 1500)).catch(async (e: Error) => {
        const m = (await api(d, maya.token, "chat.messages.list", { threadId, limit: 6 })).data.messages as Array<{ author: { kind: string; id: string }; kind: string; body: string }>;
        const now = await api(d, maya.token, "engine.now", {});
        const res = await api(d, maya.token, "engine.account.resolve", { threadId, agentId: agent });
        const turns = await api(d, maya.token, "engine.turns.list", { threadId });
        console.log("DBG resolve", JSON.stringify(res.data).slice(0, 300), "TURNS", JSON.stringify(turns.data).slice(0, 700));
        throw new Error(`${e.message.slice(0, 200)} LAST ${JSON.stringify(m.map((x) => `${x.author.kind}/${x.kind}: ${x.body.slice(0, 120)}`))} NOW ${JSON.stringify(now.data).slice(0, 300)}`);
      });
      // let the turn finish before the next one
      await waitFor(async () => { const r = await api(d, maya.token, "engine.live_turns", { threadId }); return ((r.data.turns ?? []) as unknown[]).length === 0 ? true : null; }, 180_000);
      await new Promise<void>((res) => setTimeout(res, 800));
      return at - t0;
    };
    const timing = process.env["ROOM_TIMING"] !== "off";
    if (timing) {
    await firstText("off", 0);   // the first turn builds the runtime and warms the connection
    const on: number[] = [], off: number[] = [];
    for (let n = 1; n <= 5; n++) { off.push(await firstText("off", n * 2)); on.push(await firstText("on", n * 2 + 1)); }
    console.log(`OUT|REAL first visible text (ms), model ${model}: without the pack ${off.join(", ")}; with the pack ${on.join(", ")}`);
    }
    const last = (await api(d, maya.token, "chat.messages.list", { threadId, limit: 4 })).data.messages as Array<{ author: { kind: string }; body: string }>;
    console.log(`OUT|last reply: ${last.filter((m) => m.author.kind === "agent").at(-1)?.body.slice(0, 300)}`);
    // the digest the 300 messages caused
    let digest = "";
    for (let i = 0; i < 60 && digest === ""; i++) {
      for (const f of [d.paths.events, d.paths.modules]) {
        try { const db = new DatabaseSync(f, { readOnly: true }); const r = db.prepare("SELECT text, up_to_seq FROM engine_room_digest WHERE thread_id = ?").all(threadId) as Array<{ text: string; up_to_seq: number }>; db.close(); if (r[0]) digest = `${r[0].text}\n(up to message ${r[0].up_to_seq})`; } catch { /* not in this file */ }
      }
      if (digest === "") await new Promise<void>((res) => setTimeout(res, 1_000));
    }
    console.log(`OUT|DIGEST ${(digest || "(none written)").replaceAll("\n", " // ")}`);

    // ---- the walk: what the agent knew and did not know, asked in plain words as Omar
    const ask = async (tid: string, as: string, body: string, key: string): Promise<string> => {
      const before = ((await api(d, maya.token, "chat.messages.list", { threadId: tid, limit: 5 })).data.messages as Array<{ threadSeq: number }>).reduce((n, m) => Math.max(n, m.threadSeq), 0);
      for (let tries = 0; tries < 90; tries++) {
        const r = await fetch(`${d.url}/v1/chat/post`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${as}` }, body: JSON.stringify({ threadId: tid, body, mentions: [{ kind: "agent", id: agent }], idempotencyKey: key }) });
        const t = await r.text();
        if (r.status === 200) break;
        if (!t.includes("rate_limit")) assert.fail(t.slice(0, 200));
        await new Promise<void>((res) => setTimeout(res, 1_000));
      }
      return waitFor(async () => {
        await d.hooks?.pump?.();
        if (process.env["SPY"] && Date.now() % 20 === 0) console.log("OUT|WAIT");
        const m = (await api(d, maya.token, "chat.messages.list", { threadId: tid, limit: 20 })).data.messages as Array<{ threadSeq: number; author: { kind: string }; body: string }>;
        const a = m.filter((x) => x.threadSeq > before && x.author.kind === "agent" && x.body.trim() !== "");
        return a.length ? a.map((x) => x.body).join(" ") : null;
      }, 120_000).catch(async (e) => {
        const m = (await api(d, maya.token, "chat.messages.list", { threadId: tid, limit: 8 })).data.messages as Array<{ threadSeq: number; author: { kind: string }; body: string }>;
        console.log("OUT|NOREPLY " + JSON.stringify(m.map((x) => [x.threadSeq, x.author.kind, x.body.slice(0, 160)])));
        throw e;
      });
    };
    // 1. a channel: tagged by Maya, whose account pays
    console.log(`OUT|WALK channel: ${(await ask(threadId, maya.token, "@Intake in one sentence: when does the launch email go out, and what is blocked?", "rr-w1")).slice(0, 400)}`);
    // 2. a thread under a message of the channel
    const dec = await api(d, maya.token, "chat.post", { threadId, body: "Decision: pricing stays at 49 a month, no annual discount for launch.", mentions: [], idempotencyKey: "rr-decision" });
    assert.equal(dec.status, 200, JSON.stringify(dec.data));
    const parent = { messageId: dec.data.message.messageId as string };
    const th = await api(d, maya.token, "chat.thread", { threadId, messageId: parent.messageId, idempotencyKey: "rr-thread" });
    assert.equal(th.status, 200, JSON.stringify(th.data));
    console.log(`OUT|WALK thread: ${(await ask(th.data.thread.threadId as string, maya.token, "@Intake what is the decision this thread hangs off, in one sentence?", "rr-w2")).slice(0, 400)}`);
    // 3. a room that gained a person: the owner talks with the agent alone first, then Omar joins and asks about it
    const priv = await api(d, maya.token, "channels.create", { name: "plans", visibility: "invite", agentIds: [agent], idempotencyKey: "rr-chan2" });
    assert.equal(priv.status, 200, JSON.stringify(priv.data));
    const pt = priv.data.channel.mainThreadId as string;
    await waitFor(async () => { await d.hooks?.pump?.(); return (await api(d, maya.token, "chat.messages.list", { threadId: pt })).status === 200 ? true : null; }, 20_000);
    await api(d, maya.token, "threads.set_mode", { threadId: pt, mode: "auto", idempotencyKey: "rr-auto2" });
    await api(d, maya.token, "threads.set_agent_replies", { threadId: pt, inThreads: false, idempotencyKey: "rr-rep2" });
    await api(d, maya.token, "engine.set_model", { threadId: pt, agentId: agent, model, provider: "opencode_go", idempotencyKey: "rr-pick2" });
    await ask(pt, maya.token, "@Intake private note for me only: my budget ceiling for the Acme deal is 80000 dollars, remember it.", "rr-w3a");
    await ask(pt, maya.token, "@Intake private note for me only: my walk-away price for the Harbor deal is 61000 dollars, remember it too.", "rr-w3a2");
    phase = "post-join";
    const add = await api(d, maya.token, "channels.members.add", { channelId: priv.data.channel.channelId, personIds: [omar.personId], idempotencyKey: "rr-add2" });
    assert.equal(add.status, 200, JSON.stringify(add.data));
    await waitFor(async () => { await d.hooks?.pump?.(); return (await api(d, maya.token, "chat.messages.list", { threadId: pt }).then((r) => r)).status === 200 ? true : null; }, 20_000);
    await new Promise<void>((res) => setTimeout(res, 1_500));
    const tg = await api(d, maya.token, "threads.get", { threadId: pt });
    const lastBefore = ((await api(d, maya.token, "chat.messages.list", { threadId: pt, limit: 3 })).data.messages as Array<{ threadSeq: number }>).reduce((n, m) => Math.max(n, m.threadSeq), 0);
    console.log(`OUT|joinedAt ${JSON.stringify(tg.data.thread?.joinedAt)} members ${(tg.data.thread?.members ?? []).length}`);
    const answerOmar = await ask(pt, omar.token, "@Intake what is the budget ceiling for the Acme deal and the walk-away price for Harbor?", "rr-w3b-omar");
    console.log(`OUT|WALK gained-a-person asker=omar: ${answerOmar.slice(0, 400)}`);
    const answer = await ask(pt, maya.token, "@Intake what is the budget ceiling for the Acme deal and the walk-away price for Harbor that we discussed earlier?", "rr-w3b");
    {
      const tr = await api(d, maya.token, "chat.transcript.read", { threadId: pt });
      const md = String((tr.data as { markdown?: string }).markdown ?? "");
      const tail = md.slice(-3500).replaceAll("\n", " // ");
      console.log(`OUT|TOOLS (transcript tail, ${md.length} chars): ${tail}`);
    }
    console.log(`OUT|WALK gained-a-person asker=maya: ${answer.slice(0, 400)}`);
    if (process.env["SPY"]) {
      assert.equal(leaks.length, 0, `a request after the join carried a figure said before it: ${leaks[0]?.slice(0, 300)}`);
      assert.doesNotMatch(`${answerOmar} ${answer}`, /(80|61)[, ]?000/, "no answer carries a figure said before the join");
    }
  } finally { delete process.env["VYRE_ROOM_PACK"]; await d.stop(); }
});
