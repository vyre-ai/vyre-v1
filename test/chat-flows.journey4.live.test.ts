// rc.9 chat flows in the real app, journey 4: Personal: an assistant's answer becomes a task for yourself and a remembered fact. Needs Node 24, a Chromium and VYRE_APP_DIST; without them it skips and says why, and with VYRE_REQUIRE_CHROME=1 (CI) it fails instead. One journey per file so each stays inside the 120 s cap.
import test from "node:test";
import assert from "node:assert/strict";
import { connectClaude, makeAgent, unlockVault, until } from "./support/mail-world.ts";
import { bootScreens, browserOrSkip, open, seat } from "./support/mail-browser.ts";
import { shoot, shootHere } from "./support/chat-shots.ts";
import { OUT, model, hash } from "./support/chat-flows.ts";

test("journey 4, Personal: an assistant's answer becomes a task for yourself and a remembered fact, ", async (t) => {
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
    // two actions: open the bar (hover), press Make task; the bar carries it in a chat with one person too
    await shootHere(me.page, dir, "bar-showing");
    await me.page.getByTestId(`msg-${reply}`).hover();
    await me.page.getByTestId(`act-make-${reply}`).click();
    await me.page.getByText(/Task created/).first().waitFor({ timeout: 20_000 });
    await me.page.getByTestId(`msg-${reply}`).hover();
    await me.page.getByTestId(`act-remember-${reply}`).click();
    await me.page.getByText(/Remembered/).first().waitFor({ timeout: 20_000 });
    await shoot(me.page, dir, "both-cards", { restore: async () => { await open(me, s, hash(dm)); } });
    const tasks = (await w.owner.ok("tasks.list", { scope: "all" })).tasks as Array<{ title: string; source?: { id?: string } }>;
    assert.ok(tasks.some((x) => /Three invoices are paid/.test(JSON.stringify(x)) && x.source?.id === dm), "the task exists, with the answer's words, pointing back at the chat");
    const facts = (await w.owner.ok("memory.facts.list", {})).facts as Array<{ text: string }>;
    assert.ok(facts.some((f) => /Three invoices are paid/.test(f.text)), "the fact is in memory");
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { await s.close(); }
});
