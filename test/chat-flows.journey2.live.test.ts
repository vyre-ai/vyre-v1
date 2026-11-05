// rc.9 chat flows in the real app, journey 2: Team: @mention an agent between people; both see the answer, Make task and Remember are in its hover bar, and the mentioner is the asker. Needs Node 24, a Chromium and VYRE_APP_DIST; without them it skips and says why, and with VYRE_REQUIRE_CHROME=1 (CI) it fails instead. One journey per file so each stays inside the 120 s cap.
import test from "node:test";
import assert from "node:assert/strict";
import { connectClaude, makeAgent, unlockVault, until } from "./support/mail-world.ts";
import { bootScreens, browserOrSkip, open, seat } from "./support/mail-browser.ts";
import { shoot } from "./support/chat-shots.ts";
import { OUT, askers, model, hash } from "./support/chat-flows.ts";

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
    // the answer's own hover bar carries Make task and Remember (nothing is drawn under it at rest)
    assert.equal(await me.page.locator('[data-testid^="reply-task-"], [data-testid^="reply-remember-"]').count(), 0, "nothing under the answer at rest");
    const reply = await until(async () => { const r = await w.owner.ok("chat.messages.list", { threadId: dm }); return (r.messages as Array<{ messageId: string; author?: { kind?: string }; body?: string }>).find((x) => x.author?.kind === "agent" && /Three invoices are paid, two are open\./.test(x.body ?? ""))?.messageId ?? null; }, "the answer is on the server");
    await me.page.getByTestId(`msg-${reply}`).hover();
    await me.page.getByTestId(`act-make-${reply}`).click();
    await me.page.getByText(/Task created/).first().waitFor({ timeout: 20_000 });
    await me.page.getByTestId(`msg-${reply}`).hover();
    await me.page.getByTestId(`act-remember-${reply}`).click();
    await me.page.getByText(/Remembered/).first().waitFor({ timeout: 20_000 });
    const tasks = (await w.owner.ok("tasks.list", { scope: "all" })).tasks as Array<{ title: string; source?: { id?: string } }>;
    assert.ok(tasks.some((x) => /Three invoices are paid/.test(JSON.stringify(x)) && x.source?.id === dm), "the task exists, with the answer's words, pointing back at the chat");
    const facts = (await w.owner.ok("memory.facts.list", {})).facts as Array<{ text: string }>;
    assert.ok(facts.some((f) => /Three invoices are paid/.test(f.text)), "the fact is in memory");
    await shoot(me.page, dir, "answer-made-work", { restore: async () => { await open(me, s, hash(dm)); } });
    const thread = (await w.owner.ok("threads.get", { threadId: dm })).thread as { agents: Array<{ agentId: string; mode: string }> };
    assert.deepEqual(thread.agents.map((a) => [a.agentId, a.mode]), [[agent, "listen"]]);
    assert.deepEqual([...me.errors, ...her.errors], [], "no page errors");
  } finally { await s.close(); }
});
