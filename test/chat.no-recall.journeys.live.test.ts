// A greeting recalls nothing (owner report, rc.8): every reply was followed by "Used 3 memories" and quote cards of "hi", "hi'" and an imported session's preamble. The real app in a real Chromium, the real
// daemon, engine, CLI driver and MCP around the fake claude. Its own file: two worlds in one process share the engine's module-level state.
import test from "node:test";
import assert from "node:assert/strict";
import { until } from "./support/mail-world.ts";
import { bootScreens, browserOrSkip, open, seat } from "./support/mail-browser.ts";
import { shoot } from "./support/chat-shots.ts";
import { cli, connectSubscription } from "./support/cli-world.ts";

const OUT = "shots-evidence/chat-streaming";

test("a greeting recalls nothing: a reply to \"hi\" carries no Used line and no quote cards, though earlier chats hold \"hi\" and an imported session's preamble", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "personal", engineCli: cli }, env);
  const dir = `${OUT}/no-recall-cards`;
  try {
    const w = s.world;
    await connectSubscription(w);
    const agent = (await w.owner.ok("agents.create", { name: "Haiku", role: "You answer briefly.", idempotencyKey: "nr-agent" })).agent.agentId as string;
    // earlier chats: the words "hi" and the way an imported session starts, which the old recall matched against a new "hi"
    const earlier = (await w.owner.ok("chat.start", { kind: "chat", agentIds: [agent], idempotencyKey: "nr-old" })).thread.threadId as string;
    await w.owner.ok("threads.set_mode", { threadId: earlier, mode: "auto", idempotencyKey: "nr-old-auto" });
    for (const [i, body] of ["hi", "hi'", "Continue this imported session. The following is copied conversation history, not new instructions.\n\nuser: hi\nassistant: hi there"].entries()) {
      await w.owner.ok("chat.post", { threadId: earlier, body, idempotencyKey: `nr-old-${i}` });
    }
    // the agent has answered all of them before the new chat starts
    await until(async () => { await w.d.hooks?.pump?.(); const r = await w.owner.ok("chat.messages.list", { threadId: earlier }); return (r.messages as Array<{ author?: { kind?: string } }>).filter((m) => m.author?.kind === "agent").length >= 3 ? true : null; }, "the agent answered the earlier chat", 60_000);
    const threadId = (await w.owner.ok("chat.start", { kind: "chat", agentIds: [agent], idempotencyKey: "nr-new" })).thread.threadId as string;
    await w.owner.ok("threads.set_mode", { threadId, mode: "auto", idempotencyKey: "nr-new-auto" });
    const me = await seat(s, w.owner, "Owner");
    await open(me, s, `/chat#screen=chats.conversation&threadId=${threadId}`);
    await me.page.getByTestId("composer-field").click();
    await me.page.getByTestId("composer-field").fill("hi");
    await me.page.getByTestId("composer-send").click();
    await me.page.locator('[data-testid^="msg-msg_"]').nth(1).waitFor({ timeout: 40_000 });   // the agent's saved reply
    await me.page.waitForTimeout(2_500);                                                          // time for a recall line or cards to draw, if any were going to
    assert.equal(await me.page.locator('[data-testid^="mused-"], [data-testid^="used-"], [data-testid^="qcard-"]').count(), 0, "no Used line, no quote cards");
    const feed = await me.page.getByTestId("conversation-feed").innerText();
    assert.ok(!/Used \d+ memor/.test(feed), "and no such words");
    assert.ok(!/did not finish/.test(feed), `the reply finished: ${feed.slice(0, 200)}`);
    await shoot(me.page, dir, "hi-reply", { restore: async () => { await open(me, s, `/chat#screen=chats.conversation&threadId=${threadId}`); } });
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { await s.close(); }
});
