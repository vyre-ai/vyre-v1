// rc.9 chat flows on a booted daemon, over HTTP with real tokens for two people. Each flow is one test, started the way a person starts it.
import test from "node:test";
import assert from "node:assert/strict";
import { bootFlowSpace, expectStatus } from "./02-space.ts";

const LIVE = ["agents", "access", "devices", "chat", "engine", "files", "vault", "tasks", "runs", "memory"];

test("flow 1, turn that into a task: a message becomes a task for the person it @names, the task points back, and a card in the thread links to it", async () => {
  const s = await bootFlowSpace(LIVE);
  try {
    const olivia = s.d.token;
    const noah = s.signedIn("usr_noah");
    const dm = expectStatus(await s.call("chat.start", olivia, { idempotencyKey: "f1-dm", kind: "chat", agentIds: [], personId: "usr_noah" }), 200, "chat.start").thread.threadId as string;
    const said = expectStatus(await s.call("chat.post", olivia, { idempotencyKey: "f1-say", threadId: dm, body: "@Noah please send the Rivera letter by Friday\nthanks", mentions: [{ kind: "person", id: "usr_noah" }] }), 200, "chat.post").message.messageId as string;

    const out = expectStatus(await s.call("chat.make_task", olivia, { idempotencyKey: "f1-task", threadId: dm, messageId: said, assigneeId: "usr_noah" }), 200, "chat.make_task");
    // the same key again is the same task, not a second one
    const again = expectStatus(await s.call("chat.make_task", olivia, { idempotencyKey: "f1-task", threadId: dm, messageId: said, assigneeId: "usr_noah" }), 200, "chat.make_task replay");
    assert.equal(again.taskId, out.taskId);

    const task = expectStatus(await s.call("tasks.get", noah, { taskId: out.taskId }), 200, "tasks.get as Noah").task;
    assert.equal(task.title, "please send the Rivera letter by Friday");
    assert.deepEqual(task.assigned, { kind: "person", id: "usr_noah" });
    assert.deepEqual(task.source, { kind: "chat", id: dm });

    // both people see one card in the thread, linking to the task
    for (const who of [olivia, noah]) {
      const msgs = expectStatus(await s.call("chat.messages.list", who, { threadId: dm }), 200, "chat.messages.list").messages as Array<{ kind: string; blocks: Array<{ type: string; data: any }> }>;   // eslint-disable-line @typescript-eslint/no-explicit-any
      const cards = msgs.flatMap((m) => m.blocks).filter((b) => b.type === "link_card");
      assert.equal(cards.length, 1, "one card, even after the replay");
      assert.deepEqual(cards[0]!.data.target, { type: "task", id: out.taskId });
      assert.equal(cards[0]!.data.who, "usr_noah");
    }

    // someone outside the chat cannot have it made for them
    const refused = await s.call("chat.make_task", olivia, { idempotencyKey: "f1-out", threadId: dm, messageId: said, assigneeId: "usr_mia" });
    assert.equal(refused.status, 422);
  } finally { await s.stop(); }
});

test("flow 2, remember that decision: a message becomes a fact (in the project's memory when the chat has one), a card links to it, and a later chat recalls it with the link", async () => {
  const s = await bootFlowSpace(LIVE);
  try {
    const olivia = s.d.token;
    const agent = expectStatus(await s.call("agents.create", olivia, { idempotencyKey: "f2-agent", name: "Archivist", role: "Keeps notes" }), 200, "agents.create").agent.agentId as string;
    const a = expectStatus(await s.call("chat.start", olivia, { idempotencyKey: "f2-a", kind: "chat", agentIds: [agent] }), 200, "chat.start a").thread.threadId as string;
    const said = expectStatus(await s.call("chat.post", olivia, { idempotencyKey: "f2-say", threadId: a, body: "Decision: the Tuesday launch is final, no Friday fallback." }), 200, "chat.post").message.messageId as string;

    const out = expectStatus(await s.call("chat.remember", olivia, { idempotencyKey: "f2-rem", threadId: a, messageId: said }), 200, "chat.remember");
    assert.ok(["person", "project"].includes(out.layer));
    const fact = expectStatus(await s.call("memory.fact.get", olivia, { factId: out.factId }), 200, "memory.fact.get").fact;
    assert.equal(fact.sourceRef, said, "the message is the source");
    assert.match(fact.text, /Tuesday launch is final/);

    const msgs = expectStatus(await s.call("chat.messages.list", olivia, { threadId: a }), 200, "chat.messages.list").messages as Array<{ blocks: Array<{ type: string; data: any }> }>;   // eslint-disable-line @typescript-eslint/no-explicit-any
    const cards = msgs.flatMap((m) => m.blocks).filter((b) => b.type === "link_card");
    assert.equal(cards.length, 1);
    assert.deepEqual(cards[0]!.data.target, { type: "fact", id: out.factId });

    // what the person asked to keep is current at once and readable by them
    const facts = expectStatus(await s.call("memory.facts.list", olivia, { status: ["current"] }), 200, "memory.facts.list").facts as Array<{ factId: string }>;
    assert.ok(facts.some((f) => f.factId === out.factId), "the fact is current");

    // a later chat: recall brings the decision back, with where it came from
    const b = expectStatus(await s.call("chat.start", olivia, { idempotencyKey: "f2-b", kind: "chat", agentIds: [agent] }), 200, "chat.start b").thread.threadId as string;
    const pointer = expectStatus(await s.call("memory.pointer", olivia, { threadId: b, agentId: agent, text: "when is the launch, is there a Friday fallback" }), 200, "memory.pointer");
    assert.ok(JSON.stringify(pointer.lines).includes("Tuesday launch is final"), `recall brings it back: ${JSON.stringify(pointer)}`);
  } finally { await s.stop(); }
});

test("flow 4, @agent in a chat between people: the agent joins when mentioned, the person who mentioned it pays on their own key, and both people see the answer", async () => {
  const { vendor } = await import("../../fixtures/model-vendor.ts");
  const v = await vendor();
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((u: unknown, i?: RequestInit) => { const url = String((u as { url?: string })?.url ?? u); return realFetch(url.startsWith("https://api.openai.com") ? url.replace("https://api.openai.com", v.base) : (u as string), i); }) as typeof fetch;
  const s = await bootFlowSpace(LIVE);
  try {
    const olivia = s.d.token;
    const noah = s.signedIn("usr_noah");
    // each person unlocks their own person key on this node and connects their own OpenAI key
    for (const token of [olivia, noah]) {
      const unlock = await fetch(`${s.d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
      assert.equal(unlock.status, 204);
    }
    const keys = { [olivia]: "sk-test-OLIVIA0123456789abcdef", [noah]: "sk-test-NOAH00123456789abcdef" };   // secret-scan: fake
    for (const token of [olivia, noah]) {
      const added = expectStatus(await s.call("providers.add", token, { idempotencyKey: `f4-key-${token.slice(-6)}`, providerKey: "openai", connection: "api_key", apiKey: keys[token], scope: "mine" }), 200, "providers.add").provider as { id: string };
      expectStatus(await s.call("providers.set_space_use", token, { idempotencyKey: `f4-use-${token.slice(-6)}`, providerId: added.id, allow: true }), 200, "providers.set_space_use");
    }
    const agent = expectStatus(await s.call("agents.create", olivia, { idempotencyKey: "f4-agent", name: "Billing", role: "Sums up invoices", model: "gpt-4o-mini" }), 200, "agents.create").agent.agentId as string;
    const dm = expectStatus(await s.call("chat.start", olivia, { idempotencyKey: "f4-dm", kind: "chat", agentIds: [], personId: "usr_noah" }), 200, "chat.start").thread.threadId as string;
    expectStatus(await s.call("chat.post", olivia, { idempotencyKey: "f4-hi", threadId: dm, body: "Noah, how are the invoices?" }), 200, "chat.post hi");

    // Noah brings Billing in with an @mention
    v.script.push({ text: "Three invoices are paid, two are open." });
    expectStatus(await s.call("chat.post", noah, { idempotencyKey: "f4-ask", threadId: dm, body: "@Billing sum this up for us", mentions: [{ kind: "agent", id: agent }] }), 200, "chat.post mention");
    const end = Date.now() + 40_000;
    let answer: { author?: { kind?: string }; body?: string } | undefined;
    for (;;) {
      await s.d.hooks?.pump?.();
      const msgs = expectStatus(await s.call("chat.messages.list", olivia, { threadId: dm }), 200, "chat.messages.list").messages as Array<{ author?: { kind?: string }; body?: string }>;
      answer = msgs.find((m) => m.author?.kind === "agent" && (m.body ?? "").includes("Three invoices are paid"));
      if (answer || Date.now() > end) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.ok(answer, "the answer lands in the chat for Olivia");
    const seen = expectStatus(await s.call("chat.messages.list", noah, { threadId: dm }), 200, "chat.messages.list noah").messages as Array<{ body?: string }>;
    assert.ok(seen.some((m) => (m.body ?? "").includes("Three invoices are paid")), "and for Noah");
    assert.equal(v.requests.length, 1, "one turn reached the vendor");
    assert.equal(v.auth[0], `Bearer ${keys[noah]}`, "on Noah's key: the person who mentioned it pays");
    const thread = expectStatus(await s.call("threads.get", olivia, { threadId: dm }), 200, "threads.get").thread as { agents: Array<{ agentId: string; mode: string }> };
    assert.deepEqual(thread.agents.map((a) => [a.agentId, a.mode]), [[agent, "listen"]], "it joined as a listener");
  } finally { globalThis.fetch = realFetch; v.close(); await s.stop(); }
});
