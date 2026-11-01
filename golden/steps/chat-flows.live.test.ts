// rc.9 chat flows on a booted daemon, over HTTP with real tokens for two people. Each flow is one test, started the way a person starts it.
import test from "node:test";
import assert from "node:assert/strict";
import { bootFlowSpace, expectStatus } from "./02-space.ts";
import { scriptedModel } from "../../test/support/live.ts";

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

test("flow 4, @agent in a chat between people: the agent joins when mentioned, the mentioner is the asker, both people see the answer; a chat opened mid-turn shows the turn so far", async () => {
  const askers: string[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => { release = r; });
  const model = scriptedModel(async function* (input) {
    askers.push(input.asker);
    yield { type: "text", text: "Three invoices are paid" };
    if (/slowly/.test(input.trigger?.body ?? "")) await gate;
    yield { type: "text", text: ", two are open." };
  });
  const s = await bootFlowSpace(LIVE, { engineOpenSession: model });
  try {
    const olivia = s.d.token;
    const noah = s.signedIn("usr_noah");
    // an account the Space may run work on (Olivia's), as in every live chat test
    const unlock = await fetch(`${s.d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${olivia}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    assert.equal(unlock.status, 204);
    const folder = expectStatus(await s.call("vault.folders.create", olivia, { idempotencyKey: "f4-folder", name: "Accounts", scope: "mine" }), 200, "vault.folders.create");
    const flow = expectStatus(await s.call("providers.subscription_start", olivia, { idempotencyKey: "f4-flow", providerKey: "claude-code" }), 200, "subscription_start");
    expectStatus(await s.call("vault.item.put", olivia, { idempotencyKey: "f4-item", folderId: folder.folder.id, name: "Olivia_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ", secret: true }] }), 200, "vault.item.put");   // secret-scan: fake
    const prov = expectStatus(await s.call("providers.subscription_complete", olivia, { flowId: flow.flowId }), 200, "subscription_complete");
    expectStatus(await s.call("providers.set_space_use", olivia, { idempotencyKey: "f4-use", providerId: prov.provider.id, allow: true }), 200, "set_space_use");
    expectStatus(await s.call("engine.pool.status", olivia, {}), 200, "engine.pool.status");

    const agent = expectStatus(await s.call("agents.create", olivia, { idempotencyKey: "f4-agent", name: "Billing", role: "Sums up invoices" }), 200, "agents.create").agent.agentId as string;
    const dm = expectStatus(await s.call("chat.start", noah, { idempotencyKey: "f4-dm", kind: "chat", agentIds: [], personId: "usr_olivia" }), 200, "chat.start").thread.threadId as string;
    expectStatus(await s.call("chat.post", noah, { idempotencyKey: "f4-hi", threadId: dm, body: "Olivia, how are the invoices?" }), 200, "chat.post hi");

    const answerIn = async (token: string, needle: RegExp, ms = 40_000): Promise<boolean> => {
      for (const end = Date.now() + ms; Date.now() < end;) {
        await s.d.hooks?.pump?.();
        const msgs = expectStatus(await s.call("chat.messages.list", token, { threadId: dm }), 200, "chat.messages.list").messages as Array<{ author?: { kind?: string }; body?: string }>;
        if (msgs.some((m) => m.author?.kind === "agent" && needle.test(m.body ?? ""))) return true;
        await new Promise((r) => setTimeout(r, 150));
      }
      return false;
    };
    // Olivia brings Billing in with an @mention in the chat Noah started: it joins as a listener, answers, and Olivia (not the starter) is the asker
    expectStatus(await s.call("chat.post", olivia, { idempotencyKey: "f4-ask", threadId: dm, body: "@Billing sum this up for us", mentions: [{ kind: "agent", id: agent }] }), 200, "chat.post mention");
    assert.ok(await answerIn(olivia, /Three invoices are paid, two are open\./), "the answer lands for Olivia");
    assert.ok(await answerIn(noah, /Three invoices are paid, two are open\./), "and for Noah");
    assert.deepEqual(askers, ["usr_olivia"], "the person who mentioned it is the asker, not the one who started the chat, so the turn runs on their account");
    const thread = expectStatus(await s.call("threads.get", olivia, { threadId: dm }), 200, "threads.get").thread as { agents: Array<{ agentId: string; mode: string }> };
    assert.deepEqual(thread.agents.map((a) => [a.agentId, a.mode]), [[agent, "listen"]], "it joined as a listener");

    // mid-turn: a slow answer is running; anyone who may read the chat gets the text so far at once, and a stranger gets nothing
    expectStatus(await s.call("chat.post", olivia, { idempotencyKey: "f4-slow", threadId: dm, body: "@Billing answer slowly", mentions: [{ kind: "agent", id: agent }] }), 200, "chat.post slow");
    let seen: Array<{ turnId: string; text: string }> = [];
    for (const end = Date.now() + 30_000; Date.now() < end && !seen.some((x) => x.text.includes("Three invoices are paid"));) {
      await s.d.hooks?.pump?.();
      seen = expectStatus(await s.call("engine.live_turns", noah, { threadId: dm }), 200, "engine.live_turns").turns as typeof seen;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(seen.length, 1, "one turn is being written");
    assert.equal(seen[0]!.text, "Three invoices are paid", "its text so far, before it ends");
    release();
    assert.ok(await answerIn(noah, /Three invoices are paid, two are open\./), "the turn finishes and is saved");
    for (const end = Date.now() + 10_000; Date.now() < end;) {
      const after = expectStatus(await s.call("engine.live_turns", noah, { threadId: dm }), 200, "engine.live_turns after").turns as unknown[];
      if (after.length === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  } finally { release(); await s.stop(); }
});

test("flow 5, Share this: a message goes from a chat between people to a channel as a card, the chat it came from says where it went, both open the other; someone who cannot write there is refused", async () => {
  const s = await bootFlowSpace(LIVE);
  try {
    const olivia = s.d.token;
    const noah = s.signedIn("usr_noah");
    const dm = expectStatus(await s.call("chat.start", olivia, { idempotencyKey: "f5-dm", kind: "chat", agentIds: [], personId: "usr_noah" }), 200, "chat.start").thread.threadId as string;
    const said = expectStatus(await s.call("chat.post", noah, { idempotencyKey: "f5-say", threadId: dm, body: "We ship on Friday\nThe letter goes out with it." }), 200, "chat.post").message.messageId as string;
    const ch = expectStatus(await s.call("channels.create", olivia, { idempotencyKey: "f5-ch", name: "ops", visibility: "invite" }), 200, "channels.create").channel as { mainThreadId: string };

    // Noah is not in the invite-only channel: he cannot share there
    const refused = await s.call("chat.share", noah, { idempotencyKey: "f5-no", threadId: dm, messageId: said, toThreadId: ch.mainThreadId });
    assert.ok(refused.status >= 400, "no write access there, no share");

    expectStatus(await s.call("chat.share", olivia, { idempotencyKey: "f5-share", threadId: dm, messageId: said, toThreadId: ch.mainThreadId, to: "#ops" }), 200, "chat.share");
    const there = expectStatus(await s.call("chat.messages.list", olivia, { threadId: ch.mainThreadId }), 200, "list ops").messages as Array<{ kind: string; blocks: Array<{ data: any }> }>;
    const card = there.find((m) => m.kind === "system")!.blocks[0]!.data;
    assert.equal(card.by, "usr_olivia");
    assert.equal(card.title, "We ship on Friday");
    assert.deepEqual(card.target, { type: "thread", id: dm });
    const here = expectStatus(await s.call("chat.messages.list", noah, { threadId: dm }), 200, "list dm").messages as Array<{ kind: string; blocks: Array<{ data: any }> }>;
    const back = here.find((m) => m.kind === "system")!.blocks[0]!.data;
    assert.equal(back.to, "#ops");
    assert.deepEqual(back.target, { type: "thread", id: ch.mainThreadId });
  } finally { await s.stop(); }
});
