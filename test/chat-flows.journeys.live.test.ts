// rc.9 chat flows in the real app (Chrome, the production web export), started the way a person starts them. Needs Node 24, a Chromium and VYRE_APP_DIST (the release-evidence job builds it);
// without them it skips and says why, and with VYRE_REQUIRE_CHROME=1 (CI) it fails instead. Screenshots of every step, light and dark, desktop and phone, go to shots-evidence/chat-flows/<journey>/.
//   1 Team: Maya writes to Olivia; Olivia opens the chat on a line that says what she missed (Catch me up), turns Maya's message into a task (Make a task) and remembers another (Remember This);
//     the cards link to the task and the fact.
//   2 Team: Olivia @mentions an agent in a chat between people; it joins, answers, both people see the answer with Make task and Remember under it, and the mentioner is the one who pays.
//   3 Any chat opened while an agent is mid-answer shows the answer so far at once, on desktop and phone, and finishes live.
//   4 Personal: one person and their assistant: Make a task and Remember This from the agent's answer, no one to assign to but yourself.
import test from "node:test";
import assert from "node:assert/strict";
import { connectClaude, makeAgent, unlockVault, until } from "./support/mail-world.ts";
import { bootScreens, browserOrSkip, open, seat, shoot } from "./support/mail-browser.ts";
import { scriptedModel } from "./support/live.ts";

const OUT = "shots-evidence/chat-flows";
const askers: string[] = [];
let release: () => void = () => undefined;
let gate: Promise<void> = Promise.resolve();
const arm = (): void => { gate = new Promise<void>((r) => { release = r; }); };

/** The model stand-in: answers in two pieces; a question that says "slowly" waits between them until the test lets it go. */
const model = scriptedModel(async function* (input) {
  askers.push(input.asker);
  yield { type: "text", text: "Three invoices are paid" };
  if (/slowly/.test(input.trigger?.body ?? "")) await gate;
  yield { type: "text", text: ", two are open." };
});

const hash = (threadId: string): string => `/chat#screen=chats.conversation&threadId=${threadId}`;

test("journey 1, Team: Catch me up on open, Make a task from a message, Remember This from another, and both leave a card that links", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "team", engineOpenSession: model }, env);
  const dir = `${OUT}/1-team`;
  try {
    const w = s.world;
    const maya = await w.join("maya");
    const dm = (await maya.ok("chat.start", { kind: "chat", agentIds: [], personId: w.owner.id, idempotencyKey: "j1-dm" })).thread.threadId as string;
    const say = async (body: string, key: string): Promise<string> => (await maya.ok("chat.post", { threadId: dm, body, idempotencyKey: key })).message.messageId as string;
    await say("Morning, the Rivera file is ready.", "j1-a");
    const ask = await say("@Olivia please send the Rivera letter by Friday", "j1-b");
    const decision = await say("We decided to ship the letter on Friday.", "j1-c");

    const me = await seat(s, w.owner, "Owner");
    await open(me, s, hash(dm));
    // Catch me up: one line on open, naming who wrote, with a way to jump and a way to dismiss
    await me.page.getByTestId("catch-up-line").waitFor({ timeout: 30_000 });
    assert.match(await me.page.getByTestId("catch-up-line").innerText(), /^Maya wrote\./);
    await shoot(me.page, dir, "catch-up", { restore: async () => { await open(me, s, hash(dm)); } });

    // Make a task: hover the message, press Make a task; a card says where it went
    await me.page.getByTestId(`msg-${ask}`).hover();
    await me.page.getByTestId(`act-make-${ask}`).click();
    await me.page.getByText(/Task created/).first().waitFor({ timeout: 20_000 });
    await shoot(me.page, dir, "task-card", { restore: async () => { await open(me, s, hash(dm)); } });
    const tasks = (await w.owner.ok("tasks.list", {})).tasks as Array<{ title: string; source?: { id?: string } }>;
    const made = tasks.filter((x) => /Rivera letter/.test(x.title));
    assert.equal(made.length, 1, "one task, made once");
    assert.equal(made[0]!.source?.id, dm, "the task points back at the chat");

    // Remember This: the message menu keeps it, and the card says so
    await me.page.getByTestId(`msg-${decision}`).hover();
    await me.page.getByTestId(`act-more-${decision}`).click();
    await me.page.getByText("Remember This").click();
    await me.page.getByText(/Remembered/).first().waitFor({ timeout: 20_000 });
    await shoot(me.page, dir, "remembered", { restore: async () => { await open(me, s, hash(dm)); } });
    const facts = (await w.owner.ok("memory.facts.list", {})).facts as Array<{ text: string }>;
    assert.ok(facts.some((f) => /ship the letter on Friday/.test(f.text)), "the fact is in memory");

    // Got it clears the line and the thread reads as read
    await open(me, s, hash(dm));
    await me.page.getByTestId("catch-up-done").click();
    assert.equal(await me.page.getByTestId("catch-up").count(), 0, "the line is gone");
    await open(me, s, hash(dm));
    await me.page.waitForTimeout(1200);
    assert.equal(await me.page.getByTestId("catch-up").count(), 0, "and does not come back");
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { await s.close(); }
});

test("journey 2, Team: @mention an agent in a chat between people; it joins and answers, both see it with Make task and Remember, and the mentioner is the asker", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  askers.length = 0;
  const s = await bootScreens({ kind: "team", engineOpenSession: model }, env);
  const dir = `${OUT}/2-agent-between-people`;
  try {
    const w = s.world;
    await unlockVault(w);
    const account = await connectClaude(w);
    const agent = await makeAgent(w.owner, "Billing", account);
    const maya = await w.join("maya");
    const dm = (await maya.ok("chat.start", { kind: "chat", agentIds: [], personId: w.owner.id, idempotencyKey: "j2-dm" })).thread.threadId as string;
    await maya.ok("chat.post", { threadId: dm, body: "Olivia, how are the invoices?", idempotencyKey: "j2-hi" });

    const me = await seat(s, w.owner, "Owner");
    const her = await seat(s, maya, "Member");
    await open(me, s, hash(dm));
    await open(her, s, hash(dm));
    await me.page.getByTestId("composer-field").click();
    await me.page.getByTestId("composer-field").fill("@Billing sum this up for us");
    await shoot(me.page, dir, "typed", { phone: false });
    await me.page.getByTestId("composer-send").click();
    await me.page.getByText(/Three invoices are paid, two are open\./).first().waitFor({ timeout: 40_000 });
    await her.page.getByText(/Three invoices are paid, two are open\./).first().waitFor({ timeout: 40_000 });
    await shoot(me.page, dir, "answer-olivia", { restore: async () => { await open(me, s, hash(dm)); } });
    await shoot(her.page, dir, "answer-maya", { restore: async () => { await open(her, s, hash(dm)); } });
    assert.deepEqual(askers, [w.owner.id], "the person who mentioned the agent is the asker");
    assert.ok((await me.page.locator('[data-testid^="reply-task-"]').count()) >= 1, "Make task is under the answer");
    assert.ok((await me.page.locator('[data-testid^="reply-remember-"]').count()) >= 1, "and Remember");
    await me.page.locator('[data-testid^="reply-task-"]').first().click();
    await me.page.getByText(/Task created/).first().waitFor({ timeout: 20_000 });
    await me.page.locator('[data-testid^="reply-remember-"]').first().click();
    await me.page.getByText(/Remembered/).first().waitFor({ timeout: 20_000 });
    await shoot(me.page, dir, "answer-made-work", { restore: async () => { await open(me, s, hash(dm)); } });
    const thread = (await w.owner.ok("threads.get", { threadId: dm })).thread as { agents: Array<{ agentId: string; mode: string }> };
    assert.deepEqual(thread.agents.map((a) => [a.agentId, a.mode]), [[agent, "listen"]]);
    assert.deepEqual([...me.errors, ...her.errors], [], "no page errors");
  } finally { await s.close(); }
});

test("journey 3, a chat opened mid-answer shows the answer so far at once and finishes live, on desktop and phone", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  arm();
  const s = await bootScreens({ kind: "personal", engineOpenSession: model }, env);
  const dir = `${OUT}/3-mid-turn`;
  try {
    const w = s.world;
    await unlockVault(w);
    const account = await connectClaude(w);
    const agent = await makeAgent(w.owner, "Billing", account);
    const started = await w.owner.ok("chat.start", { kind: "chat", agentIds: [agent], idempotencyKey: "j3-chat" });
    const dm = started.thread.threadId as string;
    await w.owner.ok("chat.post", { threadId: dm, body: "answer slowly", mentions: [{ kind: "agent", id: agent }], idempotencyKey: "j3-q" });
    // the answer is half written on the server before any screen opens
    await until(async () => { await w.d.hooks?.pump?.(); const r = await w.owner.ok("engine.live_turns", { threadId: dm }); return (r.turns as Array<{ text: string }>).some((x) => x.text.includes("Three invoices are paid")) ? true : null; }, "the turn is half written");
    const me = await seat(s, w.owner, "Owner");
    await open(me, s, hash(dm));
    await me.page.getByText(/Three invoices are paid/).first().waitFor({ timeout: 20_000 });
    assert.equal(await me.page.getByText(/two are open/).count(), 0, "only the part written so far");
    await shoot(me.page, dir, "half-written", { restore: async () => { await open(me, s, hash(dm)); await me.page.getByText(/Three invoices are paid/).first().waitFor({ timeout: 20_000 }); } });
    release();
    await me.page.getByText(/Three invoices are paid, two are open\./).first().waitFor({ timeout: 30_000 });
    await shoot(me.page, dir, "finished");
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { release(); await s.close(); }
});

test("journey 4, Personal: an assistant's answer becomes a task for yourself and a remembered fact, in two taps", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "personal", engineOpenSession: model }, env);
  const dir = `${OUT}/4-personal`;
  try {
    const w = s.world;
    await unlockVault(w);
    const account = await connectClaude(w);
    const agent = await makeAgent(w.owner, "Billing", account);
    const dm = (await w.owner.ok("chat.start", { kind: "chat", agentIds: [agent], idempotencyKey: "j4-chat" })).thread.threadId as string;
    await w.owner.ok("chat.post", { threadId: dm, body: "How are the invoices?", mentions: [{ kind: "agent", id: agent }], idempotencyKey: "j4-q" });
    const reply = await until(async () => { await w.d.hooks?.pump?.(); const r = await w.owner.ok("chat.messages.list", { threadId: dm }); return (r.messages as Array<{ messageId: string; author?: { kind?: string }; body?: string }>).find((x) => x.author?.kind === "agent" && (x.body ?? "") !== "")?.messageId ?? null; }, "the answer");
    const me = await seat(s, w.owner, "Owner");
    await open(me, s, hash(dm));
    await me.page.getByTestId(`msg-${reply}`).hover();
    await me.page.getByTestId(`act-make-${reply}`).click();
    await me.page.getByText(/Task created/).first().waitFor({ timeout: 20_000 });
    await me.page.getByTestId(`msg-${reply}`).hover();
    await me.page.getByTestId(`act-more-${reply}`).click();
    await me.page.getByText("Remember This").click();
    await me.page.getByText(/Remembered/).first().waitFor({ timeout: 20_000 });
    await shoot(me.page, dir, "both-cards", { restore: async () => { await open(me, s, hash(dm)); } });
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { await s.close(); }
});
